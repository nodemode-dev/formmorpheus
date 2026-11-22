#!/usr/bin/env python3
"""./formmorpheus mcp: FormMorpheus over MCP's stdio transport, for clients that start a server as a program.

Each line from the client goes to the running engine's /mcp and each answer comes back as one line; notifications get
no answer, and anything that is not protocol goes to stderr. The engine is found at FORMMORPHEUS_MCP_URL, at
FORMMORPHEUS_PORT, or on 9494 (./formmorpheus) or 9496 (the desktop app); when none answers, the engine of this source
copy is started once (FORMMORPHEUS_MCP_AUTOSTART=0 turns that off). FormDeck 0.46.3's setup/mcp_stdio.py with this
app's names."""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORTS = (9494, 9496)
STATE = {"session": None, "version": None, "started": False, "base": None}


def say(text: str) -> None:
    print(f"[formmorpheus mcp] {text}", file=sys.stderr, flush=True)


def ours(base: str, timeout: float = 2) -> bool:
    try:
        with urllib.request.urlopen(base + "/api/health", timeout=timeout) as r:
            return r.status == 200 and json.loads(r.read().decode("utf-8")).get("app") == "formmorpheus"
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        return False


def candidates() -> list[str]:
    url = (os.environ.get("FORMMORPHEUS_MCP_URL") or "").strip()
    if url:
        return [url.rsplit("/mcp", 1)[0]]
    port = (os.environ.get("FORMMORPHEUS_PORT") or "").strip()
    if port and port != "0":
        return [f"http://127.0.0.1:{int(port)}"]
    return [f"http://127.0.0.1:{p}" for p in PORTS]


def base() -> str:
    if STATE["base"] and ours(STATE["base"], 1):
        return STATE["base"]
    found = next((b for b in candidates() if ours(b)), None)
    STATE["base"] = found
    return found or candidates()[0]


def start_engine() -> bool:
    if STATE["started"] or os.environ.get("FORMMORPHEUS_MCP_AUTOSTART", "1") == "0" or os.environ.get("FORMMORPHEUS_MCP_URL"):
        return False
    STATE["started"] = True
    backend = ROOT / "backend"
    py = next((p for p in (backend / "venv" / "bin" / "python", backend / "venv" / "Scripts" / "python.exe") if p.is_file()), None)
    if py is None:
        say("no engine found: run ./formmorpheus install in the FormMorpheus folder, or open the FormMorpheus app")
        return False
    port = candidates()[0].rsplit(":", 1)[1]
    env = dict(os.environ)
    dist = ROOT / "frontend" / "dist"
    if (dist / "index.html").is_file():
        env.setdefault("FORMMORPHEUS_DIST", str(dist))
    env["FORMMORPHEUS_PORT"] = port
    log = open(Path(tempfile.gettempdir()) / "formmorpheus-engine.log", "ab")
    say(f"starting the engine on port {port}; its log: {log.name}")
    kw = {"creationflags": 0x00000008 | 0x00000200} if os.name == "nt" else {"start_new_session": True}
    subprocess.Popen([str(py), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port], cwd=str(backend), env=env,
                     stdin=subprocess.DEVNULL, stdout=log, stderr=log, **kw)
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(0.4)
        if ours(f"http://127.0.0.1:{port}", 1):
            STATE["base"] = f"http://127.0.0.1:{port}"
            return True
    return False


def post(line: str, msg: dict) -> tuple[str, dict]:
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
    version = (params.get("_meta") or {}).get("io.modelcontextprotocol/protocolVersion") or STATE["version"] or params.get("protocolVersion") or "2025-11-25"
    headers = {"Content-Type": "application/json", "Accept": "application/json", "MCP-Protocol-Version": version}
    if STATE["session"] and msg.get("method") != "initialize":
        headers["Mcp-Session-Id"] = STATE["session"]
    req = urllib.request.Request(base() + "/mcp", data=line.encode("utf-8"), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return r.read().decode("utf-8"), dict(r.headers)
    except urllib.error.HTTPError as exc:
        return exc.read().decode("utf-8", "replace"), dict(exc.headers or {})


def forward(line: str) -> str | None:
    try:
        msg = json.loads(line)
    except ValueError:
        return json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
    if not isinstance(msg, dict):
        return json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Batches are not supported"}})
    try:
        body, headers = post(line, msg)
    except (urllib.error.URLError, OSError) as exc:
        say(f"the engine is not answering at {base()}: {exc}")
        if start_engine():
            return forward(line)
        if msg.get("id") is None:
            return None
        return json.dumps({"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32000, "message": "FormMorpheus is not running and could not be started: open the FormMorpheus app or run ./formmorpheus, then retry."}})
    sid = next((v for k, v in headers.items() if k.lower() == "mcp-session-id"), None)
    if sid:
        STATE["session"] = sid
    if msg.get("method") == "initialize":
        try:
            STATE["version"] = json.loads(body)["result"]["protocolVersion"]
        except (ValueError, KeyError, TypeError):
            pass
    if msg.get("id") is None:
        return None
    return body.strip() or None


def main() -> None:
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        if not line.strip():
            continue
        out = forward(line.strip())
        if out:
            sys.stdout.write(out.replace("\n", " ") + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
