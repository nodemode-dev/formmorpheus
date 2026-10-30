import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app.core import config

router = APIRouter()

# The person's brush library (sets, edits, imported brushes with their tip pixels) is one JSON file in the data folder.
LIMIT = 96 * 1024 * 1024


def _path():
    return config.data_dir() / "brushes.json"


@router.get("")
def read_library() -> Response:
    path = _path()
    if not path.is_file():
        return Response("{}", media_type="application/json")
    return Response(path.read_bytes(), media_type="application/json")


@router.put("")
async def write_library(request: Request) -> dict:
    body = await request.body()
    if len(body) > LIMIT:
        raise HTTPException(413, "The brush library is too large.")
    try:
        json.loads(body)
    except ValueError:
        raise HTTPException(400, "The brush library is not valid JSON.")
    path = _path()
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(body)
    tmp.replace(path)
    return {"ok": True, "bytes": len(body)}
