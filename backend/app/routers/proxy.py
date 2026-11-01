"""Lower-resolution proxies of large videos, made by the person's own ffmpeg (a separate program, never bundled).

The window uploads the video, the engine returns a small H.264 copy (long side at most `height` pixels, a keyframe
every second so scrubbing is quick, no sound). The window plays the proxy while editing; an export always reads the
original. Nothing is kept in the engine: the temp folder goes with the response.
"""
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
HEIGHTS = (360, 540, 720)


@router.post("/make")
async def make_proxy(request: Request, height: int = 540) -> FileResponse:
    if height not in HEIGHTS:
        raise HTTPException(400, "The proxy size must be 360, 540 or 720 pixels.")
    info = ff.probe()
    if info is None:
        raise HTTPException(503, "ffmpeg was not found, so a proxy cannot be made.")
    if not info.has("libx264"):
        raise HTTPException(503, "This ffmpeg has no H.264 encoder.")
    folder = config.jobs_dir() / f"proxy-{uuid.uuid4().hex[:12]}"
    folder.mkdir(parents=True, exist_ok=True)
    try:
        src, dst = folder / "in.media", folder / "out.mp4"
        await _stream_to(request, src, 8 * 1024 * 1024 * 1024)
        # the short side is scaled to `height` and made even; a picture already smaller is left at its size
        with open(src, "rb") as f:
            head = f.read(64).lstrip(b"\xef\xbb\xbf \t\r\n").lower()
        # a text playlist can name other files for ffmpeg to open: a video is binary, so refuse any that starts as text
        if head.startswith((b"#extm3u", b"ffconcat", b"<", b"#ext", b"file ")):
            raise HTTPException(400, "That file is not a video.")
        scale = f"scale='if(gt(iw,ih),-2,min({height},iw))':'if(gt(iw,ih),min({height},ih),-2)'"
        proc = await asyncio.create_subprocess_exec(
            info.path, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-protocol_whitelist", "file", "-i", str(src),
            "-an", "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-g", "24", "-keyint_min", "24",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dst),
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0 or not dst.is_file() or dst.stat().st_size == 0:
            raise HTTPException(500, (err.decode("utf-8", "replace").strip()[-300:]) or "ffmpeg could not make the proxy.")
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return FileResponse(dst, media_type="video/mp4", background=BackgroundTask(shutil.rmtree, folder, True))
