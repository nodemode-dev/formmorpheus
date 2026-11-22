"""Finding and probing a user-installed ffmpeg.

formmorpheus never ships a GPL ffmpeg. libx265 is GPL; when the person's own ffmpeg has it, we run that
program as a separate process (arguments only, no shell) and nothing of it is linked or bundled.
"""
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

HEVC_ORDER = ["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_vaapi", "libx265"]
WANTED = ["prores_ks", "aac", "libmp3lame", "libopus", "libx264", *HEVC_ORDER]
# An app opened from Finder gets the system PATH only, which has none of these.
MAC_INSTALL_DIRS = ("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin")


@dataclass
class FfmpegInfo:
    path: str
    version: str
    encoders: list[str] = field(default_factory=list)
    gpl: bool = False

    def has(self, name: str) -> bool:
        return name in self.encoders

    def hevc_candidates(self) -> list[str]:
        return [e for e in HEVC_ORDER if self.has(e)]


_cache: dict[str, FfmpegInfo | None] = {}


def _run(path: str, *args: str) -> str:
    try:
        done = subprocess.run([path, "-hide_banner", *args], capture_output=True, text=True, timeout=20, check=False)
    except (OSError, subprocess.SubprocessError):
        return ""
    return (done.stdout or "") + (done.stderr if not done.stdout else "")


def find_ffmpeg() -> str | None:
    exe = "ffmpeg.exe" if sys.platform.startswith("win") else "ffmpeg"
    raw = os.environ.get("FORMMORPHEUS_FFMPEG", "").strip()
    if raw:
        p = Path(raw).expanduser()
        if p.is_file():
            return str(p)
    if getattr(sys, "frozen", False):
        beside = Path(sys.executable).resolve().parent / exe
        if beside.is_file():
            return str(beside)
    found = shutil.which("ffmpeg")
    if found or sys.platform != "darwin":
        return found
    for folder in MAC_INSTALL_DIRS:
        candidate = Path(folder) / exe
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def probe(refresh: bool = False) -> FfmpegInfo | None:
    path = find_ffmpeg()
    if path is None:
        return None
    if not refresh and path in _cache:
        return _cache[path]
    head = _run(path, "-version")
    m = re.search(r"ffmpeg version (\S+)", head)
    if not m:
        _cache[path] = None
        return None
    listing = _run(path, "-encoders")
    names = set()
    for line in listing.splitlines():
        parts = line.split()
        # lines look like " V....D libx265 H.265 / HEVC"
        if len(parts) >= 2 and re.fullmatch(r"[VAS][A-Z.]{5}", parts[0]):
            names.add(parts[1])
    conf = _run(path, "-buildconf")
    info = FfmpegInfo(path=path, version=m.group(1), encoders=[e for e in WANTED if e in names], gpl="--enable-gpl" in conf)
    _cache[path] = info
    return info
