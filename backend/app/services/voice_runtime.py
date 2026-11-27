"""The built-in voice: Kokoro run by kokoro-onnx in its own Python runtime inside the data folder.

The engine never imports kokoro_onnx, numpy or onnxruntime. The loader kokoro-onnx uses brings eSpeak NG under GPL
terms, so Kokoro stays a separate program in a separate environment: a venv made from a system Python, fed JSON on
stdin by a short script passed with -c. Setup is one job on a daemon thread: find Python, make the runtime, download
the two pinned model files.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

from app.core import config

PACKAGE = "kokoro-onnx==0.6.1"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"
# name -> (sha256, exact size); the size is what status() checks, so it never hashes 340 MB per call
MODELS = {
    "kokoro-v1.0.onnx": ("beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a", 325505369),
    "voices-v1.0.bin": ("bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d", 28214398),
}
DEFAULT_VOICE = "af_heart"
PAUSE = 0.12
SPEAK_TIMEOUT = 600
PIP_TIMEOUT = 1800
VENV_TIMEOUT = 300
BLOCK = 1 << 20
PYTHON_RANGE = ((3, 10), (3, 13))
NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# first letter of a voice id -> (language code Kokoro takes, group shown to the person)
LANGUAGES = {
    "a": ("en-us", "American English"),
    "b": ("en-gb", "British English"),
    "e": ("es", "Spanish"),
    "f": ("fr-fr", "French"),
    "h": ("hi", "Hindi"),
    "i": ("it", "Italian"),
    "j": ("ja", "Japanese"),
    "p": ("pt-br", "Brazilian Portuguese"),
    "z": ("cmn", "Mandarin Chinese"),
}
ACCEPTED = {code for code, _group in LANGUAGES.values()}
FIRST_GROUPS = ("American English", "British English")

PROBE = "import sys;print('%d %d %s'%(sys.version_info[0],sys.version_info[1],sys.executable))"

LIST_VOICES = """
import json,sys
import numpy as np
with np.load(sys.argv[1],allow_pickle=False) as data:
 print(json.dumps(sorted(data.files)))
"""

# Loads the model once and speaks each sentence in order, a short silence between, into one 16-bit mono WAV.
WORKER = """
import json,sys,wave
import numpy as np
from kokoro_onnx import Kokoro
args=json.load(sys.stdin)
engine=Kokoro(args["model"],args["voices"])
parts=[];cues=[];at=0;rate=24000
for text in args["sentences"]:
 audio,rate=engine.create(text,voice=args["voice"],speed=args["speed"],lang=args["language"])
 audio=np.asarray(audio,dtype=np.float32).reshape(-1)
 if parts:
  gap=np.zeros(int(round(args["pause"]*rate)),dtype=np.float32)
  parts.append(gap);at+=len(gap)
 cues.append({"start":round(at/rate,3),"end":round((at+len(audio))/rate,3),"text":text})
 parts.append(audio);at+=len(audio)
sound=np.concatenate(parts) if parts else np.zeros(0,dtype=np.float32)
with wave.open(args["output"],"wb") as out:
 out.setnchannels(1)
 out.setsampwidth(2)
 out.setframerate(int(rate))
 out.writeframes(np.round(np.clip(sound,-1,1)*32767).astype("<i2").tobytes())
sys.stdout.write(json.dumps({"rate":int(rate),"samples":int(at),"cues":cues})+"\\n")
sys.stdout.flush()
"""

_lock = threading.RLock()
_job: dict | None = None
_cancel = threading.Event()
_process: subprocess.Popen | None = None
_probe: dict[str, bool] = {}
_python: dict[str, str | None] = {}
_voices: dict = {}


class VoiceError(Exception):
    def __init__(self, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.status = status


class Cancelled(Exception):
    pass


def folder() -> Path:
    return config.data_dir() / "voice"


def runtime_dir() -> Path:
    return folder() / "runtime"


def models_dir() -> Path:
    return folder() / "models"


def runtime_python() -> Path:
    return runtime_dir() / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _worker_env() -> dict:
    """The environment the runtime's Python runs in: its own site-packages, not the engine's.

    A frozen engine's bootloader points the library path at its own folder and may carry Python variables; the
    runtime is another Python with its own native libraries, so those are dropped."""
    env = dict(os.environ)
    for name in ("PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONEXECUTABLE", "VIRTUAL_ENV", "__PYVENV_LAUNCHER__"):
        env.pop(name, None)
    bundle = getattr(sys, "_MEIPASS", None)
    for name in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"):
        original = env.pop(name + "_ORIG", None)
        parts = (original if original is not None else env.get(name, "")).split(os.pathsep)
        kept = [part for part in parts if part and not (bundle and part.startswith(bundle))]
        if kept:
            env[name] = os.pathsep.join(kept)
        else:
            env.pop(name, None)
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def _last_line(text: str) -> str:
    last = next((line.strip() for line in reversed((text or "").strip().splitlines()) if line.strip()), "")
    return last[:160]


# Python


def _version_of(command: list[str]) -> str | None:
    """The interpreter's own path when the command runs a Python in range, else None."""
    if not shutil.which(command[0]) and not Path(command[0]).is_file():
        return None
    try:
        done = subprocess.run(command + ["-c", PROBE], capture_output=True, text=True, timeout=20, check=False,
                              stdin=subprocess.DEVNULL, creationflags=NO_WINDOW, env=_worker_env())
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode:
        return None
    try:
        major, minor, path = done.stdout.strip().splitlines()[-1].split(" ", 2)
        version = (int(major), int(minor))
    except (ValueError, IndexError):
        return None
    if not (PYTHON_RANGE[0] <= version <= PYTHON_RANGE[1]):
        return None
    return path or None


def _candidates() -> list[list[str]]:
    found: list[list[str]] = []
    if sys.platform == "darwin":
        # an app's PATH is short, and /usr/bin/python3 may be a stub that asks to install developer tools
        for minor in (12, 13, 11, 10):
            found.append([f"/Library/Frameworks/Python.framework/Versions/3.{minor}/bin/python3"])
        found += [["/opt/homebrew/bin/python3"], ["/usr/local/bin/python3"]]
    found += [["python3"], ["python"]]
    if os.name == "nt":
        found.append(["py", "-3"])
    return found


def find_python(fresh: bool = False) -> str | None:
    """The system Python the runtime is made from: the engine's own when it is not frozen."""
    with _lock:
        if not fresh and "found" in _python:
            return _python["found"]
    if not getattr(sys, "frozen", False):
        found: str | None = sys.executable
    else:
        found = next((path for path in map(_version_of, _candidates()) if path), None)
    with _lock:
        _python["found"] = found
    return found


# runtime and model state


def _runtime_works(setup: bool = False) -> bool:
    python = runtime_python()
    if not python.is_file():
        return False
    key = str(python)
    with _lock:
        if key in _probe:
            return _probe[key]
        if _running() and not setup:
            return False   # pip may be writing into it right now
    try:
        done = subprocess.run([key, "-c", "import kokoro_onnx"], capture_output=True, text=True, timeout=120,
                              check=False, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW, env=_worker_env())
        works = done.returncode == 0
    except (OSError, subprocess.SubprocessError):
        works = False
    with _lock:
        _probe[key] = works
    return works


def _model_ready() -> bool:
    for name, (_digest, size) in MODELS.items():
        path = models_dir() / name
        try:
            if not path.is_file() or path.stat().st_size != size:
                return False
        except OSError:
            return False
    return True


def _forget() -> None:
    with _lock:
        _probe.clear()
        _voices.clear()


def _size(path: Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:
                continue
    return total


def _running() -> bool:
    return bool(_job and _job.get("state") == "running")


def job() -> dict | None:
    with _lock:
        return dict(_job) if _job else None


def status() -> dict:
    runtime = _runtime_works()
    model = _model_ready()
    return {
        "ready": runtime and model,
        "runtime": runtime,
        "model": model,
        "python": find_python(),
        "folder": str(folder()),
        "bytes": _size(folder()) if folder().is_dir() else 0,
        "job": job(),
    }


# setup


def _set(**changes) -> None:
    with _lock:
        if _job is not None:
            _job.update(changes)


def _check() -> None:
    if _cancel.is_set():
        raise Cancelled()


def _run(command: list[str], timeout: float, failure: str) -> None:
    """Runs one setup command, killing it when the person cancels. Output goes to a file so no pipe can fill."""
    global _process
    with tempfile.TemporaryFile() as log:
        with _lock:
            _check()
            _process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                        creationflags=NO_WINDOW, env=_worker_env())
        process = _process
        started = time.monotonic()
        try:
            while process.poll() is None:
                if _cancel.is_set():
                    raise Cancelled()
                if time.monotonic() - started > timeout:
                    raise VoiceError(f"{failure} It took too long.")
                time.sleep(0.25)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            with _lock:
                _process = None
        _check()
        if process.returncode:
            log.seek(0)
            tail = _last_line(log.read()[-20000:].decode("utf-8", "replace"))
            raise VoiceError(f"{failure} {tail}".strip())


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


def _download(name: str, done_before: int) -> int:
    digest, size = MODELS[name]
    target = models_dir() / name
    part = target.with_name(target.name + ".part")
    opener = urllib.request.build_opener(_HttpsOnly(), urllib.request.HTTPSHandler(context=_context()))
    request = urllib.request.Request(RELEASE + name, headers={"User-Agent": "FormMorpheus"})
    hasher = hashlib.sha256()
    received = 0
    try:
        with opener.open(request, timeout=60) as response, part.open("wb") as out:
            while True:
                _check()
                block = response.read(BLOCK)
                if not block:
                    break
                received += len(block)
                if received > size:
                    raise VoiceError(f"The download of {name} is larger than it should be, so it was not kept.", 502)
                out.write(block)
                hasher.update(block)
                _set(done=done_before + received)
        if received != size or hasher.hexdigest() != digest:
            raise VoiceError(f"The download of {name} did not match its checksum, so it was not kept. Try again.", 502)
        os.replace(part, target)
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise VoiceError(f"Could not download the voice model ({name}). Check the internet connection and try again. "
                         f"{_last_line(str(getattr(exc, 'reason', exc)))}".strip(), 502)
    finally:
        part.unlink(missing_ok=True)
    return received


def _setup() -> None:
    try:
        _set(step="python")
        python = find_python(fresh=True)
        if not python:
            raise VoiceError("The built-in voice needs Python on this computer, and none was found. "
                             "Install Python 3.12 from python.org, then try again.")
        _check()

        _set(step="runtime")
        _forget()
        if not _runtime_works(setup=True):
            try:
                if not runtime_python().is_file():
                    shutil.rmtree(runtime_dir(), ignore_errors=True)
                    folder().mkdir(parents=True, exist_ok=True)
                    _run([python, "-m", "venv", str(runtime_dir())], VENV_TIMEOUT,
                         "Could not make the voice's own Python environment. On Debian or Ubuntu, install the "
                         "python3-venv package and try again.")
                _run([str(runtime_python()), "-m", "pip", "install", "--disable-pip-version-check", "--no-input",
                      PACKAGE], PIP_TIMEOUT,
                     "Could not install the voice's runtime. Check the internet connection and try again.")
            except BaseException:
                # a half-made environment can look installed to pip, so it goes and the next try starts clean
                shutil.rmtree(runtime_dir(), ignore_errors=True)
                raise
            _forget()
            if not _runtime_works(setup=True):
                raise VoiceError("The voice's runtime was installed but does not start. Remove the built-in voice and set it up again.")

        _set(step="model")
        models_dir().mkdir(parents=True, exist_ok=True)
        total = sum(size for _digest, size in MODELS.values())
        done = 0
        _set(done=0, total=total)
        for name, (_digest, size) in MODELS.items():
            path = models_dir() / name
            if path.is_file() and path.stat().st_size == size:
                done += size
                _set(done=done)
                continue
            path.unlink(missing_ok=True)
            done += _download(name, done)
            _set(done=done)
        _forget()
        _set(state="done", error="")
    except Cancelled:
        _forget()
        _set(state="cancelled", error="")
    except VoiceError as exc:
        _forget()
        _set(state="failed", error=str(exc))
    except Exception as exc:   # anything unforeseen still ends the job, so the window stops waiting
        _forget()
        _set(state="failed", error=f"Setting up the built-in voice failed. {_last_line(str(exc))}".strip())


def start_setup() -> dict:
    global _job
    with _lock:
        if _running():
            raise VoiceError("The built-in voice is already being set up.")
        _cancel.clear()
        _job = {"state": "running", "step": "python", "done": 0, "total": 0, "error": ""}
        threading.Thread(target=_setup, name="voice-setup", daemon=True).start()
        return dict(_job)


def cancel() -> bool:
    with _lock:
        if not _running():
            return False
        _cancel.set()
        if _process is not None and _process.poll() is None:
            try:
                _process.kill()
            except OSError:
                pass
        return True


def remove() -> bool:
    global _job
    with _lock:
        if _running():
            raise VoiceError("Wait for the setup to finish or cancel it, then remove the built-in voice.")
        _job = None
    removed = False
    for path in (runtime_dir(), models_dir()):
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
            removed = True
    _forget()
    if runtime_dir().exists() or models_dir().exists():
        raise VoiceError("Some of the built-in voice's files could not be removed. Close anything using them and try again.")
    return removed


# voices and speech


def _require_ready() -> str:
    if _running():
        raise VoiceError("The built-in voice is still being set up.")
    if not (_model_ready() and _runtime_works()):
        raise VoiceError("Set up the built-in voice first.")
    return str(runtime_python())


def _describe(vid: str) -> dict:
    language, group = LANGUAGES.get(vid[:1], ("en-us", "Other"))
    tail = vid.split("_", 1)[1] if "_" in vid else vid
    return {"id": vid, "name": tail[:1].upper() + tail[1:], "language": language, "group": group}


def _order(item: dict) -> tuple:
    group = item["group"]
    rank = FIRST_GROUPS.index(group) if group in FIRST_GROUPS else len(FIRST_GROUPS)
    return (rank, group, item["name"].lower(), item["id"])


def voices() -> list[dict]:
    python = _require_ready()
    path = models_dir() / "voices-v1.0.bin"
    stamp = (str(path), path.stat().st_mtime_ns)
    with _lock:
        if _voices.get("stamp") == stamp:
            return [dict(item) for item in _voices["list"]]
    try:
        done = subprocess.run([python, "-c", LIST_VOICES, str(path)], capture_output=True, text=True, timeout=120,
                              check=False, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW, env=_worker_env())
    except (OSError, subprocess.SubprocessError) as exc:
        raise VoiceError(f"The built-in voice could not list its voices. {_last_line(str(exc))}".strip(), 502)
    try:
        ids = json.loads(done.stdout.strip().splitlines()[-1]) if done.returncode == 0 else None
    except (ValueError, IndexError):
        ids = None
    if not isinstance(ids, list):
        raise VoiceError(f"The built-in voice could not list its voices. {_last_line(done.stderr)}".strip(), 502)
    listed = sorted((_describe(str(vid)) for vid in ids), key=_order)
    with _lock:
        _voices["stamp"] = stamp
        _voices["list"] = listed
    return [dict(item) for item in listed]


_BREAK = re.compile(r"(?<=[.!?])\s+|\s*\n\s*")


def sentences(text: str) -> list[str]:
    """Sentences to speak in order; a fragment under three characters joins its neighbour."""
    pieces = [piece.strip() for piece in _BREAK.split(text or "") if piece and piece.strip()]
    merged: list[str] = []
    for piece in pieces:
        if merged and (len(piece) < 3 or len(merged[-1]) < 3):
            merged[-1] = f"{merged[-1]} {piece}"
        else:
            merged.append(piece)
    return merged


def speak(text: str, voice: str, language: str, speed: float) -> dict:
    python = _require_ready()
    voice = (voice or "").strip() or DEFAULT_VOICE
    known = {item["id"]: item for item in voices()}
    if voice not in known:
        raise VoiceError(f"There is no built-in voice named {voice}.", 422)
    parts = sentences(text)
    if not parts:
        raise VoiceError("There is no text to speak.", 422)
    code = (language or "").strip().lower()
    lang = code if code in ACCEPTED else known[voice]["language"]
    try:
        pace = min(2.0, max(0.5, float(speed)))
    except (TypeError, ValueError):
        pace = 1.0
    folder().mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(prefix=".speak-", suffix=".wav", dir=folder())
    os.close(handle)
    output = Path(name)
    args = {"model": str(models_dir() / "kokoro-v1.0.onnx"), "voices": str(models_dir() / "voices-v1.0.bin"),
            "voice": voice, "language": lang, "speed": pace, "sentences": parts, "pause": PAUSE, "output": str(output)}
    try:
        try:
            done = subprocess.run([python, "-c", WORKER], input=json.dumps(args), capture_output=True, text=True,
                                  encoding="utf-8", errors="replace", timeout=SPEAK_TIMEOUT, check=False,
                                  creationflags=NO_WINDOW, env=_worker_env())
        except subprocess.TimeoutExpired:
            raise VoiceError("The built-in voice took too long. Try a shorter text.", 502)
        except OSError as exc:
            raise VoiceError(f"The built-in voice could not start. {_last_line(str(exc))}".strip(), 502)
        if done.returncode:
            raise VoiceError(f"The built-in voice could not speak this text. {_last_line(done.stderr)}".strip(), 502)
        try:
            report = json.loads(next(line for line in reversed(done.stdout.splitlines()) if line.startswith("{")))
            audio = output.read_bytes()
            with wave.open(str(output), "rb") as sound:
                seconds = sound.getnframes() / float(sound.getframerate())
        except (StopIteration, ValueError, OSError, wave.Error, ZeroDivisionError):
            raise VoiceError(f"The built-in voice did not give back a sound. {_last_line(done.stderr)}".strip(), 502)
    finally:
        output.unlink(missing_ok=True)
    cues = [{"start": float(cue["start"]), "end": float(cue["end"]), "text": str(cue["text"])}
            for cue in report.get("cues") or []]
    return {"audio": audio, "mime": "audio/wav", "seconds": round(seconds, 3), "voice": voice, "cues": cues}
