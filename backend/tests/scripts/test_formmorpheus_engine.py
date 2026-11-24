import os
import socket
import sys

import pytest

import formmorpheus_engine as engine


@pytest.fixture(autouse=True)
def clean_env(monkeypatch, tmp_path):
    for name in ("FORMMORPHEUS_PORT", "FORMMORPHEUS_PORT_PREFER"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("FORMMORPHEUS_DESKTOP", "1")
    monkeypatch.setenv("FORMMORPHEUS_DIST", str(tmp_path / "dist"))


def test_an_asked_port_is_used_as_is(monkeypatch):
    monkeypatch.setenv("FORMMORPHEUS_PORT", "8123")
    assert engine.free_port() == 8123


def test_an_empty_or_zero_port_picks_a_free_loopback_port(monkeypatch):
    monkeypatch.setenv("FORMMORPHEUS_PORT", "")
    port = engine.free_port()
    assert 0 < port < 65536
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", port))


def test_a_preferred_free_port_is_taken(monkeypatch):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        wanted = s.getsockname()[1]
    monkeypatch.setenv("FORMMORPHEUS_PORT_PREFER", str(wanted))
    assert engine.free_port() == wanted


def test_a_preferred_port_in_use_falls_back_to_another(monkeypatch):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen(1)
        taken = busy.getsockname()[1]
        monkeypatch.setenv("FORMMORPHEUS_PORT_PREFER", str(taken))
        port = engine.free_port()
    assert port != taken
    assert port > 0


def test_resource_dir_is_beside_the_launcher_when_not_frozen(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert engine.resource_dir() == os.path.dirname(os.path.abspath(engine.__file__))


def test_resource_dir_of_a_frozen_build_prefers_the_unpack_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path / "unpacked"), raising=False)
    assert engine.resource_dir() == str(tmp_path / "unpacked")
    monkeypatch.delattr(sys, "_MEIPASS")
    monkeypatch.setattr(sys, "executable", str(tmp_path / "bin" / "engine"))
    assert engine.resource_dir() == str(tmp_path / "bin")


def test_main_runs_the_selfcheck_and_does_not_serve(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["engine", "--selfcheck"])
    monkeypatch.setattr(engine, "selfcheck", lambda: 7)

    def no_serve():
        raise AssertionError("must not serve")

    monkeypatch.setattr(engine, "serve", no_serve)
    assert engine.main() == 7


def test_main_without_flags_serves(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["engine"])
    monkeypatch.setattr(engine, "serve", lambda: 3)
    assert engine.main() == 3


def test_an_unusable_data_folder_stops_with_status_5(monkeypatch, capsys):
    from app.core import config

    def broken():
        raise OSError("read-only")

    monkeypatch.setattr(config, "data_dir", broken)
    assert engine.serve() == 5
    assert "read-only" in capsys.readouterr().err
