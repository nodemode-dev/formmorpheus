import json

from app.core import config
from library_helpers import names, save


def stacks(client):
    return client.get("/api/library/_stacks").json()["stacks"]


def test_a_stack_is_a_real_folder_holding_the_movies(client):
    save(client, "A")
    save(client, "B")
    r = client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A", "B"]})
    assert r.status_code == 200
    assert r.json() == {"id": "Shorts", "name": "Shorts", "items": ["A", "B"]}
    assert (config.library_dir() / "Shorts" / "A.fmo").is_file()
    assert not (config.library_dir() / "A.fmo").exists()


def test_a_movie_inside_a_stack_is_listed_and_opened_by_name_alone(client):
    save(client, "A", movie_id="a")
    client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A"]})
    items = client.get("/api/library").json()["items"]
    assert [(i["name"], i.get("stack")) for i in items] == [("A", "Shorts")]
    assert client.get("/api/library/A").status_code == 200


def test_saving_a_stacked_movie_keeps_it_in_its_stack(client):
    save(client, "A")
    client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A"]})
    assert save(client, "A", movie_id="again")["stack"] == "Shorts"
    assert names(client) == ["A"]


def test_a_stack_needs_at_least_one_known_movie(client):
    assert client.post("/api/library/_stacks", json={"name": "Empty", "items": []}).status_code == 400
    assert client.post("/api/library/_stacks", json={"name": "Empty", "items": ["Ghost"]}).status_code == 400
    assert not (config.library_dir() / "Empty").exists()


def test_a_taken_stack_name_gets_a_number(client):
    save(client, "A")
    save(client, "B")
    client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A"]})
    r = client.post("/api/library/_stacks", json={"name": "shorts", "items": ["B"]})
    assert r.json()["id"] == "shorts 2"


def test_a_stack_without_a_name_gets_the_default(client):
    save(client, "A")
    assert client.post("/api/library/_stacks", json={"items": ["A"]}).json()["name"] == "Stack"


def test_a_stack_id_with_traversal_is_refused(client):
    assert client.delete("/api/library/_stacks/.hidden").status_code == 400
    assert client.post("/api/library/_stacks/.hidden", json={"name": "x"}).status_code == 400
    assert client.put("/api/library/_stacks", json={"stack": "../x", "order": ["a"]}).status_code == 400


def test_an_unknown_stack_is_a_404(client):
    assert client.delete("/api/library/_stacks/Nope").status_code == 404


def test_ungrouping_returns_the_movies_to_the_top_and_removes_the_folder(client):
    save(client, "A")
    client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A"]})
    assert client.delete("/api/library/_stacks/Shorts").json() == {"ok": True}
    assert (config.library_dir() / "A.fmo").is_file()
    assert not (config.library_dir() / "Shorts").exists()
    assert stacks(client) == []


def test_updating_items_moves_movies_in_and_out(client):
    for n in ("A", "B", "C"):
        save(client, n)
    client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A", "B"]})
    r = client.post("/api/library/_stacks/Shorts", json={"items": ["B", "C"]})
    assert r.json() == {"ok": True, "id": "Shorts"}
    assert stacks(client)[0]["items"] == ["B", "C"]
    assert (config.library_dir() / "A.fmo").is_file()


def test_emptying_a_stack_removes_it(client):
    save(client, "A")
    client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A"]})
    r = client.post("/api/library/_stacks/Shorts", json={"items": []})
    assert r.json() == {"ok": True, "id": None}
    assert not (config.library_dir() / "Shorts").exists()


def test_renaming_a_stack_renames_the_folder_and_refuses_a_taken_name(client):
    save(client, "A")
    save(client, "B")
    client.post("/api/library/_stacks", json={"name": "One", "items": ["A"]})
    client.post("/api/library/_stacks", json={"name": "Two", "items": ["B"]})
    assert client.post("/api/library/_stacks/One", json={"name": "Two"}).status_code == 409
    assert client.post("/api/library/_stacks/One", json={"name": "Uno"}).json()["id"] == "Uno"
    assert sorted(s["id"] for s in stacks(client)) == ["Two", "Uno"]


def test_deleting_the_last_movie_of_a_stack_removes_the_stack(client):
    save(client, "A")
    client.post("/api/library/_stacks", json={"name": "Shorts", "items": ["A"]})
    assert client.delete("/api/library/A").status_code == 200
    assert not (config.library_dir() / "Shorts").exists()


def test_the_saved_order_round_trips_without_duplicates(client):
    client.put("/api/library/_stacks", json={"order": ["lib:B", "lib:A", "lib:B", ""]})
    assert client.get("/api/library/_stacks").json()["order"][""] == ["lib:B", "lib:A"]
    client.put("/api/library/_stacks", json={"order": []})
    assert not (config.library_dir() / ".order.json").exists()


def test_a_rename_updates_the_saved_order(client):
    save(client, "A")
    client.put("/api/library/_stacks", json={"order": ["lib:A", "lib:Z"]})
    client.post("/api/library/A/rename", json={"to": "B"})
    assert client.get("/api/library/_stacks").json()["order"][""] == ["lib:B", "lib:Z"]


def test_tags_are_cleaned_deduplicated_and_capped(client):
    save(client, "A")
    r = client.post("/api/library/_tags/A", json={"tags": ["  red  hot ", "RED HOT", "a/b", "", "x" * 50] + [f"t{i}" for i in range(20)]})
    tags = r.json()["tags"]
    assert tags[:3] == ["red hot", "a b", "x" * 32]
    assert len(tags) == 12
    assert client.get("/api/library/_tags").json()["tags"] == {"A": tags}


def test_tags_of_movies_that_no_longer_exist_are_dropped(client):
    save(client, "A")
    client.post("/api/library/_tags/Ghost", json={"tags": ["x"]})
    assert client.get("/api/library/_tags").json()["tags"] == {}
    client.post("/api/library/_tags/A", json={"tags": ["x"]})
    client.post("/api/library/_tags/A", json={"tags": []})
    assert client.get("/api/library/_tags").json()["tags"] == {}


def test_a_legacy_stack_list_becomes_real_folders_once(client):
    save(client, "A")
    lib = config.library_dir()
    (lib / ".stacks.json").write_text(json.dumps({"stacks": [{"name": "Old", "items": ["A", "Ghost"]}, {"name": "None", "items": ["Ghost"]}]}))
    assert stacks(client) == [{"id": "Old", "name": "Old", "items": ["A"]}]
    assert not (lib / ".stacks.json").exists()
    assert (lib / ".stacks.json.migrated").is_file()
    assert not (lib / "None").exists()
