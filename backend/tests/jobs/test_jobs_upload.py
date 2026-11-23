import pytest

from app.core import config
from app.routers import jobs
from jobs_helpers import PNG, WAV, FakeInfo, body


@pytest.fixture(autouse=True)
def fake_ffmpeg(monkeypatch):
    monkeypatch.setattr(jobs, "JOBS", {})
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: FakeInfo())

    async def no_encode(job, info):
        return None

    monkeypatch.setattr(jobs, "_encode", no_encode)


def make(client, **over):
    return client.post("/api/jobs/export", json=body(**over)).json()["id"]


def test_a_png_frame_is_stored_and_counted(client):
    job_id = make(client)
    r = client.put(f"/api/jobs/{job_id}/frames/1", content=PNG)
    assert r.status_code == 200
    assert r.json() == {"received": 1}
    assert (config.jobs_dir() / job_id / "frames" / "000001.png").read_bytes() == PNG
    state = client.get(f"/api/jobs/{job_id}").json()
    assert state["state"] == "receiving"
    assert state["progress"] == 0.5


def test_sending_the_same_frame_twice_counts_once(client):
    job_id = make(client)
    client.put(f"/api/jobs/{job_id}/frames/0", content=PNG)
    assert client.put(f"/api/jobs/{job_id}/frames/0", content=PNG).json() == {"received": 1}


@pytest.mark.parametrize("index", [-1, 2, 999999])
def test_a_frame_index_outside_the_job_is_refused(client, index):
    job_id = make(client)
    assert client.put(f"/api/jobs/{job_id}/frames/{index}", content=PNG).status_code == 400


def test_a_frame_that_is_not_a_png_is_refused_and_removed(client):
    job_id = make(client)
    r = client.put(f"/api/jobs/{job_id}/frames/0", content=b"GIF89a not a png")
    assert r.status_code == 400
    assert list((config.jobs_dir() / job_id / "frames").iterdir()) == []
    assert client.get(f"/api/jobs/{job_id}").json()["received"] == 0


def test_a_frame_over_the_size_limit_is_refused_and_leaves_nothing(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_JOB_FRAME_BYTES", 16)
    job_id = make(client)
    r = client.put(f"/api/jobs/{job_id}/frames/0", content=PNG)
    assert r.status_code == 413
    assert list((config.jobs_dir() / job_id / "frames").iterdir()) == []


def test_a_frame_for_an_unknown_job_is_not_found(client):
    assert client.put("/api/jobs/nope/frames/0", content=PNG).status_code == 404


def test_sound_is_refused_on_a_job_made_without_sound(client):
    job_id = make(client)
    assert client.put(f"/api/jobs/{job_id}/audio", content=WAV).status_code == 400


def test_a_wav_is_stored_and_reported(client):
    job_id = make(client, has_audio=True)
    r = client.put(f"/api/jobs/{job_id}/audio", content=WAV)
    assert r.json() == {"audio": True}
    assert (config.jobs_dir() / job_id / "audio.wav").read_bytes() == WAV
    state = client.get(f"/api/jobs/{job_id}").json()
    assert state["audio"] is True
    assert state["state"] == "receiving"


def test_sound_that_is_not_a_wav_is_refused_and_removed(client):
    job_id = make(client, has_audio=True)
    assert client.put(f"/api/jobs/{job_id}/audio", content=b"ID3 some mp3 bytes").status_code == 400
    assert not (config.jobs_dir() / job_id / "audio.wav").exists()
    assert client.get(f"/api/jobs/{job_id}").json()["audio"] is False


def test_sound_over_the_size_limit_is_refused(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_JOB_AUDIO_BYTES", 8)
    job_id = make(client, has_audio=True)
    assert client.put(f"/api/jobs/{job_id}/audio", content=WAV).status_code == 413
    assert not (config.jobs_dir() / job_id / "audio.wav").exists()


def test_run_is_refused_while_frames_are_missing(client):
    job_id = make(client)
    client.put(f"/api/jobs/{job_id}/frames/0", content=PNG)
    assert client.post(f"/api/jobs/{job_id}/run").status_code == 409
    assert client.get(f"/api/jobs/{job_id}").json()["state"] == "receiving"


def test_run_is_refused_while_the_sound_is_missing(client):
    job_id = make(client, has_audio=True, frames=1)
    client.put(f"/api/jobs/{job_id}/frames/0", content=PNG)
    assert client.post(f"/api/jobs/{job_id}/run").status_code == 409


def test_run_moves_a_complete_job_to_encoding_and_closes_uploads(client):
    job_id = make(client, frames=1)
    client.put(f"/api/jobs/{job_id}/frames/0", content=PNG)
    r = client.post(f"/api/jobs/{job_id}/run")
    assert r.status_code == 200
    assert r.json()["state"] == "encoding"
    assert client.put(f"/api/jobs/{job_id}/frames/0", content=PNG).status_code == 409
    assert client.post(f"/api/jobs/{job_id}/run").status_code == 409


def test_run_without_ffmpeg_is_unavailable_and_keeps_the_job_open(client, monkeypatch):
    job_id = make(client, frames=1)
    client.put(f"/api/jobs/{job_id}/frames/0", content=PNG)
    monkeypatch.setattr(jobs.ff, "probe", lambda *a, **k: None)
    assert client.post(f"/api/jobs/{job_id}/run").status_code == 503
    assert jobs.JOBS[job_id].state == "receiving"


def test_cancel_removes_the_folder_and_refuses_later_uploads(client):
    job_id = make(client)
    client.put(f"/api/jobs/{job_id}/frames/0", content=PNG)
    r = client.delete(f"/api/jobs/{job_id}")
    assert r.json()["state"] == "cancelled"
    assert not (config.jobs_dir() / job_id).exists()
    assert client.put(f"/api/jobs/{job_id}/frames/1", content=PNG).status_code == 409
    assert client.post(f"/api/jobs/{job_id}/run").status_code == 409


def test_cancelling_a_finished_job_leaves_it_finished(client):
    job_id = make(client)
    jobs.JOBS[job_id].state = "done"
    jobs.JOBS[job_id].output = "movie.mp4"
    data = client.delete(f"/api/jobs/{job_id}").json()
    assert data["state"] == "done"
    assert data["output"] == "movie.mp4"


def test_reading_a_finished_job_marks_it_fetched_and_complete(client):
    job_id = make(client)
    jobs.JOBS[job_id].state = "done"
    assert client.get(f"/api/jobs/{job_id}").json()["progress"] == 1
    assert jobs.JOBS[job_id].fetched is True


def test_an_unknown_job_is_not_found(client):
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.delete("/api/jobs/nope").status_code == 404
    assert client.post("/api/jobs/nope/run").status_code == 404
