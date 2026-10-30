import os
import sys


def resource_dir() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def selfcheck() -> int:
    from app.main import app  # noqa: F401

    print("formmorpheus engine selfcheck ok")
    return 0


def main() -> int:
    if "--selfcheck" in sys.argv:
        return selfcheck()
    bundled = os.path.join(resource_dir(), "frontend_dist")
    if os.path.isdir(bundled):
        os.environ.setdefault("FORMMORPHEUS_DIST", bundled)
    os.environ.setdefault("FORMMORPHEUS_DESKTOP", "1")
    import uvicorn

    from app.main import app as fastapi_app

    port = int(os.environ.get("FORMMORPHEUS_PORT", "0") or 0)
    server = uvicorn.Server(uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="info", timeout_graceful_shutdown=3))
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
