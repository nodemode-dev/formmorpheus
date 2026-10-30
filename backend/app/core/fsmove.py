"""Moving a file between folders that may sit on different devices (a library on another drive).

os.replace fails with EXDEV across devices, so the fallback copies beside the destination, flushes it to disk,
renames it into place (atomic on that device) and only then removes the source. A failure leaves the source intact.
"""
import errno
import os
import shutil
import uuid
from pathlib import Path


def safe_move(src: Path, dst: Path) -> Path:
    try:
        os.replace(src, dst)
        return dst
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise
    tmp = dst.with_name(f".{uuid.uuid4().hex}.part")
    try:
        with open(src, "rb") as fin, open(tmp, "wb") as fout:
            shutil.copyfileobj(fin, fout, 1024 * 1024)
            fout.flush()
            os.fsync(fout.fileno())
        try:
            shutil.copystat(src, tmp)
        except OSError:
            pass
        os.replace(tmp, dst)
    finally:
        tmp.unlink(missing_ok=True)
    src.unlink()
    return dst
