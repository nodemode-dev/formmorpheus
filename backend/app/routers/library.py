import json
import os
import re
import uuid
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


# Stacks (folders of the Theater): one flat level, a movie sits in at most one stack. Kept in a small
# hidden file beside the movies so renames and deletes can follow; the movies themselves never move.
_STACKS = ".stacks.json"
_SID = re.compile(r"^s[0-9a-f]{8}$")


def _stacks_path() -> Path:
    return config.library_dir() / _STACKS


def _load_stacks() -> list[dict]:
    try:
        data = json.loads(_stacks_path().read_text("utf-8"))
        out = []
        for s in data.get("stacks", []):
            if isinstance(s, dict) and _SID.match(str(s.get("id", ""))) and isinstance(s.get("items"), list):
                out.append({"id": s["id"], "name": str(s.get("name") or "Stack")[:80], "items": [str(i) for i in s["items"]]})
        return out
    except (OSError, ValueError, AttributeError):
        return []


def _save_stacks(stacks: list[dict]) -> None:
    path = _stacks_path()
    tmp = path.with_name(f".{path.name}.{os.getpid()}.part")
    tmp.write_text(json.dumps({"stacks": stacks}), "utf-8")
    os.replace(tmp, path)


class StackBody(BaseModel):
    name: str | None = None
    items: list[str] | None = None


def _known(names: list[str]) -> list[str]:
    seen: list[str] = []
    for n in names:
        n = clean_name(n)
        if n not in seen and project_path(n).is_file():
            seen.append(n)
    return seen


def _take_out(stacks: list[dict], names: list[str]) -> list[dict]:
    for s in stacks:
        s["items"] = [i for i in s["items"] if i not in names]
    return [s for s in stacks if s["items"]]


@router.get("/_stacks")
def list_stacks() -> dict:
    stacks = _load_stacks()
    have = {p.stem for p in config.library_dir().glob(f"*{config.PROJECT_EXT}")}
    for s in stacks:
        s["items"] = [i for i in s["items"] if i in have]
    return {"stacks": [s for s in stacks if s["items"]]}


@router.post("/_stacks")
def create_stack(body: StackBody) -> dict:
    names = _known(body.items or [])
    if len(names) < 1:
        raise HTTPException(400, "A stack needs at least one movie.")
    stacks = _take_out(_load_stacks(), names)
    stack = {"id": "s" + uuid.uuid4().hex[:8], "name": (body.name or "Stack").strip()[:80] or "Stack", "items": names}
    stacks.append(stack)
    _save_stacks(stacks)
    return stack


@router.post("/_stacks/{sid}")
def update_stack(sid: str, body: StackBody) -> dict:
    if not _SID.match(sid):
        raise HTTPException(400, "That stack id cannot be used.")
    stacks = _load_stacks()
    stack = next((s for s in stacks if s["id"] == sid), None)
    if stack is None:
        raise HTTPException(404, "No stack by that id.")
    if body.name is not None:
        stack["name"] = body.name.strip()[:80] or "Stack"
    if body.items is not None:
        names = _known(body.items)
        stacks = _take_out([s for s in stacks if s is not stack], names)
        stack["items"] = names
        stacks.append(stack)
        stacks = [s for s in stacks if s["items"]]
    _save_stacks(stacks)
    return {"ok": True}


@router.delete("/_stacks/{sid}")
def ungroup_stack(sid: str) -> dict:
    if not _SID.match(sid):
        raise HTTPException(400, "That stack id cannot be used.")
    _save_stacks([s for s in _load_stacks() if s["id"] != sid])
    return {"ok": True}


def _follow(old: str, new: str | None) -> None:
    stacks = _load_stacks()
    if not any(old in s["items"] for s in stacks):
        return
    for s in stacks:
        s["items"] = [new if i == old else i for i in s["items"] if not (i == old and new is None)]
    _save_stacks([s for s in stacks if s["items"]])


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
    return _picture(path, "poster.png")


def _picture(path: Path, member: str) -> Response:
    # No picture is an empty 204, not a 404, so the browser console stays quiet for movies saved without one.
    try:
        with zipfile.ZipFile(path) as archive:
            data = archive.read(member)
    except (KeyError, zipfile.BadZipFile, OSError):
        return Response(status_code=204)
    return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/{name}/preview")
def read_preview(name: str) -> Response:
    path = project_path(name)
    if not path.is_file():
        raise HTTPException(404, "No project by that name.")
    return _picture(path, "preview.png")


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
    if dst != src:
        _follow(src.stem, dst.stem)
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
    _follow(src.stem, None)
    return {"deleted": src.stem, "kept": str(dst)}
