import pytest

from app.core import config
from app.routers import jobs
from jobs_helpers import FakeInfo, body


@pytest.fixture(autouse=True)
def fake_ffmpeg(monkeypatch):
    monkeypatch.setattr(jobs, "JOBS", {})
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: FakeInfo())


def test_a_new_job_is_queued_with_an_empty_folder_for_frames(client):
    r = client.post("/api/jobs/export", json=body())
    assert r.status_code == 200
    data = r.json()
    assert data["state"] == "queued"
    assert data["received"] == 0
    assert data["progress"] == 0
    assert (config.jobs_dir() / data["id"] / "frames").is_dir()


@pytest.mark.parametrize(
    "over",
    [
        {"target": "gif"},
        {"fps": 0},
        {"fps": 241},
        {"width": 0},
        {"width": config.MAX_JOB_SIDE + 2},
        {"height": 35},
        {"width": 63},
        {"frames": 0},
        {"frames": config.MAX_JOB_FRAMES + 1},
        {"quality": "ultra"},
        {"container": "avi"},
        {"audio_codec": "mp3"},
        {"target": "prores", "profile": "nope"},
        {"audio_codec": "pcm", "container": "mp4"},
    ],
)
def test_a_bad_request_is_refused_and_makes_no_job(client, over):
    r = client.post("/api/jobs/export", json=body(**over))
    assert r.status_code == 400
    assert jobs.JOBS == {}


def test_the_largest_allowed_size_and_frame_count_are_accepted(client):
    r = client.post("/api/jobs/export", json=body(width=config.MAX_JOB_SIDE, height=config.MAX_JOB_SIDE, frames=config.MAX_JOB_FRAMES))
    assert r.status_code == 200


def test_a_missing_ffmpeg_is_reported_as_unavailable(client, monkeypatch):
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: None)
    assert client.post("/api/jobs/export", json=body()).status_code == 503


@pytest.mark.parametrize(
    "target,info",
    [
        ("prores", FakeInfo(encoders=("libx264",))),
        ("h264", FakeInfo(encoders=("prores_ks",))),
        ("hevc", FakeInfo(hevc=())),
    ],
)
def test_a_target_without_its_encoder_is_unavailable(client, monkeypatch, target, info):
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: info)
    assert client.post("/api/jobs/export", json=body(target=target)).status_code == 503


def test_sound_in_aac_needs_an_aac_encoder(client, monkeypatch):
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: FakeInfo(encoders=("libx264",)))
    assert client.post("/api/jobs/export", json=body(has_audio=True)).status_code == 503


def test_prores_always_goes_into_a_mov_file(client):
    job_id = client.post("/api/jobs/export", json=body(target="prores", container="mp4")).json()["id"]
    assert jobs.JOBS[job_id].container == "mov"


def test_alpha_is_kept_only_where_the_target_can_carry_it(client):
    plain = client.post("/api/jobs/export", json=body(target="h264", alpha=True)).json()["id"]
    four = client.post("/api/jobs/export", json=body(target="prores4444", alpha=True)).json()["id"]
    hevc = client.post("/api/jobs/export", json=body(target="hevc", alpha=True)).json()["id"]
    assert jobs.JOBS[plain].alpha is False
    assert jobs.JOBS[four].alpha is True
    assert jobs.JOBS[hevc].alpha is False


def test_rate_settings_are_clamped(client):
    job_id = client.post("/api/jobs/export", json=body(video_kbps=-5, target_bytes=1 << 50)).json()["id"]
    assert jobs.JOBS[job_id].video_kbps == 0
    assert jobs.JOBS[job_id].target_bytes == 1 << 40


def test_a_name_with_a_path_in_it_is_refused(client):
    r = client.post("/api/jobs/export", json=body(name="../../etc/passwd.mp4"))
    assert r.status_code == 400
    assert jobs.JOBS == {}


def test_the_extension_is_dropped_from_the_job_name(client):
    job_id = client.post("/api/jobs/export", json=body(name="clip.mp4")).json()["id"]
    assert jobs.JOBS[job_id].name == "clip"


def test_chapters_are_sorted_deduplicated_and_kept_inside_the_movie(client):
    chapters = [
        {"start": 0.5, "title": "b=;#"},
        {"start": 0.0, "title": "Intro"},
        {"start": 0.5, "title": "twin"},
        {"start": 99, "title": "late"},
        {"start": -1, "title": "early"},
    ]
    job_id = client.post("/api/jobs/export", json=body(frames=60, chapters=chapters)).json()["id"]
    assert jobs.JOBS[job_id].chapters == [(0.0, "Intro"), (0.5, "b")]


def test_an_unnamed_chapter_gets_a_numbered_title():
    assert jobs._clean_chapters([jobs.Chapter(start=0)], 10) == [(0, "Chapter 1")]


def test_the_window_key_is_required(anon_client):
    r = anon_client.post("/api/jobs/export", json=body())
    assert r.status_code in (401, 403)
    assert jobs.JOBS == {}


def test_capabilities_without_ffmpeg_marks_every_target_unavailable(client, monkeypatch):
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: None)
    data = client.get("/api/jobs/capabilities").json()
    assert data["ffmpeg"] is False
    assert set(data["targets"]) == set(jobs.TARGETS)
    assert all(not t["available"] and t["reason"] for t in data["targets"].values())


def test_capabilities_reports_each_encoder_found(client, monkeypatch):
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: FakeInfo(encoders=("libx264",), hevc=("hevc_videotoolbox",)))
    data = client.get("/api/jobs/capabilities").json()
    assert data["targets"]["h264"]["available"] is True
    assert data["targets"]["prores"]["available"] is False
    assert data["targets"]["prores"]["reason"]
    assert data["targets"]["hevc"]["alpha"] is True
    assert data["aac"] is False
