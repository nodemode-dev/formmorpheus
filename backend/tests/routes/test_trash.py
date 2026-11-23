import json

import pytest
from fastapi import HTTPException

from app.core import config
from app.routers import trash

DAY = 86400.0
T0 = 1_700_000_000.0


def _bin():
    d = config.trash_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _put(name: str, original: str, kind: str, deleted: float, body: bytes = b"x"):
    d = _bin()
    (d / name).write_bytes(body)
    index = d / trash.INDEX_NAME
    data = json.loads(index.read_text("utf-8")) if index.exists() else {}
    data[name] = {"original": original, "kind": kind, "deleted": deleted}
    index.write_text(json.dumps(data), "utf-8")
    return d / name


@pytest.mark.parametrize("bad", ["", "..", ".hidden", "index.json", "a/b", "a\x00b"])
def test_a_bad_item_id_is_refused_with_400(data_dir, bad):
    _bin()
    with pytest.raises(HTTPException) as err:
        trash._safe_file(bad)
    assert err.value.status_code == 400


def test_a_missing_item_answers_404(client):
    _bin()
    assert client.post("/api/trash/nothing.mp4/restore").status_code == 404
    assert client.delete("/api/trash/nothing.mp4").status_code == 404


def test_the_index_file_cannot_be_purged_through_the_route(client):
    _put("a.mp4", "a.mp4", "export", T0)
    assert client.delete(f"/api/trash/{trash.INDEX_NAME}").status_code == 400
    assert (_bin() / trash.INDEX_NAME).exists()


def test_listing_is_newest_first_and_strips_the_project_extension_from_movies(client):
    _put("old.mp4", "old.mp4", "export", T0)
    _put("new" + config.PROJECT_EXT, "Story" + config.PROJECT_EXT, "movie", T0 + DAY)
    body = client.get("/api/trash").json()
    assert body["keepDays"] == trash.KEEP_DAYS
    assert [i["id"] for i in body["items"]] == ["new" + config.PROJECT_EXT, "old.mp4"]
    assert body["items"][0]["name"] == "Story"
    assert body["items"][0]["kind"] == "movie"
    assert body["items"][1]["name"] == "old.mp4"


def test_listing_never_shows_the_index_or_hidden_files(client):
    _put("a.mp4", "a.mp4", "export", T0)
    (_bin() / ".partial").write_bytes(b"x")
    ids = [i["id"] for i in client.get("/api/trash").json()["items"]]
    assert ids == ["a.mp4"]


def test_days_left_never_goes_below_zero(client):
    _put("ancient.mp4", "ancient.mp4", "export", 0.0)
    assert client.get("/api/trash").json()["items"][0]["daysLeft"] == 0


def test_restoring_an_export_takes_a_free_name_and_clears_the_record(client):
    exports = config.exports_dir()
    exports.mkdir(parents=True, exist_ok=True)
    (exports / "clip.mp4").write_bytes(b"keep")
    _put("tid-1.mp4", "clip.mp4", "export", T0, body=b"back")
    res = client.post("/api/trash/tid-1.mp4/restore")
    assert res.status_code == 200
    assert res.json() == {"restored": "clip 2.mp4", "kind": "export"}
    assert (exports / "clip 2.mp4").read_bytes() == b"back"
    assert (exports / "clip.mp4").read_bytes() == b"keep"
    assert not (_bin() / "tid-1.mp4").exists()
    assert "tid-1.mp4" not in json.loads((_bin() / trash.INDEX_NAME).read_text("utf-8"))


def test_restoring_a_movie_picks_a_name_unused_across_the_library(client, monkeypatch):
    import app.routers.library as library

    taken = {"Clip", "Clip 2"}
    monkeypatch.setattr(library, "find_movie", lambda name: name in taken)
    config.library_dir().mkdir(parents=True, exist_ok=True)
    _put("m1" + config.PROJECT_EXT, "Clip" + config.PROJECT_EXT, "movie", T0, body=b"PK")
    res = client.post(f"/api/trash/m1{config.PROJECT_EXT}/restore")
    assert res.status_code == 200
    assert res.json()["restored"] == "Clip 3" + config.PROJECT_EXT
    assert (config.library_dir() / ("Clip 3" + config.PROJECT_EXT)).read_bytes() == b"PK"


def test_purge_removes_one_item_and_empty_removes_the_rest(client):
    _put("a.mp4", "a.mp4", "export", T0)
    _put("b.mp4", "b.mp4", "export", T0)
    _put("c.mp4", "c.mp4", "export", T0)
    assert client.delete("/api/trash/a.mp4").json() == {"deleted": "a.mp4"}
    assert not (_bin() / "a.mp4").exists()
    assert client.delete("/api/trash").json() == {"deleted": 2}
    assert client.get("/api/trash").json()["items"] == []


def test_record_then_list_round_trips_the_original_name(client):
    f = _bin() / "rec.mp4"
    f.write_bytes(b"x")
    trash.record(f, "Holiday.mp4", "export")
    item = client.get("/api/trash").json()["items"][0]
    assert item["original"] == "Holiday.mp4"
    assert item["kind"] == "export"


def test_sweep_keeps_items_younger_than_the_keep_window(data_dir):
    _put("young.mp4", "young.mp4", "export", T0)
    assert trash.sweep(now=T0 + (trash.KEEP_DAYS - 1) * DAY) == 0
    assert (_bin() / "young.mp4").exists()


def test_sweep_deletes_items_older_than_the_keep_window(data_dir):
    _put("old.mp4", "old.mp4", "export", T0)
    _put("young.mp4", "young.mp4", "export", T0 + 20 * DAY)
    assert trash.sweep(now=T0 + (trash.KEEP_DAYS + 1) * DAY) == 1
    assert not (_bin() / "old.mp4").exists()
    assert (_bin() / "young.mp4").exists()
    data = json.loads((_bin() / trash.INDEX_NAME).read_text("utf-8"))
    assert set(data) == {"young.mp4"}


def test_sweep_starts_the_clock_now_for_an_unrecorded_file(data_dir):
    f = _bin() / "stray.mp4"
    f.write_bytes(b"x")
    now = T0 + 500 * DAY
    assert trash.sweep(now=now) == 0
    assert f.exists()
    data = json.loads((_bin() / trash.INDEX_NAME).read_text("utf-8"))
    assert data["stray.mp4"]["deleted"] == now
    assert data["stray.mp4"]["kind"] == "export"
    assert trash.sweep(now=now + (trash.KEEP_DAYS + 1) * DAY) == 1
    assert not f.exists()


def test_sweep_prunes_records_whose_file_is_gone(data_dir):
    _put("a.mp4", "a.mp4", "export", T0)
    index = _bin() / trash.INDEX_NAME
    data = json.loads(index.read_text("utf-8"))
    data["ghost.mp4"] = {"original": "ghost.mp4", "kind": "export", "deleted": T0}
    index.write_text(json.dumps(data), "utf-8")
    trash.sweep(now=T0 + DAY)
    assert set(json.loads(index.read_text("utf-8"))) == {"a.mp4"}


def test_a_corrupt_index_reads_as_empty_and_items_still_list(client):
    d = _bin()
    (d / "a").write_bytes(b"x")
    (d / trash.INDEX_NAME).write_text("{not json", "utf-8")
    items = client.get("/api/trash").json()["items"]
    assert [i["id"] for i in items] == ["a"]
    assert items[0]["kind"] == "export"
