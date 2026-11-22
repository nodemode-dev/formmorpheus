import json
import os
import re
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from app.core import config
from app.core.upload import read_limited

router = APIRouter()

_SESSION = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_lock = threading.Lock()

# Windows holding a live stream open (GET /{session}/live). A closed stream means the window is gone, which is
# known at once; the heartbeat age is only the fallback for a window that never opened one.
BOOT = time.time()
GRACE_SECONDS = 4        # a dropped stream is given this long to reconnect
UNKNOWN_SECONDS = 15     # after an engine restart, windows that have not reconnected by now are gone
_streams: dict[str, int] = {}
_closed: dict[str, float] = {}
PRUNE_SECONDS = 120      # past the grace a closed record says nothing the boot age does not (gone), so it is dropped


def _prune() -> None:
    cut = time.time() - PRUNE_SECONDS
    for k in [k for k, t in _closed.items() if t < cut]:
        _closed.pop(k, None)


def _gone(session: str, idle: float) -> bool | None:
    """True/False when the stream registry knows; None when it does not (then the heartbeat age decides)."""
    now = time.time()
    if _streams.get(session, 0) > 0:
        return False
    if session in _closed:
        return now - _closed[session] > GRACE_SECONDS
    if now - BOOT > UNKNOWN_SECONDS:
        return True   # the engine restarted since this window last spoke, so it is not connected
    return None


def recovery_dir() -> Path:
    path = config.data_dir() / "Recovery"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session(session: str) -> str:
    if not _SESSION.match(session):
        raise HTTPException(400, "That is not a session id.")
    return session


def _paths(session: str) -> tuple[Path, Path]:
    folder = recovery_dir()
    return folder / f"{session}{config.PROJECT_EXT}", folder / f"{session}.json"


def _atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.part")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _entry(session: str, fmo: Path, side: Path) -> dict:
    meta: dict = {}
    try:
        data = json.loads(side.read_text("utf-8"))
        meta = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        pass
    def num(key: str, fallback: float) -> float:
        try:
            v = float(meta.get(key) or fallback)
            return v if v == v and abs(v) < 1e12 else fallback
        except (TypeError, ValueError):
            return fallback

    taken = num("time", fmo.stat().st_mtime)
    # the heartbeat of the window that owns this snapshot; older files only have the snapshot time
    alive = num("alive", taken)
    idle = max(0.0, time.time() - alive)
    known = _gone(session, idle)
    return {
        "gone": (idle > 240) if known is None else known,
        # seconds until a window whose stream just closed counts as gone (it may be reconnecting); 0 otherwise
        "wait": max(0.0, GRACE_SECONDS - (time.time() - _closed[session])) if known is False and session in _closed and _streams.get(session, 0) == 0 else 0.0,
        "session": session,
        "name": str(meta.get("name") or "Untitled"),
        "library": meta.get("library") if isinstance(meta.get("library"), str) else None,
        "time": taken,
        "alive": alive,
        "idle": idle,
        "size": fmo.stat().st_size,
    }


@router.get("")
def list_snapshots() -> dict:
    items = []
    _prune()
    for fmo in recovery_dir().glob(f"*{config.PROJECT_EXT}"):
        if fmo.is_file() and _SESSION.match(fmo.stem):
            try:
                items.append(_entry(fmo.stem, fmo, fmo.with_suffix(".json")))
            except (OSError, ValueError, TypeError):
                continue
    items.sort(key=lambda e: e["time"], reverse=True)
    return {"items": items}


@router.websocket("/{session}/live")
async def live(ws: WebSocket, session: str) -> None:
    """A window keeps this socket open while it lives; the engine learns the moment it closes, however the window died.

    A socket, not a streamed GET: it holds no slot of the browser's six HTTP connections per host and does not
    keep uvicorn from shutting down. The registry is per process, so the engine must run as a single worker.
    """
    if not _SESSION.match(session):
        await ws.close(code=1008)
        return
    await ws.accept()
    _streams[session] = _streams.get(session, 0) + 1
    _closed.pop(session, None)
    try:
        while (await ws.receive())["type"] != "websocket.disconnect":
            pass
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        n = _streams.get(session, 1) - 1
        if n > 0:
            _streams[session] = n
        else:
            _streams.pop(session, None)
            _closed[session] = time.time()
        _prune()


@router.get("/{session}")
def read_snapshot(session: str) -> Response:
    fmo, _ = _paths(_session(session))
    if not fmo.is_file():
        raise HTTPException(404, "No recovery snapshot for that session.")
    return Response(fmo.read_bytes(), media_type="application/octet-stream")


@router.put("/{session}")
async def write_snapshot(session: str, request: Request, name: str = "Untitled", library: str | None = None) -> dict:
    fmo, side = _paths(_session(session))
    body = await read_limited(request, config.MAX_PROJECT_BYTES, "The movie is too large to snapshot.")
    if body[:4] != b"PK\x03\x04":
        raise HTTPException(400, "That is not a FormMorpheus project.")
    now = time.time()
    meta = {"name": name[:180], "library": library[:180] if library else None, "time": now, "alive": now}
    with _lock:
        _atomic(fmo, body)
        _atomic(side, json.dumps(meta).encode("utf-8"))
    return _entry(session, fmo, side)


@router.post("/{session}/alive")
def heartbeat(session: str) -> dict:
    """The owning window calls this every 20 s and on every visibility change; a snapshot whose heartbeat is over 240 s old is offered as a crash."""
    fmo, side = _paths(_session(session))
    with _lock:
        if not fmo.is_file():
            raise HTTPException(404, "No recovery snapshot for that session.")
        try:
            meta = json.loads(side.read_text("utf-8"))
            if not isinstance(meta, dict):
                meta = {}
        except (OSError, ValueError):
            meta = {}
        meta["alive"] = time.time()
        _atomic(side, json.dumps(meta).encode("utf-8"))
    return {"ok": True}


@router.delete("/{session}")
def delete_snapshot(session: str) -> dict:
    fmo, side = _paths(_session(session))
    with _lock:
        for p in (fmo, side):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
    return {"ok": True}
