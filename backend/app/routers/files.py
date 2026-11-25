import hashlib
import os
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


def _source_file(path: str, request: Request) -> tuple[Path, os.stat_result]:
    """The limits both source routes share: window key, an absolute path to a regular `.svg` (not a link), at most 20 MB."""
    window_key.require(request)
    if not path.lower().endswith(".svg"):
        raise HTTPException(400, "Only SVG files can be checked.")
    target = Path(path)
    if not target.is_absolute():
        raise HTTPException(400, "The path must be absolute.")
    if target.is_symlink() or not target.is_file():
        raise HTTPException(404, "No file at that path.")
    info = target.stat()
    if info.st_size > MAX_SOURCE_BYTES:
        raise HTTPException(413, "The SVG is larger than 20 MB.")
    return target, info


@router.get("/stat")
def stat_source(path: str, request: Request) -> dict:
    """Size, change time and SHA-256 of a character's linked SVG, so the window can tell when the vector app saved it."""
    target, info = _source_file(path, request)
    digest = hashlib.sha256()
    with target.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return {"size": info.st_size, "mtime": info.st_mtime, "sha256": digest.hexdigest()}


@router.get("/source")
def read_source(path: str, request: Request) -> Response:
    """The text of a character's linked SVG, with the stat of exactly the bytes sent, for Update from Source."""
    target, info = _source_file(path, request)
    with target.open("rb") as fh:
        data = fh.read(MAX_SOURCE_BYTES + 1)
    if len(data) > MAX_SOURCE_BYTES:
        raise HTTPException(413, "The SVG is larger than 20 MB.")
    return Response(data, media_type="image/svg+xml", headers={
        "Cache-Control": "no-store",
        "Content-Security-Policy": "sandbox",
        "X-Source-Size": str(len(data)),
        "X-Source-Mtime": repr(info.st_mtime),
        "X-Source-Sha256": hashlib.sha256(data).hexdigest(),
    })
