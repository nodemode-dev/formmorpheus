import io
import zipfile

import pytest
from fastapi import HTTPException

from app.routers.system import _safe_folder


def _zip(entries: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
def target(tmp_path):
    d = tmp_path / "out"
    d.mkdir()
    return d


def test_save_file_writes_the_body(client, target):
    res = client.post("/api/save-to/file", params={"dir": str(target), "name": "clip.mp4"}, content=b"movie")
    assert res.status_code == 200
    assert res.json()["name"] == "clip.mp4"
    assert (target / "clip.mp4").read_bytes() == b"movie"


def test_save_file_never_replaces_a_taken_name(client, target):
    (target / "clip.mp4").write_bytes(b"first")
    names = [client.post("/api/save-to/file", params={"dir": str(target), "name": "clip.mp4"}, content=b"again").json()["name"] for _ in range(2)]
    assert names == ["clip 2.mp4", "clip 3.mp4"]
    assert (target / "clip.mp4").read_bytes() == b"first"


def test_save_file_leaves_no_part_files_behind(client, target):
    client.post("/api/save-to/file", params={"dir": str(target), "name": "a.png"}, content=b"x")
    assert [p.name for p in target.iterdir()] == ["a.png"]


@pytest.mark.parametrize("name", ["CON", "nul.txt", "com1.mp4", "trailing."])
def test_a_reserved_or_trailing_name_is_refused(client, target, name):
    res = client.post("/api/save-to/file", params={"dir": str(target), "name": name}, content=b"x")
    assert res.status_code == 400
    assert list(target.iterdir()) == []


def test_a_folder_that_does_not_exist_is_refused_and_not_created(client, tmp_path):
    missing = tmp_path / "typo" / "deeper"
    res = client.post("/api/save-to/file", params={"dir": str(missing), "name": "a.mp4"}, content=b"x")
    assert res.status_code == 400
    assert not missing.exists()


def test_a_network_share_path_is_refused(client):
    res = client.post("/api/save-to/file", params={"dir": "//server/share", "name": "a.mp4"}, content=b"x")
    assert res.status_code == 400


def test_a_relative_folder_is_refused(client):
    res = client.post("/api/save-to/file", params={"dir": "relative/place", "name": "a.mp4"}, content=b"x")
    assert res.status_code == 400


@pytest.mark.parametrize("raw", ["/etc", "/usr/local", "/proc/self"])
def test_system_folders_are_refused(data_dir, raw):
    with pytest.raises(HTTPException) as err:
        _safe_folder(raw, create=False)
    assert err.value.status_code == 400


def test_the_engines_own_folders_are_refused(data_dir):
    inner = data_dir / "Recovery" / "x"
    inner.mkdir(parents=True)
    with pytest.raises(HTTPException) as err:
        _safe_folder(str(inner))
    assert err.value.status_code == 400


def test_a_file_path_is_refused_as_a_folder(data_dir, tmp_path):
    f = tmp_path / "file.txt"
    f.write_text("x")
    with pytest.raises(HTTPException) as err:
        _safe_folder(str(f))
    assert err.value.status_code == 400


def test_an_empty_or_nul_folder_is_refused(data_dir):
    for raw in ["", "   ", "/tmp/a\x00b"]:
        with pytest.raises(HTTPException):
            _safe_folder(raw)


def test_save_frames_unpacks_names_only_into_a_new_folder(client, target):
    body = _zip({"f/0001.png": b"one", "../../escape.png": b"two", ".hidden": b"h", "dir/": b""})
    res = client.post("/api/save-to/frames", params={"dir": str(target), "folder": "Shot"}, content=body)
    assert res.status_code == 200
    out = res.json()
    assert out["name"] == "Shot"
    assert out["files"] == 2
    assert sorted(p.name for p in (target / "Shot").iterdir()) == ["0001.png", "escape.png"]
    assert not (target.parent / "escape.png").exists()
    assert (target / "Shot" / "escape.png").read_bytes() == b"two"


def test_save_frames_numbers_a_taken_folder(client, target):
    (target / "Shot").mkdir()
    res = client.post("/api/save-to/frames", params={"dir": str(target), "folder": "Shot"}, content=_zip({"a.png": b"1"}))
    assert res.json()["name"] == "Shot 2"


def test_save_frames_refuses_a_body_that_is_not_a_zip(client, target):
    res = client.post("/api/save-to/frames", params={"dir": str(target), "folder": "Shot"}, content=b"nope")
    assert res.status_code == 400
    assert list(target.iterdir()) == []


def test_save_frames_refuses_a_zip_with_no_usable_frames(client, target):
    body = _zip({".hidden": b"h", "CON": b"c", "bad.": b"d"})
    res = client.post("/api/save-to/frames", params={"dir": str(target), "folder": "Shot"}, content=body)
    assert res.status_code == 400
    assert list(target.iterdir()) == []


def test_save_frames_takes_back_a_half_written_folder(client, target, monkeypatch):
    body = _zip({"a.png": b"abc", "b.png": b"defghij"})
    real_open = zipfile.ZipFile.open
    calls = {"n": 0}

    def flaky(self, info, *a, **k):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real_open(self, info, *a, **k)

    monkeypatch.setattr(zipfile.ZipFile, "open", flaky)
    res = client.post("/api/save-to/frames", params={"dir": str(target), "folder": "Shot"}, content=body)
    assert res.status_code == 400
    assert not (target / "Shot").exists()
