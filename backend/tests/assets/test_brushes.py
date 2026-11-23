import io
import json
import zipfile

import pytest

B = "/api/brushes"


def _zip(meta=None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("brush.xml", "<brush/>")
        if meta is not None:
            z.writestr("formmorpheus/brush.json", json.dumps(meta))
    return buf.getvalue()


def _lib_set(client, lib="Mine", s="Basic"):
    assert client.post(f"{B}/dir", json={"lib": lib}).status_code == 200
    assert client.post(f"{B}/dir", json={"lib": lib, "set": s}).status_code == 200


def _put(client, data, lib="Mine", s="Basic", file="Soft.brush", **extra):
    return client.put(f"{B}/file", params={"lib": lib, "set": s, "file": file, **extra}, content=data)


def test_an_empty_folder_is_fresh_with_no_libraries(client):
    tree = client.get(f"{B}/tree").json()
    assert tree["fresh"] is True
    assert tree["libs"] == []
    assert tree["legacy"] is False
    assert tree["active"] is None


def test_a_made_library_and_set_appear_in_the_tree_with_slug_ids(client):
    _lib_set(client, "My Pens", "Ink Set")
    libs = client.get(f"{B}/tree").json()["libs"]
    assert libs[0]["id"] == "my-pens"
    assert libs[0]["dir"] == "My Pens"
    assert libs[0]["sets"][0]["id"] == "ink-set"
    assert libs[0]["sets"][0]["files"] == []


def test_sets_in_the_animation_library_get_the_anim_prefix_and_clashing_ids_are_numbered(client):
    _lib_set(client, "Animation", "Basic")
    _lib_set(client, "Other", "Basic")
    libs = {lib["id"]: lib for lib in client.get(f"{B}/tree").json()["libs"]}
    assert libs["animation"]["sets"][0]["id"] == "anim-basic"
    assert libs["other"]["sets"][0]["id"] == "basic"


def test_two_sets_with_the_same_slug_get_distinct_ids(client):
    _lib_set(client, "A", "Basic")
    _lib_set(client, "B", "basic!")
    ids = [s["id"] for lib in client.get(f"{B}/tree").json()["libs"] for s in lib["sets"]]
    assert sorted(ids) == ["basic", "basic-2"]


def test_a_set_in_a_missing_library_is_refused(client):
    r = client.post(f"{B}/dir", json={"lib": "Nowhere", "set": "Basic"})
    assert r.status_code == 404


@pytest.mark.parametrize("name", ["..", ".hidden", "a/b", "a\\b", "trailing.", " padded", "CON", "lpt1.txt", "x" * 121, ""])
def test_unusable_library_names_are_refused(client, data_dir, name):
    r = client.post(f"{B}/dir", json={"lib": name})
    assert r.status_code == 400
    assert not any(p.is_dir() for p in (data_dir / "Brushes").iterdir())


def test_a_library_differing_only_by_case_is_refused(client):
    assert client.post(f"{B}/dir", json={"lib": "Mine"}).status_code == 200
    assert client.post(f"{B}/dir", json={"lib": "mine"}).status_code == 409


def test_a_brush_file_round_trips_byte_for_byte(client):
    _lib_set(client)
    data = _zip({"name": "Soft"})
    r = _put(client, data)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "bytes": len(data)}
    got = client.get(f"{B}/file", params={"lib": "Mine", "set": "Basic", "file": "Soft.brush"})
    assert got.status_code == 200
    assert got.content == data


def test_the_tree_carries_the_sidecar_of_each_brush_and_none_for_a_foreign_zip(client):
    _lib_set(client)
    _put(client, _zip({"name": "Soft", "size": 12}), file="A.brush")
    _put(client, _zip(), file="B.brush")
    files = client.get(f"{B}/tree").json()["libs"][0]["sets"][0]["files"]
    assert files == [{"file": "A.brush", "meta": {"name": "Soft", "size": 12}}, {"file": "B.brush", "meta": None}]


def test_a_body_that_is_not_a_zip_is_refused(client, data_dir):
    _lib_set(client)
    r = _put(client, b"not a zip at all")
    assert r.status_code == 400
    assert list((data_dir / "Brushes" / "Mine" / "Basic").iterdir()) == []


@pytest.mark.parametrize("file", ["Soft.zip", "Soft", "..brush", ".brush", "a/b.brush"])
def test_brush_file_names_without_the_extension_or_with_a_bad_stem_are_refused(client, file):
    _lib_set(client)
    assert _put(client, _zip(), file=file).status_code == 400


def test_an_existing_brush_is_kept_unless_replace_is_asked(client):
    _lib_set(client)
    first, second = _zip({"v": 1}), _zip({"v": 2})
    _put(client, first)
    assert _put(client, second).status_code == 409
    params = {"lib": "Mine", "set": "Basic", "file": "Soft.brush"}
    assert client.get(f"{B}/file", params=params).content == first
    assert _put(client, second, replace="true").status_code == 200
    assert client.get(f"{B}/file", params=params).content == second


def test_reading_a_missing_brush_is_not_found(client):
    _lib_set(client)
    r = client.get(f"{B}/file", params={"lib": "Mine", "set": "Basic", "file": "Ghost.brush"})
    assert r.status_code == 404


def test_writing_into_a_missing_set_is_not_found(client):
    _lib_set(client)
    assert _put(client, _zip(), s="Missing").status_code == 404


def test_deleting_a_brush_removes_its_file(client, data_dir):
    _lib_set(client)
    _put(client, _zip())
    r = client.delete(f"{B}/item", params={"kind": "brush", "lib": "Mine", "set": "Basic", "file": "Soft.brush"})
    assert r.json() == {"ok": True, "kept": False}
    assert not (data_dir / "Brushes" / "Mine" / "Basic" / "Soft.brush").exists()


def test_deleting_a_library_removes_managed_files_but_keeps_a_folder_with_foreign_files(client, data_dir):
    _lib_set(client, "Mine", "Basic")
    _lib_set(client, "Kept", "Basic")
    _put(client, _zip(), lib="Mine")
    _put(client, _zip(), lib="Kept")
    (data_dir / "Brushes" / "Kept" / "Basic" / "notes.txt").write_text("mine")
    assert client.delete(f"{B}/item", params={"kind": "lib", "lib": "Mine"}).json() == {"ok": True, "kept": False}
    assert not (data_dir / "Brushes" / "Mine").exists()
    assert client.delete(f"{B}/item", params={"kind": "lib", "lib": "Kept"}).json() == {"ok": True, "kept": True}
    assert (data_dir / "Brushes" / "Kept" / "Basic" / "notes.txt").is_file()
    assert not (data_dir / "Brushes" / "Kept" / "Basic" / "Soft.brush").exists()


def test_renaming_a_brush_moves_its_bytes_to_the_new_name(client):
    _lib_set(client)
    data = _zip({"v": 1})
    _put(client, data)
    r = client.post(f"{B}/rename", json={"kind": "brush", "lib": "Mine", "set": "Basic", "file": "Soft.brush", "to": "Hard.brush"})
    assert r.status_code == 200
    params = {"lib": "Mine", "set": "Basic"}
    assert client.get(f"{B}/file", params={**params, "file": "Hard.brush"}).content == data
    assert client.get(f"{B}/file", params={**params, "file": "Soft.brush"}).status_code == 404


def test_a_rename_without_a_new_name_is_refused(client):
    _lib_set(client)
    assert client.post(f"{B}/rename", json={"kind": "lib", "lib": "Mine"}).status_code == 400


def test_moving_a_brush_onto_an_existing_one_is_refused(client):
    _lib_set(client)
    _put(client, _zip(), file="A.brush")
    _put(client, _zip(), file="B.brush")
    r = client.post(f"{B}/move", json={"kind": "brush", "lib": "Mine", "set": "Basic", "file": "A.brush", "to": "B.brush"})
    assert r.status_code == 409


def test_moving_a_brush_to_another_set(client):
    _lib_set(client, "Mine", "Basic")
    _lib_set(client, "Other", "Inks")
    data = _zip({"v": 3})
    _put(client, data)
    body = {"kind": "brush", "lib": "Mine", "set": "Basic", "file": "Soft.brush", "toLib": "Other", "toSet": "Inks"}
    assert client.post(f"{B}/move", json=body).status_code == 200
    assert client.get(f"{B}/file", params={"lib": "Other", "set": "Inks", "file": "Soft.brush"}).content == data


def test_renaming_a_library_to_its_own_name_is_unchanged(client):
    _lib_set(client)
    r = client.post(f"{B}/rename", json={"kind": "lib", "lib": "Mine", "to": "Mine"})
    assert r.json() == {"ok": True, "unchanged": True}


def test_the_root_order_sets_active_deleted_and_library_order(client):
    _lib_set(client, "Alpha", "S")
    _lib_set(client, "Beta", "S")
    body = {
        "level": "root",
        "items": [{"id": "b-id", "dir": "Beta"}, {"id": "a-id", "dir": "Alpha"}],
        "active": "b-id",
        "deleted": ["gone", "gone", "", "x" * 201, "other"],
    }
    assert client.put(f"{B}/order", json=body).status_code == 200
    tree = client.get(f"{B}/tree").json()
    assert tree["fresh"] is False
    assert tree["active"] == "b-id"
    assert tree["deleted"] == ["gone", "other"]
    assert [(lib["id"], lib["dir"]) for lib in tree["libs"]] == [("b-id", "Beta"), ("a-id", "Alpha")]


def test_a_set_order_keeps_brush_ids_once_each(client):
    _lib_set(client)
    body = {"level": "set", "lib": "Mine", "set": "Basic", "ids": ["one", "two", "one", ""]}
    assert client.put(f"{B}/order", json=body).status_code == 200
    assert client.get(f"{B}/tree").json()["libs"][0]["sets"][0]["ids"] == ["one", "two"]


def test_an_order_naming_a_traversing_folder_is_refused(client, data_dir):
    body = {"level": "root", "items": [{"id": "x", "dir": "../escape"}]}
    assert client.put(f"{B}/order", json=body).status_code == 400
    assert not (data_dir / "Brushes" / ".order.json").exists()


def test_clear_empties_the_folder_before_any_order_and_is_refused_after(client, data_dir):
    _lib_set(client)
    _put(client, _zip())
    assert client.post(f"{B}/clear").json() == {"ok": True}
    assert not (data_dir / "Brushes" / "Mine").exists()
    _lib_set(client)
    client.put(f"{B}/order", json={"level": "root", "items": [{"id": "m", "dir": "Mine"}]})
    assert client.post(f"{B}/clear").status_code == 409
    assert (data_dir / "Brushes" / "Mine").is_dir()


def test_migrated_is_refused_before_the_folder_is_written(client, data_dir):
    (data_dir / "brushes.json").write_text("{}")
    assert client.post(f"{B}/migrated").status_code == 409
    assert (data_dir / "brushes.json").is_file()


def test_migrated_renames_the_legacy_store_without_overwriting_an_older_copy(client, data_dir):
    client.put(f"{B}/order", json={"level": "root"})
    (data_dir / "brushes.json.migrated").write_text("older")
    (data_dir / "brushes.json").write_text('{"new": true}')
    assert client.post(f"{B}/migrated").json() == {"ok": True, "renamed": True}
    assert not (data_dir / "brushes.json").exists()
    assert (data_dir / "brushes.json.migrated").read_text() == "older"
    assert (data_dir / "brushes.json.migrated2").read_text() == '{"new": true}'
    assert client.post(f"{B}/migrated").json() == {"ok": True, "renamed": False}


def test_a_symlinked_library_is_never_followed(client, data_dir, tmp_path):
    outside = tmp_path / "outside" / "Basic"
    outside.mkdir(parents=True)
    (outside / "Soft.brush").write_bytes(_zip())
    brushes = data_dir / "Brushes"
    brushes.mkdir(parents=True, exist_ok=True)
    (brushes / "Linked").symlink_to(tmp_path / "outside", target_is_directory=True)
    assert client.get(f"{B}/tree").json()["libs"] == []
    assert client.get(f"{B}/file", params={"lib": "Linked", "set": "Basic", "file": "Soft.brush"}).status_code == 404
    assert client.post(f"{B}/dir", json={"lib": "Linked"}).status_code == 409
    assert client.delete(f"{B}/item", params={"kind": "lib", "lib": "Linked"}).status_code == 404
    assert client.post(f"{B}/clear").json() == {"ok": True}
    assert (outside / "Soft.brush").is_file()


def test_a_symlinked_brush_file_is_skipped_and_not_served(client, data_dir, tmp_path):
    _lib_set(client)
    secret = tmp_path / "secret.brush"
    secret.write_bytes(_zip({"secret": True}))
    (data_dir / "Brushes" / "Mine" / "Basic" / "Link.brush").symlink_to(secret)
    assert client.get(f"{B}/tree").json()["libs"][0]["sets"][0]["files"] == []
    assert client.get(f"{B}/file", params={"lib": "Mine", "set": "Basic", "file": "Link.brush"}).status_code == 404


def test_legacy_serves_the_old_store_or_an_empty_object(client, data_dir):
    assert client.get(f"{B}/legacy").json() == {}
    (data_dir / "brushes.json").write_text('{"brushes": [1]}')
    assert client.get(f"{B}/legacy").json() == {"brushes": [1]}
    assert client.get(f"{B}/tree").json()["legacy"] is True
