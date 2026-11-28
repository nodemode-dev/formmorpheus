import hashlib
import io
import re
import time

import pytest

from app.services import speech_models as models
from app.services import speech_models_record as record

BASE = "/api/speech-models"
FILES = {"model.onnx": b"m" * 3000, "voices/one.bin": b"voice one", "dict/us_gold.json": b'{"a":"b"}'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def url(path):
    return f"https://example.invalid/pinned/{path}"


class Reply(io.BytesIO):
    """A body that can press Cancel after its first block, as a person would half way through."""

    def __init__(self, body, after_first=None):
        super().__init__(body)
        self.after_first = after_first

    def read(self, size=-1):
        block = super().read(2 if self.after_first else size)
        if self.after_first and block:
            self.after_first()
            self.after_first = None
        return block


class FakeOpener:
    def __init__(self, bodies):
        self.bodies = bodies
        self.asked = []
        self.cancel_at = ""

    def open(self, request, timeout=None):
        self.asked.append(request.full_url)
        hit = self.cancel_at and request.full_url.endswith(self.cancel_at)
        return Reply(self.bodies[request.full_url], (lambda: models.cancel("voice")) if hit else None)


@pytest.fixture
def sets(data_dir, monkeypatch):
    pins = tuple(record.Pin(path=path, url=url(path), size=len(body), sha256=sha(body)) for path, body in FILES.items())
    fake = {
        "voice": record.SpeechSet(licence="Apache-2.0", sources=("https://example.invalid/pinned",), files=pins),
        "listen": record.SpeechSet(licence="Apache-2.0", sources=("https://example.invalid/pinned",), files=pins[:1]),
    }
    monkeypatch.setattr(models, "SETS", fake)
    monkeypatch.setattr(models, "_tasks", {name: models.Task() for name in fake})
    opener = FakeOpener({url(path): body for path, body in FILES.items()})
    monkeypatch.setattr(models, "_opener", lambda: opener)
    yield opener
    for name in fake:
        models.cancel(name)
        settle(name)


def settle(name="voice"):
    limit = time.monotonic() + 10
    while models.busy(name):
        assert time.monotonic() < limit, "the download did not end"
        time.sleep(0.005)
    return models.task(name)


def test_the_record_pins_every_file_of_both_sets():
    voice, listen = record.SETS["voice"], record.SETS["listen"]
    assert (voice.licence, len(voice.files)) == ("Apache-2.0", 34)
    assert (listen.licence, len(listen.files)) == ("Apache-2.0", 7)   # as the model card of the pinned files states
    assert sum(1 for pin in voice.files if re.fullmatch(r"voices/[a-z]{2}_[a-z]+\.bin", pin.path)) == 28
    assert {"model.onnx", "tokenizer.json", "dict/us_gold.json", "dict/us_silver.json", "dict/gb_gold.json", "dict/gb_silver.json"} <= {pin.path for pin in voice.files}
    assert voice.total == sum(pin.size for pin in voice.files)
    for spec in (voice, listen):
        assert len({pin.path for pin in spec.files}) == len(spec.files)
        for pin in spec.files:
            assert pin.url.startswith("https://")
            assert re.fullmatch(r"[0-9a-f]{64}", pin.sha256)
            assert pin.size > 0
            assert all(part not in ("", ".", "..") for part in pin.path.split("/")) and "\\" not in pin.path


def test_a_set_downloads_verifies_and_is_installed(sets, data_dir):
    assert models.describe()["voice"] == {"installed": False, "bytes": 3018, "files": 3, "licence": "Apache-2.0",
                                          "task": {"state": "idle", "done": 0, "total": 0, "error": ""}}
    models.start("voice")
    assert settle() == {"state": "idle", "done": 3018, "total": 3018, "error": ""}
    assert models.installed("voice")
    for path, body in FILES.items():
        assert (data_dir / "speech" / "voice" / path).read_bytes() == body
    assert not list((data_dir / "speech").rglob("*.part"))
    assert not models.installed("listen")


def test_a_file_with_the_wrong_hash_is_refused_and_removed(sets, data_dir):
    sets.bodies[url("voices/one.bin")] = b"voice 0ne"   # the recorded size, other bytes
    models.start("voice")
    task = settle()
    assert task["state"] == "failed"
    assert task["error"] == "The download could not be finished: voices/one.bin does not match its recorded SHA-256, so it was not kept."
    folder = data_dir / "speech" / "voice"
    assert (folder / "model.onnx").is_file()   # what verified is kept for the retry
    assert not (folder / "voices" / "one.bin").exists()
    assert not list(folder.rglob("*.part"))
    assert not models.installed("voice")


@pytest.mark.parametrize("body, said", [(b"voice one and more", "larger"), (b"voice", "smaller")])
def test_a_file_of_the_wrong_size_is_refused(sets, data_dir, body, said):
    sets.bodies[url("voices/one.bin")] = body
    models.start("voice")
    task = settle()
    assert task["state"] == "failed" and said in task["error"]
    assert not (data_dir / "speech" / "voice" / "voices" / "one.bin").exists()


def test_an_address_that_is_not_https_is_never_asked(sets, monkeypatch):
    pin = record.Pin(path="model.onnx", url="http://example.invalid/model.onnx", size=1, sha256=sha(b"m"))
    monkeypatch.setitem(models.SETS, "listen", record.SpeechSet(licence="Apache-2.0", sources=(), files=(pin,)))
    models.start("listen")
    assert settle("listen")["state"] == "failed"
    assert sets.asked == []


def test_cancel_stops_and_a_second_download_takes_only_what_is_missing(sets, data_dir):
    sets.cancel_at = "voices/one.bin"
    models.start("voice")
    assert settle() == {"state": "cancelled", "done": 3002, "total": 3018, "error": ""}
    folder = data_dir / "speech" / "voice"
    assert (folder / "model.onnx").is_file()
    assert not (folder / "voices" / "one.bin").exists()
    assert not list(folder.rglob("*.part"))
    sets.cancel_at = ""
    sets.asked.clear()
    models.start("voice")
    assert settle()["state"] == "idle"
    assert sets.asked == [url("voices/one.bin"), url("dict/us_gold.json")]
    assert models.installed("voice")


def test_a_second_download_while_one_runs_is_refused(sets, monkeypatch):
    monkeypatch.setitem(models._tasks, "voice", models.Task(state="downloading"))
    with pytest.raises(RuntimeError):
        models.start("voice")
    with pytest.raises(RuntimeError):
        models.remove("voice")
    monkeypatch.setitem(models._tasks, "voice", models.Task())


def test_remove_deletes_the_set_and_nothing_beside_it(sets, data_dir):
    models.start("voice")
    settle()
    models.start("listen")
    settle("listen")
    beside = data_dir / "speech" / "keep.txt"
    beside.write_text("mine")
    (data_dir / "speech" / "voice" / "stray.txt").write_text("stray")
    models.remove("voice")
    assert not (data_dir / "speech" / "voice").exists()
    assert beside.read_text() == "mine"
    assert models.installed("listen")
    assert models.describe()["voice"]["installed"] is False
    models.remove("voice")   # nothing there: no error


def test_remove_unlinks_a_linked_folder_without_following_it(sets, data_dir, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "model.onnx").write_bytes(b"not ours")
    (data_dir / "speech").mkdir()
    (data_dir / "speech" / "voice").symlink_to(elsewhere, target_is_directory=True)
    models.remove("voice")
    assert not (data_dir / "speech" / "voice").exists()
    assert (elsewhere / "model.onnx").read_bytes() == b"not ours"


def test_a_file_of_another_size_or_a_link_is_not_installed(sets, data_dir, tmp_path):
    models.start("listen")
    settle("listen")
    target = data_dir / "speech" / "listen" / "model.onnx"
    target.write_bytes(b"short")
    assert not models.installed("listen")
    target.unlink()
    outside = tmp_path / "outside.bin"
    outside.write_bytes(FILES["model.onnx"])
    target.symlink_to(outside)
    assert not models.installed("listen")
    assert models.served_file("listen", "model.onnx") is None


def test_routes_report_download_cancel_and_remove(sets, client):
    body = client.get(BASE).json()
    assert set(body["sets"]) == {"voice", "listen"}
    assert body["sets"]["listen"] == {"installed": False, "bytes": 3000, "files": 1, "licence": "Apache-2.0",
                                      "task": {"state": "idle", "done": 0, "total": 0, "error": ""}}
    reply = client.post(f"{BASE}/voice/download")
    assert reply.status_code == 200 and "sets" in reply.json()
    settle()
    assert client.get(BASE).json()["sets"]["voice"]["installed"] is True
    assert client.post(f"{BASE}/voice/cancel").status_code == 200
    reply = client.delete(f"{BASE}/voice")
    assert reply.status_code == 200
    assert reply.json()["sets"]["voice"]["installed"] is False


def test_routes_answer_409_while_a_download_runs_and_404_for_an_unknown_set(sets, client, monkeypatch):
    monkeypatch.setitem(models._tasks, "voice", models.Task(state="downloading"))
    assert client.post(f"{BASE}/voice/download").status_code == 409
    reply = client.delete(f"{BASE}/voice")
    assert (reply.status_code, reply.json()["detail"]) == (409, "These speech models are being downloaded. Cancel the download first.")
    monkeypatch.setitem(models._tasks, "voice", models.Task())
    for method, path in (("post", "/other/download"), ("post", "/other/cancel"), ("delete", "/other"), ("get", "/other/file/model.onnx")):
        assert getattr(client, method)(BASE + path).status_code == 404


def test_the_routes_need_the_window_key(sets, anon_client):
    assert anon_client.get(BASE).status_code == 403
    assert anon_client.post(f"{BASE}/voice/download").status_code == 403
    assert anon_client.get(f"{BASE}/voice/file/model.onnx").status_code == 403
    assert sets.asked == []


def test_the_file_route_serves_a_pinned_path(sets, client):
    assert client.get(f"{BASE}/voice/file/model.onnx").status_code == 404   # not installed yet
    models.start("voice")
    settle()
    reply = client.get(f"{BASE}/voice/file/voices/one.bin")
    assert reply.status_code == 200
    assert reply.content == b"voice one"
    assert reply.headers["content-type"] == "application/octet-stream"
    assert reply.headers["etag"] == f'"{sha(b"voice one")}"'
    assert reply.headers["x-content-type-options"] == "nosniff"
    words = client.get(f"{BASE}/voice/file/dict/us_gold.json")
    assert words.headers["content-type"] == "application/json" and words.json() == {"a": "b"}
    again = client.get(f"{BASE}/voice/file/voices/one.bin", headers={"If-None-Match": reply.headers["etag"]})
    assert (again.status_code, again.content) == (304, b"")


@pytest.fixture
def strays(sets, data_dir):
    models.start("voice")
    settle()
    (data_dir / "settings.json").write_text("{}")
    (data_dir / "speech" / "voice" / "stray.txt").write_text("stray")
    (data_dir / "speech" / "voice" / "voices" / "two.bin").write_bytes(b"unpinned")


@pytest.mark.parametrize("path", [
    "stray.txt", "voices", "voices/", "voices/two.bin", "MODEL.ONNX", "model.onnx/", "../voice/model.onnx",
    "..%2f..%2fsettings.json", "%2e%2e/%2e%2e/settings.json", "%2e%2e%2f%2e%2e%2fsettings.json", "..\\..\\settings.json",
    "..%5c..%5csettings.json", "/model.onnx", "voices//one.bin", "voices%5cone.bin", "voices%2f..%2fmodel.onnx", "",
])
def test_the_file_route_answers_404_for_anything_that_is_not_a_pinned_path(strays, client, path):
    assert client.get(f"{BASE}/voice/file/{path}").status_code == 404


@pytest.mark.parametrize("path", [
    "./model.onnx", "voices/../model.onnx", "../voice/model.onnx", "../../settings.json", "..\\..\\settings.json", "/model.onnx",
    "voices//one.bin", "voices\\one.bin", "model.onnx\0", "model.onnx ", "stray.txt", "voices", "",
])
def test_only_the_exact_text_of_a_pinned_path_names_a_file(strays, path):
    assert models.served_file("voice", path) is None
    assert models.served_file("other", "model.onnx") is None


def test_the_file_route_answers_404_when_a_set_is_only_partly_there(sets, client, data_dir):
    models.start("voice")
    settle()
    (data_dir / "speech" / "voice" / "dict" / "us_gold.json").unlink()
    assert client.get(f"{BASE}/voice/file/model.onnx").status_code == 404


def test_a_leftover_part_file_that_is_a_link_is_never_written_through(sets, data_dir, tmp_path):
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"not ours")
    voices = data_dir / "speech" / "voice" / "voices"
    voices.mkdir(parents=True)
    (voices / ".one.bin.part").symlink_to(outside)
    models.start("voice")
    assert settle()["state"] == "idle"
    assert outside.read_bytes() == b"not ours"
    assert (voices / "one.bin").read_bytes() == FILES["voices/one.bin"]
    assert not (voices / "one.bin").is_symlink()
    assert not list(voices.glob(".*.part"))


def test_the_part_file_is_made_new_and_never_follows_a_link(sets, data_dir, tmp_path, monkeypatch):
    seen = []
    real = models.os.open

    def spy(path, flags, *rest, **more):
        seen.append((str(path), flags))
        return real(path, flags, *rest, **more)

    monkeypatch.setattr(models.os, "open", spy)
    models.start("listen")
    assert settle("listen")["state"] == "idle"
    parts = [flags for path, flags in seen if path.endswith(".part")]
    assert len(parts) == 1
    for flag in ("O_WRONLY", "O_CREAT", "O_EXCL", "O_NOFOLLOW"):
        assert parts[0] & getattr(models.os, flag) == getattr(models.os, flag)


def test_a_linked_folder_inside_the_set_is_not_written_into(sets, data_dir, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    folder = data_dir / "speech" / "voice"
    folder.mkdir(parents=True)
    (folder / "voices").symlink_to(elsewhere, target_is_directory=True)
    models.start("voice")
    task = settle()
    assert task["state"] == "failed"
    assert task["error"] == "The download could not be finished: a folder on the way to voices/one.bin is a link, so nothing was written there."
    assert list(elsewhere.iterdir()) == []
    assert not models.installed("voice")


def test_a_linked_set_folder_is_not_written_into(sets, data_dir, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (data_dir / "speech").mkdir()
    (data_dir / "speech" / "voice").symlink_to(elsewhere, target_is_directory=True)
    models.start("voice")
    assert settle()["state"] == "failed"
    assert list(elsewhere.iterdir()) == []


def test_a_file_behind_a_linked_folder_is_neither_installed_nor_served(sets, client, data_dir, tmp_path):
    models.start("voice")
    settle()
    assert client.get(f"{BASE}/voice/file/voices/one.bin").status_code == 200
    voices = data_dir / "speech" / "voice" / "voices"
    elsewhere = tmp_path / "elsewhere"
    voices.rename(elsewhere)
    voices.symlink_to(elsewhere, target_is_directory=True)
    assert (voices / "one.bin").read_bytes() == FILES["voices/one.bin"]   # the same bytes, reached through a link
    assert not models.installed("voice")
    assert models.served_file("voice", "voices/one.bin") is None
    assert client.get(f"{BASE}/voice/file/voices/one.bin").status_code == 404
    assert client.get(f"{BASE}/voice/file/model.onnx").status_code == 404
