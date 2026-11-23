import os

from app.core import partsweep

NOW = 2_000_000_000.0


def make(path, age):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    os.utime(path, (NOW - age, NOW - age))
    return path


def test_an_old_part_file_is_swept_and_a_young_one_is_kept(tmp_path):
    old = make(tmp_path / "Library" / "deep" / ".scene.fmo.12.part", partsweep.MIN_AGE_SECONDS + 5)
    young = make(tmp_path / ".settings.json.9.part", partsweep.MIN_AGE_SECONDS - 5)
    assert partsweep.sweep(tmp_path, NOW) == 1
    assert not old.exists()
    assert young.exists()


def test_real_files_are_never_swept_however_old(tmp_path):
    kept = [
        make(tmp_path / "settings.json", 10**7),
        make(tmp_path / "visible.part", 10**7),
        make(tmp_path / ".hidden", 10**7),
        make(tmp_path / "Library" / "scene.fmo", 10**7),
    ]
    assert partsweep.sweep(tmp_path, NOW) == 0
    assert all(p.exists() for p in kept)


def test_the_jobs_folder_is_left_to_its_own_sweep(tmp_path):
    job = make(tmp_path / "Jobs" / "a" / ".frame.part", 10**6)
    assert partsweep.sweep(tmp_path, NOW) == 0
    assert job.exists()


def test_recovery_snapshots_go_after_a_month_and_not_before(tmp_path):
    month = 30 * 86400
    old = make(tmp_path / "Recovery" / "old.fmo", month + 60)
    young = make(tmp_path / "Recovery" / "young.fmo", month - 60)
    hidden = make(tmp_path / "Recovery" / ".index", month + 60)
    nested = make(tmp_path / "Recovery" / "sub" / "old.fmo", month + 60)
    assert partsweep.sweep(tmp_path, NOW) == 1
    assert not old.exists()
    assert young.exists() and hidden.exists() and nested.exists()


def test_the_count_adds_part_files_and_snapshots(tmp_path):
    make(tmp_path / ".a.part", 7200)
    make(tmp_path / "Exports" / ".b.part", 7200)
    make(tmp_path / "Recovery" / "gone.fmo", 40 * 86400)
    assert partsweep.sweep(tmp_path, NOW) == 3


def test_an_empty_or_missing_folder_sweeps_nothing(tmp_path):
    assert partsweep.sweep(tmp_path, NOW) == 0
    assert partsweep.sweep(tmp_path / "absent", NOW) == 0


def test_the_data_folder_is_swept_by_default(data_dir):
    old = make(data_dir / ".x.part", 10**6)
    os.utime(old, (1000, 1000))
    assert partsweep.sweep() == 1
    assert not old.exists()
