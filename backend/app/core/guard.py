"""Host and Origin checks for every route.

The engine listens on loopback only, but a web page can still reach it two ways: DNS rebinding (the page's own
host name resolves to 127.0.0.1, so the Host header is the attacker's) and a plain cross-site form or fetch
(the Origin header is the attacker's). So every request must carry a loopback Host, and a state-changing one must
carry no Origin (curl, the desktop shell's own calls) or one of the app's own origins: the Vite dev origin, the
Tauri origins, or the engine's own origin (the same scheme and Host the request arrived on, which is how the
desktop window and `serve` mode reach it on whatever port the engine picked).
"""
import json

from app.core import config

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def host_name(raw: str) -> str:
    raw = raw.strip().lower()
    if raw.startswith("["):
        return raw.split("]")[0] + "]"
    return raw.rsplit(":", 1)[0] if ":" in raw else raw


def origin_allowed(origin: str, host: str) -> bool:
    origin = origin.strip().lower()
    if origin in config.window_origins():
        return True
    for scheme in ("http://", "https://"):
        if origin.startswith(scheme):
            return origin[len(scheme):] == host.strip().lower()   # the engine's own origin
    return False


class GuardMiddleware:
    """Pure ASGI so streamed uploads are not buffered."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        host = headers.get("host", "")
        problem = ""
        if host_name(host) not in LOOPBACK_HOSTS:
            problem = "This engine only answers to the app itself (loopback hosts)."
        elif scope["type"] == "websocket" or scope.get("method", "GET") not in SAFE_METHODS:
            origin = headers.get("origin")
            if origin is not None and not origin_allowed(origin, host):
                problem = "That origin is not allowed to change anything here."
        if problem:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            body = json.dumps({"detail": problem}).encode()
            await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)
