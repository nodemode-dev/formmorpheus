import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "setup" / "lint_text"
EM = chr(0x2014)
TRAILER = "Co-" + "Authored-By: someone <a@b.c>"


def make_repo(tmp_path: Path, banned: str = "Zorblax\n# Quuxware\n") -> Path:
    root = tmp_path / "repo"
    (root / "setup").mkdir(parents=True)
    shutil.copy(SCRIPT, root / "setup" / "lint_text")
    (root / "setup" / "lint_text_banned.txt").write_text(banned, "utf-8")
    return root


def lint(root: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "FM_LINT_WALK": "1", "HOME": str(root), "PYTHONIOENCODING": "utf-8"}
    return subprocess.run([sys.executable, str(root / "setup" / "lint_text")], cwd=root, env=env,
                          capture_output=True, text=True, encoding="utf-8", timeout=60)


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, "utf-8")


def test_a_clean_tree_passes_with_zero_hits(tmp_path):
    root = make_repo(tmp_path)
    write(root, "src/a.txt", "plain words - with a hyphen\n")
    r = lint(root)
    assert r.returncode == 0
    assert r.stdout == ""
    assert "lint_text: 0 hits" in r.stderr


def test_an_em_dash_is_reported_with_file_and_line(tmp_path):
    root = make_repo(tmp_path)
    write(root, "src/notes.txt", "first\nsecond " + EM + " line\n")
    r = lint(root)
    assert r.returncode == 1
    assert "src/notes.txt:2: em dash" in r.stdout
    assert "lint_text: 1 hit" in r.stderr
    assert "1 hits" not in r.stderr


def test_an_emoji_is_reported_with_its_code_point(tmp_path):
    root = make_repo(tmp_path)
    write(root, "a.md", "ok " + chr(0x1F600) + "\n")
    r = lint(root)
    assert r.returncode == 1
    assert "a.md:1: emoji U+1F600" in r.stdout


def test_several_hits_on_one_line_are_all_counted(tmp_path):
    root = make_repo(tmp_path)
    write(root, "b.txt", EM + " " + chr(0x2600) + " zorblax\n")
    r = lint(root)
    assert r.returncode == 1
    assert "b.txt:1: em dash" in r.stdout
    assert "b.txt:1: emoji U+2600" in r.stdout
    assert "b.txt:1: banned name Zorblax" in r.stdout
    assert "lint_text: 3 hits" in r.stderr


def test_an_attribution_trailer_is_reported(tmp_path):
    root = make_repo(tmp_path)
    write(root, "msg.txt", TRAILER + "\n")
    r = lint(root)
    assert r.returncode == 1
    assert "msg.txt:1: commit attribution trailer" in r.stdout


def test_the_rule_docs_may_name_the_attribution_trailer(tmp_path):
    root = make_repo(tmp_path)
    write(root, "CLAUDE.md", "Never add " + TRAILER + "\n")
    write(root, ".docs/wiki/Contributing.md", TRAILER + "\n")
    r = lint(root)
    assert r.returncode == 0, r.stdout


def test_a_banned_name_is_matched_in_any_case_as_a_whole_word(tmp_path):
    root = make_repo(tmp_path)
    write(root, "c.txt", "made in ZORBLAX today\nzorblaxian is fine\nprezorblax too\n")
    r = lint(root)
    assert r.returncode == 1
    assert r.stdout.splitlines() == ["c.txt:1: banned name Zorblax"]


def test_a_commented_line_in_the_banned_list_bans_nothing(tmp_path):
    root = make_repo(tmp_path)
    write(root, "d.txt", "Quuxware is mentioned\n")
    assert lint(root).returncode == 0


def test_a_lower_case_name_after_a_dot_is_a_file_format(tmp_path):
    root = make_repo(tmp_path)
    write(root, "e.txt", "open file.zorblax please\n")
    assert lint(root).returncode == 0


def test_a_capitalised_name_after_a_dot_is_still_reported(tmp_path):
    root = make_repo(tmp_path)
    write(root, "e.txt", "open file.Zorblax please\n")
    r = lint(root)
    assert r.returncode == 1
    assert "e.txt:1: banned name Zorblax" in r.stdout


def test_a_lower_case_name_as_a_whole_plist_string_is_a_file_format(tmp_path):
    root = make_repo(tmp_path)
    write(root, "Info.plist", "<string>zorblax</string>\n<string>zorblax file</string>\n")
    r = lint(root)
    assert r.stdout.splitlines() == ["Info.plist:2: banned name Zorblax"]


def test_skipped_folders_binary_files_and_nul_bytes_are_not_scanned(tmp_path):
    root = make_repo(tmp_path)
    write(root, "node_modules/x/a.txt", EM + "\n")
    write(root, "frontend/dist/b.js", EM + "\n")
    write(root, "img/c.png", EM + "\n")
    (root / "blob.dat").write_bytes(b"\0" + EM.encode("utf-8"))
    write(root, "package-lock.json", EM + "\n")
    r = lint(root)
    assert r.returncode == 0, r.stdout


def test_a_file_that_is_not_utf8_is_skipped(tmp_path):
    root = make_repo(tmp_path)
    (root / "latin.txt").write_bytes(b"caf\xe9 zorblax\n")
    assert lint(root).returncode == 0


def test_hits_are_listed_in_sorted_file_order(tmp_path):
    root = make_repo(tmp_path)
    write(root, "z.txt", EM + "\n")
    write(root, "a/b.txt", EM + "\n")
    write(root, "m.txt", EM + "\n")
    r = lint(root)
    assert [line.split(":")[0] for line in r.stdout.splitlines()] == ["a/b.txt", "m.txt", "z.txt"]
