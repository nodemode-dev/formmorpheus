import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
SCRIPT = BACKEND.parent / "setup" / "api_contract_dump"


def make_repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "setup").mkdir(parents=True)
    (root / "docs").mkdir()
    shutil.copy(SCRIPT, root / "setup" / "api_contract_dump")
    return root


def run(root: Path, tmp_path: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "HOME": str(tmp_path / "home"), "PYTHONPATH": str(BACKEND), "PYTHONDONTWRITEBYTECODE": "1",
           "FORMMORPHEUS_DATA_DIR": str(tmp_path / "data"), "PYTHONIOENCODING": "utf-8"}
    return subprocess.run([sys.executable, str(root / "setup" / "api_contract_dump"), *args], cwd=root, env=env,
                          capture_output=True, text=True, encoding="utf-8", timeout=180)


def test_dump_writes_a_contract_that_check_then_finds_in_step(tmp_path):
    root = make_repo(tmp_path)
    out = root / "docs" / "api-contract.json"
    r = run(root, tmp_path)
    assert r.returncode == 0, r.stderr
    assert "api contract: wrote docs/api-contract.json" in r.stdout
    text = out.read_text("utf-8")
    data = json.loads(text)
    assert list(data) == ["info", "openapi", "paths", "components", "x-websockets"]
    assert data["paths"]
    assert list(data["paths"]) == sorted(data["paths"])
    assert isinstance(data["x-websockets"], list)
    assert data["x-websockets"] == sorted(set(data["x-websockets"]))
    lines = text.splitlines()
    assert len(lines) == len(data["paths"]) + len(data["components"]["schemas"]) + 9
    r = run(root, tmp_path, "--check")
    assert r.returncode == 0
    assert "api contract: in step" in r.stdout


def test_check_reports_a_contract_that_differs_or_is_missing_and_writes_nothing(tmp_path):
    root = make_repo(tmp_path)
    out = root / "docs" / "api-contract.json"
    r = run(root, tmp_path, "--check")
    assert r.returncode == 1
    assert "out of date" in r.stdout
    assert not out.exists()
    out.write_text('{"paths":{}}\n', "utf-8")
    r = run(root, tmp_path, "--check")
    assert r.returncode == 1
    assert "out of date" in r.stdout
    assert out.read_text("utf-8") == '{"paths":{}}\n'
