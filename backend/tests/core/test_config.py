import sys
from pathlib import Path

from app.core import config


def test_the_data_folder_override_wins_and_is_created(tmp_path, monkeypatch):
    target = tmp_path / "a" / "b"
    monkeypatch.setenv("FORMMORPHEUS_DATA_DIR", str(target))
    monkeypatch.setenv("FORMMORPHEUS_PORTABLE", "1")
    assert config.data_dir() == target
    assert target.is_dir()
    assert config.data_dir_source() == "override"


def test_portable_mode_keeps_the_data_beside_the_engine(monkeypatch):
    monkeypatch.delenv("FORMMORPHEUS_DATA_DIR", raising=False)
    monkeypatch.setenv("FORMMORPHEUS_PORTABLE", "1")
    assert config.portable_dir() == config.BACKEND_DIR / "FormmorpheusData"
    assert config.data_dir_source() == "portable"
    monkeypatch.setenv("FORMMORPHEUS_PORTABLE", "0")
    assert config.portable_dir() is None
    assert config.data_dir_source() == "default"


def test_the_default_data_folder_follows_the_platform(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    assert config.platform_data_dir() == tmp_path / ".local" / "share" / config.APP_NAME
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    assert config.platform_data_dir() == tmp_path / "xdg" / config.APP_NAME
    monkeypatch.setenv("XDG_DATA_HOME", "relative/path")
    assert config.platform_data_dir() == tmp_path / ".local" / "share" / config.APP_NAME
    monkeypatch.setattr(sys, "platform", "darwin")
    assert config.platform_data_dir() == tmp_path / "Library" / "Application Support" / config.APP_NAME
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roam"))
    assert config.platform_data_dir() == tmp_path / "Roam" / config.APP_NAME
    monkeypatch.delenv("APPDATA")
    assert config.platform_data_dir() == tmp_path / "AppData" / "Roaming" / config.APP_NAME


def test_settings_round_trip_and_leave_no_part_file(data_dir):
    assert config.read_settings() == {}
    config.write_settings({"theme": "dark", "n": 3})
    assert config.read_settings() == {"theme": "dark", "n": 3}
    config.write_settings({"theme": "light"})
    assert config.read_settings() == {"theme": "light"}
    assert [p.name for p in data_dir.iterdir()] == ["settings.json"]


def test_broken_or_odd_settings_read_as_empty(data_dir):
    config.settings_path().write_text("{oops", "utf-8")
    assert config.read_settings() == {}
    config.settings_path().write_text("[1, 2]", "utf-8")
    assert config.read_settings() == {}
    config.settings_path().write_bytes(b"\xff\xfe\x00")
    assert config.read_settings() == {}


def test_the_library_defaults_to_a_folder_inside_the_data_folder(data_dir):
    assert config.library_source() == "default"
    assert config.library_dir() == data_dir / "Library"
    assert (data_dir / "Library").is_dir()


def test_a_library_chosen_in_settings_is_used_and_the_environment_beats_it(data_dir, tmp_path, monkeypatch):
    chosen = tmp_path / "chosen"
    config.write_settings({"libraryDir": f"  {chosen}  "})
    assert config.library_source() == "custom"
    assert config.library_dir() == chosen
    assert chosen.is_dir()
    forced = tmp_path / "forced"
    monkeypatch.setenv("FORMMORPHEUS_LIBRARY_DIR", str(forced))
    assert config.library_source() == "override"
    assert config.library_dir() == forced
    monkeypatch.setenv("FORMMORPHEUS_LIBRARY_DIR", "   ")
    assert config.library_source() == "custom"
    assert config.library_dir() == chosen


def test_a_library_that_cannot_be_made_falls_back_to_the_default(data_dir, tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    config.write_settings({"libraryDir": str(blocker / "inside")})
    assert config.library_dir() == data_dir / "Library"


def test_a_blank_or_odd_library_setting_counts_as_default(data_dir):
    for value in ("   ", None, 0, ""):
        config.write_settings({"libraryDir": value})
        assert config.library_source() == "default"
        assert config.library_dir() == data_dir / "Library"


def test_the_working_folders_are_made_inside_the_data_folder(data_dir):
    assert config.exports_dir() == data_dir / "Exports"
    assert config.jobs_dir() == data_dir / "Jobs"
    assert config.trash_dir() == data_dir / "Recently Deleted"
    assert all((data_dir / name).is_dir() for name in ("Exports", "Jobs", "Recently Deleted"))


def test_the_built_interface_counts_only_with_an_index_page(tmp_path, monkeypatch):
    monkeypatch.setenv("FORMMORPHEUS_DIST", str(tmp_path))
    assert config.dist_dir() is None
    (tmp_path / "index.html").mkdir()
    assert config.dist_dir() is None
    (tmp_path / "index.html").rmdir()
    (tmp_path / "index.html").write_text("<html></html>")
    assert config.dist_dir() == tmp_path


def test_the_window_origins_are_the_dev_server_and_the_desktop_shell_only():
    origins = config.window_origins()
    assert f"http://localhost:{config.FRONTEND_PORT}" in origins
    assert f"http://127.0.0.1:{config.FRONTEND_PORT}" in origins
    assert "tauri://localhost" in origins
    assert all(o == o.lower() and not o.endswith("/") and "*" not in o for o in origins)
    assert all(o.split("//")[1].split(":")[0] in ("localhost", "127.0.0.1", "tauri.localhost") for o in origins)
