"""The Scenes library: scenery the person saved from a movie, one .fmo file each in the data folder's Scenes folder.

A scene is a movie holding the picture tracks the person chose, so the same file reader opens it. Mirrors the
Characters library (routers/characters.py): names, the zip check, the part file, rename, the poster, and a delete that
goes to Recently Deleted with kind "scene"."""
import os
import re
import threading
import time
import uuid
from pathlib import Path

from app.core import config
from app.core.fsmove import safe_move

KIND = "scene"
MAX_SCENE_BYTES = config.MAX_CHARACTER_BYTES
_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_lock = threading.RLock()


class SceneError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def scenes_dir() -> Path:
    folder = config.data_dir() / "Scenes"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def clean_name(name: str) -> str:
    stem = name[: -len(config.PROJECT_EXT)] if name.lower().endswith(config.PROJECT_EXT) else name
    stem = _BAD.sub("-", stem).strip().strip(".")
    if not stem or len(stem) > 180:
        raise SceneError(400, "That scene name cannot be used.")
    return stem


def scene_path(name: str) -> Path:
    return scenes_dir() / f"{clean_name(name)}{config.PROJECT_EXT}"


def existing(name: str) -> Path:
    path = scene_path(name)
    if not path.is_file():
        raise SceneError(404, "No scene by that name.")
    return path


def entry(path: Path) -> dict:
    st = path.stat()
    return {"name": path.stem, "file": path.name, "path": str(path), "size": st.st_size, "modified": st.st_mtime,
            "created": getattr(st, "st_birthtime", None) or min(st.st_ctime, st.st_mtime)}


def list_scenes() -> dict:
    folder = scenes_dir()
    items = []
    for p in folder.glob(f"*{config.PROJECT_EXT}"):
        if p.is_file() and not p.name.startswith("."):
            try:
                items.append(entry(p))
            except OSError:
                continue
    items.sort(key=lambda e: e["modified"], reverse=True)
    return {"folder": str(folder), "items": items}


def write_scene(name: str, body: bytes) -> dict:
    path = scene_path(name)
    if body[:4] != b"PK\x03\x04":
        raise SceneError(400, "That is not a FormMorpheus scene.")
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.part")
    try:
        with open(tmp, "wb") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        with _lock:
            os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return entry(path)


def rename_scene(name: str, to: str) -> dict:
    src = existing(name)
    dst = scene_path(to)
    with _lock:
        if dst.exists() and not (src.exists() and dst.samefile(src)):
            raise SceneError(409, "A scene with that name already exists.")
        os.replace(src, dst)
    return entry(dst)


def delete_scene(name: str) -> dict:
    from app.routers import trash   # lazy: the routers import the services
    src = existing(name)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    with _lock:
        dst = config.trash_dir() / f"{src.stem} {stamp}{config.PROJECT_EXT}"
        n = 2
        while dst.exists():
            dst = config.trash_dir() / f"{src.stem} {stamp} {n}{config.PROJECT_EXT}"
            n += 1
        safe_move(src, dst)
        trash.record(dst, src.name, KIND)
    return {"deleted": src.stem, "kept": str(dst)}
