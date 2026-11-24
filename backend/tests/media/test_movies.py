import io
import json
import zipfile

import pytest

from app.services import movies

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def write_movie(path, movie, manifest=None, extra=None):
    with zipfile.ZipFile(path, "w") as zout:
        zout.writestr("manifest.json", json.dumps({"app": "formmorpheus", "version": "x"} if manifest is None else manifest))
        if movie is not None:
            zout.writestr("movie.json", movie if isinstance(movie, str) else json.dumps(movie))
        for name, data in (extra or {}).items():
            zout.writestr(name, data)
    return path


def test_an_empty_movie_round_trips_through_read_meta(tmp_path):
    path = tmp_path / "first.fmo"
    path.write_bytes(movies.empty_movie("First", 1280, 720, 30, 2))
    meta = movies.read_meta(path)
    assert meta["name"] == "first"
    assert meta["title"] == "First"
    assert (meta["width"], meta["height"], meta["fps"], meta["frames"], meta["seconds"]) == (1280, 720, 30, 60, 2.0)
    assert meta["tracks"] == []
    assert meta["counts"]["content"] == 0
    assert meta["file"]["history"] is False and meta["file"]["poster"] is False
    assert meta["file"]["size"] == path.stat().st_size


def test_an_empty_movie_clamps_size_rate_and_length():
    with zipfile.ZipFile(io.BytesIO(movies.empty_movie("x", 99999, 1, 500, 0))) as zin:
        movie = json.loads(zin.read("movie.json"))
    assert movie["width"] == movies.MAX_SIDE
    assert movie["height"] == movies.MIN_SIDE
    assert movie["fps"] == movies.MAX_FPS
    assert movie["duration"] == 1
    with zipfile.ZipFile(io.BytesIO(movies.empty_movie("x", fps=0))) as zin:
        assert json.loads(zin.read("movie.json"))["fps"] == 1


def test_a_file_that_is_not_a_zip_is_not_a_movie(tmp_path):
    path = tmp_path / "bad.fmo"
    path.write_bytes(b"not a zip")
    with pytest.raises(movies.NotAMovie):
        movies.read_meta(path)
    with pytest.raises(movies.NotAMovie):
        movies.read_meta(tmp_path / "absent.fmo")


def test_a_zip_from_another_app_or_with_damaged_json_is_not_a_movie(tmp_path):
    with pytest.raises(movies.NotAMovie):
        movies.read_meta(write_movie(tmp_path / "a.fmo", {"fps": 24}, manifest={"app": "other"}))
    with pytest.raises(movies.NotAMovie):
        movies.read_meta(write_movie(tmp_path / "b.fmo", "{broken"))
    with pytest.raises(movies.NotAMovie):
        movies.read_meta(write_movie(tmp_path / "c.fmo", "[1, 2]"))
    with pytest.raises(movies.NotAMovie):
        movies.read_meta(write_movie(tmp_path / "d.fmo", None))


def test_malformed_fields_fall_back_to_defaults(tmp_path):
    meta = movies.read_meta(write_movie(tmp_path / "m.fmo", {"fps": "fast", "width": True, "height": None, "tracks": "none", "assets": [1]}))
    assert meta["fps"] == 24
    assert (meta["width"], meta["height"]) == (1920, 1080)
    assert meta["frames"] == 24
    assert meta["tracks"] == []
    assert meta["counts"]["assets"] == 0
    assert meta["playback"] == "loop"
    assert meta["camera"] is False


def test_a_rate_below_one_is_raised_to_one(tmp_path):
    meta = movies.read_meta(write_movie(tmp_path / "m.fmo", {"fps": 0, "duration": 5}))
    assert meta["fps"] == 1.0
    assert meta["seconds"] == 5.0


def test_tracks_and_content_are_counted_by_kind_with_nested_groups(tmp_path):
    movie = {
        "tracks": [
            {"name": "", "hidden": 1, "content": [
                {"kind": "text", "name": "T", "start": 3, "duration": 9, "text": {"text": "a" * 300}},
                {"kind": "flipbook", "flip": [{"frames": [1, 2]}, {"frames": [3]}, "junk"]},
                {"kind": "drawing", "layers": [1, 2, 3]},
                {"kind": "group", "tracks": [{"name": "Inner", "content": [{"kind": "text"}]}]},
                "junk",
            ]},
            "junk",
        ],
        "assets": {"a": {"kind": "image"}, "b": {"kind": "image"}, "c": {"kind": "sound"}, "d": 7},
    }
    meta = movies.read_meta(write_movie(tmp_path / "m.fmo", movie, extra={"poster.png": PNG, "history.json": "{}"}))
    track = meta["tracks"][0]
    assert track["name"] == "Track 1" and track["hidden"] is True and track["content"] == 4
    text, flip, drawing, group = track["items"]
    assert (text["start"], text["duration"], len(text["text"])) == (3, 9, 120)
    assert (flip["name"], flip["start"], flip["duration"]) == ("flipbook", 0, 1)
    assert (flip["flipRows"], flip["flipFrames"]) == (2, 3)
    assert drawing["layers"] == 3
    assert group["tracks"][0]["name"] == "Inner"
    assert meta["counts"]["tracks"] == 1
    assert meta["counts"]["content"] == 5
    assert meta["counts"]["byKind"] == {"text": 2, "flipbook": 1, "drawing": 1, "group": 1}
    assert meta["counts"]["assetsByKind"] == {"image": 2, "sound": 1}
    assert meta["file"]["poster"] is True and meta["file"]["history"] is True and meta["file"]["preview"] is False


def test_a_track_lists_a_limited_number_of_items_but_counts_all(tmp_path):
    many = movies.ITEMS_PER_TRACK + 5
    movie = {"tracks": [{"content": [{"kind": "shape"} for _ in range(many)]}]}
    meta = movies.read_meta(write_movie(tmp_path / "m.fmo", movie))
    assert len(meta["tracks"][0]["items"]) == movies.ITEMS_PER_TRACK
    assert meta["tracks"][0]["content"] == many
    assert meta["counts"]["byKind"] == {"shape": many}


def test_picture_returns_only_real_png_members(tmp_path, monkeypatch):
    path = write_movie(tmp_path / "m.fmo", {}, extra={"poster.png": PNG, "preview.png": b"GIF89a" + b"\x00" * 10})
    assert movies.picture(path, "poster.png") == PNG
    assert movies.picture(path, "preview.png") is None
    assert movies.picture(path, "absent.png") is None
    assert movies.picture(tmp_path / "absent.fmo", "poster.png") is None
    monkeypatch.setattr(movies, "PICTURE_LIMIT", 8)
    assert movies.picture(path, "poster.png") is None
