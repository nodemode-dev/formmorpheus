from app.core import config
from app.routers import mcp
from app.services import bridge


def test_the_bridge_routes_refuse_a_caller_without_the_window_key(anon_client):
    assert anon_client.get("/api/mcp/bridge/next").status_code in (401, 403)
    assert anon_client.post("/api/mcp/bridge/result", json={"id": "x", "result": {}}).status_code in (401, 403)
    assert anon_client.get("/api/mcp/bridge/file/x").status_code in (401, 403)


def test_a_result_for_a_request_nobody_waits_for_is_not_found(client):
    response = client.post("/api/mcp/bridge/result", json={"id": "no-such-request", "result": {"ok": True}})
    assert response.status_code == 404


def test_a_result_that_is_not_an_object_is_not_found(client):
    assert client.post("/api/mcp/bridge/result", json=["x"]).status_code == 404


def test_a_result_that_is_not_json_is_a_bad_request(client):
    response = client.post("/api/mcp/bridge/result", content=b"{oops", headers={"content-type": "application/json"})
    assert response.status_code == 400


def test_a_file_for_an_unknown_request_is_not_found(client):
    assert client.get("/api/mcp/bridge/file/no-such-request").status_code == 404


def test_a_waiting_file_outside_the_library_is_never_served(client, tmp_path, monkeypatch):
    secret = tmp_path / "secret.png"
    secret.write_bytes(b"secret")
    monkeypatch.setattr(bridge, "file_for", lambda rid: str(secret))
    assert client.get("/api/mcp/bridge/file/abc").status_code == 404


def test_a_waiting_file_inside_the_library_is_served_uncached(client, monkeypatch):
    folder = config.library_dir()
    folder.mkdir(parents=True, exist_ok=True)
    picture = folder / "picture.png"
    picture.write_bytes(b"pixels")
    monkeypatch.setattr(bridge, "file_for", lambda rid: str(picture) if rid == "abc" else None)
    response = client.get("/api/mcp/bridge/file/abc")
    assert response.status_code == 200
    assert response.content == b"pixels"
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/mcp/bridge/file/other").status_code == 404


def test_next_answers_with_no_content_when_nothing_waits(client, monkeypatch):
    async def nothing(is_gone):
        return None

    monkeypatch.setattr(bridge, "next_item", nothing)
    assert client.get("/api/mcp/bridge/next").status_code == 204


def test_next_hands_the_window_the_waiting_item(client, monkeypatch):
    async def one(is_gone):
        return {"id": "r1", "kind": "export", "arguments": {"movie": "First"}}

    monkeypatch.setattr(bridge, "next_item", one)
    response = client.get("/api/mcp/bridge/next")
    assert response.status_code == 200
    assert response.json()["id"] == "r1"
    assert mcp.NAMES["export_movie"]["_kind"] == "asks"
