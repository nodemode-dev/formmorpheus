import json
import stat
from pathlib import Path

import pytest

from app.core import config
from app.services import claude_code, terminal


@pytest.fixture
def tokens(data_dir, monkeypatch):
    monkeypatch.setattr(claude_code, "TOKENS", {})
    monkeypatch.setattr(claude_code, "TOKEN_NAMES", {})
    monkeypatch.setattr(terminal, "_port", [0])
    monkeypatch.setenv("FORMMORPHEUS_PORT", "5123")


def test_an_issued_token_writes_a_private_mcp_config_and_is_recognised(tokens):
    token, path = claude_code.issue()
    p = Path(path)
    assert p.parent == config.data_dir() / claude_code.TOKEN_DIR
    assert stat.S_IMODE(p.stat().st_mode) == 0o600
    server = json.loads(p.read_text("utf-8"))["mcpServers"][claude_code.SERVER_NAME]
    assert server["url"] == "http://127.0.0.1:5123/mcp"
    assert server["headers"][claude_code.INAPP_HEADER] == token
    assert claude_code.is_inapp(token) is True


def test_revoking_a_token_deletes_its_file_and_stops_recognising_it(tokens):
    token, path = claude_code.issue()
    claude_code.revoke(token)
    assert not Path(path).exists()
    assert claude_code.is_inapp(token) is False
    claude_code.revoke(token)


@pytest.mark.parametrize("value", [None, "", 42, "not-a-token"])
def test_anything_but_an_issued_token_is_not_in_app(tokens, value):
    claude_code.issue_plain("Tab")
    assert claude_code.is_inapp(value) is False


def test_a_plain_token_carries_its_tab_name(tokens):
    token = claude_code.issue_plain("Helper tab")
    assert claude_code.is_inapp(token) is True
    assert claude_code.inapp_name(token) == "Helper tab"
    assert claude_code.inapp_name("someone-else") == claude_code.INAPP_NAME
    assert claude_code.inapp_name(None) == claude_code.INAPP_NAME


def test_revoke_all_forgets_every_token(tokens):
    a, pa = claude_code.issue()
    b = claude_code.issue_plain("x")
    claude_code.revoke_all()
    assert claude_code.TOKENS == {}
    assert not Path(pa).exists()
    assert not claude_code.is_inapp(a) and not claude_code.is_inapp(b)


def test_the_startup_sweep_removes_only_stale_token_files(tokens):
    folder = config.data_dir() / claude_code.TOKEN_DIR
    folder.mkdir(parents=True)
    (folder / "mcp-old.json").write_text("{}")
    (folder / "keep.txt").write_text("x")
    claude_code.sweep()
    assert sorted(p.name for p in folder.iterdir()) == ["keep.txt"]


def test_the_sweep_tolerates_a_missing_folder(tokens):
    claude_code.sweep()
    assert not (config.data_dir() / claude_code.TOKEN_DIR).exists()


def test_the_agent_folder_follows_the_environment_override(tokens, tmp_path, monkeypatch):
    monkeypatch.setenv("FORMMORPHEUS_AGENT_DIR", str(tmp_path / "agents"))
    assert claude_code.workdir() == tmp_path / "agents"
    assert (tmp_path / "agents").is_dir()
    monkeypatch.delenv("FORMMORPHEUS_AGENT_DIR")
    assert claude_code.workdir() == config.data_dir() / "Agent"


def test_the_engine_url_prefers_the_environment_then_the_heard_port(tokens, monkeypatch):
    assert terminal.engine_url() == "http://127.0.0.1:5123"
    monkeypatch.delenv("FORMMORPHEUS_PORT")
    terminal.heard_on(7001)
    assert terminal.engine_url() == "http://127.0.0.1:7001"
    terminal.heard_on(-1)
    terminal.heard_on("8000")
    assert terminal.engine_url() == "http://127.0.0.1:7001"


def test_scrollback_drops_the_oldest_text_past_the_cap(monkeypatch):
    monkeypatch.setattr(terminal, "SCROLLBACK", 10)
    s = terminal.Session("id", "t", "/", [], {}, "shell")
    for part in ("aaaa", "bbbb", "cccc", "dddd"):
        s.keep(part)
    assert s.scrollback() == "ccccdddd"
    assert s.size == 8


def test_scrollback_keeps_a_single_chunk_larger_than_the_cap(monkeypatch):
    monkeypatch.setattr(terminal, "SCROLLBACK", 4)
    s = terminal.Session("id", "t", "/", [], {}, "shell")
    s.keep("x" * 50)
    assert s.scrollback() == "x" * 50
