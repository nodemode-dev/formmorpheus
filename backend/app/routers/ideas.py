"""Help Center > Send an idea: each idea is a small text file under the data folder (Ideas/), which the person can open,
copy or send to whoever they like. Nothing leaves the machine."""
import json
import re
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.core import config
from app.core.upload import read_limited

router = APIRouter()

MAX_BYTES = 24 * 1024
_NAME = re.compile(r"^idea-\d{8}-\d{6}(-\d{1,3})?\.txt$")
_lock = threading.Lock()


def ideas_dir() -> Path:
    path = config.data_dir() / "Ideas"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _item(path: Path) -> dict:
    st = path.stat()
    return {
        "name": path.name,
        "path": str(path),
        "modified": st.st_mtime,
        "size": st.st_size,
        "text": path.read_text(encoding="utf-8", errors="replace")[:MAX_BYTES],
    }


def _file(name: str) -> Path:
    if not _NAME.match(name):
        raise HTTPException(400, "That is not an idea file.")
    path = ideas_dir() / name
    if not path.is_file():
        raise HTTPException(404, "That idea is not here.")
    return path


@router.get("")
def list_ideas() -> dict:
    folder = ideas_dir()
    files = sorted((p for p in folder.iterdir() if p.is_file() and _NAME.match(p.name)), key=lambda p: p.stat().st_mtime, reverse=True)
    return {"folder": str(folder), "items": [_item(p) for p in files[:200]]}


@router.post("")
async def add_idea(request: Request) -> dict:
    raw = await read_limited(request, MAX_BYTES * 2, "That note is too long.")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "The note could not be read.")
    text = str(body.get("text", "")).strip() if isinstance(body, dict) else ""
    if not text:
        raise HTTPException(400, "Write something first.")
    kind = str(body.get("kind", "Idea")).strip()[:40] or "Idea"
    context = str(body.get("context", "")).strip()[:200]
    now = time.localtime()
    stamp = time.strftime("%Y%m%d-%H%M%S", now)
    head = f"{kind}\n{time.strftime('%Y-%m-%d %H:%M', now)} · {config.APP_NAME} {config.VERSION}"
    if context:
        head += f" · {context}"
    content = f"{head}\n\n{text[:MAX_BYTES]}\n"
    with _lock:
        folder = ideas_dir()
        path = folder / f"idea-{stamp}.txt"
        n = 1
        while path.exists():
            n += 1
            path = folder / f"idea-{stamp}-{n}.txt"
        path.write_text(content, encoding="utf-8", newline="\n")
    return _item(path)


@router.get("/{name}")
def read_idea(name: str) -> dict:
    return _item(_file(name))


@router.delete("/{name}")
def delete_idea(name: str) -> dict:
    with _lock:
        _file(name).unlink()
    return {"ok": True}
