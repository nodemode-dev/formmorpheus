import logging
import os
import sys
from pathlib import Path

if sys.stdin is None:
    sys.stdin = open(os.devnull, encoding="utf-8")
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")


def resource_dir() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def selfcheck() -> int:
    from app.main import app  # noqa: F401

    print("formmorpheus engine selfcheck ok")
    return 0


def watch_shell(data) -> None:
    from app.core import runtime, startup

    shell = startup.shell_pid()
    if shell <= 1:
        return

    def leave() -> None:
        logging.getLogger("formmorpheus").info("the app that started this engine is gone (process %s), stopping", shell)
        runtime.release(data)
        os._exit(0)

    startup.watch(shell, leave)


def free_port() -> int:
    import socket

    asked = int(os.environ.get("FORMMORPHEUS_PORT", "0") or 0)
    if asked:
        return asked
    prefer = int(os.environ.get("FORMMORPHEUS_PORT_PREFER", "0") or 0)
    for want in ([prefer] if prefer else []) + [0]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", want))
            except OSError:
                continue
            return probe.getsockname()[1]
    return 0


def serve() -> int:
    bundled = os.path.join(resource_dir(), "frontend_dist")
    if os.path.isdir(bundled):
        os.environ.setdefault("FORMMORPHEUS_DIST", bundled)
    os.environ.setdefault("FORMMORPHEUS_DESKTOP", "1")
    from app.core import config, runtime, startup

    try:
        data = config.data_dir()
        logs = runtime.start_logging(data).parent
    except OSError as err:
        print(f"formmorpheus cannot use its data folder: {err}", file=sys.stderr)
        return 5
    startup.keep_errors(logs)
    log = logging.getLogger("formmorpheus")
    if startup.alone():
        beside = startup.app_beside(Path(sys.executable))
        if beside is not None and startup.open_app(beside):
            log.info("started without its app, so it opened %s and stopped", beside)
            return 0
        log.error("started without its app, and no app program was found near %s", sys.executable)
        print("formmorpheus-engine is a part of FormMorpheus and serves nothing on its own. Open FormMorpheus instead.", file=sys.stderr)
        return 4
    try:
        runtime.claim(data)
    except runtime.AlreadyRunning as err:
        log.error("%s", err)
        print(err, file=sys.stderr)
        return 2
    watch_shell(data)
    import signal

    import uvicorn

    from app.main import app as fastapi_app

    port = free_port()
    os.environ["FORMMORPHEUS_PORT"] = str(port)
    server = uvicorn.Server(uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="info", timeout_graceful_shutdown=3))
    runtime.start_logging(data)

    def leave(_signum, _frame) -> None:
        runtime.release(data)
        os._exit(0)

    signal.signal(signal.SIGTERM, leave)
    try:
        server.run()
    finally:
        runtime.release(data)
    return 0 if server.started else 3


def main() -> int:
    if "--selfcheck" in sys.argv:
        return selfcheck()
    try:
        return serve()
    except Exception:
        logging.getLogger("formmorpheus").exception("the engine stopped on an error")
        raise


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    sys.exit(main())
