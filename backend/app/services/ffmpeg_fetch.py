"""The family's LGPL ffmpeg build from formai-binaries, downloaded only when the person asks for it in Preferences.

It is installed in the data folder as a separate program that the engine runs; nothing of it is linked or bundled.
"""
from __future__ import annotations

import contextlib
import hashlib
import logging
import os
import platform
import shutil
import ssl
import sys
import tarfile
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from app.core import config
from app.services.ffmpeg_record import ARCHIVES, FILES, FFMPEG_VERSION, LICENCE, RELEASE, RELEASES, SOURCES

DOCUMENTS = ("LGPL-2.1.txt", "THIRD-PARTY-NOTICES.txt", "ffmpeg-licence.json")
BLOCK = 1 << 20
LEFTOVERS = (".staging-", ".old-", ".removing-", ".download-")

log = logging.getLogger("formmorpheus")


class Cancelled(Exception):
    pass


def host_triple() -> str:
    arch = "aarch64" if platform.machine().lower() in ("arm64", "aarch64") else "x86_64" if platform.machine().lower() in ("x86_64", "amd64") else platform.machine().lower()
    if sys.platform == "darwin":
        return f"{arch}-apple-darwin"
    if os.name == "nt":
        return f"{arch}-pc-windows-msvc"
    return f"{arch}-unknown-linux-gnu"


def available() -> bool:
    return host_triple() in FILES and host_triple() in ARCHIVES


def root() -> Path:
    return config.data_dir() / "ffmpeg"


def folder() -> Path:
    return root() / f"ffmpeg-lgpl-{RELEASE}"


def _program_name(program: str) -> str:
    return f"{program}-{host_triple()}{'.exe' if os.name == 'nt' else ''}"


def library_dir() -> Path:
    return folder() / f"lib-{host_triple()}"


def inside_app_bundle(path: Path) -> bool:
    return any(part.endswith(".app") for part in path.resolve().parts)


def installed() -> str | None:
    if not available():
        return None
    try:
        program = folder() / _program_name("ffmpeg")
        if not program.is_file():
            return None
    except OSError:
        return None
    if os.name == "nt":
        libs = str(library_dir())
        parts = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
        if libs not in parts:
            os.environ["PATH"] = os.pathsep.join([libs, *parts])
    return str(program)


def installed_bytes() -> int:
    total = 0
    if not folder().is_dir():
        return 0
    for path in folder().rglob("*"):
        with contextlib.suppress(OSError):
            if path.is_file():
                total += path.stat().st_size
    return total


def download_bytes() -> int:
    return ARCHIVES.get(host_triple(), ("", 0))[1]


def urls() -> list[str]:
    name = f"ffmpeg-lgpl-{RELEASE}-{host_triple()}.tar.gz"
    override = os.environ.get("FORMCUT_FFMPEG_RELEASE", "").strip()
    bases = [override] if override else [f"{base}/ffmpeg-{RELEASE}" for base in SOURCES]
    return [f"{base.rstrip('/')}/{name}" for base in bases]


@dataclass
class Task:
    state: str = "idle"
    received: int = 0
    total: int = 0
    error: str = ""

    def public(self) -> dict:
        return {"state": self.state, "received": self.received, "total": self.total, "error": self.error}


_lock = threading.Lock()
_task = Task()
_cancel = threading.Event()


def task() -> dict:
    with _lock:
        return _task.public()


def busy() -> bool:
    with _lock:
        return _task.state in ("downloading", "verifying")


def _set(**changes) -> None:
    with _lock:
        for key, value in changes.items():
            setattr(_task, key, value)


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


class _HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise urllib.error.URLError("a redirect left HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    if sys.platform == "darwin" and os.path.isfile("/etc/ssl/cert.pem"):
        context.load_verify_locations("/etc/ssl/cert.pem")
    return context


def _download(url: str, target: Path, expected: int) -> None:
    if urllib.parse.urlsplit(url).scheme != "https":
        raise ValueError("only HTTPS addresses are used")
    opener = urllib.request.build_opener(_HttpsOnly(), urllib.request.HTTPSHandler(context=_context()))
    request = urllib.request.Request(url, headers={"User-Agent": "FormMorpheus"})
    _set(received=0, total=expected)
    received = 0
    with opener.open(request, timeout=60) as response, target.open("wb") as out:
        while True:
            if _cancel.is_set():
                raise Cancelled()
            block = response.read(BLOCK)
            if not block:
                break
            received += len(block)
            if received > expected:
                raise ValueError("the file is larger than the recorded size")
            out.write(block)
            _set(received=received)


def _root(unpacked: Path, first: str) -> Path:
    for hit in unpacked.rglob(Path(first).name):
        candidate = hit
        for _ in Path(first).parts:
            candidate = candidate.parent
        if (candidate / first).is_file():
            return candidate
    raise ValueError(f"the archive has no {first}")


def _install(archive: Path, pins: tuple[tuple[str, str], ...], where: Path) -> None:
    scratch = Path(tempfile.mkdtemp(prefix=".staging-", dir=where.parent))
    try:
        unpacked = scratch / "archive"
        with tarfile.open(archive, "r:gz") as bundle:
            bundle.extractall(unpacked, filter="data")
        top = _root(unpacked, pins[0][0])
        staged = scratch / "staged"
        for path, _ in pins:
            (staged / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(top / path, staged / path)
        for name in DOCUMENTS:
            if (top / name).is_file():
                shutil.copyfile(top / name, staged / name)
        if _cancel.is_set():
            raise Cancelled()
        for path, digest in pins:
            if _digest(staged / path) != digest:
                raise ValueError(f"{path} does not match the record, so nothing was installed")
        if os.name != "nt":
            for program in ("ffmpeg", "ffprobe"):
                os.chmod(staged / _program_name(program), 0o755)
        if _cancel.is_set():
            raise Cancelled()
        old = None
        if where.exists():
            old = where.parent / f".old-{os.getpid()}-{threading.get_ident()}"
            os.replace(where, old)
        os.replace(staged, where)
        if old is not None:
            shutil.rmtree(old, ignore_errors=True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _sweep_leftovers() -> None:
    with contextlib.suppress(OSError):
        for path in root().iterdir():
            if path.name.startswith(LEFTOVERS):
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    path.unlink(missing_ok=True)


def _run() -> None:
    triple = host_triple()
    pins = FILES[triple]
    archive_sha, size = ARCHIVES[triple]
    failures: list[str] = []
    try:
        root().mkdir(parents=True, exist_ok=True)
        _sweep_leftovers()
        for url in urls():
            part = root() / f".download-{os.getpid()}.tar.gz.part"
            try:
                _set(state="downloading")
                _download(url, part, size)
                _set(state="verifying")
                if _digest(part) != archive_sha:
                    raise ValueError("the download does not match its recorded SHA-256")
                _install(part, pins, folder())
            except Cancelled:
                raise
            except Exception as error:
                log.info("ffmpeg %s could not be taken from %s: %s", RELEASE, url, error)
                failures.append(str(error))
                continue
            finally:
                part.unlink(missing_ok=True)
            _set(state="done", error="")
            log.info("ffmpeg %s installed in %s", RELEASE, folder())
            return
        _set(state="failed", error="The download could not be finished: " + "; ".join(dict.fromkeys(failures)) + ".")
    except Cancelled:
        _set(state="cancelled", error="")
    except Exception as error:
        log.exception("the ffmpeg download failed")
        _set(state="failed", error=f"The download could not be finished: {error}.")


def start() -> None:
    if not available():
        raise ValueError("There is no ffmpeg build from formai-binaries for this computer.")
    if inside_app_bundle(root()):
        raise ValueError("The data folder is inside the app, so ffmpeg is not downloaded there.")
    with _lock:
        if _task.state in ("downloading", "verifying"):
            raise RuntimeError("ffmpeg is already being downloaded.")
        _task.state, _task.received, _task.total, _task.error = "downloading", 0, download_bytes(), ""
        _cancel.clear()
    threading.Thread(target=_run, name="ffmpeg-download", daemon=True).start()


def cancel() -> None:
    _cancel.set()


def remove() -> None:
    if busy():
        raise RuntimeError("ffmpeg is being downloaded. Cancel the download first.")
    where = folder()
    if not where.exists():
        return
    aside = root() / f".removing-{os.getpid()}"
    try:
        os.replace(where, aside)
    except OSError as error:
        raise RuntimeError("ffmpeg is in use. Try again when the export ends.") from error
    shutil.rmtree(aside, ignore_errors=True)
    with _lock:
        if _task.state in ("done", "failed", "cancelled"):
            _task.state, _task.received, _task.total, _task.error = "idle", 0, 0, ""


def describe() -> dict:
    return {
        "release": RELEASE, "version": FFMPEG_VERSION, "licence": LICENCE, "releases": RELEASES,
        "platform": host_triple(), "available": available(), "installed": installed() is not None,
        "folder": str(folder()), "downloadBytes": download_bytes(), "installedBytes": installed_bytes(),
    }
