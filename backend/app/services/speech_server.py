"""A speech server the person runs on this computer: the window cannot reach it (its page policy), so the engine relays.

Only loopback is ever called. The address is judged by its written host name, with nothing resolved, and a redirect
is followed only when its target is loopback too.
"""
from __future__ import annotations

import http.client
import json
import urllib.error
import urllib.parse
import urllib.request

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
CHECK_TIMEOUT_SECONDS = 5
SPEAK_TIMEOUT_SECONDS = 300
MAX_REPLY_BYTES = 200 * 1024 * 1024
MAX_MESSAGE_CHARS = 300
ERROR_BODY_BYTES = 64 * 1024
SOUND_TYPES = ("audio/", "application/octet-stream")


class Refused(ValueError):
    """The address is not one the engine will call."""


class Upstream(Exception):
    """The speech server failed or could not be reached."""


class UpstreamTimeout(Exception):
    """The speech server did not answer in time."""


class _LeftLoopback(urllib.error.URLError):
    pass


def _loopback(raw: str) -> urllib.parse.SplitResult:
    if any(ch <= " " or ch == "\\" for ch in raw):
        raise Refused("The speech server address has a space or a backslash in it.")
    try:
        parts = urllib.parse.urlsplit(raw)
        parts.port   # a port that is not a number raises here
    except ValueError as error:
        raise Refused("The speech server address could not be read.") from error
    if parts.scheme not in ("http", "https"):
        raise Refused("The speech server address must start with http:// or https://.")
    if "@" in parts.netloc or parts.username is not None or parts.password is not None:
        raise Refused("The speech server address must not carry a user name or a password.")
    if parts.hostname not in LOOPBACK_HOSTS:
        raise Refused("The speech server must be on this computer: 127.0.0.1, localhost or [::1].")
    return parts


def base_url(raw: str) -> str:
    """The address rebuilt from its checked parts, without a trailing slash. Raises Refused with a sentence."""
    parts = _loopback(raw.strip())
    if parts.query or parts.fragment:
        raise Refused("The speech server address must not have a question mark or a hash in it.")
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    port = f":{parts.port}" if parts.port is not None else ""
    return f"{parts.scheme}://{host}{port}{parts.path.rstrip('/')}"


class _LoopbackOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            _loopback(newurl)
        except Refused as error:
            raise _LeftLoopback("a redirect left this computer") from error
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener() -> urllib.request.OpenerDirector:
    # no proxy from the environment or the system: a loopback call must never go through one
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _LoopbackOnly())


def _message(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace")
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, dict):
        found = data.get("error", data.get("detail", data.get("message")))
        if isinstance(found, dict):
            found = found.get("message", found.get("detail"))
        if isinstance(found, str):
            text = found
    return " ".join(text.split())[:MAX_MESSAGE_CHARS]


def _timed_out(error: Exception) -> bool:
    return isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError)


def _call(url: str, body: bytes | None, timeout: int) -> tuple[bytes, str]:
    headers = {"User-Agent": "FormMorpheus", "Accept": "*/*"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method="GET" if body is None else "POST")
    try:
        with _opener().open(request, timeout=timeout) as response:
            reply = response.read(MAX_REPLY_BYTES + 1)
            kind = response.headers.get("Content-Type", "")
    except _LeftLoopback as error:
        raise Upstream("The speech server sent the engine to an address that is not on this computer.") from error
    except urllib.error.HTTPError as error:
        try:
            said = _message(error.read(ERROR_BODY_BYTES))
        except (OSError, http.client.HTTPException):
            said = ""
        raise Upstream(f"The speech server answered {error.code}" + (f": {said}" if said else ".")) from error
    except (OSError, http.client.HTTPException) as error:
        if _timed_out(error):
            raise UpstreamTimeout(f"The speech server did not answer within {timeout} seconds.") from error
        reason = " ".join(str(getattr(error, "reason", error)).split())[:MAX_MESSAGE_CHARS]
        raise Upstream(f"The speech server could not be reached: {reason}") from error
    if len(reply) > MAX_REPLY_BYTES:
        raise Upstream("The speech server sent more than 200 MB, so the reply was dropped.")
    return reply, kind.strip()


def _names(payload: object) -> list[str]:
    """Model names from the usual list shapes: {"data": [...]}, {"models": [...]} or a bare list, of names or of objects."""
    rows = payload
    if isinstance(payload, dict):
        rows = next((payload[key] for key in ("data", "models") if isinstance(payload.get(key), list)), [])
    if not isinstance(rows, list):
        return []
    names = (
        row if isinstance(row, str)
        else next((row[key] for key in ("id", "name", "model") if isinstance(row.get(key), str)), "") if isinstance(row, dict)
        else ""
        for row in rows
    )
    return list(dict.fromkeys(name for name in names if name))


def check(url: str) -> dict:
    """Asks {url}/v1/models. An address that is refused raises; a server that fails is an answer with ok false."""
    base = base_url(url)
    try:
        reply, _ = _call(f"{base}/v1/models", None, CHECK_TIMEOUT_SECONDS)
    except (Upstream, UpstreamTimeout) as error:
        return {"ok": False, "models": [], "error": str(error)}
    try:
        payload = json.loads(reply.decode("utf-8", "replace"))
    except ValueError:
        payload = None
    return {"ok": True, "models": _names(payload), "error": ""}


def speak(url: str, model: str, voice: str, text: str, speed: float) -> tuple[bytes, str]:
    """Posts to {url}/v1/audio/speech and returns the sound and its content type."""
    base = base_url(url)
    body = json.dumps({"model": model, "input": text, "voice": voice, "speed": speed, "response_format": "wav"}).encode("utf-8")
    reply, kind = _call(f"{base}/v1/audio/speech", body, SPEAK_TIMEOUT_SECONDS)
    kind = kind or "audio/wav"
    if not kind.lower().startswith(SOUND_TYPES):
        said = _message(reply[:ERROR_BODY_BYTES])
        raise Upstream(f"The speech server did not send sound (it sent {kind[:60]})" + (f": {said}" if said else "."))
    if not reply:
        raise Upstream("The speech server sent an empty reply.")
    return reply, kind
