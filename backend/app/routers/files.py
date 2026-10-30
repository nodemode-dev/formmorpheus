from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.core import config

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
        raise HTTPException(400, "Only formmorpheus movie files can be opened by path.")
    target = Path(path)
    if not target.is_absolute():
        raise HTTPException(400, "The path must be absolute.")
    if not target.is_file():
        raise HTTPException(404, "No file at that path.")
    if target.stat().st_size > config.MAX_PROJECT_BYTES:
        raise HTTPException(413, "The movie is too large to open.")
    return FileResponse(target, media_type="application/octet-stream", headers={"Cache-Control": "no-store"})
