import os
import re
import time

import pytest

I = "/api/ideas"
FIXED = time.struct_time((2024, 1, 2, 3, 4, 5, 1, 2, -1))


@pytest.fixture
def frozen(monkeypatch):
    from app.routers import ideas

    monkeypatch.setattr(ideas.time, "localtime", lambda *a: FIXED)


def test_an_idea_is_saved_as_a_text_file_with_a_header(client, data_dir, frozen):
    r = client.post(I, json={"text": "  Add onion skin colours  "})
    assert r.status_code == 200
    item = r.json()
    assert item["name"] == "idea-20240102-030405.txt"
    content = (data_dir / "Ideas" / item["name"]).read_text("utf-8")
    assert content.startswith("Idea\n2024-01-02 03:04 ")
    assert content.endswith("\n\nAdd onion skin colours\n")
    assert item["text"] == content


def test_kind_and_context_appear_in_the_header(client, frozen):
    text = client.post(I, json={"text": "x", "kind": "  Bug  ", "context": "timeline"}).json()["text"]
    first, second = text.split("\n")[:2]
    assert first == "Bug"
    assert second.startswith("2024-01-02 03:04 ")
    assert second.endswith(" timeline")


def test_a_long_kind_is_cut_and_a_blank_kind_falls_back(client, frozen):
    assert client.post(I, json={"text": "x", "kind": "k" * 99}).json()["text"].split("\n")[0] == "k" * 40
    assert client.post(I, json={"text": "x", "kind": "   "}).json()["text"].split("\n")[0] == "Idea"


def test_ideas_in_the_same_second_get_numbered_names(client, frozen):
    names = [client.post(I, json={"text": f"n{i}"}).json()["name"] for i in range(3)]
    assert names == ["idea-20240102-030405.txt", "idea-20240102-030405-2.txt", "idea-20240102-030405-3.txt"]


@pytest.mark.parametrize("body", [{"text": ""}, {"text": "   "}, {}, ["text"], "text"])
def test_an_empty_or_shapeless_note_is_refused(client, data_dir, body):
    assert client.post(I, json=body).status_code == 400
    assert list((data_dir / "Ideas").glob("*")) == []


def test_a_body_that_is_not_json_is_refused(client):
    assert client.post(I, content=b"{not json", headers={"content-type": "application/json"}).status_code == 400
    assert client.post(I, content=b"\xff\xfe\xfa", headers={"content-type": "application/json"}).status_code == 400


def test_a_note_over_the_byte_limit_is_refused(client, data_dir):
    r = client.post(I, json={"text": "z" * (48 * 1024 + 10)})
    assert r.status_code == 413
    assert list((data_dir / "Ideas").glob("*")) == []


def test_the_text_is_cut_to_the_cap(client, data_dir, frozen):
    name = client.post(I, json={"text": "z" * 30000}).json()["name"]
    content = (data_dir / "Ideas" / name).read_text("utf-8")
    assert content.endswith("\n\n" + "z" * (24 * 1024) + "\n")
    assert "z" * (24 * 1024 + 1) not in content


def test_an_idea_reads_back_and_deletes(client, data_dir, frozen):
    name = client.post(I, json={"text": "hello"}).json()["name"]
    assert client.get(f"{I}/{name}").json()["text"].endswith("\n\nhello\n")
    assert client.delete(f"{I}/{name}").json() == {"ok": True}
    assert not (data_dir / "Ideas" / name).exists()
    assert client.get(f"{I}/{name}").status_code == 404
    assert client.delete(f"{I}/{name}").status_code == 404


@pytest.mark.parametrize("name", ["notes.txt", "idea-2024-01-02.txt", "idea-20240102-030405.md", "idea-20240102-030405-1234.txt", "..%2Fsettings.json", "idea-20240102-030405.txt.bak"])
def test_names_that_are_not_idea_files_are_refused(client, name):
    assert client.get(f"{I}/{name}").status_code in (400, 404)
    assert client.delete(f"{I}/{name}").status_code in (400, 404)


def test_a_non_idea_name_is_refused_even_when_the_file_exists(client, data_dir):
    folder = data_dir / "Ideas"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "notes.txt").write_text("private")
    assert client.get(f"{I}/notes.txt").status_code == 400
    assert client.delete(f"{I}/notes.txt").status_code == 400
    assert (folder / "notes.txt").is_file()


def test_the_list_is_newest_first_and_skips_other_files(client, data_dir):
    folder = data_dir / "Ideas"
    folder.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(["idea-20240101-000000.txt", "idea-20240103-000000.txt", "idea-20240102-000000-2.txt"]):
        p = folder / name
        p.write_text(name)
        os.utime(p, (1_000_000 + i * 100, 1_000_000 + i * 100))
    (folder / "other.txt").write_text("x")
    body = client.get(I).json()
    assert body["folder"] == str(folder)
    assert [i["name"] for i in body["items"]] == ["idea-20240102-000000-2.txt", "idea-20240103-000000.txt", "idea-20240101-000000.txt"]
    assert all(re.match(r"^idea-\d{8}-\d{6}", i["name"]) for i in body["items"])
