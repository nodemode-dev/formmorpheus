import json
import os
import re
import uuid
import shutil
import threading
import time
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.core import config
from app.core.fsmove import safe_move
from app.core.upload import read_limited
from app.routers import trash

router = APIRouter()

_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def clean_name(name: str) -> str:
    stem = name[: -len(config.PROJECT_EXT)] if name.lower().endswith(config.PROJECT_EXT) else name
    stem = _BAD.sub("-", stem).strip().strip(".")
    if not stem or len(stem) > 180:
        raise HTTPException(400, "That project name cannot be used.")
    return stem


# Stacks are real folders of the library: Library/<Stack>/<movie>.fmo, one level deep (a stack never holds a
# stack). A movie is still addressed by its name alone, and names are unique across the whole library, so every
# other route (open, save, poster, trash) finds a movie inside a stack without knowing about stacks.
_lock = threading.RLock()


def _stack_dirs() -> list[Path]:
    try:
        return sorted((d for d in config.library_dir().iterdir() if d.is_dir() and not d.name.startswith(".")), key=lambda d: d.name.lower())
    except OSError:
        return []


def find_movie(stem: str) -> Path | None:
    top = config.library_dir() / f"{stem}{config.PROJECT_EXT}"
    if top.is_file():
        return top
    for d in _stack_dirs():
        p = d / f"{stem}{config.PROJECT_EXT}"
        if p.is_file():
            return p
    return None


def project_path(name: str) -> Path:
    stem = clean_name(name)
    return find_movie(stem) or config.library_dir() / f"{stem}{config.PROJECT_EXT}"


def entry(path: Path) -> dict:
    st = path.stat()
    out = {"name": path.stem, "file": path.name, "path": str(path), "size": st.st_size, "modified": st.st_mtime}
    if path.parent != config.library_dir():
        out["stack"] = path.parent.name
    return out


def unique_path(stem: str, folder: Path | None = None) -> Path:
    folder = folder or config.library_dir()
    candidate = folder / f"{stem}{config.PROJECT_EXT}"
    n = 2
    while find_movie(candidate.stem):
        candidate = folder / f"{stem} {n}{config.PROJECT_EXT}"
        n += 1
    return candidate


@router.get("")
def list_projects() -> dict:
    _migrate()
    folder = config.library_dir()
    paths = [p for p in folder.glob(f"*{config.PROJECT_EXT}") if p.is_file()]
    for d in _stack_dirs():
        paths += [p for p in d.glob(f"*{config.PROJECT_EXT}") if p.is_file()]
    items = [entry(p) for p in paths]
    items.sort(key=lambda e: e["modified"], reverse=True)
    return {"folder": str(folder), "items": items}


_LEGACY = ".stacks.json"
_ORDER = ".order.json"


def _stack_name(raw: object) -> str:
    return _BAD.sub("-", str(raw or "")).strip().strip(".")[:80].strip().strip(".")


def _stack_dir(sid: str) -> Path:
    # The id is the folder name, taken only when it is already clean: no separators, no dots in front.
    name = _stack_name(sid)
    if not name or name != sid:
        raise HTTPException(400, "That stack name cannot be used.")
    d = config.library_dir() / name
    if not d.is_dir():
        raise HTTPException(404, "No stack by that name.")
    return d


def _free_stack_name(base: str, keep: Path | None = None) -> str:
    base = _stack_name(base) or "Stack"
    taken = {p.name.lower() for p in config.library_dir().iterdir() if p != keep}
    name, n = base, 2
    while name.lower() in taken:
        name = f"{base} {n}"
        n += 1
    return name


def _order_read(d: Path | None) -> list[str]:
    try:
        data = json.loads(((d or config.library_dir()) / _ORDER).read_text("utf-8"))
        return [k for k in data.get("order", []) if isinstance(k, str)]
    except (OSError, ValueError, AttributeError):
        return []


def _order_write(d: Path | None, keys: list[str]) -> None:
    clean: list[str] = []
    for k in keys:
        if isinstance(k, str) and 0 < len(k) <= 200 and k not in clean:
            clean.append(k)
    path = (d or config.library_dir()) / _ORDER
    if not clean:
        path.unlink(missing_ok=True)
        return
    tmp = path.with_name(f".{path.name}.{os.getpid()}.part")
    tmp.write_text(json.dumps({"order": clean[:5000]}), "utf-8")
    os.replace(tmp, path)


def _order_swap(d: Path | None, old: str, new: str | None) -> None:
    keys = _order_read(d)
    if old not in keys:
        return
    _order_write(d, [new if k == old and new else k for k in keys if not (k == old and not new)])


def _leave(d: Path) -> None:
    # A stack emptied of movies goes away; its hidden order file goes with it.
    if d == config.library_dir() or not d.is_dir() or any(d.glob(f"*{config.PROJECT_EXT}")):
        return
    (d / _ORDER).unlink(missing_ok=True)
    try:
        d.rmdir()
    except OSError:
        return
    _order_swap(None, f"stk:{d.name}", None)


def _move_movie(path: Path, dest: Path) -> Path:
    dst = dest / path.name
    if dst == path:
        return path
    if dst.exists():
        raise HTTPException(409, f"\"{path.stem}\" already exists in that folder, so it was not moved.")
    safe_move(path, dst)
    _order_swap(path.parent if path.parent != config.library_dir() else None, f"lib:{path.stem}", None)
    _leave(path.parent)
    return dst


def _migrate() -> None:
    """Old builds kept stacks as a list in .stacks.json; make each one a real folder, once."""
    legacy = config.library_dir() / _LEGACY
    if not legacy.is_file():
        return
    with _lock:
        if not legacy.is_file():
            return
        try:
            data = json.loads(legacy.read_text("utf-8"))
            stacks = data.get("stacks", [])
        except (OSError, ValueError, AttributeError):
            stacks = []
        for s in stacks if isinstance(stacks, list) else []:
            if not isinstance(s, dict) or not isinstance(s.get("items"), list):
                continue
            found = []
            for i in s["items"]:
                p = config.library_dir() / f"{_stack_name(i)}{config.PROJECT_EXT}"
                if isinstance(i, str) and p.is_file():
                    found.append(p)
            if not found:
                continue
            d = config.library_dir() / _free_stack_name(str(s.get("name") or "Stack"))
            d.mkdir()
            for p in found:
                _move_movie(p, d)
        os.replace(legacy, legacy.with_name(legacy.name + ".migrated"))


class StackBody(BaseModel):
    name: str | None = None
    items: list[str] | None = None


class OrderBody(BaseModel):
    stack: str | None = None
    order: list[str]


def _known(names: list[str]) -> list[Path]:
    seen: list[Path] = []
    for n in names:
        p = find_movie(clean_name(n))
        if p and p not in seen:
            seen.append(p)
    return seen


@router.get("/_stacks")
def list_stacks() -> dict:
    _migrate()
    stacks, order = [], {"": _order_read(None)}
    for d in _stack_dirs():
        items = sorted(p.stem for p in d.glob(f"*{config.PROJECT_EXT}") if p.is_file())
        if items:
            stacks.append({"id": d.name, "name": d.name, "items": items})
            order[d.name] = _order_read(d)
    return {"stacks": stacks, "order": order}


@router.post("/_stacks")
def create_stack(body: StackBody) -> dict:
    _migrate()
    with _lock:
        paths = _known(body.items or [])
        if len(paths) < 1:
            raise HTTPException(400, "A stack needs at least one movie.")
        d = config.library_dir() / _free_stack_name(body.name or "Stack")
        d.mkdir()
        try:
            for p in paths:
                _move_movie(p, d)
        finally:
            _leave(d)
    return {"id": d.name, "name": d.name, "items": sorted(p.stem for p in d.glob(f"*{config.PROJECT_EXT}"))}


@router.post("/_stacks/{sid}")
def update_stack(sid: str, body: StackBody) -> dict:
    with _lock:
        d = _stack_dir(sid)
        if body.items is not None:
            want = _known(body.items)
            keep = {p.stem for p in want}
            for p in want:
                _move_movie(p, d)
            for p in list(d.glob(f"*{config.PROJECT_EXT}")):
                if p.stem not in keep:
                    _move_movie(p, config.library_dir())
        if body.name is not None and _stack_name(body.name) and _stack_name(body.name) != d.name and d.is_dir():
            new = _stack_name(body.name)
            dst = config.library_dir() / new
            if dst.exists() and dst.name.lower() != d.name.lower():
                raise HTTPException(409, "A folder or stack with that name already exists.")
            os.rename(d, dst)
            _order_swap(None, f"stk:{d.name}", f"stk:{new}")
            d = dst
        elif body.items is not None and not d.is_dir():
            return {"ok": True, "id": None}
    return {"ok": True, "id": d.name}


@router.put("/_stacks")
def save_order(body: OrderBody) -> dict:
    with _lock:
        d = _stack_dir(body.stack) if body.stack else None
        _order_write(d, body.order)
    return {"ok": True}


@router.delete("/_stacks/{sid}")
def ungroup_stack(sid: str) -> dict:
    with _lock:
        d = _stack_dir(sid)
        for p in sorted(d.glob(f"*{config.PROJECT_EXT}")):
            _move_movie(p, config.library_dir())
        (d / _ORDER).unlink(missing_ok=True)
        try:
            d.rmdir()
        except OSError:
            pass   # other files the person put there stay
        _order_swap(None, f"stk:{sid}", None)
    return {"ok": True}


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
    body = await read_limited(request, config.MAX_PROJECT_BYTES, "The project is too large to save.")
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
    stem = clean_name(body.to)
    dst = src.parent / f"{stem}{config.PROJECT_EXT}"
    other = find_movie(stem)
    if other is not None and not (other.exists() and src.exists() and other.samefile(src)):
        raise HTTPException(409, "A project with that name already exists.")
    with _lock:
        os.replace(src, dst)
        if dst != src:
            _order_swap(None if src.parent == config.library_dir() else src.parent, f"lib:{src.stem}", f"lib:{dst.stem}")
    return entry(dst)


@router.post("/{name}/duplicate")
def duplicate_project(name: str) -> dict:
    src = project_path(name)
    if not src.is_file():
        raise HTTPException(404, "No project by that name.")
    dst = unique_path(f"{src.stem} copy", src.parent)
    if not _copy_with_new_id(src, dst):
        shutil.copy2(src, dst)
    os.utime(dst, None)
    return entry(dst)


class CopyToBody(BaseModel):
    dir: str


@router.post("/{name}/copy-to")
def copy_project_to(name: str, body: CopyToBody) -> dict:
    """Copies the movie file into a folder of the person's choice (a second storage). Never overwrites: a name taken there gets a number."""
    from app.routers.system import _safe_folder
    src = project_path(name)
    if not src.is_file():
        raise HTTPException(404, "No project by that name.")
    folder = _safe_folder(body.dir)
    if folder == src.parent.resolve():
        raise HTTPException(400, "That is the folder the movie is already in.")
    dst = folder / src.name
    n = 2
    while dst.exists():
        dst = folder / f"{src.stem} {n}{src.suffix}"
        n += 1
    tmp = dst.with_name(f".{dst.name}.{os.getpid()}.part")
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, "formmorpheus could not copy the movie there.")
    return {"path": str(dst), "name": dst.stem}


def _copy_with_new_id(src: Path, dst: Path) -> bool:
    """A duplicate is a different movie: a fresh id (and its own name) in movie.json, every other entry copied as is."""
    tmp = dst.with_name(f".{dst.name}.{os.getpid()}.part")
    try:
        with zipfile.ZipFile(src) as zin:
            data = json.loads(zin.read("movie.json"))
            if not isinstance(data, dict) or not isinstance(data.get("id"), str):
                return False
            data["id"] = f"m{uuid.uuid4().hex[:16]}"
            if isinstance(data.get("name"), str):
                data["name"] = dst.stem
            with zipfile.ZipFile(tmp, "w") as zout:
                for info in zin.infolist():
                    body = json.dumps(data).encode("utf-8") if info.filename == "movie.json" else zin.read(info)
                    zout.writestr(info, body)
        os.replace(tmp, dst)
        return True
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        tmp.unlink(missing_ok=True)
        return False


@router.delete("/{name}")
def delete_project(name: str) -> dict:
    src = project_path(name)
    if not src.is_file():
        raise HTTPException(404, "No project by that name.")
    dst = config.trash_dir() / f"{src.stem} {time.strftime('%Y%m%d-%H%M%S')}{config.PROJECT_EXT}"
    with _lock:
        safe_move(src, dst)
        trash.record(dst, src.name, "movie")
        _order_swap(None if src.parent == config.library_dir() else src.parent, f"lib:{src.stem}", None)
        _leave(src.parent)
    return {"deleted": src.stem, "kept": str(dst)}
