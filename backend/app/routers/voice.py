"""AI voices at /api/voice: text spoken by the built-in voice, by a voice app on this computer, or by an online voice.

Three engines, one shape. builtin is Kokoro in its own runtime in the data folder (services/voice_runtime.py), set up
once on request. local is any voice app on this computer that answers the common speech API on a loopback address
(services/voice_remote.py); that is how a cloned voice is used. online is a hosted voice with the person's own key
(services/voice_remote.py). A spoken sound is kept in the data folder's voice/out folder until the window fetches it."""
import json
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core import config
from app.services import voice_remote, voice_runtime

router = APIRouter(tags=["voice"])
ENGINES = ("builtin", "local", "online")
MAX_TEXT = 10000
KEEP_SECONDS = 3600
EXT = {"audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/flac": ".flac", "audio/aac": ".aac"}
_ID = re.compile(r"^[0-9a-f]{32}$")


def out_dir() -> Path:
    path = config.data_dir() / "voice" / "out"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sweep(now: float | None = None) -> int:
    """Removes spoken sounds nobody fetched within the hour. Returns how many went."""
    gone = 0
    limit = (now or time.time()) - KEEP_SECONDS
    for path in out_dir().iterdir():
        try:
            if path.is_file() and path.stat().st_mtime < limit:
                path.unlink()
                gone += 1
        except OSError:
            continue
    return gone


class SpeakBody(BaseModel):
    engine: str = "builtin"
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    voice: str = ""
    language: str = ""   # empty: the voice's own language
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    model: str = ""


class LocalBody(BaseModel):
    base: str = Field(default="", max_length=200)
    model: str = Field(default="", max_length=120)
    voice: str = Field(default="", max_length=120)
    key: str | None = Field(default=None, max_length=400)


class ProbeBody(BaseModel):
    base: str = Field(min_length=1, max_length=200)


class KeyBody(BaseModel):
    key: str = Field(min_length=1, max_length=400)


def _fail(exc: Exception) -> HTTPException:
    if isinstance(exc, voice_runtime.VoiceError):
        return HTTPException(exc.status, str(exc))
    if isinstance(exc, voice_remote.VoiceError):
        return HTTPException(exc.status, str(exc))
    raise exc


@router.get("/status")
def status() -> dict:
    return {"builtin": voice_runtime.status(), "local": voice_remote.local_settings(), "online": voice_remote.online_status()}


@router.post("/builtin/setup", status_code=202)
def builtin_setup() -> dict:
    try:
        return voice_runtime.start_setup()
    except voice_runtime.VoiceError as exc:
        raise _fail(exc)


@router.get("/builtin/job")
def builtin_job() -> dict:
    return {"job": voice_runtime.job()}


@router.delete("/builtin/job")
def builtin_cancel() -> dict:
    return {"cancelled": voice_runtime.cancel()}


@router.delete("/builtin")
def builtin_remove() -> dict:
    try:
        return {"removed": voice_runtime.remove()}
    except voice_runtime.VoiceError as exc:
        raise _fail(exc)


@router.get("/builtin/voices")
def builtin_voices() -> dict:
    try:
        return {"voices": voice_runtime.voices()}
    except voice_runtime.VoiceError as exc:
        raise _fail(exc)


@router.put("/local")
def local_save(body: LocalBody) -> dict:
    try:
        return voice_remote.save_local(body.base, body.model, body.voice, body.key)
    except voice_remote.VoiceError as exc:
        raise _fail(exc)


@router.post("/local/probe")
def local_probe(body: ProbeBody) -> dict:
    try:
        return voice_remote.probe_local(body.base)
    except voice_remote.VoiceError as exc:
        raise _fail(exc)


@router.put("/online/key")
def online_key(body: KeyBody) -> dict:
    try:
        voice_remote.set_online_key(body.key)
    except voice_remote.VoiceError as exc:
        raise _fail(exc)
    return voice_remote.online_status()


@router.delete("/online/key")
def online_key_clear() -> dict:
    voice_remote.clear_online_key()
    return voice_remote.online_status()


@router.get("/online/voices")
def online_voices() -> dict:
    try:
        return {"voices": voice_remote.online_voices()}
    except voice_remote.VoiceError as exc:
        raise _fail(exc)


def speak_now(body: SpeakBody) -> dict:
    """Speaks the text and keeps the sound for the window. Also what the MCP tools call."""
    if body.engine not in ENGINES:
        raise HTTPException(422, f"There is no voice engine named {body.engine}.")
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "There is no text to speak.")
    sweep()
    try:
        if body.engine == "builtin":
            spoken = voice_runtime.speak(text, body.voice, body.language, body.speed)
        elif body.engine == "local":
            spoken = voice_remote.speak_local(text, body.voice, body.model, body.speed)
        else:
            spoken = voice_remote.speak_online(text, body.voice, body.model)
    except (voice_runtime.VoiceError, voice_remote.VoiceError) as exc:
        raise _fail(exc)
    mime = spoken.get("mime") or "audio/wav"
    if mime not in EXT or not spoken.get("audio"):
        raise HTTPException(502, "The voice answered with something that is not a sound.")
    sid = uuid.uuid4().hex
    (out_dir() / (sid + EXT[mime])).write_bytes(spoken["audio"])
    info = {"id": sid, "mime": mime, "engine": body.engine, "voice": spoken.get("voice") or body.voice, "seconds": spoken.get("seconds"),
            "cues": spoken.get("cues") or [], "text": text, "bytes": len(spoken["audio"])}
    (out_dir() / (sid + ".json")).write_text(json.dumps(info), "utf-8")
    return info


@router.post("/speak", status_code=201)
def speak(body: SpeakBody) -> dict:
    return speak_now(body)


def _sound(sid: str) -> tuple[Path, dict]:
    if not _ID.match(sid):
        raise HTTPException(404, "There is no spoken sound with that id.")
    note = out_dir() / (sid + ".json")
    try:
        info = json.loads(note.read_text("utf-8"))
        path = out_dir() / (sid + EXT[info["mime"]])
    except (OSError, ValueError, KeyError):
        raise HTTPException(404, "There is no spoken sound with that id.")
    if not path.is_file():
        raise HTTPException(404, "There is no spoken sound with that id.")
    return path, info


@router.get("/audio/{sid}")
def audio(sid: str) -> FileResponse:
    path, info = _sound(sid)
    return FileResponse(path, media_type=info["mime"])


@router.delete("/audio/{sid}")
def audio_drop(sid: str) -> dict:
    path, _info = _sound(sid)
    path.unlink(missing_ok=True)
    (out_dir() / (sid + ".json")).unlink(missing_ok=True)
    return {"removed": True}
