import json
import time

import pytest

from app.core import config
from app.routers import recovery

ZIP = b"PK\x03\x04" + b"payload" * 10
SID = "session-abc123"


@pytest.fixture
def fresh(monkeypatch):
    monkeypatch.setattr(recovery, "_streams", {})
    monkeypatch.setattr(recovery, "_closed", {})
    monkeypatch.setattr(recovery, "BOOT", time.time())


def _side(session: str, **meta):
    folder = recovery.recovery_dir()
    (folder / f"{session}{config.PROJECT_EXT}").write_bytes(ZIP)
    (folder / f"{session}.json").write_text(json.dumps(meta), "utf-8")


def _item(client, session: str) -> dict:
    return next(i for i in client.get("/api/recovery").json()["items"] if i["session"] == session)


@pytest.mark.parametrize("bad", ["abc", "has.dot.in.it", "x" * 65, "white space1"])
def test_a_malformed_session_id_is_refused(client, bad):
    assert client.put(f"/api/recovery/{bad}", content=ZIP).status_code == 400
    assert client.get(f"/api/recovery/{bad}").status_code == 400
    assert client.delete(f"/api/recovery/{bad}").status_code == 400


def test_a_body_that_is_not_a_project_zip_is_refused(client):
    res = client.put(f"/api/recovery/{SID}", content=b"not a zip at all")
    assert res.status_code == 400
    assert client.get(f"/api/recovery/{SID}").status_code == 404


def test_save_then_recover_returns_the_same_bytes(client, fresh):
    res = client.put(f"/api/recovery/{SID}", params={"name": "My Movie", "library": "Stack A"}, content=ZIP)
    assert res.status_code == 200
    entry = res.json()
    assert entry["name"] == "My Movie"
    assert entry["library"] == "Stack A"
    assert entry["size"] == len(ZIP)
    assert entry["gone"] is False
    got = client.get(f"/api/recovery/{SID}")
    assert got.status_code == 200
    assert got.content == ZIP


def test_a_long_name_is_cut_to_180_characters(client, fresh):
    entry = client.put(f"/api/recovery/{SID}", params={"name": "n" * 400}, content=ZIP).json()
    assert entry["name"] == "n" * 180


def test_delete_removes_the_snapshot_and_its_sidecar(client, fresh):
    client.put(f"/api/recovery/{SID}", content=ZIP)
    assert client.delete(f"/api/recovery/{SID}").json() == {"ok": True}
    assert client.get(f"/api/recovery/{SID}").status_code == 404
    assert not (recovery.recovery_dir() / f"{SID}.json").exists()
    assert client.delete(f"/api/recovery/{SID}").json() == {"ok": True}


def test_a_heartbeat_for_a_missing_snapshot_answers_404(client):
    assert client.post(f"/api/recovery/{SID}/alive").status_code == 404


def test_listing_is_newest_first(client, fresh):
    now = time.time()
    _side("older-one", name="Older", time=now - 100, alive=now)
    _side("newer-one", name="Newer", time=now - 10, alive=now)
    names = [i["name"] for i in client.get("/api/recovery").json()["items"]]
    assert names == ["Newer", "Older"]


def test_a_stale_heartbeat_marks_the_window_gone_and_a_heartbeat_revives_it(client, fresh):
    now = time.time()
    _side(SID, name="Crash", time=now - 1000, alive=now - 1000)
    assert _item(client, SID)["gone"] is True
    assert client.post(f"/api/recovery/{SID}/alive").json() == {"ok": True}
    item = _item(client, SID)
    assert item["gone"] is False
    assert item["name"] == "Crash"


def test_an_open_stream_means_not_gone_whatever_the_heartbeat(client, fresh, monkeypatch):
    now = time.time()
    _side(SID, time=now - 5000, alive=now - 5000)
    monkeypatch.setattr(recovery, "_streams", {SID: 1})
    item = _item(client, SID)
    assert item["gone"] is False
    assert item["wait"] == 0.0


def test_a_just_closed_stream_waits_out_the_grace_period(client, fresh, monkeypatch):
    now = time.time()
    _side(SID, time=now, alive=now)
    monkeypatch.setattr(recovery, "_closed", {SID: time.time()})
    item = _item(client, SID)
    assert item["gone"] is False
    assert 0.0 < item["wait"] <= recovery.GRACE_SECONDS


def test_a_stream_closed_past_the_grace_period_is_gone(client, fresh, monkeypatch):
    now = time.time()
    _side(SID, time=now, alive=now)
    monkeypatch.setattr(recovery, "_closed", {SID: time.time() - recovery.GRACE_SECONDS - 5})
    item = _item(client, SID)
    assert item["gone"] is True
    assert item["wait"] == 0.0


def test_after_an_engine_restart_an_unknown_window_is_gone(client, fresh, monkeypatch):
    now = time.time()
    _side(SID, time=now, alive=now)
    monkeypatch.setattr(recovery, "BOOT", time.time() - recovery.UNKNOWN_SECONDS - 5)
    assert _item(client, SID)["gone"] is True


def test_broken_sidecar_values_fall_back_to_safe_defaults(client, fresh):
    folder = recovery.recovery_dir()
    (folder / f"{SID}{config.PROJECT_EXT}").write_bytes(ZIP)
    (folder / f"{SID}.json").write_text(json.dumps({"time": "nan", "alive": 1e15, "library": 7}), "utf-8")
    item = _item(client, SID)
    assert item["name"] == "Untitled"
    assert item["library"] is None
    assert item["time"] == item["time"]
    assert abs(item["time"] - time.time()) < 3600


def test_files_with_bad_session_names_are_not_listed(client, fresh):
    folder = recovery.recovery_dir()
    (folder / f"bad.name{config.PROJECT_EXT}").write_bytes(ZIP)
    _side(SID, time=time.time(), alive=time.time())
    assert [i["session"] for i in client.get("/api/recovery").json()["items"]] == [SID]


def test_old_closed_records_are_pruned(fresh, monkeypatch):
    closed = {"stale-one": time.time() - recovery.PRUNE_SECONDS - 10, "fresh-one": time.time()}
    monkeypatch.setattr(recovery, "_closed", closed)
    recovery._prune()
    assert set(closed) == {"fresh-one"}
