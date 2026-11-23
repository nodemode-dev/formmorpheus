import json

from app.routers import mcp

from mcp_helpers import rpc


def test_initialize_answers_with_server_info_and_a_session_id(client):
    response = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "clientInfo": {"name": "tester"}})
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["serverInfo"]["name"] == "formmorpheus"
    assert "tools" in result["capabilities"]
    sid = response.headers["mcp-session-id"]
    assert mcp.SESSIONS[sid] == "tester"


def test_initialize_with_an_unknown_version_falls_back_to_a_supported_one(client):
    result = rpc(client, "initialize", {"protocolVersion": "1999-01-01"}).json()["result"]
    assert result["protocolVersion"] in mcp.VERSIONS


def test_delete_forgets_the_session(client):
    sid = rpc(client, "initialize", {"clientInfo": {"name": "tester"}}).headers["mcp-session-id"]
    response = client.delete("/mcp", headers={"mcp-session-id": sid})
    assert response.status_code == 204
    assert sid not in mcp.SESSIONS


def test_get_is_refused_and_names_the_allowed_methods(client):
    response = client.get("/mcp")
    assert response.status_code == 405
    assert "POST" in response.headers["allow"]


def test_a_notification_without_an_id_is_accepted_with_no_body(client):
    response = client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert response.status_code == 202
    assert response.content == b""


def test_a_body_that_is_not_json_is_a_parse_error(client):
    response = client.post("/mcp", content=b"{not json", headers={"content-type": "application/json"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32700
    assert response.json()["id"] is None


def test_a_batch_is_refused(client):
    response = client.post("/mcp", json=[{"jsonrpc": "2.0", "id": 1, "method": "ping"}])
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32600


def test_a_body_that_is_not_an_object_is_an_invalid_request(client):
    response = client.post("/mcp", json="ping")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32600


def test_params_that_are_not_an_object_are_refused(client):
    response = client.post("/mcp", json={"jsonrpc": "2.0", "id": 4, "method": "ping", "params": [1, 2]})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32602
    assert response.json()["id"] == 4


def test_a_meta_that_is_not_an_object_is_refused(client):
    response = rpc(client, "ping", {"_meta": "nope"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32602


def test_a_request_larger_than_the_limit_is_refused(client):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {"pad": "x" * (mcp.MAX_BODY + 1)}})
    response = client.post("/mcp", content=body, headers={"content-type": "application/json"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == -32600


def test_an_unknown_method_is_method_not_found_and_echoes_the_id(client):
    body = rpc(client, "resources/list", req_id="abc").json()
    assert body["id"] == "abc"
    assert body["error"]["code"] == -32601
    assert "resources/list" in body["error"]["message"]


def test_an_unsupported_protocol_version_is_refused(client):
    body = rpc(client, "ping", headers={"mcp-protocol-version": "1999-01-01"}).json()
    assert body["error"]["code"] == -32602
    assert "1999-01-01" in body["error"]["message"]


def test_ping_answers_with_an_empty_result_for_an_older_client(client):
    body = rpc(client, "ping", headers={"mcp-protocol-version": "2025-06-18"}).json()
    assert body == {"jsonrpc": "2.0", "id": 1, "result": {}}


def test_tools_list_gives_every_tool_without_the_private_kind(client):
    tools = rpc(client, "tools/list").json()["result"]["tools"]
    names = [t["name"] for t in tools]
    assert len(names) == len(set(names))
    for wanted in ("get_context", "list_movies", "get_movie", "manage_movie", "export_movie", "import_file", "list_commands", "run_command"):
        assert wanted in names
    for tool in tools:
        assert "_kind" not in tool
        assert tool["inputSchema"]["type"] == "object"
        assert set(tool["inputSchema"]["required"]) <= set(tool["inputSchema"]["properties"])


def test_reading_tools_are_marked_read_only_and_changing_tools_are_not(client):
    tools = {t["name"]: t for t in rpc(client, "tools/list").json()["result"]["tools"]}
    assert tools["list_movies"]["annotations"]["readOnlyHint"] is True
    assert tools["manage_movie"]["annotations"]["readOnlyHint"] is False
    assert tools["run_command"]["annotations"]["destructiveHint"] is True


def test_the_newest_revision_gets_a_complete_result_with_cache_hints(client):
    meta = {"_meta": {"io.modelcontextprotocol/protocolVersion": mcp.VERSIONS[0]}}
    result = rpc(client, "tools/list", meta).json()["result"]
    assert result["resultType"] == "complete"
    assert result["ttlMs"] > 0
    older = rpc(client, "tools/list", headers={"mcp-protocol-version": "2025-06-18"}).json()["result"]
    assert "resultType" not in older
    assert "ttlMs" not in older


def test_server_discover_lists_the_supported_versions(client):
    result = rpc(client, "server/discover").json()["result"]
    assert result["supportedVersions"] == mcp.VERSIONS
    assert result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "formmorpheus"


def test_a_call_to_an_unknown_tool_is_refused(client):
    body = rpc(client, "tools/call", {"name": "format_disk", "arguments": {}}).json()
    assert body["error"]["code"] == -32602
    assert "format_disk" in body["error"]["message"]


def test_a_call_whose_arguments_are_not_an_object_is_refused(client):
    body = rpc(client, "tools/call", {"name": "list_movies", "arguments": [1]}).json()
    assert body["error"]["code"] == -32602
