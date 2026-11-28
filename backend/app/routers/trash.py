import asyncio
import json
import os
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core import config
from app.core.fsmove import safe_move

router = APIRouter()

KEEP_DAYS = 30
INDEX_NAME = "index.json"
_lock = threading.RLock()


def _index_path() -> Path:
    return config.trash_dir() / INDEX_NAME


def _read_index() -> dict:
    try:
        data = json.loads(_index_path().read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_index(data: dict) -> None:
    path = _index_path()
    tmp = path.with_name(f".{path.name}.{os.getpid()}.part")
    tmp.write_text(json.dumps(data, indent=1), "utf-8")
    os.replace(tmp, path)


def record(trashed: Path, original: str, kind: str) -> None:
    """Called by the routers that move a file here; keeps its original name and deletion time."""
    with _lock:
        data = _read_index()
        data[trashed.name] = {"original": original, "kind": kind, "deleted": time.time()}
        _write_index(data)


def _safe_file(item_id: str) -> Path:
    if not item_id or item_id != Path(item_id).name or item_id.startswith(".") or item_id == INDEX_NAME or "\x00" in item_id:
        raise HTTPException(400, "That is not a deleted item.")
    path = config.trash_dir() / item_id
    if not path.is_file():
        raise HTTPException(404, "That item is no longer in Recently Deleted.")
    return path


def _meta(path: Path, data: dict) -> dict:
    rec = data.get(path.name)
    st = path.stat()
    if rec:
        original, kind, deleted = rec["original"], rec["kind"], float(rec["deleted"])
    else:
        # a file moved in before the index existed
        original = path.name
        kind = "movie" if path.suffix.lower() == config.PROJECT_EXT else "export"
        deleted = st.st_mtime
    return {
        "id": path.name,
        "name": original[: -len(config.PROJECT_EXT)] if kind in ("movie", "character", "scene") and original.lower().endswith(config.PROJECT_EXT) else original,
        "original": original,
        "kind": kind,
        "deleted": deleted,
        "size": st.st_size,
        "daysLeft": max(0, int(KEEP_DAYS - (time.time() - deleted) // 86400)),
    }


def _files() -> list[Path]:
    return [p for p in config.trash_dir().iterdir() if p.is_file() and not p.name.startswith(".") and p.name != INDEX_NAME]


def _drop(path: Path, data: dict) -> None:
    path.unlink(missing_ok=True)
    data.pop(path.name, None)


def sweep(now: float | None = None) -> int:
    """Delete items trashed more than KEEP_DAYS ago; returns how many went."""
    cutoff = (now or time.time()) - KEEP_DAYS * 86400
    gone = 0
    with _lock:
        data = _read_index()
        stamped = False
        for p in _files():
            if p.name not in data:
                # No record (trashed before the index, or record() failed): the 30 days start now,
                # since a moved file keeps its old modified time.
                m = _meta(p, data)
                data[p.name] = {"original": m["original"], "kind": m["kind"], "deleted": now or time.time()}
                stamped = True
                continue
            if _meta(p, data)["deleted"] < cutoff:
                _drop(p, data)
                gone += 1
        live = {p.name for p in _files()}
        pruned = {k: v for k, v in data.items() if k in live}
        if gone or stamped or len(pruned) != len(data):
            _write_index(pruned)
    return gone


async def sweep_daily() -> None:
    while True:
        try:
            await asyncio.to_thread(sweep)
        except Exception:
            pass
        await asyncio.sleep(86400)


def _free(folder: Path, stem: str, ext: str) -> Path:
    cand = folder / f"{stem}{ext}"
    n = 2
    while cand.exists():
        cand = folder / f"{stem} {n}{ext}"
        n += 1
    return cand


@router.get("")
def list_trash() -> dict:
    with _lock:
        data = _read_index()
        items = [_meta(p, data) for p in _files()]
    items.sort(key=lambda e: e["deleted"], reverse=True)
    return {"folder": str(config.trash_dir()), "keepDays": KEEP_DAYS, "items": items}


@router.post("/{item_id}/restore")
def restore(item_id: str) -> dict:
    with _lock:
        path = _safe_file(item_id)
        data = _read_index()
        meta = _meta(path, data)
        original = Path(meta["original"])
        if meta["kind"] == "movie":
            folder = config.library_dir()
            from app.routers.library import find_movie   # lazy: library imports this module
            stem = original.stem if original.suffix.lower() == config.PROJECT_EXT else original.name
            # names are unique across the whole library, stack folders included
            n, name = 2, stem
            while find_movie(name):
                name = f"{stem} {n}"
                n += 1
            dst = folder / f"{name}{config.PROJECT_EXT}"
        elif meta["kind"] == "character":
            dst = _free(config.characters_dir(), original.stem, config.PROJECT_EXT)
        elif meta["kind"] == "scene":
            from app.services.scenes import scenes_dir
            dst = _free(scenes_dir(), original.stem, config.PROJECT_EXT)
        else:
            folder = config.exports_dir()
            dst = _free(folder, original.stem, original.suffix)
        safe_move(path, dst)
        data.pop(path.name, None)
        _write_index(data)
    return {"restored": dst.name, "kind": meta["kind"]}


@router.delete("/{item_id}")
def purge(item_id: str) -> dict:
    with _lock:
        path = _safe_file(item_id)
        data = _read_index()
        _drop(path, data)
        _write_index(data)
    return {"deleted": item_id}


@router.delete("")
def empty() -> dict:
    with _lock:
        data = _read_index()
        files = _files()
        for p in files:
            _drop(p, data)
        _write_index(data)
    return {"deleted": len(files)}
