"""What the engine can say about a movie without opening it: metadata read from the .fmo's own JSON, and its pictures.

A new empty movie is written here with the entries and fields the interface itself writes for a new movie
(frontend/src/io/fmo.ts packMovie, frontend/src/engine/model.ts newMovie)."""
import io
import json
import time
import uuid
import zipfile
from pathlib import Path

from app import __version__

FORMAT_VERSION = 1
JSON_LIMIT = 64 * 1024 * 1024
PICTURE_LIMIT = 16 * 1024 * 1024
MAX_SIDE = 3840
MIN_SIDE = 16
MAX_FPS = 120
ITEMS_PER_TRACK = 40


class NotAMovie(ValueError):
    pass


def _json(zin: zipfile.ZipFile, name: str) -> dict | None:
    try:
        info = zin.getinfo(name)
    except KeyError:
        return None
    if info.file_size > JSON_LIMIT:
        return None
    try:
        data = json.loads(zin.read(info))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _num(value, fallback: float) -> float:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else fallback


def _walk(tracks, depth: int, counts: dict) -> list[dict]:
    out = []
    for i, t in enumerate(tracks if isinstance(tracks, list) else []):
        if not isinstance(t, dict):
            continue
        items = [c for c in t.get("content") or [] if isinstance(c, dict)]
        row = {"name": str(t.get("name") or f"Track {i + 1}"), "hidden": bool(t.get("hidden")), "content": len(items), "items": []}
        for c in items:
            kind = str(c.get("kind") or "")
            counts[kind] = counts.get(kind, 0) + 1
            item = {"name": str(c.get("name") or kind), "kind": kind, "start": int(_num(c.get("start"), 0)), "duration": int(_num(c.get("duration"), 1))}
            if kind == "flipbook":
                rows = [r for r in c.get("flip") or [] if isinstance(r, dict)]
                item["flipRows"] = len(rows)
                item["flipFrames"] = sum(len(r.get("frames") or []) for r in rows)
            if kind == "drawing":
                item["layers"] = len(c.get("layers") or [])
            if kind == "text" and isinstance(c.get("text"), dict):
                item["text"] = str(c["text"].get("text") or "")[:120]
            if kind == "group" and depth < 8:
                item["tracks"] = _walk(c.get("tracks"), depth + 1, counts)
            if len(row["items"]) < ITEMS_PER_TRACK:
                row["items"].append(item)
        out.append(row)
    return out


def read_meta(path: Path) -> dict:
    try:
        with zipfile.ZipFile(path) as zin:
            names = set(zin.namelist())
            manifest = _json(zin, "manifest.json") or {}
            movie = _json(zin, "movie.json")
    except (OSError, zipfile.BadZipFile) as exc:
        raise NotAMovie(f"{path.name} could not be read as a movie: {exc}") from None
    if manifest.get("app") != "formmorpheus" or movie is None:
        raise NotAMovie(f"{path.name} is not a FormMorpheus movie, or its movie.json is damaged.")
    fps = max(1.0, _num(movie.get("fps"), 24))
    counts: dict = {}
    tracks = _walk(movie.get("tracks"), 0, counts)
    duration = int(max(1, _num(movie.get("duration"), round(fps))))
    assets = [a for a in (movie.get("assets") or {}).values() if isinstance(a, dict)] if isinstance(movie.get("assets"), dict) else []
    kinds: dict = {}
    for a in assets:
        kinds[str(a.get("kind") or "")] = kinds.get(str(a.get("kind") or ""), 0) + 1
    st = path.stat()
    return {
        "name": path.stem,
        "title": str(movie.get("name") or ""),
        "width": int(_num(movie.get("width"), 1920)),
        "height": int(_num(movie.get("height"), 1080)),
        "fps": fps,
        "frames": duration,
        "seconds": round(duration / fps, 3),
        "background": str(movie.get("background") or ""),
        "transparent": bool(movie.get("transparent")),
        "playback": str(movie.get("playback") or "loop"),
        "author": str(movie.get("author") or ""),
        "camera": isinstance(movie.get("camera"), dict),
        "tracks": tracks,
        "counts": {"tracks": len(tracks), "content": sum(counts.values()), "byKind": counts, "assets": len(assets), "assetsByKind": kinds},
        "file": {"size": st.st_size, "modified": st.st_mtime, "savedBy": str(manifest.get("version") or ""), "saved": manifest.get("saved"),
                 "history": "history.json" in names, "poster": "poster.png" in names, "preview": "preview.png" in names},
    }


def read_subtitles(path: Path) -> dict:
    """The movie's subtitles from movie.json, with the frame rate and height their times and size are read against. subtitles is None when it has none."""
    try:
        with zipfile.ZipFile(path) as zin:
            manifest = _json(zin, "manifest.json") or {}
            movie = _json(zin, "movie.json")
    except (OSError, zipfile.BadZipFile) as exc:
        raise NotAMovie(f"{path.name} could not be read as a movie: {exc}") from None
    if manifest.get("app") != "formmorpheus" or movie is None:
        raise NotAMovie(f"{path.name} is not a FormMorpheus movie, or its movie.json is damaged.")
    out = {"name": path.stem, "fps": max(1.0, _num(movie.get("fps"), 24)), "height": int(_num(movie.get("height"), 1080)), "subtitles": None}
    raw = movie.get("subtitles")
    if not isinstance(raw, dict):
        return out
    st = raw.get("style") if isinstance(raw.get("style"), dict) else {}
    pos = st.get("position")
    style = {"font": str(st.get("font") or "Inter"), "size": _num(st.get("size"), 5), "position": pos if pos in ("top", "middle", "bottom") else "bottom",
             "color": str(st.get("color") or "#ffffff"), "band": st.get("band") is not False}
    cues = []
    for c in raw.get("cues") or [] if isinstance(raw.get("cues"), list) else []:
        if not isinstance(c, dict):
            continue
        start, end = int(_num(c.get("start"), 0)), int(_num(c.get("end"), 0))
        if end > start >= 0:
            cues.append({"id": str(c.get("id") or ""), "start": start, "end": end, "text": str(c.get("text") or "")})
    cues.sort(key=lambda c: c["start"])
    out["subtitles"] = {"show": raw.get("show") is not False, "style": style, "cues": cues}
    return out


def picture(path: Path, member: str) -> bytes | None:
    try:
        with zipfile.ZipFile(path) as zin:
            info = zin.getinfo(member)
            if info.file_size > PICTURE_LIMIT:
                return None
            data = zin.read(info)
    except (KeyError, OSError, zipfile.BadZipFile):
        return None
    return data if data[:8] == b"\x89PNG\r\n\x1a\n" else None


def empty_movie(title: str, width: int = 1920, height: int = 1080, fps: float = 24, seconds: float = 10) -> bytes:
    fps = min(MAX_FPS, max(1, round(float(fps) * 1000) / 1000))
    movie = {
        "format": FORMAT_VERSION,
        "id": f"m{uuid.uuid4().hex[:16]}",
        "name": title,
        "width": min(MAX_SIDE, max(MIN_SIDE, round(width))),
        "height": min(MAX_SIDE, max(MIN_SIDE, round(height))),
        "fps": fps,
        "duration": max(1, round(float(seconds) * fps)),
        "background": "#ffffff",
        "transparent": False,
        "playback": "loop",
        "addKeyAtStart": True,
        "loopVisible": True,
        "onion": {"enabled": True, "backFrames": 2, "foreFrames": 1, "opacity": 0.4, "tint": True, "backColor": "#ff4f7a", "foreColor": "#3a9bff", "blendPrimary": False},
        "tracks": [],
        "assets": {},
    }
    manifest = {"app": "formmorpheus", "format": FORMAT_VERSION, "version": __version__, "saved": int(time.time() * 1000), "history": False}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        zout.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
        zout.writestr("movie.json", json.dumps(movie, separators=(",", ":")))
    return buf.getvalue()
