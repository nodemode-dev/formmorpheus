"""The two speech model sets, downloaded into the data folder only when the person asks and removable again.

Each file comes from its pinned HTTPS address, must have the recorded size and SHA-256, and reaches its real name only
after it matched. A set counts as installed when every pinned file is there with its recorded size.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import stat
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from app.core import config
from app.services.ffmpeg_fetch import BLOCK, Cancelled, _HttpsOnly, _context, inside_app_bundle
from app.services.speech_models_record import SETS, Pin, SpeechSet

TIMEOUT_SECONDS = 60

log = logging.getLogger("formmorpheus")


@dataclass
class Task:
    state: str = "idle"
    done: int = 0
    total: int = 0
    error: str = ""
    stop: threading.Event = field(default_factory=threading.Event)

    def public(self) -> dict:
        return {"state": self.state, "done": self.done, "total": self.total, "error": self.error}


_lock = threading.Lock()
_tasks: dict[str, Task] = {name: Task() for name in SETS}


def known(name: str) -> bool:
    return name in SETS


def root() -> Path:
    return config.data_dir() / "speech"


def folder(name: str) -> Path:
    if name not in SETS:
        raise KeyError(name)
    return root() / name   # the name is one of the record's own keys, never a request string


def _target(name: str, pin: Pin) -> Path:
    return folder(name).joinpath(*pin.path.split("/"))


def _present(name: str, pin: Pin) -> bool:
    try:
        info = os.lstat(_target(name, pin))
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) and info.st_size == pin.size


def installed(name: str) -> bool:
    return all(_present(name, pin) for pin in SETS[name].files)


def task(name: str) -> dict:
    with _lock:
        return _tasks[name].public()


def busy(name: str) -> bool:
    with _lock:
        return _tasks[name].state == "downloading"


def _set(name: str, **changes) -> None:
    with _lock:
        for key, value in changes.items():
            setattr(_tasks[name], key, value)


def describe() -> dict:
    return {
        name: {"installed": installed(name), "bytes": spec.total, "files": len(spec.files), "licence": spec.licence, "task": task(name)}
        for name, spec in SETS.items()
    }


def served_file(name: str, path: str) -> tuple[Path, Pin] | None:
    """The installed file for one pinned path. The request string only picks a record entry; the path is built from the record."""
    spec = SETS.get(name)
    if spec is None:
        return None
    pin = next((pin for pin in spec.files if pin.path == path), None)
    if pin is None or not installed(name):
        return None
    return _target(name, pin), pin


def _opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_HttpsOnly(), urllib.request.HTTPSHandler(context=_context()))


def _reason(error: Exception) -> str:
    if isinstance(error, urllib.error.HTTPError):
        return f"the source answered {error.code}"
    if isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError):
        return "the source stopped answering"
    if isinstance(error, urllib.error.URLError):
        return f"the source could not be reached ({error.reason})"
    return str(error)


def _fetch(name: str, pin: Pin, before: int) -> None:
    if urllib.parse.urlsplit(pin.url).scheme != "https":
        raise ValueError("only HTTPS addresses are used")
    stop = _tasks[name].stop
    target = _target(name, pin)
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(f".{target.name}.part")   # the hourly part-file sweep knows this shape
    request = urllib.request.Request(pin.url, headers={"User-Agent": "FormMorpheus"})
    digest = hashlib.sha256()
    received = 0
    try:
        with _opener().open(request, timeout=TIMEOUT_SECONDS) as response, part.open("wb") as out:
            while True:
                if stop.is_set():
                    raise Cancelled()
                block = response.read(BLOCK)
                if not block:
                    break
                received += len(block)
                if received > pin.size:
                    raise ValueError(f"{pin.path} is larger than its recorded size")
                digest.update(block)
                out.write(block)
                _set(name, done=before + received)
        if received != pin.size:
            raise ValueError(f"{pin.path} is smaller than its recorded size")
        if digest.hexdigest() != pin.sha256:
            raise ValueError(f"{pin.path} does not match its recorded SHA-256, so it was not kept")
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)


def _run(name: str) -> None:
    spec: SpeechSet = SETS[name]
    stop = _tasks[name].stop
    try:
        done = sum(pin.size for pin in spec.files if _present(name, pin))
        _set(name, done=done)
        for pin in spec.files:
            if stop.is_set():
                raise Cancelled()
            if _present(name, pin):
                continue   # kept from an earlier try, so a retry takes only what is missing
            _fetch(name, pin, done)
            done += pin.size
        _set(name, state="idle", done=spec.total, error="")
        log.info("the %s speech models are installed in %s", name, folder(name))
    except Cancelled:
        _set(name, state="cancelled", error="")
    except Exception as error:
        log.info("the %s speech models could not be downloaded: %s", name, error)
        _set(name, state="failed", error=f"The download could not be finished: {_reason(error)}.")


def start(name: str) -> None:
    if inside_app_bundle(root()):
        raise ValueError("The data folder is inside the app, so speech models are not downloaded there.")
    with _lock:
        current = _tasks[name]
        if current.state == "downloading":
            raise RuntimeError("These speech models are already being downloaded.")
        # a new Task with its own stop flag, so a late cancel of the old run cannot stop this one
        _tasks[name] = Task(state="downloading", total=SETS[name].total)
    threading.Thread(target=_run, args=(name,), name=f"speech-models-{name}", daemon=True).start()


def cancel(name: str) -> None:
    with _lock:
        if _tasks[name].state == "downloading":
            _tasks[name].stop.set()


def remove(name: str) -> None:
    """Deletes what is inside the set's own folder, then the folder; a link is unlinked, never followed."""
    with _lock:
        if _tasks[name].state == "downloading":
            raise RuntimeError("These speech models are being downloaded. Cancel the download first.")
        where = folder(name)
        try:
            if where.is_symlink():
                where.unlink()
            elif where.is_dir():
                for child in where.iterdir():
                    if child.is_dir() and not child.is_symlink():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
                where.rmdir()
        except OSError as error:
            raise RuntimeError("The speech models are in use. Try again in a moment.") from error
        _tasks[name] = Task()
