import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "setup" / "api_contract_check"


def load():
    loader = importlib.machinery.SourceFileLoader("api_contract_check_under_test", str(SCRIPT))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def make_repo(tmp_path: Path, contract: dict | None, swift: dict[str, str]) -> Path:
    root = tmp_path / "repo"
    (root / "setup").mkdir(parents=True)
    shutil.copy(SCRIPT, root / "setup" / "api_contract_check")
    if contract is not None:
        (root / "docs").mkdir()
        (root / "docs" / "api-contract.json").write_text(json.dumps(contract), "utf-8")
    for rel, text in swift.items():
        p = root / "ios" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, "utf-8")
    return root


def run(root: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "HOME": str(root), "PYTHONIOENCODING": "utf-8"}
    return subprocess.run([sys.executable, str(root / "setup" / "api_contract_check")], cwd=root, env=env,
                          capture_output=True, text=True, encoding="utf-8", timeout=60)


def section(out: str, title: str) -> list[str]:
    lines = out.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(title))
    rows = []
    for line in lines[start + 1:]:
        if not line.strip():
            break
        rows.append(" ".join(line.split()))
    return rows


CONTRACT = {
    "info": {"title": "Engine", "version": "9.9.9-test"},
    "paths": {
        "/api/library/{name}": {"get": {}, "delete": {}, "parameters": []},
        "/api/jobs/{job_id}/audio": {"post": {}},
        "/api/penlink/start": {"post": {}},
        "/api/library/{name}/copy-to": {"post": {}},
        "/api/health": {"get": {}},
    },
    "x-websockets": ["/api/agent/ws/{id}"],
}

SWIFT = {
    "Engine/Library.swift": 'table.add("GET", "/library/{name}")\ntable.add( "POST" , "/extra/thing")\n',
    "Export/Jobs.swift": 'let prefix = "/jobs"\nif rest[1] == "audio" && method == "POST" {}\n',
}


def test_a_missing_contract_is_reported_and_still_exits_zero(tmp_path):
    r = run(make_repo(tmp_path, None, {}))
    assert r.returncode == 0
    assert "docs/api-contract.json is missing" in r.stdout


def test_the_header_counts_routes_sockets_and_swift_files(tmp_path):
    r = run(make_repo(tmp_path, CONTRACT, SWIFT))
    assert r.returncode == 0
    assert "contract Engine 9.9.9-test: 6 routes, 1 sockets" in r.stdout
    assert "scanned 2 Swift files in ios/Engine and ios/Export: 2 exact routes, 1 hand-parsed groups" in r.stdout


def test_routes_are_split_into_served_guessed_required_and_desktop_only(tmp_path):
    out = run(make_repo(tmp_path, CONTRACT, SWIFT)).stdout
    assert section(out, "REQUIRED routes") == ["DELETE /api/library/{}", "GET /api/health"]
    assert section(out, "DESKTOP-ONLY routes the iPad engine does not serve") == [
        "POST /api/penlink/start", "POST /api/library/{}/copy-to"]
    assert section(out, "Served by hand-parsed groups") == ["~ POST /api/jobs/{}/audio"]
    assert section(out, "DESKTOP-ONLY sockets") == ["WS /api/agent/ws/{}"]
    assert "summary: served 1 exact + 1 heuristic of 6; required missing 2; desktop-only missing 2" in out


def test_routes_the_ipad_has_beyond_the_contract_are_listed(tmp_path):
    out = run(make_repo(tmp_path, CONTRACT, SWIFT)).stdout
    assert section(out, "Routes the iPad engine has that the contract does not list") == ["POST /api/extra/thing"]


def test_a_desktop_only_route_the_ipad_serves_anyway_is_listed(tmp_path):
    swift = {"Engine/Pen.swift": 'table.add("POST", "/penlink/start")\n'}
    out = run(make_repo(tmp_path, CONTRACT, swift)).stdout
    assert section(out, "Desktop-only routes the iPad engine serves anyway") == ["POST /api/penlink/start"]
    assert section(out, "DESKTOP-ONLY routes the iPad engine does not serve") == ["POST /api/library/{}/copy-to"]


def test_the_heuristic_needs_the_method_and_every_literal_segment(tmp_path):
    swift = {"Export/Jobs.swift": 'let prefix = "/jobs"\nif method == "GET" && rest[1] == "audio" {}\n'}
    out = run(make_repo(tmp_path, CONTRACT, swift)).stdout
    assert "POST /api/jobs/{}/audio" in " ".join(section(out, "REQUIRED routes"))
    assert section(out, "Served by hand-parsed groups") == []


def test_a_file_with_exact_adds_is_not_treated_as_hand_parsed(tmp_path):
    swift = {"Export/Jobs.swift": 'let prefix = "/jobs"\ntable.add("GET", "/other")\n"audio" "POST"\n'}
    out = run(make_repo(tmp_path, CONTRACT, swift)).stdout
    assert section(out, "Served by hand-parsed groups") == []
    assert "0 hand-parsed groups" in out


def test_norm_collapses_parameters_and_trailing_slashes():
    mod = load()
    assert mod.norm("/api/library/{name}/copy-to/") == "/api/library/{}/copy-to"
    assert mod.norm("/") == "/"
    assert mod.norm("") == "/"
    assert mod.norm("/a/{x}/{y}") == "/a/{}/{}"


def test_desktop_only_wildcards_match_the_prefix_and_below_but_not_neighbours():
    mod = load()
    assert mod.is_desktop_only("GET", "/api/penlink")
    assert mod.is_desktop_only("POST", "/api/penlink/a/b")
    assert not mod.is_desktop_only("GET", "/api/penlinker")
    assert mod.is_desktop_only("GET", "/mcp")
    assert not mod.is_desktop_only("GET", "/mcp/sub")
    assert mod.is_desktop_only("POST", "/api/library/{}/copy-to")
    assert not mod.is_desktop_only("POST", "/api/library/{}")
    assert not mod.is_desktop_only("GET", "/api/health")
