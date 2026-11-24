import json
import stat
import subprocess

import pytest

from app.services import agent_lookup, agent_programs, claude_code, terminal


@pytest.fixture(autouse=True)
def engine(monkeypatch):
    monkeypatch.setattr(terminal, "engine_url", lambda: "http://127.0.0.1:7000")
    monkeypatch.setitem(agent_programs._cache, "value", None)
    monkeypatch.setitem(agent_programs._cache, "at", 0.0)


def mcp_file(folder):
    return folder / ".agents" / "mcp_config.json"


@pytest.mark.parametrize("kind", ["codex", "cursor", "antigravity"])
def test_the_written_config_is_recognised_as_ours(kind):
    assert agent_programs.ours(kind, agent_programs.config_text(kind))


def test_a_config_with_another_server_or_extra_lines_is_not_ours():
    assert not agent_programs.ours("cursor", json.dumps({"mcpServers": {agent_programs.TAB_ENTRY: {}, "mine": {}}}))
    assert not agent_programs.ours("cursor", "not json")
    assert not agent_programs.ours("codex", agent_programs.config_text("codex") + "model = \"x\"\n")


def test_the_config_carries_the_engine_url_and_the_token_variable_not_a_token():
    text = agent_programs.config_text("cursor")
    entry = json.loads(text)["mcpServers"][agent_programs.TAB_ENTRY]
    assert entry["url"] == "http://127.0.0.1:7000/mcp"
    assert agent_programs.TOKEN_VAR in entry["headers"][claude_code.INAPP_HEADER]


def test_write_config_creates_a_private_file(tmp_path):
    assert agent_programs.write_config("codex", tmp_path)
    path = tmp_path / ".codex" / "config.toml"
    assert path.read_text() == agent_programs.config_text("codex")
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_write_config_leaves_the_persons_own_file_alone(tmp_path):
    path = tmp_path / ".cursor" / "mcp.json"
    path.parent.mkdir()
    path.write_text('{"mcpServers": {"mine": {"url": "x"}}}')
    assert agent_programs.write_config("cursor", tmp_path) is False
    assert path.read_text() == '{"mcpServers": {"mine": {"url": "x"}}}'


def test_write_config_replaces_a_stale_copy_of_its_own(tmp_path, monkeypatch):
    agent_programs.write_config("cursor", tmp_path)
    monkeypatch.setattr(terminal, "engine_url", lambda: "http://127.0.0.1:8111")
    assert agent_programs.write_config("cursor", tmp_path)
    assert "8111" in (tmp_path / ".cursor" / "mcp.json").read_text()


def test_tab_entry_is_added_beside_other_servers_and_removed_only_with_its_token(tmp_path):
    path = mcp_file(tmp_path)
    path.parent.mkdir()
    path.write_text(json.dumps({"mcpServers": {"mine": {"serverUrl": "y"}}, "other": 1}))
    agent_programs.write_tab_entry(tmp_path, "tok-1")
    data = json.loads(path.read_text())
    assert data["mcpServers"][agent_programs.TAB_ENTRY]["headers"] == {claude_code.INAPP_HEADER: "tok-1"}
    assert data["mcpServers"]["mine"] == {"serverUrl": "y"} and data["other"] == 1
    agent_programs.remove_tab_entry(tmp_path, "tok-2")
    assert agent_programs.TAB_ENTRY in json.loads(path.read_text())["mcpServers"]
    agent_programs.remove_tab_entry(tmp_path, "tok-1")
    assert json.loads(path.read_text()) == {"mcpServers": {"mine": {"serverUrl": "y"}}, "other": 1}


def test_a_servers_file_of_the_wrong_shape_is_left_alone(tmp_path):
    path = mcp_file(tmp_path)
    path.parent.mkdir()
    path.write_text("[1, 2]")
    with pytest.raises(OSError):
        agent_programs.write_tab_entry(tmp_path, "tok")
    agent_programs.remove_tab_entry(tmp_path, "tok")
    path.write_text("{broken")
    agent_programs.remove_tab_entry(tmp_path, "tok")
    assert path.read_text() == "{broken"


def test_tab_folder_is_inside_the_data_folder(data_dir):
    folder = agent_programs.tab_folder("antigravity")
    assert folder == data_dir / "agent-tabs" / "antigravity" and folder.is_dir()


def test_signed_in_is_true_when_a_key_is_in_the_environment(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    monkeypatch.setattr(agent_lookup, "run", lambda *a, **k: pytest.fail("must not run"))
    assert agent_programs.claude_signed_in("/x/claude") is True


@pytest.mark.parametrize("stdout, want", [('{"loggedIn": true}', True), ('{"loggedIn": false}', False), ("{}", None), ("nope", None)])
def test_signed_in_reads_the_auth_status_answer(monkeypatch, stdout, want):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    monkeypatch.setattr(claude_code, "child_env", lambda *a, **k: {})
    monkeypatch.setattr(agent_lookup, "run", lambda *a, **k: subprocess.CompletedProcess([], 0, stdout, ""))
    assert agent_programs.claude_signed_in("/x/claude") is want


def test_status_answers_all_four_programs_and_is_kept(monkeypatch):
    calls = []

    def located(kind, fresh=False):
        calls.append(kind)
        state = "runs" if kind == "codex" else "missing"
        return agent_lookup.Found(kind, kind, "/x/" + kind if state == "runs" else None, "path" if state == "runs" else "", state)

    monkeypatch.setattr(claude_code, "located", located)
    got = agent_programs.status()
    assert set(got) == {"claude", "codex", "cursor", "antigravity"}
    assert got["codex"]["installed"] is True and got["cursor"]["installed"] is False
    assert got["claude"]["signedIn"] is None
    agent_programs.status()
    assert len(calls) == 4
    agent_programs.status(fresh=True)
    assert len(calls) == 8


def test_open_tab_refuses_a_program_that_does_not_run(monkeypatch):
    monkeypatch.setattr(claude_code, "usable", lambda kind: agent_lookup.Found(kind, "Codex"))
    monkeypatch.setattr(claude_code, "said", lambda found: "nope")
    with pytest.raises(LookupError):
        agent_programs.open_tab("codex")


def test_open_tab_revokes_the_token_and_entry_when_the_session_fails(data_dir, monkeypatch):
    revoked = []
    monkeypatch.setattr(claude_code, "usable", lambda kind: agent_lookup.Found(kind, "Antigravity", "/x/agy", "path", "runs"))
    monkeypatch.setattr(claude_code, "issue_plain", lambda name: "tok-9")
    monkeypatch.setattr(claude_code, "revoke", revoked.append)
    monkeypatch.setattr(claude_code, "child_env", lambda *a, **k: {})

    def boom(*a, **k):
        raise RuntimeError("no pty")

    monkeypatch.setattr(terminal, "open_session", boom)
    with pytest.raises(RuntimeError):
        agent_programs.open_tab("antigravity")
    assert revoked == ["tok-9"]
    data = json.loads(mcp_file(data_dir / "agent-tabs" / "antigravity").read_text())
    assert agent_programs.TAB_ENTRY not in data["mcpServers"]
