"""The Characters library: saved characters, one .fmo file each in the data folder's Characters folder.

A character is a movie the size of its source holding one track with the one character group, so the same file
reader opens it. The routes follow routers/library.py (names, the zip check, the part file, rename, the poster);
there are no stacks, tags or duplicates here. A deleted character goes to Recently Deleted with kind "character"."""
import os
import re
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.core import config
from app.core.fsmove import safe_move
from app.core.upload import read_limited
from app.routers import trash
from app.routers.library import _picture

router = APIRouter()

KIND = "character"
_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_lock = threading.RLock()


def clean_name(name: str) -> str:
    stem = name[: -len(config.PROJECT_EXT)] if name.lower().endswith(config.PROJECT_EXT) else name
    stem = _BAD.sub("-", stem).strip().strip(".")
    if not stem or len(stem) > 180:
        raise HTTPException(400, "That character name cannot be used.")
    return stem


def character_path(name: str) -> Path:
    return config.characters_dir() / f"{clean_name(name)}{config.PROJECT_EXT}"


def entry(path: Path) -> dict:
    st = path.stat()
    return {"name": path.stem, "file": path.name, "path": str(path), "size": st.st_size, "modified": st.st_mtime,
            "created": getattr(st, "st_birthtime", None) or min(st.st_ctime, st.st_mtime)}


def list_characters() -> dict:
    folder = config.characters_dir()
    items = []
    for p in folder.glob(f"*{config.PROJECT_EXT}"):
        if p.is_file() and not p.name.startswith("."):
            try:
                items.append(entry(p))
            except OSError:
                continue
    items.sort(key=lambda e: e["modified"], reverse=True)
    return {"folder": str(folder), "items": items}


@router.get("")
def list_all() -> dict:
    return list_characters()


@router.get("/{name}")
def read_character(name: str) -> Response:
    path = character_path(name)
    if not path.is_file():
        raise HTTPException(404, "No character by that name.")
    return Response(path.read_bytes(), media_type="application/octet-stream")


@router.get("/{name}/poster")
def read_poster(name: str, v: str | None = None) -> Response:
    path = character_path(name)
    if not path.is_file():
        raise HTTPException(404, "No character by that name.")
    return _picture(path, "poster.png", v)


@router.put("/{name}")
async def write_character(name: str, request: Request) -> dict:
    path = character_path(name)
    body = await read_limited(request, config.MAX_CHARACTER_BYTES, "The character is too large to save.")
    if body[:4] != b"PK\x03\x04":
        raise HTTPException(400, "That is not a FormMorpheus character.")
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


class RenameBody(BaseModel):
    to: str


@router.post("/{name}/rename")
def rename_character(name: str, body: RenameBody) -> dict:
    src = character_path(name)
    if not src.is_file():
        raise HTTPException(404, "No character by that name.")
    dst = character_path(body.to)
    with _lock:
        if dst.exists() and not (src.exists() and dst.samefile(src)):
            raise HTTPException(409, "A character with that name already exists.")
        os.replace(src, dst)
    return entry(dst)


@router.delete("/{name}")
def delete_character(name: str) -> dict:
    src = character_path(name)
    if not src.is_file():
        raise HTTPException(404, "No character by that name.")
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
