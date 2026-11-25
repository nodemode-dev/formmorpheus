import hashlib
import os
import stat
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

from app.core import config, window_key

router = APIRouter()


_LOOPBACK = {"127.0.0.1", "localhost", "[::1]"}


@router.get("/read")
def read_file(path: str, request: Request) -> FileResponse:
    """Streams a movie file from an absolute path the operating system handed the app (a double-click, Open With)."""
    # A page on another site that rebinds its DNS to 127.0.0.1 still sends its own Host, so refuse non-loopback hosts.
    raw = request.headers.get("host") or ""
    host = raw.split("]")[0] + "]" if raw.startswith("[") else raw.rsplit(":", 1)[0]
    if host not in _LOOPBACK:
        raise HTTPException(403, "Files can only be opened by the app itself.")
    if not path.lower().endswith(config.PROJECT_EXT):
        raise HTTPException(400, "Only FormMorpheus movie files can be opened by path.")
    target = Path(path)
    if not target.is_absolute():
        raise HTTPException(400, "The path must be absolute.")
    if not target.is_file():
        raise HTTPException(404, "No file at that path.")
    if target.stat().st_size > config.MAX_PROJECT_BYTES:
        raise HTTPException(413, "The movie is too large to open.")
    return FileResponse(target, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})


MAX_SOURCE_BYTES = 20 * 1024 * 1024
_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_OPEN_FLAGS = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_BINARY", 0)
_NO_FILE = "No file at that path."
_TOO_BIG = "The SVG is larger than 20 MB."


def _source_path(path: str) -> str:
    s = path.replace("\\", "/")
    if s.startswith("//"):
        raise HTTPException(400, "A network share path cannot be used here.")   # UNC paths and device paths
    if ":" in s[2:]:
        raise HTTPException(400, "That path cannot be used here.")   # alternate data streams
    if not s.lower().endswith(".svg"):
        raise HTTPException(400, "Only SVG files can be checked.")
    if not Path(path).is_absolute():
        raise HTTPException(400, "The path must be absolute.")
    if ".." in s.split("/"):
        raise HTTPException(400, "That path cannot be used here.")
    return path


def _read_source(path: str, request: Request) -> tuple[bytes, float]:
    """Both source routes: at most 20 MB + 1 byte of one regular `.svg` (not a link), read from the one descriptor that was checked."""
    window_key.require(request)
    target = _source_path(path)
    before = None
    if not _NOFOLLOW:
        try:
            before = os.lstat(target)
        except OSError:
            raise HTTPException(404, _NO_FILE)
        if stat.S_ISLNK(before.st_mode):
            raise HTTPException(404, _NO_FILE)
    try:
        fd = os.open(target, _OPEN_FLAGS | _NOFOLLOW)
    except OSError:
        raise HTTPException(404, _NO_FILE)   # a link where O_NOFOLLOW exists fails here too
    try:
        info = os.fstat(fd)
        if before is not None and (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino):
            raise HTTPException(404, _NO_FILE)
        if not stat.S_ISREG(info.st_mode):
            raise HTTPException(404, _NO_FILE)
        if info.st_size > MAX_SOURCE_BYTES:
            raise HTTPException(413, _TOO_BIG)
        chunks, left = [], MAX_SOURCE_BYTES + 1
        while left > 0:
            block = os.read(fd, min(left, 1 << 20))
            if not block:
                break
            chunks.append(block)
            left -= len(block)
    finally:
        os.close(fd)
    data = b"".join(chunks)
    if len(data) > MAX_SOURCE_BYTES:
        raise HTTPException(413, _TOO_BIG)
    return data, info.st_mtime


@router.get("/stat")
def stat_source(path: str, request: Request) -> dict:
    """Size, change time and SHA-256 of a character's linked SVG, so the window can tell when the vector app saved it."""
    data, mtime = _read_source(path, request)
    return {"size": len(data), "mtime": mtime, "sha256": hashlib.sha256(data).hexdigest()}


@router.get("/source")
def read_source(path: str, request: Request) -> Response:
    """The text of a character's linked SVG, with the stat of exactly the bytes sent, for Update from Source."""
    data, mtime = _read_source(path, request)
    return Response(data, media_type="image/svg+xml", headers={
        "Cache-Control": "no-store",
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "X-Source-Size": str(len(data)),
        "X-Source-Mtime": repr(mtime),
        "X-Source-Sha256": hashlib.sha256(data).hexdigest(),
    })
