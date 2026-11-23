import io
import os
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.core import config
from app.routers import library
from library_helpers import PNG, movie_bytes, names, read_json, save


def test_an_empty_library_lists_no_items(client):
    body = client.get("/api/library").json()
    assert body["items"] == []
    assert Path(body["folder"]) == config.library_dir()


def test_a_saved_project_reads_back_byte_for_byte(client):
    data = movie_bytes(movie_id="abc")
    r = client.put("/api/library/Film", content=data)
    assert r.status_code == 200
    assert r.json()["name"] == "Film"
    assert r.json()["file"] == "Film.fmo"
    assert r.json()["size"] == len(data)
    assert client.get("/api/library/Film").content == data


def test_saving_again_replaces_the_project_and_leaves_no_part_file(client):
    save(client, "Film", movie_id="one")
    save(client, "Film", movie_id="two")
    assert read_json(client.get("/api/library/Film").content)["id"] == "two"
    assert [p.name for p in config.library_dir().iterdir()] == ["Film.fmo"]


def test_a_body_that_is_not_a_zip_is_refused_and_nothing_is_written(client):
    r = client.put("/api/library/Film", content=b"hello world")
    assert r.status_code == 400
    assert list(config.library_dir().iterdir()) == []


def test_an_empty_body_is_refused(client):
    assert client.put("/api/library/Film", content=b"").status_code == 400


def test_a_project_over_the_size_limit_is_refused(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_PROJECT_BYTES", 64)
    r = client.put("/api/library/Big", content=movie_bytes(extra={"pad": "x" * 500}))
    assert r.status_code == 413
    assert names(client) == []


def test_a_streamed_upload_over_the_limit_is_refused(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_PROJECT_BYTES", 64)

    def chunks():
        yield b"PK\x03\x04"
        for _ in range(10):
            yield b"x" * 32

    r = client.put("/api/library/Big", content=chunks())
    assert r.status_code == 413
    assert names(client) == []


def test_a_streamed_upload_under_the_limit_is_saved_whole(client):
    data = movie_bytes()

    def chunks():
        for i in range(0, len(data), 7):
            yield data[i:i + 7]

    assert client.put("/api/library/Stream", content=chunks()).status_code == 200
    assert client.get("/api/library/Stream").content == data


def test_reading_a_missing_project_is_a_404(client):
    assert client.get("/api/library/Nope").status_code == 404


def test_the_project_extension_in_the_name_is_ignored(client):
    save(client, "Film.fmo")
    assert names(client) == ["Film"]
    assert client.get("/api/library/Film.FMO").status_code == 200


def test_the_list_is_sorted_newest_first(client):
    save(client, "Old")
    save(client, "New")
    lib = config.library_dir()
    os.utime(lib / "Old.fmo", (1000, 1000))
    os.utime(lib / "New.fmo", (2000, 2000))
    items = client.get("/api/library").json()["items"]
    assert [i["name"] for i in items] == ["New", "Old"]
    assert items[0]["modified"] == 2000


def test_files_of_other_kinds_are_not_listed(client):
    save(client, "Film")
    (config.library_dir() / "notes.txt").write_text("x")
    assert names(client) == ["Film"]


def test_the_window_key_is_required(anon_client):
    assert anon_client.get("/api/library").status_code in (401, 403)


@pytest.mark.parametrize("bad", ["", "   ", "...", ".", "x" * 181])
def test_clean_name_refuses_unusable_names(bad):
    with pytest.raises(HTTPException) as e:
        library.clean_name(bad)
    assert e.value.status_code == 400


def test_clean_name_replaces_separators_and_control_characters():
    assert library.clean_name("a/b\\c:d") == "a-b-c-d"
    assert library.clean_name("tab\there") == "tab-here"
    assert library.clean_name("  Film.fmo ") == "Film.fmo"
    assert library.clean_name("Film.fmo") == "Film"
    assert library.clean_name("x" * 180) == "x" * 180


def test_a_traversal_name_resolves_inside_the_library(data_dir):
    for raw in ["../../etc/passwd", "..\\..\\secret", "/abs/path", ".."]:
        try:
            p = library.project_path(raw)
        except HTTPException as e:
            assert e.status_code == 400
            continue
        assert p.parent == config.library_dir()


def test_an_encoded_traversal_save_stays_inside_the_library(client, data_dir):
    r = client.put("/api/library/..%5C..%5Cevil", content=movie_bytes())
    assert r.status_code == 200
    assert Path(r.json()["path"]).parent == config.library_dir()
    assert not (data_dir.parent / "evil.fmo").exists()


def test_a_name_of_only_dots_cannot_be_saved(client):
    assert client.put("/api/library/...", content=movie_bytes()).status_code in (400, 404)
    assert names(client) == []


def test_rename_moves_the_project_and_keeps_its_bytes(client):
    data = movie_bytes()
    client.put("/api/library/Film", content=data)
    r = client.post("/api/library/Film/rename", json={"to": "Movie"})
    assert r.status_code == 200
    assert r.json()["name"] == "Movie"
    assert names(client) == ["Movie"]
    assert client.get("/api/library/Movie").content == data
    assert client.get("/api/library/Film").status_code == 404


def test_rename_onto_an_existing_project_is_refused(client):
    save(client, "A", movie_id="a")
    save(client, "B", movie_id="b")
    assert client.post("/api/library/A/rename", json={"to": "B"}).status_code == 409
    assert read_json(client.get("/api/library/B").content)["id"] == "b"
    assert names(client) == ["A", "B"]


def test_rename_of_a_missing_project_is_a_404(client):
    assert client.post("/api/library/Nope/rename", json={"to": "X"}).status_code == 404


def test_rename_to_an_unusable_name_is_refused(client):
    save(client, "Film")
    assert client.post("/api/library/Film/rename", json={"to": "..."}).status_code == 400
    assert names(client) == ["Film"]


def test_rename_cleans_separators_out_of_the_new_name(client):
    save(client, "Film")
    r = client.post("/api/library/Film/rename", json={"to": "../up"})
    assert r.status_code == 200
    assert Path(r.json()["path"]).parent == config.library_dir()


def test_rename_carries_the_tags_along(client):
    save(client, "Film")
    client.post("/api/library/_tags/Film", json={"tags": ["red"]})
    client.post("/api/library/Film/rename", json={"to": "Movie"})
    assert client.get("/api/library/_tags").json()["tags"] == {"Movie": ["red"]}


def test_duplicate_makes_a_copy_with_a_new_id_and_its_own_name(client):
    save(client, "Film", movie_id="orig", extra={"frames/1.bin": b"abc"})
    r = client.post("/api/library/Film/duplicate")
    assert r.status_code == 200
    assert r.json()["name"] == "Film copy"
    raw = client.get("/api/library/Film copy").content
    meta = read_json(raw)
    assert meta["id"] != "orig" and meta["id"].startswith("m")
    assert meta["name"] == "Film copy"
    assert meta["frames"] == 3
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert z.read("frames/1.bin") == b"abc"
    assert read_json(client.get("/api/library/Film").content)["id"] == "orig"


def test_a_second_duplicate_gets_a_number(client):
    save(client, "Film")
    client.post("/api/library/Film/duplicate")
    assert client.post("/api/library/Film/duplicate").json()["name"] == "Film copy 2"
    assert names(client) == ["Film", "Film copy", "Film copy 2"]


def test_duplicate_of_a_file_without_movie_json_is_a_plain_copy(client):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("other.txt", "x")
    client.put("/api/library/Odd", content=buf.getvalue())
    assert client.post("/api/library/Odd/duplicate").status_code == 200
    assert client.get("/api/library/Odd copy").content == buf.getvalue()


def test_duplicate_of_a_missing_project_is_a_404(client):
    assert client.post("/api/library/Nope/duplicate").status_code == 404


def test_delete_moves_the_project_to_the_trash(client):
    data = movie_bytes()
    client.put("/api/library/Film", content=data)
    r = client.delete("/api/library/Film")
    assert r.status_code == 200
    assert r.json()["deleted"] == "Film"
    kept = Path(r.json()["kept"])
    assert kept.parent == config.trash_dir()
    assert kept.read_bytes() == data
    assert names(client) == []
    assert client.get("/api/library/Film").status_code == 404


def test_delete_of_a_missing_project_is_a_404(client):
    assert client.delete("/api/library/Nope").status_code == 404


def test_a_movie_without_a_poster_answers_204(client):
    save(client, "Film")
    assert client.get("/api/library/Film/poster").status_code == 204
    assert client.get("/api/library/Film/preview").status_code == 204


def test_the_poster_is_served_and_cached_only_with_a_version(client):
    save(client, "Film", poster=PNG)
    r = client.get("/api/library/Film/poster")
    assert r.content == PNG
    assert r.headers["cache-control"] == "no-store"
    assert "max-age" in client.get("/api/library/Film/poster?v=1").headers["cache-control"]


def test_a_poster_is_added_to_a_movie_that_has_none_without_changing_its_time(client):
    save(client, "Film", movie_id="keep")
    path = config.library_dir() / "Film.fmo"
    os.utime(path, (5000, 5000))
    r = client.put("/api/library/Film/poster", content=PNG)
    assert r.json() == {"ok": True, "written": True}
    assert client.get("/api/library/Film/poster").content == PNG
    assert read_json(path.read_bytes())["id"] == "keep"
    assert path.stat().st_mtime == 5000


def test_an_existing_poster_is_never_overwritten(client):
    save(client, "Film", poster=PNG)
    r = client.put("/api/library/Film/poster", content=PNG + b"new")
    assert r.json()["written"] is False
    assert client.get("/api/library/Film/poster").content == PNG


def test_a_poster_that_is_not_a_png_is_refused(client):
    save(client, "Film")
    assert client.put("/api/library/Film/poster", content=b"GIF89a").status_code == 400


def test_a_poster_over_eight_megabytes_is_refused(client):
    save(client, "Film")
    r = client.put("/api/library/Film/poster", content=PNG + b"\x00" * (8 * 1024 * 1024))
    assert r.status_code == 413
    assert client.get("/api/library/Film/poster").status_code == 204
