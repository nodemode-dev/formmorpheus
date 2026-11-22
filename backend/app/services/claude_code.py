"""Claude Code in a dock tab, and the in-app token each agent tab gets: a secret good only while its tab is open, which
marks that tab's MCP calls as the person's own. FormDeck 0.46.3's services/claude_code.py with this app's names, without
the Chat run (this app's dock has no Chat tab)."""
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from app.core import config
from app.services import agent_lookup, terminal

OVERRIDES = {"claude": ("FORMMORPHEUS_CLAUDE_BIN",), "codex": ("FORMMORPHEUS_CODEX_BIN",), "cursor": ("FORMMORPHEUS_CURSOR_BIN",), "antigravity": ("FORMMORPHEUS_ANTIGRAVITY_BIN",)}
SHELL_WAIT = 10.0
CHECK_WAIT = 15.0
TOKENS: dict[str, Path | None] = {}
TOKEN_NAMES: dict[str, str] = {}
TOKEN_DIR = "AgentTokens"
INAPP_HEADER = "x-formmorpheus-inapp"
INAPP_NAME = "Claude Code in FormMorpheus"
SERVER_NAME = "formmorpheus_tab"
NOTE = ("You are Claude Code running inside FormMorpheus, the animation studio open on this computer. "
        "Work on the person's movies with the formmorpheus_tab MCP server's tools: start with get_context, list_movies shows the library, "
        "get_movie and get_movie_picture look inside a movie, manage_movie creates, renames, duplicates, deletes and restores, "
        "and export_movie and import_file are carried out by the open window after the person agrees. list_commands shows the rest. "
        "Use the formmorpheus skill when it is available.")
_cache: dict = {"at": 0.0, "value": None}


def child_env(path: str | None = None, extra: dict | None = None) -> dict:
    env = agent_lookup.child_env(path, base=terminal.base_env(), extra=extra, shell_timeout=SHELL_WAIT)
    env.setdefault("ENABLE_TOOL_SEARCH", "false")
    return env


def located(kind: str, fresh: bool = False) -> agent_lookup.Found:
    found = agent_lookup.find(kind, setting=None, override_vars=OVERRIDES.get(kind, ()), shell_timeout=SHELL_WAIT, fresh=fresh)
    return agent_lookup.check(found, child_env(found.path), CHECK_WAIT, fresh)


def usable(kind: str) -> agent_lookup.Found:
    found = located(kind)
    return found if found.state == "runs" else located(kind, fresh=True)


def said(found: agent_lookup.Found) -> str:
    return agent_lookup.sentence(found, agent_lookup.install(found.program))


def info(fresh: bool = False) -> dict:
    if not fresh and _cache["value"] is not None and time.time() - _cache["at"] < 60:
        return _cache["value"]
    found = located("claude", fresh)
    _cache["value"], _cache["at"] = agent_lookup.answer(found, agent_lookup.install("claude")), time.time()
    return _cache["value"]


def issue() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    folder = config.data_dir() / TOKEN_DIR
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = folder / f"mcp-{secrets.token_hex(8)}.json"
    body = json.dumps({"mcpServers": {SERVER_NAME: {"type": "http", "url": terminal.engine_url() + "/mcp", "headers": {INAPP_HEADER: token}}}})
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(body)
    TOKENS[token] = path
    return token, str(path)


def issue_plain(name: str) -> str:
    token = secrets.token_urlsafe(32)
    TOKENS[token] = None
    TOKEN_NAMES[token] = name
    return token


def revoke(token: str) -> None:
    TOKEN_NAMES.pop(token, None)
    path = TOKENS.pop(token, None)
    if path is not None:
        try:
            path.unlink()
        except OSError:
            pass


def revoke_all() -> None:
    for token in list(TOKENS):
        revoke(token)


def sweep() -> None:
    folder = config.data_dir() / TOKEN_DIR
    for stale in folder.glob("mcp-*.json") if folder.is_dir() else []:
        try:
            stale.unlink()
        except OSError:
            pass


def is_inapp(value) -> bool:
    if not isinstance(value, str) or not value:
        return False
    return any(hmac.compare_digest(value.encode("utf-8"), t.encode("utf-8")) for t in list(TOKENS))


def inapp_name(value) -> str:
    if isinstance(value, str) and value:
        for token, name in list(TOKEN_NAMES.items()):
            if hmac.compare_digest(value.encode("utf-8"), token.encode("utf-8")):
                return name
    return INAPP_NAME


def workdir() -> Path:
    raw = (os.environ.get("FORMMORPHEUS_AGENT_DIR") or "").strip()
    folder = Path(raw).expanduser() if raw else config.data_dir() / "Agent"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def tab_argv(path: str, mcp_file: str, prompt: str | None, resume: str | None = None) -> list[str]:
    cmd = [path, "--mcp-config", mcp_file, "--allowedTools", f"mcp__{SERVER_NAME}", "--append-system-prompt", NOTE]
    if resume:
        cmd += ["--resume", resume]
    if prompt:
        cmd.append(prompt)
    return agent_lookup.start_argv(cmd)


def status() -> dict:
    tab = next((s.describe() for s in terminal.SESSIONS.values() if s.kind == "claude" and s.alive), None)
    note = ""
    try:
        folder = str(workdir())
    except OSError as exc:
        folder, note = "", f"The agent folder cannot be created: {exc.strerror or exc}"
    return info(fresh=True) | {"folder": folder, "terminal": tab, "binNote": note}


def open_tab(prompt: str | None = None, cols: int = 100, rows: int = 30, fresh: bool = False, resume: str | None = None) -> dict:
    running = next((s for s in terminal.SESSIONS.values() if s.kind == "claude" and s.alive), None)
    if running is not None and not fresh and not resume:
        if prompt:
            terminal.write(running.id, prompt + "\r")
        return running.describe()
    found = usable("claude")
    if found.state != "runs":
        raise LookupError(said(found))
    title = "Claude Code (resumed)" if resume else "Claude Code"
    token, mcp_file = issue()
    try:
        session = terminal.open_session(str(workdir()), cols, rows, title, tab_argv(found.path, mcp_file, prompt, resume), child_env(found.path), "claude")
    except BaseException:
        revoke(token)
        raise
    session.on_close.append(lambda: revoke(token))
    return session.describe()
