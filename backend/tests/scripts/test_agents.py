import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "setup" / "agents.py"


@pytest.fixture
def agents(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    spec = importlib.util.spec_from_file_location("agents_script_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "ROOT", tmp_path / "repo")
    return mod


def backups(folder: Path) -> list[Path]:
    return [p for p in folder.iterdir() if ".bak-" in p.name]


def test_merge_json_writes_a_new_file_with_the_servers(agents, tmp_path):
    path = tmp_path / "proj" / ".mcp.json"
    said = []
    agents.merge_json(path, {"fm": {"type": "http"}}, False, said)
    assert json.loads(path.read_text("utf-8")) == {"mcpServers": {"fm": {"type": "http"}}}
    assert said == [f"  write {path}"]


def test_merge_json_keeps_other_servers_and_keys_and_backs_up_the_old_file(agents, tmp_path):
    path = tmp_path / ".mcp.json"
    path.write_text(json.dumps({"theme": "dark", "mcpServers": {"other": {"a": 1}, "fm": {"old": True}}}), "utf-8")
    said = []
    agents.merge_json(path, {"fm": {"new": True}}, False, said)
    data = json.loads(path.read_text("utf-8"))
    assert data == {"theme": "dark", "mcpServers": {"other": {"a": 1}, "fm": {"new": True}}}
    assert said == [f"  update {path}"]
    assert len(backups(tmp_path)) == 1


def test_merge_json_leaves_a_file_that_is_already_set_alone(agents, tmp_path):
    path = tmp_path / "mcp.json"
    agents.merge_json(path, {"fm": {"x": 1}}, False, [])
    before = path.read_text("utf-8")
    said = []
    agents.merge_json(path, {"fm": {"x": 1}}, False, said)
    assert said == [f"  {path} already set"]
    assert path.read_text("utf-8") == before
    assert backups(tmp_path) == []


def test_merge_json_refuses_to_touch_invalid_json(agents, tmp_path):
    path = tmp_path / "mcp.json"
    path.write_text("{broken", "utf-8")
    said = []
    agents.merge_json(path, {"fm": {}}, False, said)
    assert path.read_text("utf-8") == "{broken"
    assert "is not valid JSON" in said[0]


def test_merge_json_refuses_a_file_that_is_not_an_object(agents, tmp_path):
    path = tmp_path / "mcp.json"
    path.write_text("[1, 2]", "utf-8")
    said = []
    agents.merge_json(path, {"fm": {}}, False, said)
    assert path.read_text("utf-8") == "[1, 2]"
    assert "is not a JSON object" in said[0]


def test_merge_json_replaces_a_mcp_servers_value_that_is_not_an_object(agents, tmp_path):
    path = tmp_path / "mcp.json"
    path.write_text(json.dumps({"mcpServers": "nope"}), "utf-8")
    agents.merge_json(path, {"fm": {}}, False, [])
    assert json.loads(path.read_text("utf-8")) == {"mcpServers": {"fm": {}}}


def test_a_dry_run_writes_nothing(agents, tmp_path):
    path = tmp_path / "sub" / "mcp.json"
    said = []
    agents.merge_json(path, {"fm": {}}, True, said)
    assert not path.exists()
    assert said == [f"  write {path}"]


def test_merge_toml_appends_the_block_after_a_blank_line(agents, tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('model = "x"\n\n\n', "utf-8")
    block = "[mcp_servers.formmorpheus]\ncommand = \"py\"\n"
    agents.merge_toml(path, block, False, [])
    assert path.read_text("utf-8") == 'model = "x"\n\n' + block


def test_merge_toml_replaces_only_its_own_block(agents, tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('[a]\nk = 1\n\n[mcp_servers.formmorpheus]\ncommand = "old"\n\n[b]\nk = 2\n', "utf-8")
    block = "[mcp_servers.formmorpheus]\ncommand = \"new\"\n"
    agents.merge_toml(path, block, False, [])
    assert path.read_text("utf-8") == '[a]\nk = 1\n\n[mcp_servers.formmorpheus]\ncommand = "new"\n\n[b]\nk = 2\n'


def test_merge_toml_into_a_missing_file_writes_just_the_block(agents, tmp_path):
    path = tmp_path / ".codex" / "config.toml"
    block = "[mcp_servers.formmorpheus]\n"
    agents.merge_toml(path, block, False, [])
    assert path.read_text("utf-8") == block


def make_skill(root: Path) -> Path:
    src = root / "src" / "skill"
    (src / "refs").mkdir(parents=True)
    (src / "SKILL.md").write_text("skill", "utf-8")
    (src / "refs" / "a.md").write_text("a", "utf-8")
    return src


def test_copy_skill_copies_the_tree_then_reports_it_current(agents, tmp_path):
    src = make_skill(tmp_path)
    to = tmp_path / "dest" / "skill"
    said = []
    assert agents.copy_skill(src, to, False, said) is True
    assert (to / "refs" / "a.md").read_text("utf-8") == "a"
    assert agents.copy_skill(src, to, False, said) is False
    assert said[-1] == f"  {to} already current"


def test_copy_skill_replaces_stale_files(agents, tmp_path):
    src = make_skill(tmp_path)
    to = tmp_path / "dest" / "skill"
    to.mkdir(parents=True)
    (to / "stale.md").write_text("old", "utf-8")
    assert agents.copy_skill(src, to, False, []) is True
    assert not (to / "stale.md").exists()
    assert (to / "SKILL.md").is_file()


def test_copy_skill_dry_run_reports_but_copies_nothing(agents, tmp_path):
    src = make_skill(tmp_path)
    to = tmp_path / "dest" / "skill"
    said = []
    assert agents.copy_skill(src, to, True, said) is True
    assert not to.exists()
    assert said == [f"  not current: {to}"]


def test_copy_skill_onto_itself_does_nothing(agents, tmp_path):
    src = make_skill(tmp_path)
    assert agents.copy_skill(src, src, False, []) is False


def test_skills_skips_a_skill_that_has_no_skill_file(agents, tmp_path):
    said = []
    assert agents.skills([tmp_path / "t"], False, said) == 0
    assert "skipped" in said[-1]
    assert not (tmp_path / "t").exists()
