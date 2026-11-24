import errno
import os

import pytest

from app.core import fsmove


def cross_device(monkeypatch, fail_second=False):
    real = os.replace
    calls = []

    def replace(src, dst):
        calls.append((str(src), str(dst)))
        if len(calls) == 1:
            raise OSError(errno.EXDEV, "cross-device link")
        if fail_second:
            raise OSError(errno.ENOSPC, "no space")
        return real(src, dst)

    monkeypatch.setattr(fsmove.os, "replace", replace)
    return calls


def test_a_move_on_one_device_renames_the_file(tmp_path):
    src = tmp_path / "a.bin"
    dst = tmp_path / "sub" / "b.bin"
    dst.parent.mkdir()
    src.write_bytes(b"payload")
    assert fsmove.safe_move(src, dst) == dst
    assert dst.read_bytes() == b"payload"
    assert not src.exists()


def test_a_move_replaces_an_existing_destination(tmp_path):
    src = tmp_path / "a.bin"
    dst = tmp_path / "b.bin"
    src.write_bytes(b"new")
    dst.write_bytes(b"old")
    fsmove.safe_move(src, dst)
    assert dst.read_bytes() == b"new"


def test_a_move_across_devices_copies_then_removes_the_source(tmp_path, monkeypatch):
    src = tmp_path / "a.bin"
    dst = tmp_path / "other" / "b.bin"
    dst.parent.mkdir()
    data = os.urandom(3 * 1024 * 1024 + 17)
    src.write_bytes(data)
    os.utime(src, (1_500_000_000, 1_500_000_000))
    calls = cross_device(monkeypatch)
    assert fsmove.safe_move(src, dst) == dst
    assert dst.read_bytes() == data
    assert int(dst.stat().st_mtime) == 1_500_000_000
    assert not src.exists()
    assert [p.name for p in dst.parent.iterdir()] == ["b.bin"]
    assert os.path.dirname(calls[1][0]) == str(dst.parent)


def test_a_failed_copy_across_devices_leaves_the_source_and_no_part_file(tmp_path, monkeypatch):
    src = tmp_path / "a.bin"
    dst = tmp_path / "other" / "b.bin"
    dst.parent.mkdir()
    src.write_bytes(b"keep me")
    dst.write_bytes(b"old")
    cross_device(monkeypatch, fail_second=True)
    with pytest.raises(OSError):
        fsmove.safe_move(src, dst)
    assert src.read_bytes() == b"keep me"
    assert dst.read_bytes() == b"old"
    assert [p.name for p in dst.parent.iterdir()] == ["b.bin"]


def test_any_other_failure_is_raised_unchanged(tmp_path):
    src = tmp_path / "missing.bin"
    with pytest.raises(FileNotFoundError):
        fsmove.safe_move(src, tmp_path / "b.bin")
    assert list(tmp_path.iterdir()) == []
