import os
import tempfile
from pathlib import Path

import pytest

_SESSION = Path(tempfile.mkdtemp(prefix="formmorpheus-tests-"))
os.environ["FORMMORPHEUS_DATA_DIR"] = str(_SESSION / "data")
os.environ["FORMMORPHEUS_DIST"] = str(_SESSION / "no-dist")
for _name in ("FORMMORPHEUS_LIBRARY_DIR", "FORMMORPHEUS_PORTABLE", "FORMMORPHEUS_WINDOW_KEY_STDOUT"):
    os.environ.pop(_name, None)

LOOPBACK = "http://127.0.0.1:9494"


@pytest.fixture
def data_dir(tmp_path, monkeypatch) -> Path:
    path = tmp_path / "data"
    monkeypatch.setenv("FORMMORPHEUS_DATA_DIR", str(path))
    monkeypatch.delenv("FORMMORPHEUS_LIBRARY_DIR", raising=False)
    monkeypatch.delenv("FORMMORPHEUS_PORTABLE", raising=False)
    path.mkdir(parents=True, exist_ok=True)
    return path


@pytest.fixture
def window_headers() -> dict:
    from app.core import window_key

    return {window_key.HEADER: window_key.KEY}


@pytest.fixture
def client(data_dir, window_headers):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, base_url=LOOPBACK, headers=window_headers)


@pytest.fixture
def anon_client(data_dir):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, base_url=LOOPBACK)
