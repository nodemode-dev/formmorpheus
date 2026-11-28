"""The relay to a speech server on this computer: a check of its address and one text spoken."""
import asyncio

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.services import speech_server

router = APIRouter()

MAX_URL_CHARS = 2048
MAX_NAME_CHARS = 512
MAX_INPUT_CHARS = 200_000
MAX_SPEED = 10


class CheckBody(BaseModel):
    url: str = Field(max_length=MAX_URL_CHARS)


class SpeakBody(BaseModel):
    url: str = Field(max_length=MAX_URL_CHARS)
    model: str = Field(default="", max_length=MAX_NAME_CHARS)
    voice: str = Field(default="", max_length=MAX_NAME_CHARS)
    input: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)
    speed: float = Field(default=1.0, gt=0, le=MAX_SPEED)


@router.post("/check")
async def check(body: CheckBody) -> dict:
    try:
        return await asyncio.to_thread(speech_server.check, body.url)
    except speech_server.Refused as error:
        raise HTTPException(400, str(error)) from error


@router.post("/speak")
async def speak(body: SpeakBody) -> Response:
    try:
        sound, kind = await asyncio.to_thread(speech_server.speak, body.url, body.model, body.voice, body.input, body.speed)
    except speech_server.Refused as error:
        raise HTTPException(400, str(error)) from error
    except speech_server.UpstreamTimeout as error:
        raise HTTPException(504, str(error)) from error
    except speech_server.Upstream as error:
        raise HTTPException(502, str(error)) from error
    return Response(sound, media_type=kind, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
