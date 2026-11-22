"""Preferences, Video Tools: where ffmpeg was found, what it encodes, and the family build to download or remove."""
import asyncio

from fastapi import APIRouter, HTTPException

from app.services import ffmpeg as ff
from app.services import ffmpeg_fetch

router = APIRouter()


def _state(refresh: bool = False) -> dict:
    info = ff.probe(refresh=refresh)
    family = ffmpeg_fetch.describe()
    downloaded = ffmpeg_fetch.installed()
    hevc = info.hevc_candidates() if info else []
    return {
        "ffmpeg": {
            "found": info is not None,
            "path": info.path if info else "",
            "version": info.version if info else "",
            "source": "" if info is None else "download" if info.path == downloaded else "computer",
            "gpl": info.gpl if info else False,
            "encoders": info.encoders if info else [],
        },
        "formats": {
            "prores": bool(info and info.has("prores_ks")),
            "hevc": bool(hevc),
            "hevcAlpha": "hevc_videotoolbox" in hevc,
            "h264": bool(info and info.has("libx264")),
            "mp3": bool(info and info.has("libmp3lame")),
            "aac": bool(info and info.has("aac")),
            "opus": bool(info and info.has("libopus")),
        },
        "family": family,
        "task": ffmpeg_fetch.task(),
    }


@router.get("")
async def state(refresh: bool = False) -> dict:
    return await asyncio.to_thread(_state, refresh)


@router.post("/download")
async def download() -> dict:
    try:
        ffmpeg_fetch.start()
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    return await asyncio.to_thread(_state)


@router.post("/cancel")
async def cancel() -> dict:
    ffmpeg_fetch.cancel()
    return await asyncio.to_thread(_state)


@router.delete("/download")
async def remove() -> dict:
    try:
        await asyncio.to_thread(ffmpeg_fetch.remove)
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    return await asyncio.to_thread(_state)
