import json
import os
import signal
import sys
from types import SimpleNamespace

import pytest

from app.core import startup

ME = os.getpid()
ENGINE = 424242
SHELL = 434343


@pytest.fixture
def procs(monkeypatch):
    table = {}
    monkeypatch.setattr(startup, "alive", lambda pid: pid in table)
    monkeypatch.setattr(startup, "created", lambda pid: table.get(pid, 0.0))
    return table


@pytest.fixture
def ended(monkeypatch):
    calls = []
    outcome = [True]

    def end(pid):
        calls.append(pid)
        return outcome[0]

    monkeypatch.setattr(startup, "end", end)
    return calls, outcome


def test_number_takes_only_positive_whole_numbers():
    assert startup.number(12) == 12
    for bad in (0, -3, True, 1.5, "12", None):
        assert startup.number(bad) == 0


def test_moment_takes_only_positive_numbers():
    assert startup.moment(5) == 5.0
    assert startup.moment(2.5) == 2.5
    for bad in (0, -1, True, "5", None):
        assert startup.moment(bad) == 0.0


def test_read_lock_gives_an_empty_record_for_a_missing_broken_or_odd_file(tmp_path):
    path = tmp_path / startup.LOCK_NAME
    assert startup.read_lock(path) == {}
    path.write_text("{not json", encoding="utf-8")
    assert startup.read_lock(path) == {}
    path.write_text("[1, 2]", encoding="utf-8")
    assert startup.read_lock(path) == {}
    path.write_text('{"pid": 9}', encoding="utf-8")
    assert startup.read_lock(path) == {"pid": 9}


def test_a_pid_of_zero_or_less_is_never_alive_and_has_no_birth():
    assert startup.alive(0) is False
    assert startup.alive(-1) is False
    assert startup.created(0) == 0.0
    assert startup.created(-5) == 0.0


def test_same_needs_a_live_process_born_at_the_recorded_moment(procs):
    procs[ENGINE] = 5000.0
    assert startup.same(ENGINE, 5000.0 + startup.SLACK)
    assert not startup.same(ENGINE, 5000.0 + startup.SLACK + 1)
    assert startup.same(ENGINE, 0.0)
    assert not startup.same(SHELL, 0.0)


def test_an_empty_own_or_dead_lock_is_free(procs):
    assert startup.holder({}, False) == startup.FREE
    assert startup.holder({"pid": "x"}, False) == startup.FREE
    procs[ME] = 1.0
    assert startup.holder({"pid": ME}, False) == startup.FREE
    assert startup.holder({"pid": ENGINE}, False) == startup.FREE


def test_a_live_holder_with_no_dates_is_busy(procs):
    procs[ENGINE] = 5000.0
    assert startup.holder({"pid": ENGINE}, True) == startup.BUSY


def test_a_reused_pid_born_at_another_moment_is_free(procs):
    procs[ENGINE] = 9000.0
    assert startup.holder({"pid": ENGINE, "born": 5000.0}, False) == startup.FREE


def test_an_old_lock_is_judged_by_its_start_time(procs):
    procs[ENGINE] = 5000.0
    assert startup.holder({"pid": ENGINE, "started": 5000 + startup.OLD_SLACK}, False) == startup.BUSY
    assert startup.holder({"pid": ENGINE, "started": 5000 + startup.OLD_SLACK + 1}, False) == startup.FREE
    assert startup.holder({"pid": ENGINE, "started": 5000 - startup.SLACK - 1}, False) == startup.FREE
    procs[ENGINE] = 0.0
    assert startup.holder({"pid": ENGINE, "started": 5000}, False) == startup.FREE


def test_a_lock_without_a_shell_field_is_a_leftover_only_for_a_shelled_start(procs):
    procs[ENGINE] = 5000.0
    lock = {"pid": ENGINE, "born": 5000.0}
    assert startup.holder(lock, True) == startup.LEFTOVER
    assert startup.holder(lock, False) == startup.BUSY


def test_an_engine_started_alone_is_busy(procs):
    procs[ENGINE] = 5000.0
    assert startup.holder({"pid": ENGINE, "born": 5000.0, "shell": 0}, True) == startup.BUSY


def test_an_engine_whose_app_still_runs_is_busy(procs):
    procs[ENGINE] = 5000.0
    procs[SHELL] = 4000.0
    lock = {"pid": ENGINE, "born": 5000.0, "shell": SHELL, "shellBorn": 4000.0}
    assert startup.holder(lock, True) == startup.BUSY


def test_an_engine_whose_app_is_gone_or_replaced_is_a_leftover(procs):
    procs[ENGINE] = 5000.0
    lock = {"pid": ENGINE, "born": 5000.0, "shell": SHELL, "shellBorn": 4000.0}
    assert startup.holder(lock, False) == startup.LEFTOVER
    procs[SHELL] = 8000.0
    assert startup.holder(lock, False) == startup.LEFTOVER


def test_claim_on_an_empty_folder_writes_this_engine_into_the_lock(tmp_path, procs, ended):
    procs[ME] = 7000.0
    procs[SHELL] = 6000.0
    path, replaced = startup.claim(tmp_path, SHELL)
    assert path == tmp_path / startup.LOCK_NAME
    assert replaced == 0
    record = json.loads(path.read_text(encoding="utf-8"))
    assert record["pid"] == ME
    assert record["born"] == 7000.0
    assert record["shell"] == SHELL
    assert record["shellBorn"] == 6000.0
    assert record["started"] == int(startup.STARTED)
    assert [p.name for p in tmp_path.iterdir()] == [startup.LOCK_NAME]
    assert ended[0] == []


def test_claim_refuses_a_folder_a_live_engine_holds(tmp_path, procs, ended):
    procs[ENGINE] = 5000.0
    before = json.dumps({"pid": ENGINE, "born": 5000.0, "shell": 0})
    (tmp_path / startup.LOCK_NAME).write_text(before, encoding="utf-8")
    with pytest.raises(startup.Busy) as refused:
        startup.claim(tmp_path, 0)
    assert str(ENGINE) in str(refused.value)
    assert (tmp_path / startup.LOCK_NAME).read_text(encoding="utf-8") == before
    assert ended[0] == []


def test_claim_takes_over_a_stale_lock_without_ending_anything(tmp_path, procs, ended):
    (tmp_path / startup.LOCK_NAME).write_text(json.dumps({"pid": ENGINE, "born": 5000.0}), encoding="utf-8")
    path, replaced = startup.claim(tmp_path, 0)
    assert replaced == 0
    assert json.loads(path.read_text(encoding="utf-8"))["pid"] == ME
    assert ended[0] == []


def test_claim_ends_a_leftover_engine_and_reports_it(tmp_path, procs, ended):
    procs[ENGINE] = 5000.0
    lock = {"pid": ENGINE, "born": 5000.0, "shell": SHELL, "shellBorn": 4000.0}
    (tmp_path / startup.LOCK_NAME).write_text(json.dumps(lock), encoding="utf-8")
    path, replaced = startup.claim(tmp_path, 0)
    assert replaced == ENGINE
    assert ended[0] == [ENGINE]
    assert json.loads(path.read_text(encoding="utf-8"))["pid"] == ME


def test_claim_refuses_when_a_leftover_engine_will_not_stop(tmp_path, procs, ended):
    procs[ENGINE] = 5000.0
    ended[1][0] = False
    lock = {"pid": ENGINE, "born": 5000.0, "shell": SHELL, "shellBorn": 4000.0}
    (tmp_path / startup.LOCK_NAME).write_text(json.dumps(lock), encoding="utf-8")
    with pytest.raises(startup.Busy):
        startup.claim(tmp_path, 0)
    assert json.loads((tmp_path / startup.LOCK_NAME).read_text(encoding="utf-8")) == lock


def test_shell_pid_reads_only_plain_digits(monkeypatch):
    monkeypatch.delenv(startup.SHELL_ENV, raising=False)
    assert startup.shell_pid() == 0
    monkeypatch.setenv(startup.SHELL_ENV, " 4321 ")
    assert startup.shell_pid() == 4321
    for bad in ("-5", "12abc", "1.5", "", "\u0663"):
        monkeypatch.setenv(startup.SHELL_ENV, bad)
        assert startup.shell_pid() == 0


def test_only_a_packaged_engine_without_a_shell_counts_as_alone(monkeypatch):
    monkeypatch.delenv(startup.SHELL_ENV, raising=False)
    monkeypatch.delenv(startup.ALONE_ENV, raising=False)
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert startup.alone() is False
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert startup.alone() is True
    monkeypatch.setenv(startup.ALONE_ENV, "1")
    assert startup.alone() is False
    monkeypatch.delenv(startup.ALONE_ENV)
    monkeypatch.setenv(startup.SHELL_ENV, "77")
    assert startup.alone() is False


def test_gone_by_is_true_at_once_for_a_dead_process(monkeypatch):
    monkeypatch.setattr(startup, "alive", lambda pid: False)
    assert startup.gone_by(ENGINE, 5.0) is True


def test_gone_by_gives_up_after_the_wait_without_really_sleeping(monkeypatch):
    now = [0.0]
    naps = []

    def nap(seconds):
        naps.append(seconds)
        now[0] += seconds

    monkeypatch.setattr(startup, "alive", lambda pid: True)
    monkeypatch.setattr(startup, "finished", lambda pid: False)
    monkeypatch.setattr(startup, "time", SimpleNamespace(monotonic=lambda: now[0], sleep=nap))
    assert startup.gone_by(ENGINE, 1.0) is False
    assert naps and all(n == startup.STEP for n in naps)


def test_end_asks_politely_first_and_forces_only_when_ignored(monkeypatch):
    sent = []
    waits = iter([False, True])
    monkeypatch.setattr(startup, "WINDOWS", False)
    monkeypatch.setattr(startup.os, "kill", lambda pid, sig: sent.append((pid, sig)))
    monkeypatch.setattr(startup, "gone_by", lambda pid, seconds: next(waits))
    assert startup.end(ENGINE) is True
    assert sent == [(ENGINE, signal.SIGTERM), (ENGINE, signal.SIGKILL)]


def test_end_stops_at_the_polite_signal_when_the_process_leaves(monkeypatch):
    sent = []
    monkeypatch.setattr(startup, "WINDOWS", False)
    monkeypatch.setattr(startup.os, "kill", lambda pid, sig: sent.append((pid, sig)))
    monkeypatch.setattr(startup, "gone_by", lambda pid, seconds: True)
    assert startup.end(ENGINE) is True
    assert sent == [(ENGINE, signal.SIGTERM)]


def test_end_reports_a_process_that_was_already_gone(monkeypatch):
    def kill(pid, sig):
        raise ProcessLookupError(pid)

    monkeypatch.setattr(startup, "WINDOWS", False)
    monkeypatch.setattr(startup.os, "kill", kill)
    monkeypatch.setattr(startup, "gone_by", lambda pid, seconds: True)
    assert startup.end(ENGINE) is True


def test_the_app_beside_the_engine_is_found_one_folder_up(tmp_path, monkeypatch):
    monkeypatch.setattr(startup, "WINDOWS", False)
    engine = tmp_path / "bin" / "engine"
    engine.parent.mkdir()
    engine.write_text("x")
    assert startup.app_beside(engine) is None
    app = tmp_path / "formmorpheus"
    app.write_text("x")
    app.chmod(0o644)
    assert startup.app_beside(engine) is None
    app.chmod(0o755)
    assert startup.app_beside(engine) == app.resolve()


def test_the_engine_never_finds_itself_as_the_app(tmp_path, monkeypatch):
    monkeypatch.setattr(startup, "WINDOWS", False)
    engine = tmp_path / "bin" / "formmorpheus"
    engine.parent.mkdir()
    engine.write_text("x")
    engine.chmod(0o755)
    assert startup.app_beside(engine) is None


def test_errors_are_kept_in_a_file_only_when_stderr_goes_nowhere(tmp_path, monkeypatch):
    monkeypatch.setattr(startup, "STAND_INS", [])
    monkeypatch.setattr(sys, "stderr", SimpleNamespace(name="<stderr>"))
    assert startup.keep_errors(tmp_path) is None
    assert list(tmp_path.iterdir()) == []
    quiet = SimpleNamespace(name=os.devnull)
    monkeypatch.setattr(sys, "stderr", quiet)
    path = startup.keep_errors(tmp_path)
    kept = sys.stderr
    try:
        assert path == tmp_path / startup.ERRORS_NAME
        assert kept is not quiet
        assert startup.STAND_INS == [quiet]
        kept.write("boom\n")
    finally:
        kept.close()
    assert path.read_text(encoding="utf-8") == "boom\n"


def test_an_oversized_error_file_is_started_again_and_a_small_one_is_kept(tmp_path, monkeypatch):
    monkeypatch.setattr(startup, "STAND_INS", [])
    monkeypatch.setattr(startup, "ERRORS_BYTES", 10)
    path = tmp_path / startup.ERRORS_NAME
    path.write_text("old\n", encoding="utf-8")
    monkeypatch.setattr(sys, "stderr", SimpleNamespace(name=os.devnull))
    startup.keep_errors(tmp_path)
    sys.stderr.write("new\n")
    sys.stderr.close()
    assert path.read_text(encoding="utf-8") == "old\nnew\n"
    path.write_text("x" * 50, encoding="utf-8")
    monkeypatch.setattr(sys, "stderr", SimpleNamespace(name=os.devnull))
    startup.keep_errors(tmp_path)
    sys.stderr.write("fresh\n")
    sys.stderr.close()
    assert path.read_text(encoding="utf-8") == "fresh\n"
