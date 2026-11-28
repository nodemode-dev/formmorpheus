"""The speech model sets: what is installed, download, cancel, remove, and the installed files for the window."""
import asyncio
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, Response
from fastapi.responses import FileResponse

from app.services import speech_models

router = APIRouter()

SetName = Annotated[str, Path(alias="set")]
CACHE = "private, no-cache"   # the window may keep a file but asks each time, so a removed or re-pinned file is never served stale


def _state() -> dict:
    return {"sets": speech_models.describe()}


def _known(name: str) -> str:
    if not speech_models.known(name):
        raise HTTPException(404, "There is no speech model set of that name.")
    return name


@router.get("")
async def state() -> dict:
    return await asyncio.to_thread(_state)


@router.post("/{set}/download")
async def download(name: SetName) -> dict:
    try:
        speech_models.start(_known(name))
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    return await asyncio.to_thread(_state)


@router.post("/{set}/cancel")
async def cancel(name: SetName) -> dict:
    speech_models.cancel(_known(name))
    return await asyncio.to_thread(_state)


@router.delete("/{set}")
async def remove(name: SetName) -> dict:
    try:
        await asyncio.to_thread(speech_models.remove, _known(name))
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    return await asyncio.to_thread(_state)


@router.get("/{set}/file/{path:path}")
async def file(name: SetName, path: str, request: Request) -> Response:
    found = await asyncio.to_thread(speech_models.served_file, name, path)
    if found is None:
        raise HTTPException(404, "That speech model file is not installed.")
    where, pin = found
    tag = f'"{pin.sha256}"'
    headers = {"Cache-Control": CACHE, "ETag": tag, "X-Content-Type-Options": "nosniff"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    kind = "application/json" if pin.path.endswith(".json") else "application/octet-stream"
    return FileResponse(where, media_type=kind, headers=headers)
