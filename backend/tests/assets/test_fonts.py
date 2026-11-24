import pytest

F = "/api/fonts"
TTF = b"\x00\x01\x00\x00" + bytes(range(20))
WOFF2 = b"wOF2" + b"\x00" * 16


def test_an_empty_library_lists_no_fonts(client):
    assert client.get(F).json()["items"] == []


def test_an_imported_font_is_listed_with_its_family_and_served_back(client):
    r = client.put(f"{F}/Body.ttf", params={"family": "  Body Sans  "}, content=TTF)
    assert r.status_code == 200
    assert r.json()["file"] == "Body.ttf"
    assert r.json()["family"] == "Body Sans"
    assert r.json()["size"] == len(TTF)
    items = client.get(F).json()["items"]
    assert [(i["file"], i["family"]) for i in items] == [("Body.ttf", "Body Sans")]
    got = client.get(f"{F}/Body.ttf")
    assert got.content == TTF
    assert got.headers["content-type"] == "font/ttf"


def test_a_woff2_font_is_served_with_its_own_type(client):
    client.put(f"{F}/Head.woff2", params={"family": "Head"}, content=WOFF2)
    assert client.get(f"{F}/Head.woff2").headers["content-type"] == "font/woff2"


def test_the_same_name_with_another_family_gets_a_numbered_name(client):
    client.put(f"{F}/A.ttf", params={"family": "One"}, content=TTF)
    r = client.put(f"{F}/A.ttf", params={"family": "Two"}, content=TTF)
    assert r.json()["file"] == "A 2.ttf"
    items = client.get(F).json()["items"]
    assert sorted((i["file"], i["family"]) for i in items) == [("A 2.ttf", "Two"), ("A.ttf", "One")]


def test_the_same_name_with_the_same_family_replaces_the_font(client):
    client.put(f"{F}/A.ttf", params={"family": "One"}, content=TTF)
    newer = b"OTTO" + b"\x01" * 30
    r = client.put(f"{F}/A.ttf", params={"family": "One"}, content=newer)
    assert r.json()["file"] == "A.ttf"
    assert len(client.get(F).json()["items"]) == 1
    assert client.get(f"{F}/A.ttf").content == newer


@pytest.mark.parametrize("body", [b"<html><body>hi</body></html>", b"MZ\x90\x00" + b"\x00" * 20, b"\x00\x01\x00\x00"])
def test_a_body_that_is_not_a_font_is_refused_and_leaves_nothing(client, data_dir, body):
    r = client.put(f"{F}/Fake.ttf", params={"family": "Fake"}, content=body)
    assert r.status_code == 400
    assert list((data_dir / "Fonts").iterdir()) == []


@pytest.mark.parametrize("family", ["", "   ", 'Bad"Name', "Back\\slash", "Tab\tName"])
def test_a_missing_or_unsafe_family_is_refused(client, data_dir, family):
    r = client.put(f"{F}/A.ttf", params={"family": family}, content=TTF)
    assert r.status_code == 400
    assert client.get(F).json()["items"] == []


def test_a_long_family_is_cut_to_120_characters(client):
    r = client.put(f"{F}/A.ttf", params={"family": "f" * 300}, content=TTF)
    assert r.json()["family"] == "f" * 120


@pytest.mark.parametrize("name", ["evil.exe", "font.svg", "noext", ".hidden.ttf", "trailing.ttf.", "..%5Cevil.ttf", "a%3Ab.ttf", ("x" * 157) + ".ttf"])
def test_unusable_font_file_names_are_refused(client, name):
    assert client.put(f"{F}/{name}", params={"family": "X"}, content=TTF).status_code == 400
    assert client.get(f"{F}/{name}").status_code == 400
    assert client.delete(f"{F}/{name}").status_code == 400


def test_a_file_in_the_data_folder_above_fonts_cannot_be_read(client, data_dir):
    (data_dir / "secret.ttf").write_bytes(TTF)
    assert client.get(f"{F}/..%2Fsecret.ttf").status_code in (400, 404)
    assert client.get(f"{F}/..%5Csecret.ttf").status_code == 400


def test_reading_a_missing_font_is_not_found(client):
    assert client.get(f"{F}/Ghost.otf").status_code == 404


def test_deleting_a_font_removes_the_file_and_its_family(client, data_dir):
    client.put(f"{F}/A.ttf", params={"family": "One"}, content=TTF)
    assert client.delete(f"{F}/A.ttf").json() == {"deleted": "A.ttf"}
    assert client.get(F).json()["items"] == []
    assert client.get(f"{F}/A.ttf").status_code == 404
    assert client.delete(f"{F}/A.ttf").status_code == 404
    (data_dir / "Fonts" / "A.ttf").write_bytes(TTF)
    assert client.get(F).json()["items"][0]["family"] == "A"


def test_the_list_skips_hidden_and_non_font_files(client, data_dir):
    folder = data_dir / "Fonts"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "readme.txt").write_text("x")
    (folder / ".hidden.ttf").write_bytes(TTF)
    (folder / "b.OTF").write_bytes(TTF)
    (folder / "A.woff").write_bytes(TTF)
    assert [i["file"] for i in client.get(F).json()["items"]] == ["A.woff", "b.OTF"]


def test_a_symlinked_font_is_neither_listed_served_nor_deleted(client, data_dir, tmp_path):
    secret = tmp_path / "secret.ttf"
    secret.write_bytes(TTF)
    folder = data_dir / "Fonts"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "Link.ttf").symlink_to(secret)
    assert client.get(F).json()["items"] == []
    assert client.get(f"{F}/Link.ttf").status_code == 404
    assert client.delete(f"{F}/Link.ttf").status_code == 404
    assert secret.read_bytes() == TTF


def test_a_font_over_the_size_limit_is_refused(client, data_dir, monkeypatch):
    from app.routers import fonts

    monkeypatch.setattr(fonts, "FILE_LIMIT", 16)
    r = client.put(f"{F}/Big.ttf", params={"family": "Big"}, content=TTF)
    assert r.status_code == 413
    assert list((data_dir / "Fonts").iterdir()) == []
