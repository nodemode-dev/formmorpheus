import os
import shutil
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core import config

router = APIRouter()

# Folders a library must never live in: the system's own.
_BLOCKED = ("/etc", "/proc", "/sys", "/dev", "/boot", "/bin", "/sbin", "/lib", "/lib64", "/usr", "/run", "/System", "/Library", "/private/etc",
            "c:/windows", "c:/program files", "c:/program files (x86)", "c:/programdata")


def _icloud() -> Path | None:
    drive = Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
    return drive if drive.is_dir() else None


def _safe_folder(raw: str) -> Path:
    raw = raw.strip()
    if not raw or len(raw) > 1000 or "\x00" in raw:
        raise HTTPException(400, "That folder cannot be used.")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise HTTPException(400, "Give the full path of the folder.")
    path = path.resolve()
    shown = path.as_posix().lower()
    if len(path.parts) < 2 or any(shown == b.lower() or shown.startswith(b.lower() + "/") for b in _BLOCKED):
        raise HTTPException(400, "That folder belongs to the system. Choose one of your own.")
    data = config.data_dir().resolve()
    for sub in ("Exports", "Jobs", "Recently Deleted", "Recovery"):
        inner = data / sub
        if path == inner or inner in path.parents:
            raise HTTPException(400, "That folder is used for something else.")
    if path.exists() and not path.is_dir():
        raise HTTPException(400, "That path is a file, not a folder.")
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".fm-write-test-{os.getpid()}"
        probe.write_bytes(b"")
        probe.unlink()
    except OSError:
        raise HTTPException(400, "formmorpheus cannot write to that folder.")
    return path


@router.get("/system/library")
def library_info() -> dict:
    icloud = _icloud()
    return {
        "dir": str(config.library_dir()),
        "default": str(config.default_library_dir()),
        "source": config.library_source(),
        "icloud": str(icloud / "formmorpheus") if icloud else None,
    }


class LibraryBody(BaseModel):
    dir: str | None = None
    copyMovies: bool = False


@router.post("/system/library")
def set_library(body: LibraryBody) -> dict:
    if config.library_source() == "override":
        raise HTTPException(409, "The library folder is set by FORMMORPHEUS_LIBRARY_DIR, so it cannot be changed here.")
    old = config.library_dir()
    settings = config.read_settings()
    if body.dir is None or not body.dir.strip():
        settings.pop("libraryDir", None)
        target = config.default_library_dir()
        target.mkdir(parents=True, exist_ok=True)
    else:
        target = _safe_folder(body.dir)
        settings["libraryDir"] = str(target)
    copied = 0
    if body.copyMovies and target.resolve() != old.resolve():
        # Top-level movies and order file, the legacy stacks file, then each stack folder (movies + hidden order file).
        # Copies, never moves: the old library stays as it was. Nothing is overwritten.
        def _copy(src: Path, dst: Path) -> int:
            if src.is_file() and not dst.exists():
                shutil.copy2(src, dst)
                return int(src.suffix == config.PROJECT_EXT)
            return 0

        for src in list(old.glob(f"*{config.PROJECT_EXT}")) + [old / ".stacks.json", old / ".order.json"]:
            copied += _copy(src, target / src.name)
        for d in sorted(p for p in old.iterdir() if p.is_dir() and not p.name.startswith(".")):
            if d.resolve() == target.resolve() or d.resolve() in target.resolve().parents:
                continue   # the new library sits inside a stack folder: do not copy into itself
            if not any(d.glob(f"*{config.PROJECT_EXT}")):
                continue
            sub = target / d.name
            sub.mkdir(exist_ok=True)
            for src in list(d.glob(f"*{config.PROJECT_EXT}")) + [d / ".order.json"]:
                copied += _copy(src, sub / src.name)
    config.write_settings(settings)
    return {"dir": str(config.library_dir()), "copied": copied, "source": config.library_source()}


@router.get("/health")
def health() -> dict:
    return {"ok": True, "app": config.APP_NAME, "version": config.VERSION}


@router.get("/capabilities")
def capabilities() -> dict:
    return {
        "app": config.APP_NAME,
        "version": config.VERSION,
        "platform": sys.platform,
        "desktop": os.environ.get("FORMMORPHEUS_DESKTOP") == "1",
        "dataDir": str(config.data_dir()),
        "dataDirSource": config.data_dir_source(),
        "libraryDir": str(config.library_dir()),
        "projectExt": config.PROJECT_EXT,
    }
