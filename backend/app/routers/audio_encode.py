"""MP3 for sound-only exports: the browser has no MP3 encoder, so the window sends its WAV mixdown here and the
person's own ffmpeg (libmp3lame) turns it into an MP3 that comes straight back. Nothing is kept in the engine."""
import asyncio
import shutil
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.core import config
from app.routers.jobs import _stream_to
from app.services import ffmpeg as ff

router = APIRouter()
KBPS = (96, 128, 160, 192, 256, 320)


@router.post("/mp3")
async def encode_mp3(request: Request, kbps: int = 192) -> FileResponse:
    if kbps not in KBPS:
        raise HTTPException(400, "The MP3 rate must be 96, 128, 160, 192, 256 or 320 kbps.")
    info = ff.probe()
    if info is None:
        raise HTTPException(503, "ffmpeg was not found, so MP3 is not available.")
    if not info.has("libmp3lame"):
        raise HTTPException(503, "This ffmpeg has no MP3 encoder (libmp3lame).")
    folder = config.jobs_dir() / f"mp3-{uuid.uuid4().hex[:12]}"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        src, dst = folder / "in.wav", folder / "out.mp3"
        await _stream_to(request, src, config.MAX_JOB_AUDIO_BYTES)
        with open(src, "rb") as f:
            head = f.read(12)
        if head[:4] != b"RIFF" or head[8:12] != b"WAVE":
            raise HTTPException(400, "The sound must be a WAV file.")
        proc = await asyncio.create_subprocess_exec(
            info.path, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-protocol_whitelist", "file", "-i", str(src),
            "-vn", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-id3v2_version", "3", str(dst),
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0 or not dst.is_file() or dst.stat().st_size == 0:
            raise HTTPException(500, (err.decode("utf-8", "replace").strip()[-300:]) or "ffmpeg could not encode the MP3.")
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return FileResponse(dst, media_type="audio/mpeg", background=BackgroundTask(shutil.rmtree, folder, True))
