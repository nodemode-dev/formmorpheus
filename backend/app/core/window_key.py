import hmac
import json
import os
import secrets
import time
from urllib.parse import parse_qs

from fastapi import APIRouter, HTTPException, Request

HEADER = "x-formmorpheus-window-key"
STDOUT_ENV = "FORMMORPHEUS_WINDOW_KEY_STDOUT"
LINE = "formmorpheus-window-key: "
REFUSED = "Only the FormMorpheus window can do this"
TICKET_LIFE = 30.0
GUARDED = "/api/"
OPEN = ("/api/window/key", "/api/health")
KEY = secrets.token_urlsafe(32)
STATE = {"claimed": False, "secondClaim": False}
TICKETS: dict[str, float] = {}

router = APIRouter(prefix="/api/window", tags=["window"])


def stdout_mode() -> bool:
    return os.environ.get(STDOUT_ENV) == "1"


def valid(value) -> bool:
    return isinstance(value, str) and bool(value) and hmac.compare_digest(value.encode("utf-8"), KEY.encode("utf-8"))


def require(request: Request) -> None:
    if not valid(request.headers.get(HEADER)):
        raise HTTPException(403, REFUSED)


def claim() -> str | None:
    if STATE["claimed"]:
        STATE["secondClaim"] = True
        return None
    STATE["claimed"] = True
    return KEY


def ticket() -> str:
    now = time.monotonic()
    for old in [t for t, at in TICKETS.items() if now - at > TICKET_LIFE]:
        TICKETS.pop(old, None)
    value = secrets.token_urlsafe(24)
    TICKETS[value] = now
    return value


def spend(value) -> bool:
    if not isinstance(value, str) or not value:
        return False
    at = TICKETS.pop(value, None)
    return at is not None and time.monotonic() - at <= TICKET_LIFE


@router.post("/key")
def claim_key() -> dict:
    if stdout_mode():
        raise HTTPException(404, "Not Found")
    key = claim()
    if key is None:
        raise HTTPException(409, "The window key was already given to a window of this engine.")
    return {"key": key}


@router.get("/key")
def key_state() -> dict:
    return {"claimed": STATE["claimed"], "secondClaim": STATE["secondClaim"], "packaged": stdout_mode()}


@router.post("/ticket")
def stream_ticket(request: Request) -> dict:
    require(request)
    return {"ticket": ticket()}


class WindowKeyGuard:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        path = str(scope.get("path", ""))
        if scope["type"] not in ("http", "websocket") or not path.startswith(GUARDED) or path in OPEN:
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            given = parse_qs(scope.get("query_string", b"").decode("latin-1")).get("ticket", [""])[0]
            if spend(given):
                await self.app(scope, receive, send)
                return
            await send({"type": "websocket.close", "code": 4403})
            return
        if scope.get("method") == "OPTIONS":
            await self.app(scope, receive, send)
            return
        given = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k.decode("latin-1").lower() == HEADER), None)
        if valid(given):
            await self.app(scope, receive, send)
            return
        body = json.dumps({"detail": REFUSED}).encode("utf-8")
        await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
