"""Voices that are not built in: a voice app on this computer that answers the common speech API, and an online voice with
the person's own key. Standard library only. Keys live in the system keyring, never in settings.json."""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from app.core import config

SERVICE = "FormMorpheus"   # the keyring service name app/core/seal.py uses
LOCAL_ACCOUNT = "voice-local-key"
ONLINE_ACCOUNT = "voice-online-key"
ONLINE_ENV = "FORMMORPHEUS_VOICE_ONLINE_KEY"
DEFAULT_BASE = "http://127.0.0.1:8080"
ONLINE_BASE = "https://api.elevenlabs.io"
DEFAULT_ONLINE_VOICE = "21m00Tcm4TlvDq8ikWAM"
DEFAULT_ONLINE_MODEL = "eleven_multilingual_v2"
MAX_ONLINE_TEXT = 2000
MAX_BYTES = 200 * 1024 * 1024
SPEECH_TIMEOUT = 300
PROBE_TIMEOUT = 5
ONLINE_TIMEOUT = 120
_LOOPBACK = ("127.0.0.1", "localhost", "::1")
_VOICE_ID = re.compile(r"^[A-Za-z0-9]+$")
_GENERIC = ("", "application/octet-stream", "binary/octet-stream", "text/plain", "audio/basic")
_MIMES = {
    "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/vnd.wave": "audio/wav",
    "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/ogg": "audio/ogg", "application/ogg": "audio/ogg",
    "audio/flac": "audio/flac", "audio/x-flac": "audio/flac",
}


class VoiceError(Exception):
    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.status = status


# ---- keyring ----

def _keyring():
    if sys.platform.startswith("linux"):
        import ctypes.util

        if hasattr(ctypes.util, "_findLib_ld"):
            ctypes.util._findLib_ld = lambda name: None   # same reason as seal.py: no ld probe
    import keyring

    return keyring


def _get_secret(account: str) -> str | None:
    try:
        return _keyring().get_password(SERVICE, account) or None
    except Exception:
        return None


def _can_store() -> bool:
    try:
        _keyring().get_password(SERVICE, "voice-probe")
        return True
    except Exception:
        return False


def _set_secret(account: str, value: str) -> None:
    try:
        _keyring().set_password(SERVICE, account, value)
    except Exception:
        raise VoiceError("This computer has no safe place to keep a key, so it was not saved.", 503)


def _delete_secret(account: str) -> None:
    try:
        _keyring().delete_password(SERVICE, account)
    except Exception:
        pass   # nothing stored, or no keyring: either way no key is kept


def _online_key() -> str | None:
    return _get_secret(ONLINE_ACCOUNT) or (os.environ.get(ONLINE_ENV, "").strip() or None)


# ---- settings ----

def _stored_local() -> dict:
    voice = config.read_settings().get("voice")
    local = voice.get("local") if isinstance(voice, dict) else None
    local = local if isinstance(local, dict) else {}
    return {k: str(local.get(k) or "") for k in ("base", "model", "voice")}


def local_settings() -> dict:
    stored = _stored_local()
    return {"base": stored["base"] or DEFAULT_BASE, "model": stored["model"], "voice": stored["voice"],
            "hasKey": bool(_get_secret(LOCAL_ACCOUNT))}


def normalize_base(base: str) -> str:
    sorry = VoiceError("Only an address on this computer is allowed, such as http://127.0.0.1:8080.", 422)
    text = (base or "").strip()
    if not text:
        raise sorry
    try:
        parts = urllib.parse.urlsplit(text)
        host = (parts.hostname or "").lower()
        port = parts.port
    except ValueError:
        raise sorry
    if parts.scheme not in ("http", "https") or host not in _LOOPBACK or parts.username or parts.password:
        raise sorry
    if parts.query or parts.fragment or parts.path.rstrip("/") not in ("", "/v1"):
        raise sorry
    shown = "[::1]" if host == "::1" else host
    return f"{parts.scheme}://{shown}" + (f":{port}" if port is not None else "")


def save_local(base: str, model: str, voice: str, key: str | None) -> dict:
    clean = normalize_base(base) if (base or "").strip() else DEFAULT_BASE
    if key:
        _set_secret(LOCAL_ACCOUNT, key.strip())
    elif key == "":
        _delete_secret(LOCAL_ACCOUNT)
    settings = config.read_settings()
    section = settings.get("voice") if isinstance(settings.get("voice"), dict) else {}
    section["local"] = {"base": clean, "model": (model or "").strip(), "voice": (voice or "").strip()}
    settings["voice"] = section
    config.write_settings(settings)
    return local_settings()


# ---- http ----

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _local_opener() -> urllib.request.OpenerDirector:
    # No proxy, and no redirect that could leave this computer.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _read_capped(resp) -> bytes:
    chunks, size = [], 0
    while True:
        chunk = resp.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_BYTES:
            raise VoiceError("The voice sent back a sound larger than 200 MB, so it was dropped.", 502)
        chunks.append(chunk)
    return b"".join(chunks)


def _reply_text(exc: urllib.error.HTTPError) -> str:
    try:
        return exc.read(150).decode("utf-8", "replace").strip()[:150]
    except Exception:
        return ""


def _sniff(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "audio/mpeg"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[:4] == b"fLaC":
        return "audio/flac"
    return None


def _mime_of(content_type: str, data: bytes) -> str:
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared in _MIMES:
        return _MIMES[declared]
    found = _sniff(data) if declared in _GENERIC else None
    if found:
        return found
    raise VoiceError("The voice app answered with something that is not a sound.", 502)


def _local_get(base: str, path: str, key: str | None):
    req = urllib.request.Request(base + path, headers={"Accept": "application/json"})
    if key:
        req.add_header("Authorization", "Bearer " + key)
    try:
        with _local_opener().open(req, timeout=PROBE_TIMEOUT) as resp:
            return json.loads(_read_capped(resp).decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError, VoiceError):
        return None   # each probe part is allowed to be missing


def probe_local(base: str) -> dict:
    clean = normalize_base(base)
    key = _get_secret(LOCAL_ACCOUNT)
    listed = _local_get(clean, "/v1/models", key)
    voiced = _local_get(clean, "/v1/audio/voices", key)
    if listed is None and voiced is None:
        # Neither answered: find out whether anything is listening at all.
        try:
            with _local_opener().open(urllib.request.Request(clean + "/"), timeout=PROBE_TIMEOUT):
                pass
        except urllib.error.HTTPError:
            pass   # it answered, just not with a page
        except (urllib.error.URLError, OSError, ValueError):
            return {"ok": False, "models": [], "voices": [],
                    "error": "No voice app answered at that address. Check that it is running and that the address is right."}
    models: list[str] = []
    items = listed.get("data") if isinstance(listed, dict) else listed
    for item in items if isinstance(items, list) else []:
        name = item.get("id") if isinstance(item, dict) else item
        if isinstance(name, str) and name:
            models.append(name)
    voices: list[dict] = []
    raw = voiced.get("voices") if isinstance(voiced, dict) else voiced
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, str):
            vid, name = item, item
        elif isinstance(item, dict):
            vid = item.get("id") or item.get("voice_id") or item.get("name")
            name = item.get("name") or vid
        else:
            continue
        if isinstance(vid, str) and vid:
            voices.append({"id": vid, "name": str(name)})
    return {"ok": True, "models": models, "voices": voices, "error": ""}


def speak_local(text: str, voice: str, model: str, speed: float) -> dict:
    stored = local_settings()
    base = normalize_base(stored["base"])
    use_model = (model or "").strip() or stored["model"]
    use_voice = (voice or "").strip() or stored["voice"]
    body: dict = {"input": text, "speed": speed, "response_format": "wav"}
    if use_model:
        body["model"] = use_model
    if use_voice:
        body["voice"] = use_voice
    headers = {"Content-Type": "application/json"}
    key = _get_secret(LOCAL_ACCOUNT)
    if key:
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(base + "/v1/audio/speech", data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        with _local_opener().open(req, timeout=SPEECH_TIMEOUT) as resp:
            data = _read_capped(resp)
            ctype = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        said = _reply_text(exc)
        raise VoiceError(f"The voice app refused the request (error {exc.code})" + (f": {said}" if said else "."), 502)
    except (urllib.error.URLError, OSError):
        raise VoiceError("The voice app did not answer. Check that it is running and that its address is right.", 502)
    if not data:
        raise VoiceError("The voice app answered with an empty sound.", 502)
    return {"audio": data, "mime": _mime_of(ctype, data), "seconds": None, "voice": use_voice, "cues": []}


# ---- online ----

def online_status() -> dict:
    return {"hasKey": bool(_online_key()), "canStore": _can_store()}


def set_online_key(key: str) -> None:
    clean = (key or "").strip()
    if not clean:
        raise VoiceError("There is no key to save.", 422)
    if not _can_store():
        raise VoiceError("This computer has no safe place to keep a key. Set FORMMORPHEUS_VOICE_ONLINE_KEY instead.", 503)
    _set_secret(ONLINE_ACCOUNT, clean)


def clear_online_key() -> None:
    _delete_secret(ONLINE_ACCOUNT)


def _need_key() -> str:
    key = _online_key()
    if not key:
        raise VoiceError("There is no online voice key yet. Add your key in the AI Voice card's Online tab.", 503)
    return key


def _online_call(req: urllib.request.Request) -> tuple[bytes, str]:
    try:
        with urllib.request.urlopen(req, timeout=ONLINE_TIMEOUT) as resp:   # default opener: system proxy and CA settings apply
            return _read_capped(resp), resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise VoiceError("The online voice service did not accept the key (error 401). Check the key in the Online tab.", 502)
        said = _reply_text(exc)
        raise VoiceError(f"The online voice service refused the request (error {exc.code})" + (f": {said}" if said else "."), 502)
    except (urllib.error.URLError, OSError):
        raise VoiceError("The online voice service could not be reached. Check the internet connection.", 502)


def online_voices() -> list[dict]:
    key = _need_key()
    data, _ctype = _online_call(urllib.request.Request(ONLINE_BASE + "/v1/voices", headers={"xi-api-key": key, "Accept": "application/json"}))
    try:
        listed = json.loads(data.decode("utf-8", "replace")).get("voices", [])
    except (ValueError, AttributeError):
        raise VoiceError("The online voice service answered with something unreadable.", 502)
    out = []
    for item in listed if isinstance(listed, list) else []:
        if not isinstance(item, dict) or not item.get("voice_id"):
            continue
        labels = item.get("labels") if isinstance(item.get("labels"), dict) else {}
        out.append({"id": item["voice_id"], "name": item.get("name") or item["voice_id"],
                    "group": str(labels.get("accent") or item.get("category") or "")})
    return out


def speak_online(text: str, voice: str, model: str) -> dict:
    key = _need_key()
    if len(text) > MAX_ONLINE_TEXT:
        raise VoiceError(f"The online voice takes at most {MAX_ONLINE_TEXT} characters at a time. Shorten the text.", 422)
    use_voice = (voice or "").strip() or DEFAULT_ONLINE_VOICE
    if not _VOICE_ID.match(use_voice):
        raise VoiceError("That voice id is not valid. It may hold only letters and digits.", 422)
    body = {"text": text, "model_id": (model or "").strip() or DEFAULT_ONLINE_MODEL}
    req = urllib.request.Request(f"{ONLINE_BASE}/v1/text-to-speech/{use_voice}", data=json.dumps(body).encode("utf-8"),
                                 headers={"xi-api-key": key, "Content-Type": "application/json"}, method="POST")
    data, _ctype = _online_call(req)
    if not data:
        raise VoiceError("The online voice service answered with an empty sound.", 502)
    return {"audio": data, "mime": "audio/mpeg", "seconds": None, "voice": use_voice, "cues": []}
