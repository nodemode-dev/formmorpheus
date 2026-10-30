import json
import os
import sys
from pathlib import Path

from app import __version__

APP_NAME = "formmorpheus"
VERSION = __version__
FRONTEND_PORT = 5194
BACKEND_PORT = 9494
PROJECT_EXT = ".fmo"
MAX_PROJECT_BYTES = 4 * 1024 * 1024 * 1024
MAX_EXPORT_BYTES = 2 * 1024 * 1024 * 1024
MAX_JOB_FRAMES = 36000
MAX_JOB_SIDE = 8192
MAX_JOB_FRAME_BYTES = 256 * 1024 * 1024
MAX_JOB_AUDIO_BYTES = 1024 * 1024 * 1024
JOB_MAX_AGE_SECONDS = 24 * 3600
BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


def _ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def platform_data_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / APP_NAME
    if sys.platform.startswith("win"):
        return Path(os.environ.get("APPDATA") or home / "AppData" / "Roaming") / APP_NAME
    base = Path(os.environ.get("XDG_DATA_HOME") or ".")
    return (base if base.is_absolute() else home / ".local" / "share") / APP_NAME


def portable_dir() -> Path | None:
    beside = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else BACKEND_DIR
    frozen_marker = getattr(sys, "frozen", False) and any((beside / name).is_file() for name in ("portable", "portable.txt"))
    if os.environ.get("FORMMORPHEUS_PORTABLE") == "1" or frozen_marker:
        return beside / "FormmorpheusData"
    return None


def data_dir() -> Path:
    raw = os.environ.get("FORMMORPHEUS_DATA_DIR")
    if raw:
        return _ensure(Path(raw).expanduser())
    portable = portable_dir()
    if portable:
        return _ensure(portable)
    return _ensure(platform_data_dir())


def data_dir_source() -> str:
    if os.environ.get("FORMMORPHEUS_DATA_DIR"):
        return "override"
    return "portable" if portable_dir() else "default"


def settings_path() -> Path:
    return data_dir() / "settings.json"


def read_settings() -> dict:
    try:
        data = json.loads(settings_path().read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_settings(data: dict) -> None:
    path = settings_path()
    tmp = path.with_name(f".{path.name}.{os.getpid()}.part")
    tmp.write_text(json.dumps(data), "utf-8")
    os.replace(tmp, path)


def library_source() -> str:
    """Where the library folder comes from: the environment, a folder chosen in Preferences, or the default."""
    if os.environ.get("FORMMORPHEUS_LIBRARY_DIR", "").strip():
        return "override"
    return "custom" if str(read_settings().get("libraryDir") or "").strip() else "default"


def default_library_dir() -> Path:
    return data_dir() / "Library"


def library_dir() -> Path:
    raw = os.environ.get("FORMMORPHEUS_LIBRARY_DIR", "").strip()
    if not raw:
        raw = str(read_settings().get("libraryDir") or "").strip()
    if raw:
        try:
            return _ensure(Path(raw).expanduser())
        except OSError:
            pass   # a folder that went away (an unplugged drive): fall back to the default
    return _ensure(default_library_dir())


def exports_dir() -> Path:
    return _ensure(data_dir() / "Exports")


def jobs_dir() -> Path:
    return _ensure(data_dir() / "Jobs")


def trash_dir() -> Path:
    return _ensure(data_dir() / "Recently Deleted")


def dist_dir() -> Path | None:
    raw = os.environ.get("FORMMORPHEUS_DIST")
    path = Path(raw) if raw else REPO_DIR / "frontend" / "dist"
    return path if (path / "index.html").is_file() else None


def window_origins() -> list[str]:
    return [f"http://localhost:{FRONTEND_PORT}", f"http://127.0.0.1:{FRONTEND_PORT}", "tauri://localhost", "http://tauri.localhost"]
