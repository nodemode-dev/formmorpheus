import json
import os
import re
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app.core import config
from app.core.upload import read_limited

router = APIRouter()

_SESSION = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_lock = threading.Lock()


def recovery_dir() -> Path:
    path = config.data_dir() / "Recovery"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session(session: str) -> str:
    if not _SESSION.match(session):
        raise HTTPException(400, "That is not a session id.")
    return session


def _paths(session: str) -> tuple[Path, Path]:
    folder = recovery_dir()
    return folder / f"{session}{config.PROJECT_EXT}", folder / f"{session}.json"


def _atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.part")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _entry(session: str, fmo: Path, side: Path) -> dict:
    meta: dict = {}
    try:
        data = json.loads(side.read_text("utf-8"))
        meta = data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        pass
    def num(key: str, fallback: float) -> float:
        try:
            v = float(meta.get(key) or fallback)
            return v if v == v and abs(v) < 1e12 else fallback
        except (TypeError, ValueError):
            return fallback

    taken = num("time", fmo.stat().st_mtime)
    # the heartbeat of the window that owns this snapshot; older files only have the snapshot time
    alive = num("alive", taken)
    return {
        "session": session,
        "name": str(meta.get("name") or "Untitled"),
        "library": meta.get("library") if isinstance(meta.get("library"), str) else None,
        "time": taken,
        "alive": alive,
        "idle": max(0.0, time.time() - alive),
        "size": fmo.stat().st_size,
    }


@router.get("")
def list_snapshots() -> dict:
    items = []
    for fmo in recovery_dir().glob(f"*{config.PROJECT_EXT}"):
        if fmo.is_file() and _SESSION.match(fmo.stem):
            try:
                items.append(_entry(fmo.stem, fmo, fmo.with_suffix(".json")))
            except (OSError, ValueError, TypeError):
                continue
    items.sort(key=lambda e: e["time"], reverse=True)
    return {"items": items}


@router.get("/{session}")
def read_snapshot(session: str) -> Response:
    fmo, _ = _paths(_session(session))
    if not fmo.is_file():
        raise HTTPException(404, "No recovery snapshot for that session.")
    return Response(fmo.read_bytes(), media_type="application/octet-stream")


@router.put("/{session}")
async def write_snapshot(session: str, request: Request, name: str = "Untitled", library: str | None = None) -> dict:
    fmo, side = _paths(_session(session))
    body = await read_limited(request, config.MAX_PROJECT_BYTES, "The movie is too large to snapshot.")
    if body[:4] != b"PK\x03\x04":
        raise HTTPException(400, "That is not a formmorpheus project.")
    now = time.time()
    meta = {"name": name[:180], "library": library[:180] if library else None, "time": now, "alive": now}
    with _lock:
        _atomic(fmo, body)
        _atomic(side, json.dumps(meta).encode("utf-8"))
    return _entry(session, fmo, side)


@router.post("/{session}/alive")
def heartbeat(session: str) -> dict:
    """The owning window calls this every 20 s and on every visibility change; a snapshot whose heartbeat is over 240 s old is offered as a crash."""
    fmo, side = _paths(_session(session))
    with _lock:
        if not fmo.is_file():
            raise HTTPException(404, "No recovery snapshot for that session.")
        try:
            meta = json.loads(side.read_text("utf-8"))
            if not isinstance(meta, dict):
                meta = {}
        except (OSError, ValueError):
            meta = {}
        meta["alive"] = time.time()
        _atomic(side, json.dumps(meta).encode("utf-8"))
    return {"ok": True}


@router.delete("/{session}")
def delete_snapshot(session: str) -> dict:
    fmo, side = _paths(_session(session))
    with _lock:
        for p in (fmo, side):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
    return {"ok": True}
