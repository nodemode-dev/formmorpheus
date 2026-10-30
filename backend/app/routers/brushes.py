"""The person's brush libraries as files they can browse: Brushes/<Library>/<Set>/<Brush>.brush in the data folder.

A .brush is the same zip the app exports (so other apps open it) plus a small `formmorpheus/` folder inside it that
keeps what the format has no room for. Order lives in small `.order.json` files (libraries at the top, sets in a
library, brush ids in a set), like the Theater's. Starter brushes are built in and have no file unless edited.
The old single `brushes.json` is migrated by the app once and then renamed `brushes.json.migrated`.
"""
import io
import json
import os
import re
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.core import config
from app.core.fsmove import safe_move
from app.core.upload import read_limited

router = APIRouter()

EXT = ".brush"
ORDER = ".order.json"
SIDECAR = "formmorpheus/brush.json"
FILE_LIMIT = 64 * 1024 * 1024
META_LIMIT = 256 * 1024
_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
# Names Windows reserves for devices, on the part before the first dot, in any case.
_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", re.IGNORECASE)
PATH_LIMIT = 240   # a full path stays under Windows' 260 with room for the temp-file prefix
_lock = threading.RLock()


def root() -> Path:
    p = config.data_dir() / "Brushes"
    p.mkdir(parents=True, exist_ok=True)
    return p


def legacy_path() -> Path:
    return config.data_dir() / "brushes.json"


def check(raw: object, what: str = "name") -> str:
    """One path segment: no separators, no dot in front or behind, no padding, no device name. What is checked is what is used."""
    if (
        not isinstance(raw, str) or not raw or len(raw) > 120 or raw != raw.strip() or _BAD.search(raw)
        or raw.startswith(".") or raw.endswith(".") or _RESERVED.match(raw.split(".", 1)[0].rstrip())
    ):
        raise HTTPException(400, f"That {what} cannot be used.")
    return raw


def _link(p: Path) -> bool:
    """A symlink or a Windows junction: never followed."""
    return p.is_symlink() or bool(getattr(os.path, "isjunction", lambda _p: False)(p))


def _plain_dir(p: Path) -> bool:
    return p.is_dir() and not _link(p)


def _plain_file(p: Path) -> bool:
    return p.is_file() and not _link(p)


def _fit(p: Path) -> Path:
    if len(str(p)) > PATH_LIMIT:
        raise HTTPException(400, "That name makes the path too long.")
    return p


def lib_dir(lib: str, must: bool = True) -> Path:
    p = _fit(root() / check(lib, "library name"))
    if must and not _plain_dir(p):
        raise HTTPException(404, "No library by that name.")
    return p


def set_dir(lib: str, name: str, must: bool = True) -> Path:
    p = _fit(lib_dir(lib) / check(name, "set name"))
    if must and not _plain_dir(p):
        raise HTTPException(404, "No set by that name.")
    return p


def file_path(lib: str, name: str, file: str, must: bool = True) -> Path:
    if not isinstance(file, str) or not file.endswith(EXT):
        raise HTTPException(400, "That brush file name cannot be used.")
    check(file[: -len(EXT)], "brush name")
    p = _fit(set_dir(lib, name) / file)
    if must and not _plain_file(p):
        raise HTTPException(404, "No brush by that name.")
    return p


def _case_twin(p: Path, ignore: Path | None = None) -> bool:
    """Another entry beside `p` whose name differs from it only by case (a folder that is case-sensitive can hold both, a synced one cannot)."""
    key = p.name.casefold()
    try:
        for x in p.parent.iterdir():
            if x.name != p.name and x.name.casefold() == key and x != ignore:
                return True
    except OSError:
        pass
    return False


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{uuid.uuid4().hex}.part")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _read_order(d: Path) -> dict:
    try:
        data = json.loads((d / ORDER).read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _meta(path: Path):
    """The sidecar of a .brush, or None for a file made elsewhere."""
    try:
        with zipfile.ZipFile(path) as z:
            with z.open(SIDECAR) as f:
                raw = f.read(META_LIMIT + 1)   # the header's size is not trusted: read at most the cap
        return None if len(raw) > META_LIMIT else json.loads(raw)
    except (OSError, KeyError, ValueError, zipfile.BadZipFile, RuntimeError, NotImplementedError, zipfile.LargeZipFile):
        return None


_metas: dict[str, tuple[int, int, object]] = {}


def _meta_cached(path: Path, st: os.stat_result):
    """The sidecar again only when the file changed (size and mtime), so a tree does not reopen every zip."""
    key = str(path)
    hit = _metas.get(key)
    if hit and hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        return hit[2]
    meta = _meta(path)
    _metas[key] = (st.st_mtime_ns, st.st_size, meta)
    return meta


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "set"


def _dirs(d: Path) -> list[Path]:
    try:
        return sorted((x for x in d.iterdir() if _plain_dir(x) and not x.name.startswith(".")), key=lambda x: x.name.lower())
    except OSError:
        return []


def _ordered(found: list[Path], entries: object) -> list[tuple[Path, str | None]]:
    """Folders in the order file's order (with the id it gave), then folders it did not know."""
    by = {p.name: p for p in found}
    out: list[tuple[Path, str | None]] = []
    for e in entries if isinstance(entries, list) else []:
        if isinstance(e, dict) and isinstance(e.get("dir"), str) and e["dir"] in by:
            out.append((by.pop(e["dir"]), e.get("id") if isinstance(e.get("id"), str) else None))
    out += [(p, None) for p in by.values()]
    return out


@router.get("/tree")
def tree() -> dict:
    """Every library, set and brush file; `fresh` means no order file yet (nothing was ever saved as files)."""
    pending: list[tuple[dict, Path, os.stat_result]] = []   # sidecars are read after the lock is let go
    with _lock:
        top = root()
        order = _read_order(top)
        fresh = not (top / ORDER).is_file()
        used_sets: set[str] = set()
        libs = []
        for ld, lid in _ordered(_dirs(top), order.get("libs")):
            lid = lid or _slug(ld.name)
            lorder = _read_order(ld)
            sets = []
            for sd, sid in _ordered(_dirs(ld), lorder.get("sets")):
                if not sid:
                    base = ("anim-" if lid == "animation" else "") + _slug(sd.name)
                    sid, n = base, 2
                    while sid in used_sets:
                        sid, n = f"{base}-{n}", n + 1
                used_sets.add(sid)
                files = []
                for f in sorted(sd.glob(f"*{EXT}"), key=lambda x: x.name.lower()):
                    try:
                        if not _plain_file(f):
                            continue
                        entry = {"file": f.name, "meta": None}
                        pending.append((entry, f, f.stat()))
                    except OSError:
                        continue
                    files.append(entry)
                ids = [i for i in _read_order(sd).get("ids", []) if isinstance(i, str)]
                sets.append({"id": sid, "dir": sd.name, "ids": ids, "files": files})
            libs.append({"id": lid, "dir": ld.name, "sets": sets})
        out = {
            "folder": str(top),
            "fresh": fresh,
            "legacy": legacy_path().is_file(),
            "active": order.get("active") if isinstance(order.get("active"), str) else None,
            "deleted": [i for i in order.get("deleted", []) if isinstance(i, str)],
            "libs": libs,
        }
    for entry, f, st in pending:
        entry["meta"] = _meta_cached(f, st)
    live = {str(f) for _, f, _ in pending}
    for k in [k for k in list(_metas) if k not in live]:
        _metas.pop(k, None)
    return out


@router.get("/legacy")
def legacy() -> Response:
    p = legacy_path()
    if not p.is_file():
        return Response("{}", media_type="application/json")
    return Response(p.read_bytes(), media_type="application/json")


@router.get("/file")
def read_file(lib: str, set: str, file: str) -> Response:
    return Response(file_path(lib, set, file).read_bytes(), media_type="application/zip")


@router.put("/file")
async def write_file(request: Request, lib: str, set: str, file: str, replace: bool = False) -> dict:
    body = await read_limited(request, FILE_LIMIT, "That brush file is too large.")
    if not zipfile.is_zipfile(io.BytesIO(body)):
        raise HTTPException(400, "A brush file is a zip.")
    with _lock:
        path = file_path(lib, set, file, must=False)
        if (path.exists() and not replace) or _case_twin(path):
            raise HTTPException(409, "A brush with that name is already there.")
        _write_atomic(path, body)
    return {"ok": True, "bytes": len(body)}


class MakeBody(BaseModel):
    lib: str
    set: str | None = None


@router.post("/dir")
def make_dir(body: MakeBody) -> dict:
    with _lock:
        if body.set is None:
            p = lib_dir(body.lib, must=False)
        else:
            lib_dir(body.lib)
            p = set_dir(body.lib, body.set, must=False)
        if _link(p) or (p.exists() and not p.is_dir()) or _case_twin(p):
            raise HTTPException(409, "Something with that name is already there.")
        p.mkdir(exist_ok=True)
    return {"ok": True}


class MoveBody(BaseModel):
    kind: Literal["lib", "set", "brush"]
    lib: str
    set: str | None = None
    file: str | None = None
    toLib: str | None = None
    toSet: str | None = None
    to: str | None = None


def _move(b: MoveBody) -> dict:
    with _lock:
        if b.kind == "lib":
            src = lib_dir(b.lib)
            dst = lib_dir(b.to or b.lib, must=False)
        elif b.kind == "set":
            src = set_dir(b.lib, b.set or "")
            dst = set_dir(b.toLib or b.lib, b.to or b.set or "", must=False)
        else:
            src = file_path(b.lib, b.set or "", b.file or "")
            name = b.to or b.file or ""
            dst = file_path(b.toLib or b.lib, b.toSet or b.set or "", name, must=False)
        if dst.exists() and not (dst.samefile(src) and dst != src):
            if dst == src:
                return {"ok": True, "unchanged": True}
            raise HTTPException(409, "Something with that name is already there.")
        if _case_twin(dst, ignore=src):
            raise HTTPException(409, "Something that differs only by case is already there.")
        if b.kind == "brush":
            safe_move(src, dst)
        else:
            os.rename(src, dst)
    return {"ok": True}


@router.post("/move")
def move(body: MoveBody) -> dict:
    return _move(body)


@router.post("/rename")
def rename(body: MoveBody) -> dict:
    if not body.to:
        raise HTTPException(400, "Give the new name.")
    body.toLib = body.toSet = None
    return _move(body)


@router.delete("/item")
def delete_item(kind: Literal["lib", "set", "brush"], lib: str, set: str | None = None, file: str | None = None) -> dict:
    with _lock:
        if kind == "lib":
            left = _sweep_lib(lib_dir(lib))
        elif kind == "set":
            left = _sweep_set(set_dir(lib, set or ""))
        else:
            file_path(lib, set or "", file or "").unlink()
            left = False
    return {"ok": True, "kept": left}


def _sweep_set(d: Path, parts: bool = True) -> bool:
    """Removes the brush files and the order file the app manages, then the folder if nothing else is in it. True when something stays."""
    try:
        for x in d.iterdir():
            if _plain_file(x) and (x.name == ORDER or x.name.endswith(EXT) or (parts and x.name.startswith(".") and x.name.endswith(".part"))):
                x.unlink(missing_ok=True)
        d.rmdir()
        return False
    except OSError:
        return True


def _sweep_lib(d: Path) -> bool:
    kept = False
    try:
        for x in d.iterdir():
            if _plain_dir(x) and not x.name.startswith("."):
                kept = _sweep_set(x) or kept
        (d / ORDER).unlink(missing_ok=True)
        d.rmdir()
        return False
    except OSError:
        return True


class Entry(BaseModel):
    id: str
    dir: str


class OrderBody(BaseModel):
    level: Literal["root", "lib", "set"]
    lib: str | None = None
    set: str | None = None
    items: list[Entry] | None = None
    ids: list[str] | None = None
    active: str | None = None
    deleted: list[str] | None = None


def _ids(raw: list[str] | None) -> list[str]:
    out: list[str] = []
    for i in raw or []:
        if 0 < len(i) <= 200 and i not in out:
            out.append(i)
    return out


@router.put("/order")
def write_order(body: OrderBody) -> dict:
    with _lock:
        if body.level == "root":
            d = root()
            data = {"libs": [{"id": e.id, "dir": check(e.dir)} for e in body.items or []], "active": body.active or "", "deleted": _ids(body.deleted)}
        elif body.level == "lib":
            d = lib_dir(body.lib or "")
            data = {"sets": [{"id": e.id, "dir": check(e.dir)} for e in body.items or []]}
        else:
            d = set_dir(body.lib or "", body.set or "")
            data = {"ids": _ids(body.ids)}
        _write_atomic(d / ORDER, json.dumps(data).encode("utf-8"))
    return {"ok": True}


@router.post("/clear")
def clear() -> dict:
    """Empties the Brushes folder before a migration is retried; refused once a library has been saved as files."""
    with _lock:
        top = root()
        if (top / ORDER).is_file():
            raise HTTPException(409, "The brush folder already holds a saved library.")
        # Only what a migration writes: libraries and sets of .brush files and order files. Anything else stays.
        for x in top.iterdir():
            if _plain_dir(x) and not x.name.startswith("."):
                _sweep_lib(x)
    return {"ok": True}


@router.post("/migrated")
def migrated() -> dict:
    """Keeps the old single-file store beside the new folder under a new name, never over an older copy."""
    with _lock:
        if not (root() / ORDER).is_file():
            raise HTTPException(409, "The brush folder has not been written yet.")
        src = legacy_path()
        if not src.is_file():
            return {"ok": True, "renamed": False}
        dst = src.with_name("brushes.json.migrated")
        n = 2
        while dst.exists():
            dst = src.with_name(f"brushes.json.migrated{n}")
            n += 1
        os.replace(src, dst)
    return {"ok": True, "renamed": True}
