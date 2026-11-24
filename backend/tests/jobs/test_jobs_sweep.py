import asyncio
import os
import time
from pathlib import Path

import pytest

from app.core import config
from app.routers import jobs
from jobs_helpers import FakeInfo


@pytest.fixture(autouse=True)
def empty_registry(monkeypatch, data_dir):
    monkeypatch.setattr(jobs, "JOBS", {})


def make_job(job_id="abc", **over):
    folder = config.jobs_dir() / job_id
    (folder / "frames").mkdir(parents=True, exist_ok=True)
    fields = dict(
        id=job_id, target="h264", fps=30.0, width=64, height=36, frames=10, has_audio=False, alpha=False,
        quality="high", container="mp4", name="movie", folder=folder,
    )
    fields.update(over)
    job = jobs.Job(**fields)
    jobs.JOBS[job_id] = job
    return job


def age(path: Path, seconds: float) -> None:
    then = time.time() - seconds
    os.utime(path, (then, then))


def test_startup_sweep_removes_only_folders_older_than_the_age_limit():
    old = config.jobs_dir() / "old"
    new = config.jobs_dir() / "new"
    old.mkdir(parents=True)
    new.mkdir(parents=True)
    age(old, config.JOB_MAX_AGE_SECONDS + 60)
    jobs.sweep()
    assert not old.exists()
    assert new.exists()


def test_a_silent_job_is_cancelled_and_loses_its_folder():
    job = make_job()
    now = job.touched + jobs.ABANDON_SECONDS + 1
    assert jobs.sweep_abandoned(now) == 1
    assert job.state == "cancelled"
    assert job.error
    assert not job.folder.exists()


def test_a_recently_touched_job_survives_the_sweep():
    job = make_job()
    assert jobs.sweep_abandoned(job.touched + jobs.ABANDON_SECONDS - 1) == 0
    assert job.state == "queued"
    assert job.folder.exists()


def test_an_encoding_job_is_never_swept_as_abandoned():
    job = make_job(state="encoding")
    assert jobs.sweep_abandoned(job.touched + jobs.ABANDON_SECONDS * 10) == 0
    assert job.state == "encoding"
    assert job.folder.exists()


def test_an_unowned_folder_is_swept_only_after_the_orphan_time():
    stale = config.jobs_dir() / "stale"
    fresh = config.jobs_dir() / "fresh"
    stale.mkdir(parents=True)
    fresh.mkdir(parents=True)
    age(stale, jobs.ORPHAN_SECONDS + 60)
    assert jobs.sweep_abandoned() == 1
    assert not stale.exists()
    assert fresh.exists()


def test_only_the_oldest_finished_records_are_pruned():
    for i in range(jobs.MAX_KEPT_RECORDS + 3):
        make_job(f"f{i:03d}", state="failed", created=1000.0 + i)
    live = make_job("live", created=1.0)
    unread = make_job("unread", state="done", created=time.time())
    jobs._prune()
    assert "f000" not in jobs.JOBS and "f002" not in jobs.JOBS
    assert "f003" in jobs.JOBS
    assert live.id in jobs.JOBS and unread.id in jobs.JOBS
    assert len(jobs.JOBS) == jobs.MAX_KEPT_RECORDS + 2


@pytest.mark.parametrize(
    "fps,text",
    [(24, "24"), (23.976, "24000/1001"), (29.97, "30000/1001"), (59.94, "60000/1001"), (12.5, "25/2")],
)
def test_frame_rates_become_exact_rationals(fps, text):
    assert jobs.rate_text(fps) == text


def test_progress_follows_uploads_then_encode_passes():
    job = make_job()
    job.received = {0, 1, 2, 3, 4}
    assert job.progress() == 0.5
    job.state = "encoding"
    job.passes = 2
    job.pass_index = 1
    job.done_frames = 5
    assert job.progress() == 0.75
    job.done_frames = 10
    assert job.progress() == 0.99
    job.state = "failed"
    assert job.progress() == 0.0


def test_a_bitrate_wins_over_a_file_size_and_zero_means_constant_quality():
    assert jobs.target_bps(make_job("a")) == 0
    assert jobs.target_bps(make_job("b", video_kbps=500, target_bytes=10_000_000)) == 500_000
    sized = make_job("c", frames=300, target_bytes=1_000_000, has_audio=True)
    assert jobs.target_bps(sized) == int(1_000_000 * 8 * 0.985 / 10 - 192_000)
    assert jobs.target_bps(make_job("d", target_bytes=1)) == 30_000


def test_the_h264_command_is_an_argument_list_over_the_frame_sequence():
    job = make_job(has_audio=True, chapters=[(0.0, "Intro")])
    out = job.folder / "out.mp4"
    cmd = jobs._command(job, FakeInfo(), "libx264", out)
    assert cmd[0] == "/fake/ffmpeg"
    assert cmd[-1] == str(out)
    assert cmd[cmd.index("-framerate") + 1] == "30"
    assert cmd[cmd.index("-crf") + 1] == str(jobs.CRF["high"])
    assert cmd[cmd.index("-frames:v") + 1] == "10"
    assert cmd[cmd.index("-map_chapters") + 1] == "2"
    assert str(job.folder / "audio.wav") in cmd
    assert "title=Intro" in (job.folder / "chapters.txt").read_text("utf-8")


def test_the_statistics_pass_writes_no_file_and_no_sound():
    job = make_job(has_audio=True, video_kbps=800)
    cmd = jobs._command(job, FakeInfo(), "libx264", job.folder / "out.mp4", 1)
    assert cmd[-3:] == ["-f", "null", os.devnull]
    assert "-c:a" not in cmd
    assert cmd[cmd.index("-b:v") + 1] == "800k"
    assert cmd[cmd.index("-pass") + 1] == "1"


def test_prores_with_alpha_uses_a_pixel_format_with_an_alpha_plane():
    job = make_job(target="prores4444", alpha=True, container="mov")
    cmd = jobs._command(job, FakeInfo(), "prores_ks", job.folder / "out.mov")
    assert cmd[cmd.index("-profile:v") + 1] == "4"
    assert cmd[cmd.index("-pix_fmt") + 1] == "yuva444p10le"


class FakeStream:
    def __init__(self, lines):
        self.lines = list(lines)

    async def readline(self):
        return self.lines.pop(0) if self.lines else b""


class FakeProc:
    def __init__(self, code, lines=()):
        self.code = code
        self.returncode = None
        self.stdout = FakeStream(lines)
        self.killed = False

    async def wait(self):
        self.returncode = self.code
        return self.code

    def kill(self):
        self.killed = True


def fake_exec(monkeypatch, code, write=b"movie"):
    calls = []

    async def run(*cmd, **kwargs):
        calls.append(list(cmd))
        if write and cmd[-1] != os.devnull:
            Path(cmd[-1]).write_bytes(write)
        if code:
            kwargs["stderr"].write(b"boom: bad input\n")
        return FakeProc(code, [b"frame=4\n", b"frame=oops\n"])

    monkeypatch.setattr(jobs.asyncio, "create_subprocess_exec", run)
    return calls


def test_a_successful_encode_lands_in_exports_without_replacing_a_file(monkeypatch):
    calls = fake_exec(monkeypatch, 0)
    config.exports_dir().mkdir(parents=True, exist_ok=True)
    (config.exports_dir() / "movie.mp4").write_bytes(b"earlier")
    job = make_job(state="encoding")
    asyncio.run(jobs._encode(job, FakeInfo()))
    assert job.state == "done"
    assert job.output and job.output != "movie.mp4"
    assert (config.exports_dir() / job.output).read_bytes() == b"movie"
    assert (config.exports_dir() / "movie.mp4").read_bytes() == b"earlier"
    assert not job.folder.exists()
    assert len(calls) == 1
    assert job.done_frames == 4


def test_a_bitrate_target_runs_two_passes_with_a_software_encoder(monkeypatch):
    calls = fake_exec(monkeypatch, 0)
    job = make_job(state="encoding", video_kbps=500)
    asyncio.run(jobs._encode(job, FakeInfo()))
    assert job.state == "done"
    assert len(calls) == 2
    assert calls[0][-1] == os.devnull


def test_a_failing_ffmpeg_fails_the_job_with_its_last_words(monkeypatch):
    fake_exec(monkeypatch, 1, write=b"")
    job = make_job(state="encoding")
    asyncio.run(jobs._encode(job, FakeInfo()))
    assert job.state == "failed"
    assert "boom" in job.error
    assert job.output == ""
    assert not job.folder.exists()


def test_hevc_falls_back_to_the_next_encoder_when_one_fails(monkeypatch):
    seen = []

    async def run(*cmd, **kwargs):
        enc = cmd[cmd.index("-c:v") + 1]
        seen.append(enc)
        if enc == "libx265":
            Path(cmd[-1]).write_bytes(b"hevc")
            return FakeProc(0)
        return FakeProc(1)

    monkeypatch.setattr(jobs.asyncio, "create_subprocess_exec", run)
    job = make_job(target="hevc", state="encoding")
    asyncio.run(jobs._encode(job, FakeInfo(hevc=("hevc_nvenc", "libx265"))))
    assert seen == ["hevc_nvenc", "libx265"]
    assert job.state == "done"
    assert job.encoder == "libx265"


def test_a_cancelled_job_starts_no_process(monkeypatch):
    calls = fake_exec(monkeypatch, 0)
    job = make_job(state="cancelled")
    asyncio.run(jobs._encode(job, FakeInfo()))
    assert calls == []
    assert job.state == "cancelled"
    assert job.output == ""
