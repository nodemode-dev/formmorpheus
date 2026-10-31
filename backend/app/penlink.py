"""Pen Link: a tablet with a pen and a browser as a pressure-sensitive drawing tablet over the local network.

Two halves live here:

* `router` on the normal loopback API (`/api/penlink/...`, guarded like everything else): the desktop app starts and
  stops Pen Link, reads its status, and holds one WebSocket (`/api/penlink/desk`) through which tablet samples reach
  the app and canvas mirror frames go back.
* the LAN listener: a second uvicorn Server in this process on 0.0.0.0, alive only between start and stop (or engine
  exit). Its ASGI app answers exactly `/penlink/` (the companion page and its two assets), `POST /penlink/pair` and the
  WebSocket `/penlink/ws`. Every other path is a 404, so none of the engine API is reachable through it.
"""
import asyncio
import hmac
import json
import secrets
import socket
import time
from pathlib import Path

import uvicorn
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter()

DEFAULT_PORT = 9495
CODE_SECONDS = 120
CODE_TRIES = 5
GRACE_SECONDS = 30        # a dropped tablet keeps its token this long
MAX_TABLET_MESSAGE = 65536
MAX_PER_SECOND = 1500     # tablet messages; more are dropped
STATIC = Path(__file__).parent / "penlink_static"
FILES = {"": ("index.html", "text/html; charset=utf-8"), "index.html": ("index.html", "text/html; charset=utf-8"),
         "pen.js": ("pen.js", "text/javascript; charset=utf-8"), "pen.css": ("pen.css", "text/css; charset=utf-8")}
HEADERS = [
    (b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"), (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"content-security-policy", b"default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'"),
]


class _Quiet(uvicorn.Server):
    """Runs inside the engine's loop: the engine owns the signals, this server must not take them."""

    async def serve(self, sockets=None) -> None:   # noqa: ANN001
        await self._serve(sockets)


class _State:
    def __init__(self) -> None:
        self.server: _Quiet | None = None
        self.task: asyncio.Task | None = None
        self.port = 0
        self.hosts: set[str] = set()
        self.urls: list[str] = []
        self.code = ""
        self.code_until = 0.0
        self.tries = 0
        self.token = ""
        self.device = ""
        self.tablet: object | None = None       # the tablet's send callable while connected
        self.tablet_close: object | None = None
        self.gone_at = 0.0
        self.desk: WebSocket | None = None
        self.revoker: asyncio.Task | None = None


S = _State()


def lan_ips() -> list[str]:
    found: list[str] = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("192.0.2.1", 9))   # no packet is sent; the OS picks the outgoing interface
        found.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    out: list[str] = []
    for ip in found:
        if ip not in out and not ip.startswith("127.") and not ip.startswith("169.254."):
            out.append(ip)
    return out


def _new_code() -> None:
    S.code = f"{secrets.randbelow(1_000_000):06d}"
    S.code_until = time.time() + CODE_SECONDS
    S.tries = 0


def _code_live() -> bool:
    return bool(S.code) and time.time() < S.code_until and S.tries < CODE_TRIES


async def _desk_send(obj: dict | bytes) -> None:
    ws = S.desk
    if ws is None:
        return
    try:
        if isinstance(obj, bytes):
            await ws.send_bytes(obj)
        else:
            await ws.send_text(json.dumps(obj))
    except Exception:
        pass


def _view() -> dict:
    paired = bool(S.token)
    return {
        "on": S.server is not None, "port": S.port, "urls": S.urls,
        "code": S.code if _code_live() and not paired else "", "codeSeconds": max(0, int(S.code_until - time.time())) if _code_live() and not paired else 0,
        "locked": bool(S.code) and S.tries >= CODE_TRIES and not paired,
        "paired": paired, "connected": paired and S.tablet is not None, "device": S.device,
    }


async def _revoke(tell: bool = True) -> None:
    """Forgets the tablet: token gone, socket closed."""
    close = S.tablet_close
    S.token = ""
    S.device = ""
    S.tablet = None
    S.tablet_close = None
    S.gone_at = 0.0
    if callable(close):
        try:
            await close()
        except Exception:
            pass
    if tell:
        await _desk_send({"t": "status", **_view()})


async def _grace(token: str) -> None:
    await asyncio.sleep(GRACE_SECONDS)
    if S.token == token and S.tablet is None:
        await _revoke()


# --------------------------------------------------------------------------------------- the LAN listener


def _headers(scope) -> dict[str, str]:   # noqa: ANN001
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}


def _origin_ok(h: dict[str, str]) -> bool:
    origin = h.get("origin")
    if origin is None:
        return False
    return origin.strip().lower() in {f"http://{x}" for x in S.hosts}


async def _plain(send, status: int, body: bytes, ctype: str = "text/plain; charset=utf-8", extra=()) -> None:   # noqa: ANN001
    await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", ctype.encode()), (b"content-length", str(len(body)).encode()), *HEADERS, *extra]})
    await send({"type": "http.response.body", "body": body})


async def _read_body(receive, limit: int) -> bytes | None:   # noqa: ANN001
    data = b""
    while True:
        m = await receive()
        if m["type"] != "http.request":
            return None
        data += m.get("body", b"")
        if len(data) > limit:
            return None
        if not m.get("more_body"):
            return data


async def lan_app(scope, receive, send) -> None:   # noqa: ANN001
    if scope["type"] == "lifespan":
        while True:
            m = await receive()
            if m["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif m["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    h = _headers(scope)
    path = scope.get("path", "")
    if scope["type"] == "http":
        if h.get("host", "").strip().lower() not in S.hosts:
            await _plain(send, 403, b"Wrong host.")
            return
        method = scope.get("method", "GET")
        if path == "/penlink/pair":
            if method != "POST":
                await _plain(send, 405, b"POST only.")
                return
            if not _origin_ok(h):
                await _plain(send, 403, b"Wrong origin.")
                return
            await _pair(receive, send)
            return
        if path.startswith("/penlink/") and method == "GET":
            hit = FILES.get(path[len("/penlink/"):])
            if hit:
                await _plain(send, 200, (STATIC / hit[0]).read_bytes(), hit[1])
                return
        await _plain(send, 404, b"Not found.")
        return
    if scope["type"] == "websocket":
        if path != "/penlink/ws" or h.get("host", "").strip().lower() not in S.hosts or not _origin_ok(h):
            await send({"type": "websocket.close", "code": 1008})
            return
        await _tablet(scope, receive, send, h)
        return


async def _pair(receive, send) -> None:   # noqa: ANN001
    raw = await _read_body(receive, 512)
    try:
        code = str(json.loads(raw or b"")["code"])[:12]
        device = str(json.loads(raw).get("device", ""))[:60]
    except Exception:
        await _plain(send, 400, b"Bad request.")
        return
    if S.token:
        await _plain(send, 409, b"A tablet is already paired.")
        return
    if not _code_live():
        await _plain(send, 410, b"That code has expired. Ask for a new one on the desktop.")
        return
    S.tries += 1
    if not hmac.compare_digest(code.encode(), S.code.encode()):
        await _plain(send, 401, b"Wrong code.")
        if S.tries >= CODE_TRIES:
            await _desk_send({"t": "status", **_view()})
        return
    S.token = secrets.token_urlsafe(16)   # 128 bits, memory only
    S.device = device or "Tablet"
    S.code = ""
    S.gone_at = time.time()
    asyncio.create_task(_grace(S.token))
    await _desk_send({"t": "status", **_view()})
    await _plain(send, 200, json.dumps({"token": S.token}).encode(), "application/json")


async def _tablet(scope, receive, send, h) -> None:   # noqa: ANN001
    m = await receive()
    if m["type"] != "websocket.connect":
        return
    await send({"type": "websocket.accept"})

    async def close() -> None:
        await send({"type": "websocket.close", "code": 1000})

    try:
        first = await asyncio.wait_for(receive(), 5)
        msg = json.loads(first.get("text") or "{}")
        ok = first["type"] == "websocket.receive" and msg.get("t") == "hello" and S.token and hmac.compare_digest(str(msg.get("token", "")).encode(), S.token.encode())
    except Exception:
        ok = False
    if not ok or S.tablet is not None:
        await send({"type": "websocket.close", "code": 1008})
        return
    mine = S.token
    lock = asyncio.Lock()

    async def tx(data: bytes | str) -> None:
        async with lock:
            await send({"type": "websocket.send", **({"bytes": data} if isinstance(data, bytes) else {"text": data})})

    S.tablet, S.tablet_close = tx, close
    await tx(json.dumps({"t": "ok", "v": 1}))
    await _desk_send({"t": "status", **_view()})
    window, count = time.time(), 0
    try:
        while True:
            ev = await receive()
            if ev["type"] != "websocket.receive":
                break
            now = time.time()
            if now - window >= 1:
                window, count = now, 0
            count += 1
            if count > MAX_PER_SECOND:
                continue
            if ev.get("bytes") is not None:
                await _desk_send(ev["bytes"])
                continue
            text = ev.get("text") or ""
            try:
                obj = json.loads(text)
            except ValueError:
                continue
            kind = obj.get("t")
            if kind == "ping":
                await tx(json.dumps({"t": "pong", "ts": obj.get("ts")}))
            elif kind in ("tool", "undo", "redo", "lat", "ack", "view"):
                await _desk_send(obj)
    except Exception:
        pass
    finally:
        if S.token == mine:
            S.tablet = S.tablet_close = None
            S.gone_at = time.time()
            asyncio.create_task(_grace(mine))
            await _desk_send({"t": "status", **_view()})


# ------------------------------------------------------------------------------------ the loopback API


class StartBody(BaseModel):
    port: int = DEFAULT_PORT


async def _stop() -> None:
    await _revoke(tell=False)
    server, task = S.server, S.task
    S.server = S.task = None
    S.code = ""
    S.hosts = set()
    S.urls = []
    if server is not None:
        server.should_exit = True
        try:
            await asyncio.wait_for(task, 5)
        except Exception:
            server.force_exit = True
            task.cancel()
    await _desk_send({"t": "status", **_view()})


@router.post("/start")
async def start(body: StartBody | None = None) -> dict:
    port = (body.port if body else DEFAULT_PORT)
    if not 1024 <= port <= 65535:
        raise HTTPException(400, "That is not a usable port.")
    if S.server is not None:
        return _view()
    ips = lan_ips() or ["127.0.0.1"]
    cfg = uvicorn.Config(lan_app, host="0.0.0.0", port=port, log_level="warning", lifespan="on", ws_max_size=MAX_TABLET_MESSAGE,
                         timeout_graceful_shutdown=1, server_header=False, date_header=False, access_log=False)
    server = _Quiet(cfg)
    task = asyncio.create_task(server.serve())
    for _ in range(50):
        await asyncio.sleep(0.05)
        if server.started or task.done():
            break
    if not server.started:
        task.cancel()
        raise HTTPException(409, f"Pen Link could not open port {port}. Another program may be using it.")
    S.server, S.task, S.port = server, task, port
    S.hosts = {f"{ip}:{port}" for ip in ips}
    S.urls = [f"http://{ip}:{port}/penlink/" for ip in ips]
    _new_code()
    return _view()


@router.post("/stop")
async def stop() -> dict:
    await _stop()
    return _view()


@router.post("/code")
async def new_code() -> dict:
    if S.server is None:
        raise HTTPException(409, "Pen Link is off.")
    if S.token:
        await _revoke()   # a new code means a new pairing: the paired tablet is forgotten
    _new_code()
    await _desk_send({"t": "status", **_view()})
    return _view()


@router.get("/status")
async def status() -> dict:
    return _view()


@router.websocket("/desk")
async def desk(ws: WebSocket) -> None:
    await ws.accept()
    if S.desk is not None:
        try:
            await S.desk.close(1000)
        except Exception:
            pass
    S.desk = ws
    await _desk_send({"t": "status", **_view()})
    try:
        while True:
            ev = await ws.receive()
            if ev["type"] == "websocket.disconnect":
                break
            tx = S.tablet
            if not callable(tx):
                continue
            if ev.get("bytes") is not None:
                if len(ev["bytes"]) <= 4_000_000:
                    await tx(ev["bytes"])
            elif ev.get("text"):
                await tx(ev["text"])
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if S.desk is ws:
            S.desk = None


async def shutdown() -> None:
    """Engine exit: the listener goes with it."""
    await _stop()
