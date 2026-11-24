import json
import logging
import os

import pytest

from app.core import runtime, startup


@pytest.fixture
def logs():
    runtime.stop_logging()
    yield
    runtime.stop_logging()


def held(name: str) -> list:
    return [h for h in logging.getLogger(name).handlers if h.get_name() == runtime.HANDLER]


def test_logging_starts_a_file_in_the_logs_folder_with_a_first_line(tmp_path, logs):
    path = runtime.start_logging(tmp_path)
    assert path == tmp_path / runtime.LOG_FOLDER / runtime.LOG_NAME
    logging.getLogger("formmorpheus").warning("something %s", "odd")
    text = path.read_text(encoding="utf-8")
    assert "engine started" in text and str(os.getpid()) in text
    assert "WARNING formmorpheus something odd" in text


def test_starting_twice_on_one_folder_adds_no_second_handler(tmp_path, logs):
    runtime.start_logging(tmp_path)
    first = held("formmorpheus")
    runtime.start_logging(tmp_path)
    assert held("formmorpheus") == first
    assert len(first) == 1
    assert held("uvicorn") == first


def test_a_handler_lost_from_one_logger_is_put_back(tmp_path, logs):
    runtime.start_logging(tmp_path)
    handler = held("formmorpheus")[0]
    logging.getLogger("uvicorn").removeHandler(handler)
    runtime.start_logging(tmp_path)
    assert held("uvicorn") == [handler]


def test_moving_to_another_folder_replaces_the_handler(tmp_path, logs):
    runtime.start_logging(tmp_path / "one")
    second = runtime.start_logging(tmp_path / "two")
    handlers = held("formmorpheus")
    assert len(handlers) == 1
    assert handlers[0].baseFilename == os.path.abspath(second)


def test_stopping_removes_the_handler_from_every_logger(tmp_path, logs):
    runtime.start_logging(tmp_path)
    runtime.stop_logging()
    assert held("formmorpheus") == [] and held("uvicorn") == []
    runtime.stop_logging()


def test_claim_writes_the_lock_and_warns_about_a_replaced_engine(tmp_path, monkeypatch, caplog):
    seen = []

    def fake(data, shell):
        seen.append((data, shell))
        return data / startup.LOCK_NAME, 4242

    monkeypatch.setattr(startup, "claim", fake)
    monkeypatch.setenv(startup.SHELL_ENV, "99")
    with caplog.at_level(logging.WARNING, logger="formmorpheus"):
        assert runtime.claim(tmp_path) == tmp_path / startup.LOCK_NAME
    assert seen == [(tmp_path, 99)]
    assert "4242" in caplog.text


def test_claim_is_quiet_when_nothing_was_replaced(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(startup, "claim", lambda data, shell: (data / startup.LOCK_NAME, 0))
    with caplog.at_level(logging.WARNING, logger="formmorpheus"):
        runtime.claim(tmp_path)
    assert caplog.text == ""


def test_a_busy_folder_surfaces_as_already_running(tmp_path, monkeypatch):
    def busy(data, shell):
        raise startup.Busy("held")

    monkeypatch.setattr(startup, "claim", busy)
    with pytest.raises(runtime.AlreadyRunning):
        runtime.claim(tmp_path)


def test_release_removes_only_this_engine_own_lock(tmp_path):
    path = tmp_path / startup.LOCK_NAME
    path.write_text(json.dumps({"pid": os.getpid() + 1}), encoding="utf-8")
    runtime.release(tmp_path)
    assert path.exists()
    path.write_text(json.dumps({"pid": os.getpid()}), encoding="utf-8")
    runtime.release(tmp_path)
    assert not path.exists()


def test_release_survives_a_missing_or_broken_lock(tmp_path):
    runtime.release(tmp_path)
    path = tmp_path / startup.LOCK_NAME
    for text in ("{nope", "[1]", '{"pid": null}', '{"pid": "abc"}'):
        path.write_text(text, encoding="utf-8")
        runtime.release(tmp_path)
        assert path.read_text(encoding="utf-8") == text
