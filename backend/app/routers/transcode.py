"""Engine import transcodes: media the browser cannot decode is converted to something it can.

Video the browser has no decoder for (ProRes, some HEVC, alpha ProRes 4444) becomes H.264 in MP4, or VP9 with alpha
in WebM when the source has alpha. Sound it cannot decode (AIFF, CAF, AC-3, MP2) becomes a WAV. The person's own
ffmpeg runs as a separate process (an argument list, never a shell), like the export jobs. HEIC / HEIF pictures are
decoded with pillow-heif when it is installed (optional, never required), else by the person's ffmpeg when it is 7.1
or newer (it reads HEIC itself); with neither, the engine says so and the window refuses the file.
"""
import asyncio
import re
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.core import config
from app.routers.jobs import _stream_to, _tail
from app.services import ffmpeg as ff

router = APIRouter()

KINDS = ("video", "audio", "image")
MAX_IMPORT_BYTES = 8 * 1024 * 1024 * 1024
MAX_KEPT = 30
ABANDON_SECONDS = 1800


@dataclass
class Transcode:
    id: str
    kind: str
    name: str
    folder: Path
    state: str = "running"
    progress: float = 0.0
    error: str = ""
    result: Path | None = None
    mime: str = ""
    alpha: bool = False
    proc: asyncio.subprocess.Process | None = None
    created: float = field(default_factory=time.time)
    touched: float = field(default_factory=time.time)


JOBS: dict[str, Transcode] = {}
# At most this many ffmpeg conversions run at once; the rest wait (still "running", progress 0) in a queue.
MAX_CONCURRENT = 2
PROBE_TIMEOUT = 30
_slots: asyncio.Semaphore | None = None


def _get(job_id: str) -> Transcode:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "No transcode by that id.")
    job.touched = time.time()
    return job


async def _communicate(proc: asyncio.subprocess.Process) -> tuple[bytes, bytes]:
    """communicate() with a deadline: a probe that hangs on a broken file is killed."""
    try:
        out, err = await asyncio.wait_for(proc.communicate(), PROBE_TIMEOUT)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        raise RuntimeError("ffmpeg took too long to read that file.")
    return out or b"", err or b""


def _describe(j: Transcode) -> dict:
    return {"id": j.id, "kind": j.kind, "state": j.state, "progress": round(j.progress, 4), "error": j.error, "mime": j.mime, "alpha": j.alpha}


def _prune() -> None:
    now = time.time()
    # Keep time: a finished job (and its unfetched result) stays 30 minutes after its last poll or fetch.
    for j in list(JOBS.values()):
        if j.state != "running" and now - j.touched > ABANDON_SECONDS:
            shutil.rmtree(j.folder, ignore_errors=True)
            JOBS.pop(j.id, None)
    done = sorted((j for j in JOBS.values() if j.state != "running"), key=lambda j: j.created)
    for j in done[: max(0, len(done) - MAX_KEPT)]:
        shutil.rmtree(j.folder, ignore_errors=True)
        JOBS.pop(j.id, None)


def heif_available() -> bool:
    try:
        import pillow_heif  # noqa: F401  (optional: never installed by us)
        return True
    except Exception:
        return False


def ffmpeg_reads_heif(info: ff.FfmpegInfo | None) -> bool:
    """ffmpeg reads HEIF stills (items and tile grids) from 7.1; older builds cannot, or return one tile only."""
    if info is None:
        return False
    m = re.match(r"n?(\d+)\.(\d+)", info.version)
    if not m:
        return True  # a development build: try it, the result is checked
    return (int(m.group(1)), int(m.group(2))) >= (7, 1)


@router.get("/capabilities")
def capabilities() -> dict:
    info = ff.probe()
    return {"ffmpeg": info is not None, "heif": heif_available() or ffmpeg_reads_heif(info)}


async def _duration(path: str, src: Path) -> tuple[float, bool]:
    """Seconds and whether the first video stream carries alpha, from `ffmpeg -i`."""
    proc = await asyncio.create_subprocess_exec(
        path, "-hide_banner", "-nostdin", "-i", str(src), stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await _communicate(proc)
    text = err.decode("utf-8", "replace")
    seconds = 0.0
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if m:
        seconds = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    alpha = bool(re.search(r"Video:.*\b(yuva\w*|argb|rgba|bgra|abgr|gbrap\w*|ya8|ya16\w*)\b", text))
    return seconds, alpha


def _command(info: ff.FfmpegInfo, src: Path, out: Path, kind: str, alpha: bool, encoder: str) -> list[str]:
    cmd = [info.path, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats", "-i", str(src)]
    if kind == "audio":
        return cmd + ["-vn", "-map", "0:a:0", "-c:a", "pcm_s16le", "-ar", "48000", str(out)]
    # sizes must be even for 4:2:0
    even = "scale=trunc(iw/2)*2:trunc(ih/2)*2"
    if encoder == "libvpx-vp9":
        cmd += ["-map", "0:v:0", "-map", "0:a:0?", "-vf", even + ",format=yuva420p", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
                "-crf", "28", "-b:v", "0", "-deadline", "realtime", "-cpu-used", "5", "-auto-alt-ref", "0", "-c:a", "libopus", "-b:a", "160k", str(out)]
    else:
        cmd += ["-map", "0:v:0", "-map", "0:a:0?", "-vf", even + ",format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
    return cmd


async def _run_media(job: Transcode, src: Path) -> None:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(MAX_CONCURRENT)
    try:
        async with _slots:
            if job.state == "cancelled":
                return
            await _convert(job, src)
    finally:
        src.unlink(missing_ok=True)


async def _convert(job: Transcode, src: Path) -> None:
    info = ff.probe()
    try:
        if info is None:
            raise RuntimeError("ffmpeg was not found. Install it, or set FORMMORPHEUS_FFMPEG to its path.")
        seconds, alpha = await _duration(info.path, src)
        job.alpha = alpha and job.kind == "video"
        if job.kind == "audio":
            out, encoder, job.mime = job.folder / "out.wav", "pcm_s16le", "audio/wav"
        else:
            names = await _encoders(info.path)
            if job.alpha and "libvpx-vp9" in names:
                encoder, ext, job.mime = "libvpx-vp9", "webm", "video/webm"
            elif "libx264" in names:
                encoder, ext, job.mime, job.alpha = "libx264", "mp4", "video/mp4", False
            elif "libvpx-vp9" in names:
                encoder, ext, job.mime, job.alpha = "libvpx-vp9", "webm", "video/webm", False
            else:
                raise RuntimeError("This ffmpeg has no H.264 or VP9 encoder, so the video cannot be converted for the browser.")
            out = job.folder / f"out.{ext}"
        err_path = job.folder / "ffmpeg.err"
        with open(err_path, "wb") as err:
            proc = await asyncio.create_subprocess_exec(
                *_command(info, src, out, job.kind, job.alpha, encoder), stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=err,
            )
            job.proc = proc
            if job.state == "cancelled":
                # cancelled while the process was starting: cancel() saw no proc to kill
                proc.kill()
            assert proc.stdout is not None
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", "replace").strip()
                if text.startswith("out_time_us=") and seconds > 0:
                    try:
                        job.progress = min(0.99, int(text[12:]) / 1e6 / seconds)
                    except ValueError:
                        pass
            code = await proc.wait()
        if job.state == "cancelled":
            return
        if code == 0 and out.is_file() and out.stat().st_size > 0:
            job.result, job.progress, job.state = out, 1.0, "done"
            job.touched = time.time()
        else:
            raise RuntimeError(_tail(err_path) or f"ffmpeg stopped with code {code}.")
    except Exception as exc:
        if job.state != "cancelled":
            job.error, job.state = str(exc) or "The conversion failed.", "failed"
            job.touched = time.time()
    finally:
        job.proc = None


async def _encoders(path: str) -> set[str]:
    proc = await asyncio.create_subprocess_exec(path, "-hide_banner", "-encoders", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    out, _ = await _communicate(proc)
    names: set[str] = set()
    for line in out.decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) >= 2 and re.fullmatch(r"[VAS][A-Z.]{5}", parts[0]):
            names.add(parts[1])
    return names


def _heif_with_ffmpeg(info: ff.FfmpegInfo, src: Path, out: Path) -> None:
    import subprocess

    done = subprocess.run(
        [info.path, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", str(src), "-frames:v", "1", "-an", "-pix_fmt", "rgba", str(out)],
        capture_output=True, text=True, timeout=120, check=False, stdin=subprocess.DEVNULL,
    )
    if done.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
        raise RuntimeError((done.stderr or "").strip().splitlines()[-1] if done.stderr.strip() else "ffmpeg could not read it.")


def _run_heif(job: Transcode, src: Path) -> None:
    out = job.folder / "out.png"
    try:
        if heif_available():
            import pillow_heif  # type: ignore
            from PIL import Image

            pillow_heif.register_heif_opener()
            with Image.open(src) as im:
                im.convert("RGBA").save(out, "PNG")
        else:
            info = ff.probe()
            if not ffmpeg_reads_heif(info):
                raise RuntimeError("no HEIC reader is available on the engine")
            assert info is not None
            _heif_with_ffmpeg(info, src, out)
        job.result, job.mime, job.progress, job.state = out, "image/png", 1.0, "done"
    except Exception as exc:
        job.error, job.state = f"This HEIC picture could not be converted: {exc}", "failed"
    finally:
        src.unlink(missing_ok=True)


@router.post("")
async def start(request: Request, kind: str, name: str = "import") -> dict:
    if kind not in KINDS:
        raise HTTPException(400, "Unknown kind.")
    if kind == "image" and not heif_available() and not ffmpeg_reads_heif(ff.probe()):
        raise HTTPException(
            503,
            "This browser cannot open HEIC pictures, and neither can the engine: it needs ffmpeg 7.1 or newer "
            "(or the optional pillow-heif package). Export the picture as PNG or JPEG first, or update ffmpeg.",
        )
    if kind != "image" and ff.probe() is None:
        raise HTTPException(503, "ffmpeg was not found. Install it, or set FORMMORPHEUS_FFMPEG to its path.")
    job_id = uuid.uuid4().hex[:16]
    folder = config.jobs_dir() / f"import-{job_id}"
    folder.mkdir(parents=True, exist_ok=True)
    src = folder / ("in" + (Path(name).suffix[:12] if re.fullmatch(r"\.[A-Za-z0-9]+", Path(name).suffix[:12]) else ".bin"))
    try:
        await _stream_to(request, src, MAX_IMPORT_BYTES)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    job = Transcode(id=job_id, kind=kind, name=name, folder=folder)
    JOBS[job_id] = job
    _prune()
    if kind == "image":
        await asyncio.to_thread(_run_heif, job, src)
    else:
        asyncio.create_task(_run_media(job, src))
    return _describe(job)


@router.get("/{job_id}")
def get_job(job_id: str) -> dict:
    return _describe(_get(job_id))


@router.get("/{job_id}/result")
def result(job_id: str):
    from fastapi.responses import FileResponse

    job = _get(job_id)
    if job.state != "done" or job.result is None or not job.result.is_file():
        raise HTTPException(409, "The conversion is not finished.")
    return FileResponse(job.result, media_type=job.mime)


@router.delete("/{job_id}")
async def cancel(job_id: str) -> dict:
    job = _get(job_id)
    if job.state == "running":
        job.state = "cancelled"
        if job.proc is not None and job.proc.returncode is None:
            try:
                job.proc.kill()
            except ProcessLookupError:
                pass
    shutil.rmtree(job.folder, ignore_errors=True)
    JOBS.pop(job_id, None)
    return {"id": job_id, "state": "cancelled"}
