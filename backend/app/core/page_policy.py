import base64
import hashlib
import re

from app.core import config

API = "/api/"
INLINE = re.compile(rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S)
RULES = (
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'{hashes}",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "connect-src 'self' data: blob: ipc: http://ipc.localhost ws://127.0.0.1:* ws://localhost:*",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
)
EXTRA = (
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
)
_made: dict[tuple[str, int, int], bytes] = {}


def policy() -> bytes:
    dist = config.dist_dir()
    page = dist / "index.html" if dist else None
    try:
        stat = page.stat() if page else None
        key = (str(page), stat.st_mtime_ns, stat.st_size) if stat else ("", 0, 0)
    except OSError:
        key = ("", 0, 0)
    if key not in _made:
        hashes = ""
        if key[0]:
            try:
                for body in INLINE.findall(page.read_bytes()):
                    hashes += " 'sha256-" + base64.b64encode(hashlib.sha256(body).digest()).decode("ascii") + "'"
            except OSError:
                hashes = ""
        _made.clear()
        _made[key] = "; ".join(RULES).format(hashes=hashes).encode("ascii")
    return _made[key]


class PagePolicy:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or str(scope.get("path", "")).startswith(API):
            await self.app(scope, receive, send)
            return

        async def with_policy(message) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"content-security-policy"]
                headers.append((b"content-security-policy", policy()))
                headers.extend(EXTRA)
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, with_policy)
