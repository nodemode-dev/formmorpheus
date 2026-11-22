#!/usr/bin/env python3
"""./formmorpheus agents: set up coding agents for FormMorpheus, and keep the agent files in step with the code.

install writes the MCP entries for Claude Code, Codex, Cursor and Antigravity and copies the skill pack where they read it.
sync mirrors .claude/skills to .agents/skills and writes agents/manifest.json from the MCP server's own code; --check
changes nothing and exits 1 when anything is stale. FormDeck 0.46.3's setup/agents.py with this app's names."""
import ast
import hashlib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ["formmorpheus"]
REGISTRY_NAME = "formmorpheus"
MANIFEST = ROOT / "agents" / "manifest.json"
SERVER = ROOT / "backend" / "app" / "routers" / "mcp.py"
AGENTS_ROUTER = ROOT / "backend" / "app" / "routers" / "agents.py"
DOCK_MODULE = ROOT / "frontend" / "src" / "dock"
LOOKUP = ROOT / "backend" / "app" / "services" / "agent_lookup.py"
LOOKUP_HASHES = {"1.0.0": "252ea9bb9419d4990f174f91914f09800497bc69e98f849f5643bbf4217cc3f3", "1.0.1": "62667f9b68b7d101e1896ce617240424e33b7e498c560bc79d45f0ab26c77d51"}
PORT = int(os.environ.get("FORMMORPHEUS_PORT") or 9494)
PY = "python" if os.name == "nt" else "python3"
USAGE = """usage: ./formmorpheus agents install [--dry-run]   set up Claude Code, Codex, Cursor and Antigravity here and in the folder you ran it from
       ./formmorpheus agents sync [--check]       mirror .claude/skills to .agents/skills and write agents/manifest.json"""


def home() -> Path:
    return Path(os.environ.get("HOME") or Path.home())


def caller() -> Path:
    raw = os.environ.get("FORMMORPHEUS_CALLER_DIR")
    return Path(raw).resolve() if raw else ROOT


def entries(portable: bool) -> dict:
    script = "${CLAUDE_PROJECT_DIR:-.}/setup/mcp_stdio.py" if portable else str(ROOT / "setup" / "mcp_stdio.py")
    cursor = "${workspaceFolder}/setup/mcp_stdio.py" if portable else str(ROOT / "setup" / "mcp_stdio.py")
    if portable:
        codex = 'command = "sh"\nargs = ["-c", "exec python3 \\"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/setup/mcp_stdio.py\\""]\n'
    else:
        codex = f"command = {json.dumps(PY)}\nargs = [{json.dumps(str(ROOT / 'setup' / 'mcp_stdio.py'))}]\n"
    return {
        "claude": {"formmorpheus": {"type": "http", "url": f"http://127.0.0.1:{PORT}/mcp"}, "formmorpheus-stdio": {"type": "stdio", "command": PY, "args": [script]}},
        "codex": "[mcp_servers.formmorpheus]\n" + codex + "startup_timeout_sec = 30\ntool_timeout_sec = 900\n",
        "cursor": {"formmorpheus": {"command": PY, "args": [cursor]}},
        "antigravity": {"formmorpheus": {"command": PY, "args": [str(ROOT / "setup" / "mcp_stdio.py")]}},
    }


def antigravity(dry: bool, said: list) -> None:
    said.append("Antigravity:")
    merge_json(home() / ".gemini" / "config" / "mcp_config.json", entries(False)["antigravity"], dry, said)


def _write(path: Path, text: str, dry: bool, said: list) -> None:
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old == text:
        said.append(f"  {path} already set")
        return
    said.append(f"  {'update' if old is not None else 'write'} {path}")
    if dry:
        return
    if path.exists():
        shutil.copy2(path, path.with_name(path.name + time.strftime(".bak-%Y%m%d-%H%M%S")))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def merge_json(path: Path, servers: dict, dry: bool, said: list) -> None:
    data: dict = {}
    if path.exists() and path.read_text(encoding="utf-8").strip():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            said.append(f"  {path} is not valid JSON; left as it is. Add under mcpServers: {json.dumps(servers)}")
            return
    if not isinstance(data, dict):
        said.append(f"  {path} is not a JSON object; left as it is")
        return
    have = data.get("mcpServers") if isinstance(data.get("mcpServers"), dict) else {}
    data["mcpServers"] = {**have, **servers}
    _write(path, json.dumps(data, indent=2) + "\n", dry, said)


def merge_toml(path: Path, block: str, dry: bool, said: list) -> None:
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    found = re.search(r"(?ms)^\[mcp_servers\.formmorpheus\]\s*\n.*?(?=^\[|\Z)", text)
    if found:
        new = text[:found.start()] + block + ("\n" if text[found.end():].strip() else "") + text[found.end():]
    else:
        new = (text.rstrip("\n") + "\n\n" if text.strip() else "") + block
    _write(path, new, dry, said)


def configure(folder: Path, portable: bool, dry: bool, said: list) -> None:
    e = entries(portable)
    said.append(f"{folder}:")
    merge_json(folder / ".mcp.json", e["claude"], dry, said)
    merge_toml(folder / ".codex" / "config.toml", e["codex"], dry, said)
    merge_json(folder / ".cursor" / "mcp.json", e["cursor"], dry, said)


def _files(folder: Path) -> dict:
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()} if folder.is_dir() else {}


def copy_skill(src: Path, to: Path, dry: bool, said: list) -> bool:
    if to.resolve() == src.resolve():
        return False
    if _files(to) == _files(src):
        said.append(f"  {to} already current")
        return False
    said.append(f"  {'not current:' if dry else 'skill ->'} {to}")
    if not dry:
        shutil.rmtree(to, ignore_errors=True)
        to.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, to)
    return True


def skills(targets: list[Path], dry: bool, said: list) -> int:
    said.append("Skills:")
    changed = 0
    for name in SKILLS:
        src = ROOT / ".claude" / "skills" / name
        if not (src / "SKILL.md").is_file():
            said.append(f"  {name} is not in {src.parent} yet; skipped")
            continue
        for t in targets:
            changed += copy_skill(src, t / name, dry, said)
    return changed


def _assigned(tree: ast.Module, name: str) -> ast.expr:
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return node.value
    raise SystemExit(f"agents: {name} is not assigned at the top of the module the manifest reads")


def _calls(tree: ast.Module, name: str, maker: str) -> list[tuple[str, str]]:
    out = []
    for call in _assigned(tree, name).elts:
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == maker and len(call.args) >= 2):
            raise SystemExit(f"agents: every entry of {name} must be a {maker}(name, kind, ...) call")
        out.append((call.args[0].value, call.args[1].value))
    return out


def _names(folder: Path) -> list:
    return sorted(p.name for p in folder.iterdir() if p.is_dir()) if folder.is_dir() else []


def manifest_data() -> dict:
    tree = ast.parse(SERVER.read_text(encoding="utf-8"))
    tools = _calls(tree, "TOOLS", "_tool")
    commands = _calls(tree, "COMMANDS", "_command")
    kinds = {k for _, k in tools + commands}
    if kinds - {"reads", "changes", "asks"}:
        raise SystemExit(f"agents: unknown tool classes {', '.join(sorted(kinds - {'reads', 'changes', 'asks'}))}")
    http = any(isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr == "post" and d.args and isinstance(d.args[0], ast.Constant) and d.args[0].value == "/mcp"
               for fn in tree.body if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) for d in fn.decorator_list)
    dock = ast.parse(AGENTS_ROUTER.read_text(encoding="utf-8"))
    folder = ROOT / ".claude" / "skills"
    return {
        "format": "form-agent-manifest",
        "version": 1,
        "app": REGISTRY_NAME,
        "mcp": {
            "tools": [n for n, _ in tools],
            "read_only": [n for n, k in tools if k == "reads"],
            "approval_gated": [n for n, k in tools if k != "reads"],
            "asks_first": [n for n, k in tools if k == "asks"],
            "commands": [{"id": n, "kind": k} for n, k in commands],
            "versions": [e.value for e in _assigned(tree, "VERSIONS").elts],
            "transports": (["stdio"] if (ROOT / "setup" / "mcp_stdio.py").is_file() else []) + (["http"] if http else []),
        },
        "skills": [{"name": n, "sub_skills": _names(folder / n / "sub-skills")} for n in _names(folder) if (folder / n / "SKILL.md").is_file()],
        "dock": {"present": True, "contract": _assigned(dock, "CONTRACT").value, "tabs": [e.value for e in _assigned(dock, "TABS").elts]},
    }


def manifest(check: bool, said: list) -> int:
    text = json.dumps(manifest_data(), indent=2) + "\n"
    rel = MANIFEST.relative_to(ROOT).as_posix()
    if MANIFEST.exists() and MANIFEST.read_text(encoding="utf-8") == text:
        said.append(f"  {rel} already current")
        return 0
    said.append(f"  {rel} {'is not what sync would write' if check else 'written'}")
    if not check:
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST.write_text(text, encoding="utf-8")
    return 1


def dock_module(said: list, folder: Path = DOCK_MODULE) -> int:
    rel = "frontend/src/dock"
    if not (folder / "MANIFEST.json").is_file():
        said.append(f"  {rel} is not in this copy yet; nothing to check")
        return 0
    listed = json.loads((folder / "MANIFEST.json").read_text(encoding="utf-8"))["files"]
    have = {p.name for p in folder.iterdir() if p.name != "MANIFEST.json"}
    bad = [f"{name} is not the family's file" for name in sorted(have & set(listed)) if hashlib.sha256((folder / name).read_bytes()).hexdigest() != listed[name]]
    bad += [f"{name} is missing" for name in sorted(set(listed) - have)]
    bad += [f"{name} is not in MANIFEST.json" for name in sorted(have - set(listed))]
    for name in sorted(n for n in have if n.endswith(".ts")):
        for spec in re.findall(r"""(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]""", (folder / name).read_text(encoding="utf-8")):
            if not (re.fullmatch(r"\./[\w.-]+", spec) or spec.startswith("@xterm/")):
                bad.append(f"{name} imports {spec} from outside the folder")
    said.extend(f"  {rel}/{line}" for line in bad)
    if not bad:
        said.append(f"  {rel} matches its MANIFEST.json ({len(listed)} files) and imports nothing of the app's")
    return len(bad)


def lookup_problems() -> list[str]:
    rel = LOOKUP.relative_to(ROOT).as_posix()
    try:
        raw = LOOKUP.read_bytes()
    except OSError:
        return [f"{rel}: missing (the shared finder for the agent programs)"]
    said = re.search(rb'^VERSION = "([^"\r\n]+)"\r?$', raw, re.M)
    version = said.group(1).decode("ascii", "replace") if said else "unknown"
    if LOOKUP_HASHES.get(version) != hashlib.sha256(raw).hexdigest():
        return [f"{rel}: does not match the hash recorded for version {version} (the shared finder changes only as a whole new version)"]
    return []


def install(dry: bool) -> int:
    said: list = []
    configure(ROOT, True, dry, said)
    if caller() != ROOT:
        configure(caller(), False, dry, said)
    antigravity(dry, said)
    targets = [home() / ".claude" / "skills", home() / ".agents" / "skills", ROOT / ".agents" / "skills"]
    if caller() != ROOT:
        targets += [caller() / ".claude" / "skills", caller() / ".agents" / "skills"]
    skills(targets, dry, said)
    print(("Would do (dry run):\n" if dry else "") + "\n".join(said))
    if not dry:
        print(f"""
Next:
  1. Start FormMorpheus: ./formmorpheus (the window at http://localhost:5194; the engine at http://127.0.0.1:{PORT}).
  2. Open Claude Code, Codex, Cursor or Antigravity in {caller()} and approve the formmorpheus MCP server.
  3. Ask: "List my movies and export the newest as MP4". The first change asks you in the FormMorpheus window.""")
    return 0


def sync(check: bool) -> int:
    said: list = []
    n = skills([ROOT / ".agents" / "skills"], check, said)
    said.append("Manifest:")
    m = manifest(check, said)
    said.append("Dock module:")
    d = dock_module(said)
    said.append("Agent finder:")
    finder = lookup_problems()
    said.extend(f"  {line}" for line in finder or [f"{LOOKUP.relative_to(ROOT).as_posix()} matches the hash recorded for its version"])
    d += len(finder)
    print("\n".join(said))
    if check:
        print("agents: in step" if n == 0 and m == 0 and d == 0 else "agents: .agents/skills, agents/manifest.json, frontend/src/dock or the agent finder drifted (run ./formmorpheus agents sync; the dock folder and the finder are copied from FormVis, never edited here)")
        return 1 if n or m or d else 0
    print(f"agents: {n} skill cop{'ies' if n != 1 else 'y'} updated, manifest {'written' if m else 'already current'}")
    return 1 if d else 0


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "help"
    rest = argv[1:]
    if cmd == "install":
        return install("--dry-run" in rest)
    if cmd == "sync":
        return sync("--check" in rest)
    print(USAGE)
    return 0 if cmd in ("help", "-h", "--help") else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
