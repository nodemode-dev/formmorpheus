"""A speech server the person runs on this computer: the window cannot reach it (its page policy), so the engine relays.

Only loopback is ever called. The address is judged by its written host name, with nothing resolved, and a redirect
is followed only when its target is loopback too.
"""
from __future__ import annotations

import http.client
import json
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request

LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")
CHECK_TIMEOUT_SECONDS = 5
SPEAK_TIMEOUT_SECONDS = 300
MAX_REPLY_BYTES = 200 * 1024 * 1024
MAX_MESSAGE_CHARS = 300
ERROR_BODY_BYTES = 64 * 1024
READ_BYTES = 64 * 1024
# What a speak may answer with, compared without parameters and in lower case. Nothing else is passed to the window.
SOUND_TYPES = ("audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4",
               "audio/webm", "application/octet-stream")


class Refused(ValueError):
    """The address is not one the engine will call."""


class Upstream(Exception):
    """The speech server failed or could not be reached."""


class UpstreamTimeout(Exception):
    """The speech server did not answer in time."""


class _LeftLoopback(urllib.error.URLError):
    pass


def _loopback(raw: str) -> urllib.parse.SplitResult:
    # the request line is sent as ASCII: any other character would fail there, as an error of the engine's own
    if not raw.isascii() or "\x7f" in raw:
        raise Refused("The speech server address must be plain unaccented letters, digits and signs.")
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


class _Watch:
    """The connections one call opened, so its deadline can end whichever of them is still waiting."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._open: list[socket.socket] = []
        self.expired = False

    def add(self, sock: socket.socket) -> None:
        # the socket itself is kept: once the reply's headers are in, the connection lets go of it and only the reply reads it
        with self._lock:
            if self.expired:
                raise TimeoutError("the call ran out of time before it connected")
            self._open.append(sock)

    def expire(self) -> None:
        with self._lock:
            self.expired = True
            waiting = list(self._open)
        for sock in waiting:
            try:
                sock.shutdown(socket.SHUT_RDWR)   # wakes a read that is waiting; close alone does not everywhere
            except OSError:
                pass


def _opener(watch: _Watch) -> urllib.request.OpenerDirector:
    class Plain(http.client.HTTPConnection):
        def connect(self) -> None:
            super().connect()
            watch.add(self.sock)

    class Secure(http.client.HTTPSConnection):
        def connect(self) -> None:
            super().connect()
            watch.add(self.sock)

    class PlainHandler(urllib.request.HTTPHandler):
        def http_open(self, req):
            return self.do_open(Plain, req)

    class SecureHandler(urllib.request.HTTPSHandler):
        def https_open(self, req):
            return self.do_open(Secure, req, context=self._context)

    # no proxy from the environment or the system: a loopback call must never go through one
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _LoopbackOnly(), PlainHandler(), SecureHandler())


def _plain(text: str) -> str:
    """One line of printable text: runs of white space become a space, control and other unprintable characters go."""
    return "".join(ch for ch in " ".join(text.split()) if ch.isprintable())


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
    return _plain(text)[:MAX_MESSAGE_CHARS]


def _timed_out(error: Exception) -> bool:
    return isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError)


def _read(response) -> bytes:
    """The reply a block at a time, given up one block past the cap."""
    blocks: list[bytes] = []
    size = 0
    while size <= MAX_REPLY_BYTES:
        block = response.read1(READ_BYTES)
        if not block:
            break
        blocks.append(block)
        size += len(block)
    return b"".join(blocks)


def _call(url: str, body: bytes | None, timeout: float) -> tuple[bytes, str]:
    """One request and its whole reply inside `timeout` seconds. The same number also bounds each wait on the socket."""
    headers = {"User-Agent": "FormMorpheus", "Accept": "*/*"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method="GET" if body is None else "POST")
    late = UpstreamTimeout(f"The speech server did not answer within {timeout} seconds.")
    watch = _Watch()
    # a reply that keeps arriving a little at a time never trips the wait on the socket, so the whole call has an end too
    timer = threading.Timer(timeout, watch.expire)
    timer.daemon = True
    timer.start()
    try:
        with _opener(watch).open(request, timeout=timeout) as response:
            kind = response.headers.get("Content-Type", "")
            reply = _read(response)
    except _LeftLoopback as error:
        raise Upstream("The speech server sent the engine to an address that is not on this computer.") from error
    except urllib.error.HTTPError as error:
        try:
            said = _message(error.read(ERROR_BODY_BYTES))
        except (OSError, http.client.HTTPException):
            said = ""
        if watch.expired:
            raise late from error
        raise Upstream(f"The speech server answered {error.code}" + (f": {said}" if said else ".")) from error
    except (OSError, http.client.HTTPException) as error:
        if watch.expired or _timed_out(error):
            raise late from error
        reason = _plain(str(getattr(error, "reason", error)))[:MAX_MESSAGE_CHARS]
        raise Upstream(f"The speech server could not be reached: {reason}") from error
    finally:
        timer.cancel()
    if watch.expired:
        raise late   # a connection ended by the deadline reads as a reply that simply stopped
    if len(reply) > MAX_REPLY_BYTES:
        raise Upstream("The speech server sent more than 200 MB, so the reply was dropped.")
    return reply, kind


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
    reply, sent = _call(f"{base}/v1/audio/speech", body, SPEAK_TIMEOUT_SECONDS)
    # the type goes to the window as one of the listed values, never as the server wrote it
    kind = sent.split(";")[0].strip().lower() or "audio/wav"
    if kind not in SOUND_TYPES:
        said = _message(reply[:ERROR_BODY_BYTES])
        raise Upstream(f"The speech server did not send sound (it sent {_plain(sent)[:60]})" + (f": {said}" if said else "."))
    if not reply:
        raise Upstream("The speech server sent an empty reply.")
    return reply, kind
