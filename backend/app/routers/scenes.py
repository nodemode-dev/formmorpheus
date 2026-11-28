"""The Scenes library routes (/api/scenes): the person's own scenery, kept by services/scenes.py."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.upload import read_limited
from app.routers.library import _picture
from app.services import scenes as store

router = APIRouter()


def _run(fn, *args):
    try:
        return fn(*args)
    except store.SceneError as e:
        raise HTTPException(e.status, e.message) from None


@router.get("")
def list_all() -> dict:
    return store.list_scenes()


@router.get("/{name}")
def read_scene(name: str) -> Response:
    path = _run(store.existing, name)
    return Response(path.read_bytes(), media_type="application/octet-stream")


@router.get("/{name}/poster")
def read_poster(name: str, v: str | None = None) -> Response:
    path = _run(store.existing, name)
    return _picture(path, "poster.png", v)


@router.put("/{name}")
async def write_scene(name: str, request: Request) -> dict:
    _run(store.clean_name, name)
    body = await read_limited(request, store.MAX_SCENE_BYTES, "The scene is too large to save.")
    return _run(store.write_scene, name, body)


class RenameBody(BaseModel):
    to: str


@router.post("/{name}/rename")
def rename_scene(name: str, body: RenameBody) -> dict:
    return _run(store.rename_scene, name, body.to)


@router.delete("/{name}")
def delete_scene(name: str) -> dict:
    return _run(store.delete_scene, name)
