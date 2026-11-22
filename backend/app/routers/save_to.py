"""Exports written to a folder the person chose (the desktop app's folder dialog hands the engine the path).

Nothing here replaces a file: a taken name becomes "name 2", "name 3". A frames folder is cut out of the zip the window
made, so the window never holds the pictures twice in two shapes.
"""
import io
import os
import re
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from app.core import config
from app.routers.exports import clean_name

router = APIRouter()

_BAD = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
MAX_FILES = 200_000


_RESERVED = re.compile(r"^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$", re.I)
MAX_UNPACKED = 16 * 1024 * 1024 * 1024   # a zip can claim far more than its own size: cap what it may unpack to


def _plain(name: str) -> str:
    """A Windows device name (CON, NUL, COM1...) or one ending in a dot or space would not make a file there."""
    if _RESERVED.match(name.strip()) or name != name.rstrip(" ."):
        raise HTTPException(400, "That file name cannot be used.")
    return name


def _folder(raw: str) -> Path:
    from app.routers.system import _safe_folder
    s = raw.strip().replace("\\", "/")
    if s.startswith("//"):
        raise HTTPException(400, "A network share path cannot be used here.")   # UNC paths and device paths
    return _safe_folder(raw, create=False)   # a typo must not leave new folders behind


def _publish(tmp: Path, dst: Path) -> None:
    """Exclusive: a hard link, or a create with 'x' where links are not supported."""
    try:
        os.link(tmp, dst)
        return
    except FileExistsError:
        raise
    except OSError:
        pass
    with open(tmp, "rb") as fin, open(dst, "xb") as fout:
        while chunk := fin.read(1024 * 1024):
            fout.write(chunk)


async def _body(request: Request, folder: Path) -> Path:
    tmp = folder / f".{uuid.uuid4().hex}.part"
    size = 0
    try:
        with open(tmp, "wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > config.MAX_EXPORT_BYTES:
                    raise HTTPException(413, "The export is too large to save.")
                out.write(chunk)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise HTTPException(400, "FormMorpheus could not write there.")
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return tmp


@router.post("/file")
async def save_file(request: Request, dir: str, name: str) -> dict:
    folder = _folder(dir)
    base = Path(_plain(clean_name(name)))
    tmp = await _body(request, folder)
    try:
        n = 1
        while True:
            dst = folder / (base.name if n == 1 else f"{base.stem} {n}{base.suffix}")
            try:
                _publish(tmp, dst)
                break
            except FileExistsError:
                n += 1
            except OSError:
                raise HTTPException(400, "FormMorpheus could not write there.")
    finally:
        tmp.unlink(missing_ok=True)
    return {"path": str(dst), "name": dst.name}


@router.post("/frames")
async def save_frames(request: Request, dir: str, folder: str) -> dict:
    """The zip of a picture sequence becomes a folder of pictures: dir/<folder>/, numbered if that folder is taken."""
    parent = _folder(dir)
    stem = _plain(clean_name(folder))
    tmp = await _body(request, parent)
    try:
        try:
            zf = zipfile.ZipFile(tmp)
        except zipfile.BadZipFile:
            raise HTTPException(400, "That is not a set of frames.")
        with zf:
            files = [i for i in zf.infolist() if not i.is_dir() and not _BAD.search(Path(i.filename).name) and not Path(i.filename).name.startswith(".")
                     and not _RESERVED.match(Path(i.filename).name) and Path(i.filename).name == Path(i.filename).name.rstrip(" .")]
            if not files or len(files) > MAX_FILES or sum(i.file_size for i in files) > MAX_UNPACKED:
                raise HTTPException(400, "There are no frames to save.")
            n = 1
            while True:
                dst = parent / (stem if n == 1 else f"{stem} {n}")
                try:
                    dst.mkdir()
                    break
                except FileExistsError:
                    n += 1
                except OSError:
                    raise HTTPException(400, "FormMorpheus could not write there.")
            written = 0
            total = 0
            made: list[Path] = []
            try:
                for info in files:
                    target = dst / Path(info.filename).name   # the name only: an entry can never leave the folder
                    made.append(target)
                    with zf.open(info) as src, open(target, "xb") as out:
                        while chunk := src.read(1024 * 1024):
                            total += len(chunk)
                            if total > MAX_UNPACKED:
                                raise OSError("too large")   # the header lied about the size
                            out.write(chunk)
                    written += 1
            except (OSError, zipfile.BadZipFile, RuntimeError):
                # a half-written folder is worse than none: take back what this call made
                for p in made:
                    p.unlink(missing_ok=True)
                try:
                    dst.rmdir()
                except OSError:
                    pass
                raise HTTPException(400, "FormMorpheus could not write all the frames there.")
    finally:
        tmp.unlink(missing_ok=True)
    return {"path": str(dst), "name": dst.name, "files": written}
