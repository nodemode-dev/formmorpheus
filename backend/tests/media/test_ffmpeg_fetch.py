import hashlib
import io
import tarfile

import pytest

from app.services import ffmpeg_fetch as fetch


class FakeOpener:
    def __init__(self, body):
        self.body = body
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        return io.BytesIO(self.body)


@pytest.fixture
def idle(monkeypatch):
    fetch._cancel.clear()
    yield
    fetch._cancel.clear()


def use_opener(monkeypatch, body):
    opener = FakeOpener(body)
    monkeypatch.setattr(fetch.urllib.request, "build_opener", lambda *handlers: opener)
    return opener


def sha(data):
    return hashlib.sha256(data).hexdigest()


def make_archive(path, files, prefix="bundle"):
    with tarfile.open(path, "w:gz") as bundle:
        for name, data in files.items():
            entry = tarfile.TarInfo(f"{prefix}/{name}")
            entry.size = len(data)
            bundle.addfile(entry, io.BytesIO(data))


def test_download_refuses_an_address_that_is_not_https(idle, tmp_path):
    with pytest.raises(ValueError):
        fetch._download("http://example.invalid/a.tar.gz", tmp_path / "a", 10)
    assert not (tmp_path / "a").exists()


def test_download_writes_the_body_and_reports_progress(idle, monkeypatch, tmp_path):
    opener = use_opener(monkeypatch, b"abcdef")
    target = tmp_path / "a.part"
    fetch._download("https://example.invalid/a.tar.gz", target, 6)
    assert target.read_bytes() == b"abcdef"
    assert fetch.task()["received"] == 6
    assert fetch.task()["total"] == 6
    assert opener.requests[0].full_url == "https://example.invalid/a.tar.gz"


def test_download_stops_when_the_body_is_larger_than_recorded(idle, monkeypatch, tmp_path):
    use_opener(monkeypatch, b"abcdefgh")
    with pytest.raises(ValueError):
        fetch._download("https://example.invalid/a.tar.gz", tmp_path / "a.part", 4)


def test_download_stops_when_cancelled(idle, monkeypatch, tmp_path):
    use_opener(monkeypatch, b"abcdef")
    fetch.cancel()
    with pytest.raises(fetch.Cancelled):
        fetch._download("https://example.invalid/a.tar.gz", tmp_path / "a.part", 6)


def test_a_redirect_that_leaves_https_is_refused():
    handler = fetch._HttpsOnly()
    with pytest.raises(fetch.urllib.error.URLError):
        handler.redirect_request(None, None, 302, "Found", {}, "http://example.invalid/x")


def test_digest_is_the_sha256_of_the_file(tmp_path):
    path = tmp_path / "blob"
    path.write_bytes(b"hello" * 1000)
    assert fetch._digest(path) == sha(b"hello" * 1000)


def test_install_copies_only_pinned_files_that_match_their_record(idle, tmp_path):
    ffmpeg, ffprobe = fetch._program_name("ffmpeg"), fetch._program_name("ffprobe")
    files = {ffmpeg: b"program one", ffprobe: b"program two", "lib/one.so": b"library", "stray.txt": b"stray", "LGPL-2.1.txt": b"licence"}
    archive = tmp_path / "a.tar.gz"
    make_archive(archive, files)
    pins = ((ffmpeg, sha(files[ffmpeg])), (ffprobe, sha(files[ffprobe])), ("lib/one.so", sha(b"library")))
    where = tmp_path / "root" / "build"
    where.parent.mkdir()
    fetch._install(archive, pins, where)
    assert (where / ffmpeg).read_bytes() == b"program one"
    assert (where / "lib" / "one.so").read_bytes() == b"library"
    assert (where / "LGPL-2.1.txt").read_bytes() == b"licence"
    assert not (where / "stray.txt").exists()
    assert sorted(p.name for p in where.parent.iterdir()) == ["build"]


def test_install_refuses_a_file_that_does_not_match_and_keeps_the_old_build(idle, tmp_path):
    ffmpeg, ffprobe = fetch._program_name("ffmpeg"), fetch._program_name("ffprobe")
    archive = tmp_path / "a.tar.gz"
    make_archive(archive, {ffmpeg: b"tampered", ffprobe: b"program two"})
    pins = ((ffmpeg, sha(b"program one")), (ffprobe, sha(b"program two")))
    where = tmp_path / "root" / "build"
    where.mkdir(parents=True)
    (where / "keep").write_bytes(b"old")
    with pytest.raises(ValueError):
        fetch._install(archive, pins, where)
    assert (where / "keep").read_bytes() == b"old"
    assert sorted(p.name for p in where.parent.iterdir()) == ["build"]


def test_install_refuses_an_archive_without_the_first_pinned_file(idle, tmp_path):
    archive = tmp_path / "a.tar.gz"
    make_archive(archive, {"other": b"x"})
    where = tmp_path / "root" / "build"
    where.parent.mkdir()
    with pytest.raises(ValueError):
        fetch._install(archive, (("ffmpeg-nowhere", sha(b"x")),), where)
    assert not where.exists()


def test_start_refuses_a_computer_without_a_build(idle, monkeypatch):
    monkeypatch.setattr(fetch, "available", lambda: False)
    with pytest.raises(ValueError):
        fetch.start()


def test_start_refuses_a_data_folder_inside_the_app(idle, monkeypatch):
    monkeypatch.setattr(fetch, "available", lambda: True)
    monkeypatch.setattr(fetch, "inside_app_bundle", lambda path: True)
    with pytest.raises(ValueError):
        fetch.start()


def test_remove_is_refused_while_a_download_runs(idle, monkeypatch):
    monkeypatch.setattr(fetch, "busy", lambda: True)
    with pytest.raises(RuntimeError):
        fetch.remove()


def test_every_recorded_platform_has_an_archive_and_pinned_programs():
    assert set(fetch.ARCHIVES) == set(fetch.FILES)
    for triple, pins in fetch.FILES.items():
        digest, size = fetch.ARCHIVES[triple]
        assert len(digest) == 64 and size > 0
        assert pins[0][0].startswith("ffmpeg-") and pins[1][0].startswith("ffprobe-")
        assert all(len(d) == 64 and int(d, 16) >= 0 for _, d in pins)
