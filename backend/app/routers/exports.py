import os
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.core import config
from app.routers import trash

router = APIRouter()

_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
KINDS = {
    ".mp4": "video", ".webm": "video", ".mov": "video", ".gif": "animation",
    ".png": "picture", ".jpg": "picture", ".jpeg": "picture", ".webp": "picture",
    ".zip": "frames", ".fmo": "movie",
}
MIMES = {
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".gif": "image/gif",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".zip": "application/zip",
}


def clean_name(name: str) -> str:
    safe = _BAD.sub("-", name).strip().strip(".")
    # file systems count bytes, not characters
    if not safe or len(safe.encode("utf-8")) > 200 or safe != name.strip() or safe.startswith("."):
        raise HTTPException(400, "That file name cannot be used.")
    return safe


def export_path(name: str) -> Path:
    return config.exports_dir() / clean_name(name)


def entry(path: Path) -> dict:
    st = path.stat()
    ext = path.suffix.lower()
    return {"name": path.name, "path": str(path), "size": st.st_size, "modified": st.st_mtime, "kind": KINDS.get(ext, ext.lstrip(".") or "file")}


@router.get("")
def list_exports() -> dict:
    folder = config.exports_dir()
    items = [entry(p) for p in folder.iterdir() if p.is_file() and not p.name.startswith(".")]
    items.sort(key=lambda e: e["modified"], reverse=True)
    return {"folder": str(folder), "items": items}


@router.get("/{name}")
def read_export(name: str) -> FileResponse:
    path = export_path(name)
    if not path.is_file():
        raise HTTPException(404, "No export by that name.")
    return FileResponse(path, media_type=MIMES.get(path.suffix.lower(), "application/octet-stream"), headers={"Cache-Control": "no-store"})


def free_path(path: Path) -> Path:
    """An export never replaces an earlier one: a taken name becomes "name 2", "name 3" and so on."""
    if not path.exists():
        return path
    n = 2
    while True:
        cand = path.with_name(f"{path.stem} {n}{path.suffix}")
        if not cand.exists():
            return cand
        n += 1


@router.put("/{name}")
async def write_export(name: str, request: Request) -> dict:
    path = free_path(export_path(name))
    # a unique part file per request, so two writes never share one
    tmp = path.with_name(f".{uuid.uuid4().hex}.part")
    size = 0
    try:
        with open(tmp, "wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > config.MAX_EXPORT_BYTES:
                    raise HTTPException(413, "The export is too large to keep.")
                out.write(chunk)
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
    return entry(path)


@router.delete("/{name}")
def delete_export(name: str) -> dict:
    src = export_path(name)
    if not src.is_file():
        raise HTTPException(404, "No export by that name.")
    dst = config.trash_dir() / f"{src.stem} {time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 1_000_000_000:09d}{src.suffix}"
    os.replace(src, dst)
    trash.record(dst, src.name, "export")
    return {"deleted": src.name, "kept": str(dst)}
