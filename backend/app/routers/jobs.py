"""Engine export jobs: formats the browser cannot encode (ProRes, HEVC) go through the person's own ffmpeg.

The window renders every frame to a PNG and uploads it here; the engine runs ffmpeg as a separate process
(an argument list, never a shell) over the PNG sequence and a WAV mixdown, then keeps the result in Exports.
formmorpheus never ships a GPL ffmpeg: libx265 is GPL, and a user-installed ffmpeg run as its own program is
an ordinary use of that program, so nothing here links to or bundles it.
"""
import asyncio
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core import config
from app.routers.exports import clean_name, free_path
from app.services import ffmpeg as ff

router = APIRouter()

TARGETS = ("prores", "prores4444", "hevc", "h264")
# prores_ks -profile:v numbers: 0 proxy, 1 lt, 2 standard 422, 3 hq, 4 4444, 5 4444 xq
PRORES_PROFILES = {"proxy": 0, "lt": 1, "422": 2, "hq": 3, "4444": 4, "4444xq": 5}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
CRF = {"low": 28, "medium": 24, "high": 20, "very-high": 16}
VT_Q = {"low": 40, "medium": 55, "high": 65, "very-high": 80}
MAX_KEPT_RECORDS = 40
ABANDON_SECONDS = 600
ORPHAN_SECONDS = 1800   # an unowned folder is swept only after 30 minutes without a write
SWEEP_EVERY_SECONDS = 60


class NewJob(BaseModel):
    target: str
    fps: float
    width: int
    height: int
    frames: int
    has_audio: bool = False
    alpha: bool = False
    quality: str = "high"
    container: str = "mp4"
    name: str = "movie"
    audio_codec: str = "aac"
    profile: str = ""


@dataclass
class Job:
    id: str
    target: str
    fps: float
    width: int
    height: int
    frames: int
    has_audio: bool
    alpha: bool
    quality: str
    container: str
    name: str
    folder: Path
    audio_codec: str = "aac"
    profile: str = ""
    state: str = "queued"
    received: set[int] = field(default_factory=set)
    audio_in: bool = False
    done_frames: int = 0
    output: str = ""
    error: str = ""
    encoder: str = ""
    proc: asyncio.subprocess.Process | None = None
    task: asyncio.Task | None = None
    created: float = field(default_factory=time.time)
    touched: float = field(default_factory=time.time)

    def touch(self) -> None:
        self.touched = time.time()

    def progress(self) -> float:
        if self.state == "done":
            return 1.0
        if self.state == "encoding":
            return min(0.99, self.done_frames / max(1, self.frames))
        if self.state in ("receiving", "queued"):
            return len(self.received) / max(1, self.frames)
        return 0.0


JOBS: dict[str, Job] = {}


def sweep() -> None:
    """Startup: temp folders left by a crash, older than a day, are removed."""
    root = config.jobs_dir()
    cutoff = time.time() - config.JOB_MAX_AGE_SECONDS
    for p in root.iterdir():
        try:
            if p.is_dir() and p.stat().st_mtime < cutoff:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            continue


def sweep_abandoned(now: float | None = None) -> int:
    """While running: a job that took no upload and no poll for ABANDON_SECONDS loses its folder. Returns how many."""
    now = now or time.time()
    gone = 0
    for job in list(JOBS.values()):
        if job.state in ("queued", "receiving") and now - job.touched > ABANDON_SECONDS:
            job.state = "cancelled"
            job.error = "The window stopped sending this job."
            _remove_files(job)
            gone += 1
    # Folders no live registry owns (the engine restarted) that nothing has written to for ORPHAN_SECONDS.
    # Import transcodes (import-*) live in transcode.JOBS: a running one, or a finished one whose result has not
    # been fetched within its 30 minute keep time, is owned there and never swept here. Uploads touch their folder
    # while receiving, so a slow upload keeps its folder fresh.
    from app.routers import transcode

    owned = {j.folder.name for j in JOBS.values()} | {j.folder.name for j in transcode.JOBS.values()}
    try:
        for p in config.jobs_dir().iterdir():
            if p.is_dir() and p.name not in owned and now - p.stat().st_mtime > ORPHAN_SECONDS:
                shutil.rmtree(p, ignore_errors=True)
                gone += 1
    except OSError:
        pass
    return gone


async def sweep_loop() -> None:
    while True:
        await asyncio.sleep(SWEEP_EVERY_SECONDS)
        try:
            await asyncio.to_thread(sweep_abandoned)
        except Exception:
            pass


def rate_text(fps: float) -> str:
    """An exact rational for ffmpeg: 23.976 is 24000/1001, 29.97 is 30000/1001, 59.94 is 60000/1001."""
    whole = round(fps)
    if abs(fps - whole) < 1e-9:
        return str(whole)
    ntsc = round(fps * 1001 / 1000)
    if ntsc > 0 and abs(fps - ntsc * 1000 / 1001) < 0.01:
        return f"{ntsc * 1000}/1001"
    frac = Fraction(fps).limit_denominator(1000)
    return f"{frac.numerator}/{frac.denominator}"


def _get(job_id: str) -> Job:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "No job by that id.")
    job.touch()
    return job


def _remove_files(job: Job) -> None:
    shutil.rmtree(job.folder, ignore_errors=True)


def _prune() -> None:
    finished = [j for j in JOBS.values() if j.state in ("done", "failed", "cancelled")]
    finished.sort(key=lambda j: j.created)
    for j in finished[: max(0, len(finished) - MAX_KEPT_RECORDS)]:
        JOBS.pop(j.id, None)


def describe(job: Job) -> dict:
    return {
        "id": job.id, "target": job.target, "state": job.state, "progress": round(job.progress(), 4),
        "frames": job.frames, "received": len(job.received), "audio": job.audio_in,
        "output": job.output, "error": job.error, "encoder": job.encoder,
    }


@router.get("/capabilities")
def capabilities() -> dict:
    info = ff.probe(refresh=True)
    if info is None:
        why = "ffmpeg was not found. Install it, or set FORMMORPHEUS_FFMPEG to its path."
        none = {"available": False, "encoder": "", "reason": why}
        return {"ffmpeg": False, "path": "", "version": "", "gpl": False, "aac": False, "targets": {t: dict(none) for t in TARGETS}}
    prores_ok = info.has("prores_ks")
    h264_ok = info.has("libx264")
    reason_pr = "" if prores_ok else "This ffmpeg has no prores_ks encoder."
    hevc = info.hevc_candidates()
    return {
        "ffmpeg": True, "path": info.path, "version": info.version, "gpl": info.gpl, "aac": info.has("aac"),
        "targets": {
            "h264": {"available": h264_ok, "encoder": "libx264", "reason": "" if h264_ok else "This ffmpeg has no libx264 encoder."},
            "prores": {"available": prores_ok, "encoder": "prores_ks", "reason": reason_pr},
            "prores4444": {"available": prores_ok, "encoder": "prores_ks", "reason": reason_pr},
            "hevc": {
                "available": bool(hevc), "encoder": hevc[0] if hevc else "", "encoders": hevc,
                "reason": "" if hevc else "This ffmpeg has no HEVC encoder (needs a hardware encoder or libx265).",
            },
        },
    }


@router.post("/export")
def create_job(body: NewJob) -> dict:
    if body.target not in TARGETS:
        raise HTTPException(400, "Unknown export target.")
    if not (1 <= body.fps <= 240) or body.fps != body.fps:
        raise HTTPException(400, "The frame rate must be between 1 and 240.")
    if not (2 <= body.width <= config.MAX_JOB_SIDE and 2 <= body.height <= config.MAX_JOB_SIDE):
        raise HTTPException(400, f"The size must be between 2 and {config.MAX_JOB_SIDE} pixels a side.")
    if body.width % 2 or body.height % 2:
        raise HTTPException(400, "The width and height must be even.")
    if not (1 <= body.frames <= config.MAX_JOB_FRAMES):
        raise HTTPException(400, f"A job takes 1 to {config.MAX_JOB_FRAMES} frames.")
    if body.quality not in CRF:
        raise HTTPException(400, "Unknown quality.")
    if body.container not in ("mp4", "mov"):
        raise HTTPException(400, "The container must be mp4 or mov.")
    if body.audio_codec not in ("aac", "pcm"):
        raise HTTPException(400, "The sound must be aac or pcm.")
    if body.target in ("prores", "prores4444") and body.profile and body.profile not in PRORES_PROFILES:
        raise HTTPException(400, "Unknown ProRes profile.")
    if body.audio_codec == "pcm" and body.container == "mp4" and body.target in ("hevc", "h264"):
        raise HTTPException(400, "Linear PCM sound needs a .mov file.")
    info = ff.probe()
    if info is None:
        raise HTTPException(503, "ffmpeg was not found.")
    if body.target in ("prores", "prores4444") and not info.has("prores_ks"):
        raise HTTPException(503, "This ffmpeg has no ProRes encoder.")
    if body.target == "h264" and not info.has("libx264"):
        raise HTTPException(503, "This ffmpeg has no H.264 encoder.")
    if body.target == "hevc" and not info.hevc_candidates():
        raise HTTPException(503, "This ffmpeg has no HEVC encoder.")
    if body.has_audio and body.target in ("hevc", "h264") and body.audio_codec == "aac" and not info.has("aac"):
        raise HTTPException(503, "This ffmpeg has no AAC encoder.")
    base = Path(clean_name(body.name or "movie")).stem or "movie"
    job_id = uuid.uuid4().hex[:16]
    folder = config.jobs_dir() / job_id
    (folder / "frames").mkdir(parents=True, exist_ok=True)
    job = Job(
        id=job_id, target=body.target, fps=float(body.fps), width=body.width, height=body.height, frames=body.frames,
        has_audio=body.has_audio, alpha=body.alpha and (body.target == "prores4444" or (body.target == "prores" and body.profile in ("4444", "4444xq"))),
        quality=body.quality, container="mov" if body.target in ("prores", "prores4444") else body.container, name=base, folder=folder,
        audio_codec=body.audio_codec, profile=body.profile,
    )
    JOBS[job_id] = job
    _prune()
    return describe(job)


async def _stream_to(request: Request, dest: Path, limit: int, job: "Job | None" = None) -> int:
    tmp = dest.with_name(f".{uuid.uuid4().hex}.part")
    size = 0
    last_touch = 0.0
    try:
        with open(tmp, "wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, "That upload is too large.")
                out.write(chunk)
                now = time.monotonic()
                if now - last_touch > 5:
                    # a slow upload keeps its folder (and the job) fresh so no sweep takes it
                    last_touch = now
                    if job is not None:
                        job.touch()
                    try:
                        os.utime(dest.parent, None)
                    except OSError:
                        pass
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    return size


def _accepting(job: Job) -> None:
    if job.state not in ("queued", "receiving"):
        raise HTTPException(409, f"The job is {job.state}; it no longer takes files.")


@router.put("/{job_id}/frames/{index}")
async def put_frame(job_id: str, index: int, request: Request) -> dict:
    job = _get(job_id)
    _accepting(job)
    if not (0 <= index < job.frames):
        raise HTTPException(400, "Frame index out of range.")
    dest = job.folder / "frames" / f"{index:06d}.png"
    await _stream_to(request, dest, config.MAX_JOB_FRAME_BYTES, job)
    if job.state not in ("queued", "receiving"):
        dest.unlink(missing_ok=True)
        raise HTTPException(409, "The job ended.")
    with open(dest, "rb") as f:
        if f.read(8) != PNG_SIGNATURE:
            dest.unlink(missing_ok=True)
            raise HTTPException(400, "A frame must be a PNG picture.")
    job.received.add(index)
    job.state = "receiving"
    return {"received": len(job.received)}


@router.put("/{job_id}/audio")
async def put_audio(job_id: str, request: Request) -> dict:
    job = _get(job_id)
    _accepting(job)
    if not job.has_audio:
        raise HTTPException(400, "This job was created without sound.")
    dest = job.folder / "audio.wav"
    await _stream_to(request, dest, config.MAX_JOB_AUDIO_BYTES, job)
    with open(dest, "rb") as f:
        head = f.read(12)
    if head[:4] != b"RIFF" or head[8:12] != b"WAVE":
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "The sound must be a WAV file.")
    job.audio_in = True
    if job.state == "queued":
        job.state = "receiving"
    return {"audio": True}


def _command(job: Job, info: ff.FfmpegInfo, encoder: str, out: Path) -> list[str]:
    cmd = [info.path, "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]
    vaapi = encoder == "hevc_vaapi"
    if vaapi:
        cmd += ["-vaapi_device", "/dev/dri/renderD128"]
    fps = rate_text(job.fps)
    cmd += ["-framerate", fps, "-start_number", "0", "-i", str(job.folder / "frames" / "%06d.png")]
    if job.has_audio:
        cmd += ["-i", str(job.folder / "audio.wav")]
    cmd += ["-map", "0:v:0"]
    if job.has_audio:
        cmd += ["-map", "1:a:0"]
    bt709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    matrix = "scale=out_color_matrix=bt709:out_range=tv"
    if job.target in ("prores", "prores4444"):
        name = job.profile or ("hq" if job.target == "prores" else "4444")
        num = PRORES_PROFILES[name]
        pix = "yuv422p10le" if num < 4 else ("yuva444p10le" if job.alpha else "yuv444p10le")
        cmd += ["-vf", matrix, "-c:v", "prores_ks", "-profile:v", str(num), "-vendor", "apl0", "-pix_fmt", pix, *bt709]
        if job.has_audio:
            cmd += ["-c:a", "pcm_s16le"]
    else:
        crf = CRF[job.quality]
        if encoder == "libx264":
            cmd += ["-vf", matrix, "-c:v", "libx264", "-crf", str(crf), "-preset", "medium", "-pix_fmt", "yuv420p", *bt709]
            if job.container == "mp4":
                cmd += ["-movflags", "+faststart"]
        elif encoder == "libx265":
            cmd += ["-vf", matrix, "-c:v", "libx265", "-crf", str(crf), "-preset", "medium", "-x265-params", "log-level=error", "-pix_fmt", "yuv420p", *bt709]
        elif encoder == "hevc_videotoolbox":
            cmd += ["-vf", matrix, "-c:v", encoder, "-q:v", str(VT_Q[job.quality]), "-pix_fmt", "yuv420p", *bt709]
        elif encoder == "hevc_nvenc":
            cmd += ["-vf", matrix, "-c:v", encoder, "-rc", "vbr", "-cq", str(crf), "-b:v", "0", "-pix_fmt", "yuv420p", *bt709]
        elif encoder == "hevc_qsv":
            cmd += ["-vf", matrix + ",format=nv12", "-c:v", encoder, "-global_quality", str(crf), *bt709]
        else:
            cmd += ["-vf", "format=nv12,hwupload", "-c:v", encoder, "-qp", str(crf)]
        if job.target == "hevc":
            cmd += ["-tag:v", "hvc1", "-movflags", "+faststart"]
        if job.has_audio:
            cmd += ["-c:a", "pcm_s16le"] if job.audio_codec == "pcm" else ["-c:a", "aac", "-b:a", "192k"]
    # frames and a little over their length, so a longer sound is cut at the picture's end
    cmd += ["-frames:v", str(job.frames)]
    if job.has_audio:
        cmd += ["-t", f"{(job.frames + 0.5) / float(Fraction(rate_text(job.fps))):.6f}"]
    cmd += [str(out)]
    return cmd


async def _read_progress(job: Job, proc: asyncio.subprocess.Process) -> None:
    assert proc.stdout is not None
    while True:
        line = await proc.stdout.readline()
        if not line:
            return
        text = line.decode("utf-8", "replace").strip()
        if text.startswith("frame="):
            try:
                job.done_frames = max(job.done_frames, int(text[6:]))
            except ValueError:
                pass


def _tail(path: Path) -> str:
    try:
        text = path.read_text("utf-8", "replace")
    except OSError:
        return ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return " ".join(lines[-4:])[:600]


def _keep(tmp: Path, name: str) -> Path:
    """Moves the finished file into Exports without ever replacing one that is there."""
    base = free_path(config.exports_dir() / name)
    while True:
        try:
            os.link(tmp, base)
            tmp.unlink(missing_ok=True)
            return base
        except FileExistsError:
            base = free_path(base)
        except OSError:
            # no hard links here: fall back to an exclusive create + copy
            try:
                with open(base, "xb") as dst, open(tmp, "rb") as src:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                tmp.unlink(missing_ok=True)
                return base
            except FileExistsError:
                base = free_path(base)


async def _encode(job: Job, info: ff.FfmpegInfo) -> None:
    ext = "mov" if job.container == "mov" else "mp4"
    out = job.folder / f"out.{ext}"
    encoders = {"hevc": info.hevc_candidates(), "h264": ["libx264"]}.get(job.target, ["prores_ks"])
    last_error = ""
    try:
        for enc in encoders:
            if job.state == "cancelled":
                return
            job.encoder = enc
            job.done_frames = 0
            out.unlink(missing_ok=True)
            err_path = job.folder / "ffmpeg.err"
            with open(err_path, "wb") as err:
                proc = await asyncio.create_subprocess_exec(
                    *_command(job, info, enc, out), stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE, stderr=err,
                )
                job.proc = proc
                if job.state == "cancelled":
                    # cancelled while the process was starting: cancel_job saw no proc to kill
                    proc.kill()
                await _read_progress(job, proc)
                code = await proc.wait()
            if job.state == "cancelled":
                return
            if code == 0 and out.is_file() and out.stat().st_size > 0:
                final = _keep(out, f"{job.name}.{ext}")
                job.output = final.name
                job.state = "done"
                return
            last_error = _tail(err_path) or f"ffmpeg stopped with code {code}."
        job.error = last_error or "ffmpeg could not encode the movie."
        job.state = "failed"
    except Exception as exc:  # the job reports it; the engine keeps serving
        if job.state != "cancelled":
            job.error = str(exc) or "The encode failed."
            job.state = "failed"
    finally:
        job.proc = None
        _remove_files(job)


@router.post("/{job_id}/run")
async def run_job(job_id: str) -> dict:
    job = _get(job_id)
    if job.state not in ("queued", "receiving"):
        raise HTTPException(409, f"The job is {job.state}.")
    if len(job.received) != job.frames:
        raise HTTPException(409, f"{job.frames - len(job.received)} frames have not been uploaded.")
    if job.has_audio and not job.audio_in:
        raise HTTPException(409, "The sound has not been uploaded.")
    info = ff.probe()
    if info is None:
        raise HTTPException(503, "ffmpeg was not found.")
    job.state = "encoding"
    job.task = asyncio.create_task(_encode(job, info))
    return describe(job)


@router.get("/{job_id}")
def get_job(job_id: str) -> dict:
    return describe(_get(job_id))


@router.delete("/{job_id}")
async def cancel_job(job_id: str) -> dict:
    job = _get(job_id)
    if job.state in ("done", "failed", "cancelled"):
        return describe(job)
    job.state = "cancelled"
    proc = job.proc
    if proc is not None and proc.returncode is None:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    if job.task is None:
        _remove_files(job)
    return describe(job)
