import os
import subprocess
from pathlib import Path

import pytest

from app.services import agent_lookup


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    agent_lookup.forget()
    monkeypatch.setattr(agent_lookup, "shell_path", lambda *a, **k: ([], "your shell (test)"))
    yield
    agent_lookup.forget()


@pytest.fixture
def probe(monkeypatch):
    monkeypatch.setitem(agent_lookup.PROGRAMS, "probe", {"title": "Probe", "names": ("fm-probe-xyz",), "install": "get-probe"})
    return "probe"


def exe(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(0o755)
    return path


def test_short_replaces_the_home_folder_with_a_tilde():
    assert agent_lookup.short("/h/u/bin/x", "/h/u") == "~/bin/x"
    assert agent_lookup.short("/h/u", "/h/u") == "~"


def test_short_leaves_a_sibling_folder_with_the_same_prefix_alone():
    assert agent_lookup.short("/h/user2/x", "/h/u") == "/h/user2/x"
    assert agent_lookup.short("/x/y", "/") == "/x/y"


def test_install_prefers_the_windows_command_only_on_windows():
    spec = agent_lookup.PROGRAMS["claude"]
    assert agent_lookup.install("claude", "win32") == spec["install_windows"]
    assert agent_lookup.install("claude", "linux") == spec["install"]
    assert agent_lookup.install("codex", "win32") == agent_lookup.PROGRAMS["codex"]["install"]


def test_runnable_needs_an_executable_file_except_on_windows(tmp_path):
    plain = tmp_path / "plain"
    plain.write_text("x")
    plain.chmod(0o644)
    assert not agent_lookup.runnable(plain, "linux")
    assert agent_lookup.runnable(plain, "win32")
    assert agent_lookup.runnable(exe(tmp_path / "run"), "linux")
    assert not agent_lookup.runnable(tmp_path, "linux")
    assert not agent_lookup.runnable(tmp_path / "nothing", "win32")


def test_node_version_folders_are_listed_newest_first_by_number(tmp_path):
    home = tmp_path / "home"
    for v in ("v9.0.0", "v18.2.0", "v20.1.0"):
        (home / ".nvm" / "versions" / "node" / v).mkdir(parents=True)
    got = [p for p in agent_lookup.folders("claude", home, {}, "linux") if ".nvm" in str(p)]
    assert [p.parent.name for p in got] == ["v20.1.0", "v18.2.0", "v9.0.0"]
    assert all(p.name == "bin" for p in got)


def test_npm_prefix_adds_bin_on_linux_but_not_on_windows(tmp_path):
    env = {"NPM_CONFIG_PREFIX": str(tmp_path / "npm")}
    assert agent_lookup.folders("codex", tmp_path, env, "linux")[0] == tmp_path / "npm" / "bin"
    assert agent_lookup.folders("codex", tmp_path, env, "win32")[0] == tmp_path / "npm"


def test_folders_hold_no_duplicates_and_end_with_the_system_folders(tmp_path):
    env = {"NPM_CONFIG_PREFIX": str(tmp_path / "p"), "npm_config_prefix": str(tmp_path / "p")}
    got = agent_lookup.folders("claude", tmp_path, env, "darwin")
    assert len(got) == len(set(got))
    assert got[-3:] == agent_lookup.system_folders("darwin")
    assert tmp_path / "Library" / "pnpm" in got
    assert tmp_path / "Library" / "pnpm" not in agent_lookup.folders("claude", tmp_path, {}, "linux")


def test_windows_folders_use_local_and_roaming_roots_and_no_system_folders(tmp_path):
    env = {"LOCALAPPDATA": str(tmp_path / "L"), "APPDATA": str(tmp_path / "R")}
    got = agent_lookup.folders("claude", tmp_path, env, "win32")
    assert tmp_path / "L" / "Programs" / "claude" in got
    assert tmp_path / "R" / "Programs" / "claude" in got
    assert not set(agent_lookup.system_folders("linux")) & set(got)


def test_windows_candidates_try_each_program_ending(tmp_path):
    got = agent_lookup.candidates("codex", tmp_path, {"LOCALAPPDATA": str(tmp_path / "L")}, "win32")
    first = tmp_path / ".local" / "bin"
    assert [first / "codex.exe", first / "codex.cmd", first / "codex.bat"] == [c for c in got if c.parent == first]


def test_windows_search_finds_named_folders_one_and_two_levels_down(tmp_path):
    local = tmp_path / "L"
    (local / "Google" / "Antigravity" / "bin").mkdir(parents=True)
    (local / "agy-tools").mkdir(parents=True)
    (local / "Other" / "stuff").mkdir(parents=True)
    got = {c.parent for c in agent_lookup.candidates("antigravity", tmp_path, {"LOCALAPPDATA": str(local)}, "win32")}
    assert local / "Google" / "Antigravity" in got
    assert local / "agy-tools" in got
    assert local / "Other" / "stuff" not in got


def test_find_uses_a_runnable_setting_first(tmp_path):
    prog = exe(tmp_path / "mine" / "claude")
    found = agent_lookup.find("claude", str(prog), env={"PATH": ""}, home=tmp_path, platform="linux")
    assert (found.path, found.how, found.state) == (str(prog), "setting", "found")


def test_find_records_an_unusable_setting_and_an_empty_one(tmp_path, probe):
    bad = tmp_path / "not-a-program"
    bad.write_text("x")
    one = agent_lookup.find(probe, str(bad), env={"PATH": ""}, home=tmp_path, platform="linux")
    two = agent_lookup.find(probe, "  ", env={"PATH": ""}, home=tmp_path, platform="linux")
    assert one.state == "missing" and str(bad) in one.looked[0]
    assert two.looked[0] == "your setting (empty)"


def test_find_uses_the_override_variable_before_the_path(tmp_path):
    dev = exe(tmp_path / "dev" / "claude")
    other = exe(tmp_path / "onpath" / "claude")
    env = {"FM_DEV_CLAUDE": str(dev), "PATH": str(other.parent)}
    found = agent_lookup.find("claude", None, ("FM_DEV_CLAUDE",), env=env, home=tmp_path, platform="linux")
    assert (found.path, found.how) == (str(dev), "override")


def test_find_on_the_engine_path(tmp_path, probe):
    hit = exe(tmp_path / "bin" / "fm-probe-xyz")
    found = agent_lookup.find(probe, env={"PATH": str(hit.parent)}, home=tmp_path, platform="linux")
    assert (found.path, found.how, found.state) == (str(hit), "path", "found")


def test_find_in_a_known_install_folder_under_home(tmp_path, probe):
    hit = exe(tmp_path / ".local" / "bin" / "fm-probe-xyz")
    found = agent_lookup.find(probe, env={"PATH": ""}, home=tmp_path, platform="linux")
    assert (found.path, found.how) == (str(hit), "folder")


def test_find_falls_back_to_the_shell_path(tmp_path, monkeypatch, probe):
    hit = exe(tmp_path / "shellbin" / "fm-probe-xyz")
    monkeypatch.setattr(agent_lookup, "shell_path", lambda *a, **k: ([str(hit.parent)], "note"))
    found = agent_lookup.find(probe, env={"PATH": ""}, home=tmp_path, platform="linux")
    assert (found.path, found.how) == (str(hit), "shell")


def test_a_missing_program_records_every_place_it_looked(tmp_path, probe):
    found = agent_lookup.find(probe, "", env={"PATH": ""}, home=tmp_path, platform="linux")
    assert found.state == "missing" and found.path is None
    assert found.looked[0] == "your setting (empty)"
    assert found.looked[1] == "PATH (empty)"
    assert "~/.local/bin" in found.looked[2]
    assert found.looked[3] == "your shell (test)"


def test_a_generic_agent_name_outside_its_vendor_folder_is_not_trusted(tmp_path):
    plain = exe(tmp_path / "generic" / "agent")
    vendor = exe(tmp_path / "cursor-cli" / "agent")
    assert agent_lookup._on_path("cursor", str(plain.parent)) is None
    assert agent_lookup._on_path("cursor", str(vendor.parent)) == str(vendor)


def test_start_argv_runs_through_the_login_shell_with_quoting():
    argv = agent_lookup.start_argv(["/opt/my tools/claude", "--version", "it's"], {"SHELL": "/bin/bash"}, "linux")
    assert argv[:3] == ["/bin/bash", "-l", "-c"]
    assert argv[3] == "exec '/opt/my tools/claude' --version 'it'\"'\"'s'"


def test_start_argv_quotes_for_fish_with_backslashes():
    argv = agent_lookup.start_argv(["a b", "it's"], {"SHELL": "/usr/bin/fish"}, "linux")
    assert argv[3] == "exec 'a b' 'it\\'s'"


def test_start_argv_on_windows_puts_the_interpreter_before_a_cmd_only():
    assert agent_lookup.start_argv(["C:\\x\\codex.CMD", "-v"], {"COMSPEC": "C:\\cmd.exe"}, "win32") == ["C:\\cmd.exe", "/c", "C:\\x\\codex.CMD", "-v"]
    assert agent_lookup.start_argv(["C:\\x\\codex.exe"], {}, "win32") == ["C:\\x\\codex.exe"]


def test_shell_path_falls_back_to_login_only_and_is_kept(monkeypatch):
    monkeypatch.undo()
    agent_lookup.forget()
    calls = []

    def ask(shell, flags, env, timeout):
        calls.append(flags)
        return None if "-i" in flags else ["/a", "/b"]

    monkeypatch.setattr(agent_lookup, "_ask_shell", ask)
    path, note = agent_lookup.shell_path({"SHELL": "/bin/zsh"}, 3, platform="linux")
    again, _ = agent_lookup.shell_path({"SHELL": "/bin/zsh"}, 3, platform="linux")
    assert path == again == ["/a", "/b"]
    assert "zsh" in note and "login only" in note
    assert calls == [["-l", "-i"], ["-l"]]


def test_shell_path_with_no_answer_gives_an_empty_list(monkeypatch):
    monkeypatch.undo()
    agent_lookup.forget()
    monkeypatch.setattr(agent_lookup, "_ask_shell", lambda *a: None)
    path, note = agent_lookup.shell_path({"SHELL": "/bin/bash"}, 2, platform="linux")
    assert path == [] and "bash" in note


def test_child_env_orders_path_and_filters_claude_variables(tmp_path, monkeypatch):
    monkeypatch.setattr(agent_lookup, "shell_path", lambda *a, **k: (["/shell/bin", "/prog"], "n"))
    base = {"PATH": "/engine/bin", "CLAUDE_STRAY": "1", "CLAUDE_CONFIG_DIR": "/c", "LD_LIBRARY_PATH": "/frozen", "LD_LIBRARY_PATH_ORIG": "/orig"}
    env = agent_lookup.child_env("/prog/claude", base, {"TOKEN": "t"}, ("/front",), tmp_path / "home", "linux")
    parts = env["PATH"].split(os.pathsep)
    assert parts[:3] == ["/prog", "/front", "/shell/bin"]
    assert parts[-1] == "/engine/bin"
    assert len(parts) == len(set(parts))
    assert "CLAUDE_STRAY" not in env and env["CLAUDE_CONFIG_DIR"] == "/c"
    assert env["LD_LIBRARY_PATH"] == "/orig" and env["TOKEN"] == "t"


def test_child_env_drops_the_library_path_of_a_frozen_engine(tmp_path):
    env = agent_lookup.child_env(None, {"PATH": "", "_MEIPASS2": "x", "LD_LIBRARY_PATH": "/bundle"}, home=tmp_path, platform="linux")
    assert "LD_LIBRARY_PATH" not in env


def fake_run(result, calls):
    def run(cmd, env, timeout=15.0, platform=None):
        calls.append(cmd)
        if isinstance(result, BaseException):
            raise result
        return result
    return run


def test_check_reports_runs_with_the_version_and_keeps_the_answer(tmp_path, monkeypatch):
    prog = exe(tmp_path / "claude")
    calls = []
    monkeypatch.setattr(agent_lookup, "run", fake_run(subprocess.CompletedProcess([], 0, "claude 2.1.3 (Claude Code)\n", ""), calls))
    found = agent_lookup.check(agent_lookup.Found("claude", "Claude Code", str(prog)), env={})
    agent_lookup.check(agent_lookup.Found("claude", "Claude Code", str(prog)), env={})
    assert (found.state, found.version) == ("runs", "2.1.3")
    assert calls == [[str(prog), "--version"]]
    agent_lookup.check(agent_lookup.Found("claude", "Claude Code", str(prog)), env={}, fresh=True)
    assert len(calls) == 2


def test_check_reports_broken_with_the_last_error_line(tmp_path, monkeypatch):
    prog = exe(tmp_path / "codex")
    out = subprocess.CompletedProcess([], 2, "", "warming up\nnode: not found\n\n")
    monkeypatch.setattr(agent_lookup, "run", fake_run(out, []))
    found = agent_lookup.check(agent_lookup.Found("codex", "Codex", str(prog)), env={})
    assert (found.state, found.error, found.version) == ("broken", "node: not found", None)


def test_check_reports_a_silent_failure_by_its_exit_code(tmp_path, monkeypatch):
    prog = exe(tmp_path / "codex")
    monkeypatch.setattr(agent_lookup, "run", fake_run(subprocess.CompletedProcess([], 7, "", ""), []))
    found = agent_lookup.check(agent_lookup.Found("codex", "Codex", str(prog)), env={})
    assert found.state == "broken" and "7" in found.error


def test_check_reports_a_timeout_as_broken(tmp_path, monkeypatch):
    prog = exe(tmp_path / "agy")
    monkeypatch.setattr(agent_lookup, "run", fake_run(subprocess.TimeoutExpired("x", 4), []))
    found = agent_lookup.check(agent_lookup.Found("antigravity", "Antigravity", str(prog)), env={}, timeout=4)
    assert found.state == "broken" and "--version" in found.error


def test_check_leaves_a_missing_program_alone(monkeypatch):
    monkeypatch.setattr(agent_lookup, "run", fake_run(AssertionError("must not run"), []))
    found = agent_lookup.check(agent_lookup.Found("codex", "Codex"))
    assert found.state == "missing"


def test_answer_says_installed_only_when_the_program_runs():
    runs = agent_lookup.Found("codex", "Codex", "/x/codex", "path", "runs", "1.0")
    broken = agent_lookup.Found("codex", "Codex", "/x/codex", "path", "broken", error="bad")
    missing = agent_lookup.Found("codex", "Codex", looked=["PATH (empty)"])
    assert agent_lookup.answer(runs)["installed"] is True
    assert agent_lookup.answer(broken)["installed"] is False and agent_lookup.answer(broken)["finding"] == "broken"
    got = agent_lookup.answer(missing, "npm i codex")
    assert (got["installed"], got["path"], got["finding"], got["looked"]) == (False, None, "missing", ["PATH (empty)"])


def test_sentence_for_a_missing_program_names_the_places_and_the_install_command():
    said = agent_lookup.sentence(agent_lookup.Found("codex", "Codex", looked=["A", "B"]), "npm i codex", "give its path")
    assert said.startswith("Codex")
    assert "A; B" in said and "npm i codex" in said and "give its path" in said
    assert " I" in said.split("A; B.")[1][:3]


def test_sentence_for_a_found_program_gives_the_path_and_how():
    said = agent_lookup.sentence(agent_lookup.Found("codex", "Codex", "/x/codex", "shell", "runs"))
    assert "/x/codex" in said and agent_lookup.HOW["shell"] in said
    broken = agent_lookup.sentence(agent_lookup.Found("codex", "Codex", "/x/codex", "path", "broken", error="E42"))
    assert "E42" in broken
