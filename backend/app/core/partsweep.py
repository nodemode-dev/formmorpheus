"""Leftover `.part` files: a write that was killed half way leaves its temporary file behind (the real file is untouched,
since every write goes to a part file and is renamed into place). They are swept at start and then hourly, never while young."""
import os
import time
from pathlib import Path

from app.core import config

MIN_AGE_SECONDS = 3600


def sweep(root: Path | None = None, now: float | None = None) -> int:
    top = root or config.data_dir()
    cut = (now or time.time()) - MIN_AGE_SECONDS
    gone = 0
    for folder, dirs, files in os.walk(top, followlinks=False):
        dirs[:] = [d for d in dirs if d != "Jobs"]   # export jobs have their own sweep
        for name in files:
            if name.startswith(".") and name.endswith(".part"):
                p = Path(folder) / name
                try:
                    if p.stat().st_mtime < cut:
                        p.unlink()
                        gone += 1
                except OSError:
                    continue
    # snapshots nobody answered for a month (the Recover question keeps asking until then) would otherwise pile up for ever
    rec = top / "Recovery"
    old = (now or time.time()) - 30 * 86400
    if rec.is_dir():
        for p in rec.iterdir():
            try:
                if p.is_file() and not p.name.startswith(".") and p.stat().st_mtime < old:
                    p.unlink()
                    gone += 1
            except OSError:
                continue
    return gone
