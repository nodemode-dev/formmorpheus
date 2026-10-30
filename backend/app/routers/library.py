import os
import re
import shutil
import time
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.core import config
from app.routers import trash

router = APIRouter()

_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def clean_name(name: str) -> str:
    stem = name[: -len(config.PROJECT_EXT)] if name.lower().endswith(config.PROJECT_EXT) else name
    stem = _BAD.sub("-", stem).strip().strip(".")
    if not stem or len(stem) > 180:
        raise HTTPException(400, "That project name cannot be used.")
    return stem


def project_path(name: str) -> Path:
    return config.library_dir() / f"{clean_name(name)}{config.PROJECT_EXT}"


def entry(path: Path) -> dict:
    st = path.stat()
    return {"name": path.stem, "file": path.name, "path": str(path), "size": st.st_size, "modified": st.st_mtime}


def unique_path(stem: str) -> Path:
    folder = config.library_dir()
    candidate = folder / f"{stem}{config.PROJECT_EXT}"
    n = 2
    while candidate.exists():
        candidate = folder / f"{stem} {n}{config.PROJECT_EXT}"
        n += 1
    return candidate


@router.get("")
def list_projects() -> dict:
    folder = config.library_dir()
    items = [entry(p) for p in folder.glob(f"*{config.PROJECT_EXT}") if p.is_file()]
    items.sort(key=lambda e: e["modified"], reverse=True)
    return {"folder": str(folder), "items": items}


@router.get("/{name}")
def read_project(name: str) -> Response:
    path = project_path(name)
    if not path.is_file():
        raise HTTPException(404, "No project by that name.")
    return Response(path.read_bytes(), media_type="application/octet-stream")


@router.get("/{name}/poster")
def read_poster(name: str) -> Response:
    path = project_path(name)
    if not path.is_file():
        raise HTTPException(404, "No project by that name.")
    try:
        with zipfile.ZipFile(path) as archive:
            data = archive.read("poster.png")
    except (KeyError, zipfile.BadZipFile, OSError):
        raise HTTPException(404, "This project has no poster.")
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.put("/{name}")
async def write_project(name: str, request: Request) -> dict:
    path = project_path(name)
    body = await request.body()
    if len(body) > config.MAX_PROJECT_BYTES:
        raise HTTPException(413, "The project is too large to save.")
    if body[:4] != b"PK\x03\x04":
        raise HTTPException(400, "That is not a formmorpheus project.")
    tmp = path.with_name(f".{path.name}.{os.getpid()}.part")
    tmp.write_bytes(body)
    os.replace(tmp, path)
    return entry(path)


class RenameBody(BaseModel):
    to: str


@router.post("/{name}/rename")
def rename_project(name: str, body: RenameBody) -> dict:
    src = project_path(name)
    if not src.is_file():
        raise HTTPException(404, "No project by that name.")
    dst = project_path(body.to)
    if dst.exists() and dst != src:
        raise HTTPException(409, "A project with that name already exists.")
    os.replace(src, dst)
    return entry(dst)


@router.post("/{name}/duplicate")
def duplicate_project(name: str) -> dict:
    src = project_path(name)
    if not src.is_file():
        raise HTTPException(404, "No project by that name.")
    dst = unique_path(f"{src.stem} copy")
    shutil.copy2(src, dst)
    os.utime(dst, None)
    return entry(dst)


@router.delete("/{name}")
def delete_project(name: str) -> dict:
    src = project_path(name)
    if not src.is_file():
        raise HTTPException(404, "No project by that name.")
    dst = config.trash_dir() / f"{src.stem} {time.strftime('%Y%m%d-%H%M%S')}{config.PROJECT_EXT}"
    os.replace(src, dst)
    trash.record(dst, src.name, "movie")
    return {"deleted": src.stem, "kept": str(dst)}
