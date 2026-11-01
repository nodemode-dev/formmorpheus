"""The app-wide Fonts library: font files kept once in the data folder (Fonts/), available in every movie.

A movie still embeds the fonts its Text uses (the window copies a library font into the movie when a Text picks it),
so a shared .fmo opens elsewhere. The family names live in a small `.fonts.json` beside the files, because the
window already read them from each font's name table when the font was imported.
"""
import json
import os
import re
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.core import config

router = APIRouter()

EXTS = {".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2"}
FILE_LIMIT = 64 * 1024 * 1024
INDEX = ".fonts.json"
_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_lock = threading.RLock()


def root() -> Path:
    p = config.data_dir() / "Fonts"
    p.mkdir(parents=True, exist_ok=True)
    return p


def check(name: str) -> str:
    if not name or len(name.encode("utf-8")) > 160 or name != name.strip() or _BAD.search(name) or name.startswith(".") or name.endswith("."):
        raise HTTPException(400, "That font file name cannot be used.")
    if Path(name).suffix.lower() not in EXTS:
        raise HTTPException(400, "Fonts are .ttf, .otf, .woff or .woff2 files.")
    return name


def _read_index() -> dict:
    try:
        data = json.loads((root() / INDEX).read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_index(data: dict) -> None:
    path = root() / INDEX
    tmp = path.with_name(f".{INDEX}.{os.getpid()}.part")
    tmp.write_text(json.dumps(data), "utf-8")
    os.replace(tmp, path)


def _entry(p: Path, family: str) -> dict:
    st = p.stat()
    return {"file": p.name, "family": family, "size": st.st_size, "modified": st.st_mtime}


@router.get("")
def list_fonts() -> dict:
    with _lock:
        index = _read_index()
        items = []
        for p in sorted(root().iterdir(), key=lambda x: x.name.lower()):
            if p.is_file() and not p.is_symlink() and not p.name.startswith(".") and p.suffix.lower() in EXTS:
                items.append(_entry(p, str(index.get(p.name) or p.stem)))
        return {"folder": str(root()), "items": items}


@router.get("/{name}")
def read_font(name: str) -> FileResponse:
    p = root() / check(name)
    if not p.is_file() or p.is_symlink():
        raise HTTPException(404, "No font by that name.")
    return FileResponse(p, media_type=EXTS[p.suffix.lower()], headers={"Cache-Control": "no-store"})


@router.put("/{name}")
async def write_font(name: str, request: Request, family: str = "") -> dict:
    name = check(name)
    family = family.strip()[:120]
    if not family or '"' in family or "\\" in family or re.search(r"[\x00-\x1f]", family):
        raise HTTPException(400, "The font needs a family name.")
    with _lock:
        index = _read_index()
        dest = root() / name
        # the same file name with the same family is the same font: it is replaced; another family gets its own name
        if dest.exists() and index.get(name) != family:
            n = 2
            while (root() / f"{Path(name).stem} {n}{Path(name).suffix}").exists():
                n += 1
            dest = root() / f"{Path(name).stem} {n}{Path(name).suffix}"
    tmp = dest.with_name(f".{uuid.uuid4().hex}.part")
    size = 0
    try:
        with open(tmp, "wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > FILE_LIMIT:
                    raise HTTPException(413, "That font file is too large.")
                out.write(chunk)
        if size < 12:
            raise HTTPException(400, "That is not a font file.")
        with open(tmp, "rb") as probe:
            magic = probe.read(4)
        # the first bytes must be those of a font, not just the right extension (a page or a script renamed .ttf)
        if magic not in (b"\x00\x01\x00\x00", b"OTTO", b"true", b"ttcf", b"wOFF", b"wOF2"):
            raise HTTPException(400, "That is not a font file.")
        with _lock:
            os.replace(tmp, dest)
            index = _read_index()
            index[dest.name] = family
            _write_index(index)
    finally:
        tmp.unlink(missing_ok=True)
    return _entry(dest, family)


@router.delete("/{name}")
def delete_font(name: str) -> dict:
    p = root() / check(name)
    with _lock:
        if not p.is_file() or p.is_symlink():
            raise HTTPException(404, "No font by that name.")
        p.unlink()
        index = _read_index()
        if index.pop(name, None) is not None:
            _write_index(index)
    return {"deleted": name}
