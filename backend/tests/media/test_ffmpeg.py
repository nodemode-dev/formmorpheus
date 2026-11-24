import subprocess
import sys

import pytest

from app.services import ffmpeg as ff
from app.services import ffmpeg_fetch

ENCODERS = """Encoders:
 V..... = Video
 ------
 V....D libx264 H.264
 V....D libx265 H.265 / HEVC
 V....D hevc_nvenc NVIDIA HEVC
 A....D aac AAC
 A....D libmp3lame MP3
 V....D mpeg4 MPEG-4 part 2
"""


@pytest.fixture
def lone(monkeypatch):
    monkeypatch.setattr(ff, "_cache", {})
    monkeypatch.delenv("FORMMORPHEUS_FFMPEG", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(ff.shutil, "which", lambda name: None)
    monkeypatch.setattr(ffmpeg_fetch, "installed", lambda: None)


def fake_run(monkeypatch, version="ffmpeg version 7.1.5 Copyright", conf="--enable-shared"):
    calls = []

    def run(argv, **kwargs):
        calls.append(argv)
        out = {"-version": version, "-encoders": ENCODERS, "-buildconf": conf}[argv[-1]]
        return subprocess.CompletedProcess(argv, 0, stdout=out, stderr="")

    monkeypatch.setattr(ff.subprocess, "run", run)
    return calls


def test_the_environment_path_wins_when_it_is_a_file(lone, monkeypatch, tmp_path):
    binary = tmp_path / "ffmpeg"
    binary.write_bytes(b"x")
    monkeypatch.setenv("FORMMORPHEUS_FFMPEG", str(binary))
    monkeypatch.setattr(ff.shutil, "which", lambda name: "/elsewhere/ffmpeg")
    assert ff.find_ffmpeg() == str(binary)


def test_an_environment_path_that_is_missing_falls_back_to_the_search_path(lone, monkeypatch, tmp_path):
    monkeypatch.setenv("FORMMORPHEUS_FFMPEG", str(tmp_path / "absent"))
    monkeypatch.setattr(ff.shutil, "which", lambda name: "/elsewhere/ffmpeg")
    assert ff.find_ffmpeg() == "/elsewhere/ffmpeg"


def test_the_downloaded_build_is_the_last_resort(lone, monkeypatch):
    assert ff.find_ffmpeg() is None
    monkeypatch.setattr(ffmpeg_fetch, "installed", lambda: "/data/ffmpeg/ffmpeg")
    assert ff.find_ffmpeg() == "/data/ffmpeg/ffmpeg"


def test_probe_is_none_when_no_ffmpeg_is_found(lone):
    assert ff.probe() is None


def test_probe_reads_version_and_wanted_encoders_in_order(lone, monkeypatch):
    monkeypatch.setattr(ff.shutil, "which", lambda name: "/bin/ffmpeg")
    calls = fake_run(monkeypatch)
    info = ff.probe()
    assert info.path == "/bin/ffmpeg"
    assert info.version == "7.1.5"
    assert info.encoders == ["aac", "libmp3lame", "libx264", "hevc_nvenc", "libx265"]
    assert info.gpl is False
    assert not info.has("mpeg4")
    assert info.hevc_candidates() == ["hevc_nvenc", "libx265"]
    assert all(argv[:2] == ["/bin/ffmpeg", "-hide_banner"] for argv in calls)


def test_probe_flags_a_gpl_build(lone, monkeypatch):
    monkeypatch.setattr(ff.shutil, "which", lambda name: "/bin/ffmpeg")
    fake_run(monkeypatch, conf="--enable-gpl --enable-libx265")
    assert ff.probe().gpl is True


def test_probe_caches_until_refresh_is_asked(lone, monkeypatch):
    monkeypatch.setattr(ff.shutil, "which", lambda name: "/bin/ffmpeg")
    calls = fake_run(monkeypatch)
    first = ff.probe()
    count = len(calls)
    assert ff.probe() is first
    assert len(calls) == count
    assert ff.probe(refresh=True) is not first
    assert len(calls) == 2 * count


def test_probe_is_none_for_a_program_that_is_not_ffmpeg(lone, monkeypatch):
    monkeypatch.setattr(ff.shutil, "which", lambda name: "/bin/ffmpeg")
    fake_run(monkeypatch, version="some other tool 1.0")
    assert ff.probe() is None


def test_a_program_that_cannot_start_reads_as_no_ffmpeg(lone, monkeypatch):
    monkeypatch.setattr(ff.shutil, "which", lambda name: "/bin/ffmpeg")

    def run(argv, **kwargs):
        raise OSError("cannot start")

    monkeypatch.setattr(ff.subprocess, "run", run)
    assert ff.probe() is None
