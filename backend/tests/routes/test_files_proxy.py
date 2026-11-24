import asyncio
from pathlib import Path

import pytest

from app.core import config
from app.routers import proxy


def test_reading_a_movie_by_absolute_path_streams_it_uncached(client, tmp_path):
    f = tmp_path / f"m{config.PROJECT_EXT}"
    f.write_bytes(b"PKmovie")
    res = client.get("/api/files/read", params={"path": str(f)})
    assert res.status_code == 200
    assert res.content == b"PKmovie"
    assert res.headers["cache-control"] == "no-store"


def test_reading_a_file_of_another_kind_is_refused(client, tmp_path):
    f = tmp_path / "secret.txt"
    f.write_text("x")
    assert client.get("/api/files/read", params={"path": str(f)}).status_code == 400


def test_reading_a_relative_path_is_refused(client):
    assert client.get("/api/files/read", params={"path": f"rel/m{config.PROJECT_EXT}"}).status_code == 400


def test_reading_a_missing_file_answers_404(client, tmp_path):
    assert client.get("/api/files/read", params={"path": str(tmp_path / f"none{config.PROJECT_EXT}")}).status_code == 404


def test_reading_a_file_over_the_size_cap_is_refused(client, tmp_path, monkeypatch):
    f = tmp_path / f"big{config.PROJECT_EXT}"
    f.write_bytes(b"0123456789")
    monkeypatch.setattr(config, "MAX_PROJECT_BYTES", 4)
    assert client.get("/api/files/read", params={"path": str(f)}).status_code == 413


def test_reading_through_a_foreign_host_name_is_refused(client, tmp_path):
    f = tmp_path / f"m{config.PROJECT_EXT}"
    f.write_bytes(b"PKmovie")
    res = client.get("/api/files/read", params={"path": str(f)}, headers={"host": "evil.example"})
    assert res.status_code >= 400
    assert res.content != b"PKmovie"


class _Info:
    path = "/fake/ffmpeg"

    def __init__(self, ok: bool = True):
        self.ok = ok

    def has(self, name: str) -> bool:
        return self.ok and name == "libx264"


class _Proc:
    def __init__(self, code: int, dst: Path | None, data: bytes):
        self.returncode = code
        self.dst = dst
        self.data = data

    async def communicate(self):
        if self.dst is not None:
            self.dst.write_bytes(self.data)
        return b"", b"encoder broke"


def _fake_exec(calls: list, code: int = 0, data: bytes = b"mp4data"):
    async def run(*args, **kwargs):
        calls.append(args)
        return _Proc(code, Path(args[-1]) if code == 0 else None, data)
    return run


def _leftovers() -> list:
    d = config.jobs_dir()
    return list(d.glob("proxy-*")) if d.exists() else []


@pytest.mark.parametrize("height", [0, 480, 1080, -360])
def test_an_unsupported_proxy_height_is_refused(client, height):
    assert client.post("/api/proxy/make", params={"height": height}, content=b"\x00\x01").status_code == 400


def test_no_ffmpeg_answers_503(client, monkeypatch):
    monkeypatch.setattr(proxy.ff, "probe", lambda: None)
    assert client.post("/api/proxy/make", content=b"\x00\x01").status_code == 503


def test_an_ffmpeg_without_h264_answers_503(client, monkeypatch):
    monkeypatch.setattr(proxy.ff, "probe", lambda: _Info(ok=False))
    assert client.post("/api/proxy/make", content=b"\x00\x01").status_code == 503


@pytest.mark.parametrize("head", [b"#EXTM3U\nfile.ts", b"ffconcat version 1.0", b"  <html>", b"\xef\xbb\xbffile 'x'"])
def test_a_text_playlist_is_refused_before_ffmpeg_runs(client, monkeypatch, head):
    calls: list = []
    monkeypatch.setattr(proxy.ff, "probe", lambda: _Info())
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec(calls))
    res = client.post("/api/proxy/make", content=head)
    assert res.status_code == 400
    assert calls == []
    assert _leftovers() == []


def test_a_proxy_is_returned_and_its_temp_folder_removed(client, monkeypatch):
    calls: list = []
    monkeypatch.setattr(proxy.ff, "probe", lambda: _Info())
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec(calls))
    res = client.post("/api/proxy/make", params={"height": 360}, content=b"\x00\x00\x00\x18ftypmp42")
    assert res.status_code == 200
    assert res.content == b"mp4data"
    assert res.headers["content-type"] == "video/mp4"
    args = calls[0]
    assert args[0] == "/fake/ffmpeg"
    assert "-an" in args
    assert any("min(360," in str(a) for a in args)
    assert _leftovers() == []


def test_a_failed_encode_answers_500_and_leaves_nothing(client, monkeypatch):
    monkeypatch.setattr(proxy.ff, "probe", lambda: _Info())
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_exec([], code=1))
    res = client.post("/api/proxy/make", content=b"\x00\x00\x00\x18ftypmp42")
    assert res.status_code == 500
    assert _leftovers() == []
