import pytest

from app.routers import mcp
from app.services import agent_access, bridge

from mcp_helpers import call, text


@pytest.fixture(autouse=True)
def quiet(monkeypatch):
    monkeypatch.setattr(mcp, "_declined", [0.0])
    monkeypatch.setattr(bridge, "live", lambda: False)
    monkeypatch.setattr(mcp.ff, "probe", lambda: None)


def answer_with(monkeypatch, said, seen=None):
    async def ask(agent, what, offers, timeout):
        if seen is not None:
            seen.append((agent, what, offers))
        return said

    monkeypatch.setattr(bridge, "live", lambda: True)
    monkeypatch.setattr(bridge, "ask", ask)


def names(client):
    return [m["name"] for m in call(client, "list_movies")["structuredContent"]["movies"]]


def test_an_empty_library_lists_no_movies(client):
    result = call(client, "list_movies")
    assert result["structuredContent"] == {"movies": []}
    assert "isError" not in result


def test_get_context_reports_the_closed_window_and_the_default_choice(client):
    data = call(client, "get_context")["structuredContent"]
    assert data["window"] is False
    assert data["outsideAgents"] == "ask"
    assert data["inApp"] is False
    assert data["movies"] == 0
    assert data["ffmpeg"] == {"found": False, "version": "", "encoders": []}


def test_get_context_names_the_client_from_the_request_meta(client):
    from mcp_helpers import rpc

    params = {"name": "get_context", "arguments": {}, "_meta": {"io.modelcontextprotocol/clientInfo": {"name": "tester"}}}
    data = rpc(client, "tools/call", params).json()["result"]["structuredContent"]
    assert data["client"] == "tester"


def test_get_movie_without_a_name_is_a_tool_error(client):
    result = call(client, "get_movie")
    assert result["isError"] is True
    assert "movie" in text(result)


def test_get_movie_for_a_missing_movie_is_a_tool_error(client):
    result = call(client, "get_movie", {"movie": "Nowhere"})
    assert result["isError"] is True
    assert "Nowhere" in text(result)


def test_manage_movie_refuses_an_unknown_action(client):
    result = call(client, "manage_movie", {"action": "shred"})
    assert result["isError"] is True


def test_a_change_is_refused_while_outside_agents_are_off_and_no_window_is_open(client):
    result = call(client, "manage_movie", {"action": "create", "name": "First"})
    assert result["isError"] is True
    assert text(result) == mcp.OFF
    assert names(client) == []


def test_a_change_runs_without_asking_once_outside_agents_are_allowed(client):
    agent_access.set_choice("allowed")
    result = call(client, "manage_movie", {"action": "create", "name": "First"})
    assert "isError" not in result
    assert result["structuredContent"]["movie"] == "First"
    assert names(client) == ["First"]


def test_a_yes_once_in_the_window_lets_the_change_through_and_keeps_asking(client, monkeypatch):
    seen = []
    answer_with(monkeypatch, "once", seen)
    result = call(client, "manage_movie", {"action": "create", "name": "First"})
    assert "isError" not in result
    assert names(client) == ["First"]
    assert agent_access.choice() == "ask"
    assert "First" in seen[0][1]
    assert seen[0][2] == ["deny", "once", "always"]


def test_a_yes_always_in_the_window_allows_outside_agents(client, monkeypatch):
    answer_with(monkeypatch, "always")
    call(client, "manage_movie", {"action": "create", "name": "First"})
    assert agent_access.choice() == "allowed"


def test_a_no_in_the_window_stops_the_change_and_pauses_further_asking(client, monkeypatch):
    seen = []
    answer_with(monkeypatch, "deny", seen)
    first = call(client, "manage_movie", {"action": "create", "name": "First"})
    assert first["isError"] is True
    second = call(client, "manage_movie", {"action": "create", "name": "Second"})
    assert text(second) == mcp.DECLINED
    assert len(seen) == 1
    assert names(client) == []


def test_no_answer_in_the_window_changes_nothing(client, monkeypatch):
    answer_with(monkeypatch, None)
    result = call(client, "manage_movie", {"action": "create", "name": "First"})
    assert result["isError"] is True
    assert names(client) == []


def test_blocked_agents_cannot_even_read(client):
    agent_access.set_choice("blocked")
    result = call(client, "list_movies")
    assert result["isError"] is True
    assert text(result) == mcp.BLOCKED


def test_rename_needs_an_existing_movie_before_anyone_is_asked(client, monkeypatch):
    seen = []
    answer_with(monkeypatch, "once", seen)
    result = call(client, "manage_movie", {"action": "rename", "movie": "Ghost", "to": "Other"})
    assert result["isError"] is True
    assert seen == []


def test_rename_without_a_new_name_is_refused(client):
    agent_access.set_choice("allowed")
    call(client, "manage_movie", {"action": "create", "name": "First"})
    result = call(client, "manage_movie", {"action": "rename", "movie": "First"})
    assert result["isError"] is True
    assert names(client) == ["First"]


def test_list_movies_narrows_by_words_in_the_name(client):
    agent_access.set_choice("allowed")
    call(client, "manage_movie", {"action": "create", "name": "Red Fox"})
    call(client, "manage_movie", {"action": "create", "name": "Blue Whale"})
    found = call(client, "list_movies", {"query": "fox RED"})["structuredContent"]["movies"]
    assert [m["name"] for m in found] == ["Red Fox"]


def test_creating_the_same_name_twice_keeps_both_movies(client):
    agent_access.set_choice("allowed")
    call(client, "manage_movie", {"action": "create", "name": "First"})
    call(client, "manage_movie", {"action": "create", "name": "First"})
    found = names(client)
    assert len(found) == 2
    assert len(set(found)) == 2


def test_run_command_refuses_an_unknown_id(client):
    result = call(client, "run_command", {"id": "wipe"})
    assert result["isError"] is True
    assert "wipe" in text(result)


def test_a_reading_command_runs_while_outside_agents_are_off(client):
    result = call(client, "run_command", {"id": "list_stacks"})
    assert "isError" not in result
    assert result["structuredContent"] == {"stacks": []}


def test_a_changing_command_is_refused_while_outside_agents_are_off(client):
    result = call(client, "run_command", {"id": "set_tags", "params": {"movie": "First", "tags": ["a"]}})
    assert text(result) == mcp.OFF


def test_set_tags_stores_tags_that_list_movies_then_shows(client):
    agent_access.set_choice("allowed")
    call(client, "manage_movie", {"action": "create", "name": "First"})
    result = call(client, "run_command", {"id": "set_tags", "params": {"movie": "First", "tags": ["hero", "draft"]}})
    assert sorted(result["structuredContent"]["tags"]) == ["draft", "hero"]
    movie = call(client, "list_movies")["structuredContent"]["movies"][0]
    assert sorted(movie["tags"]) == ["draft", "hero"]


def test_set_tags_refuses_tags_that_are_not_a_list_of_words(client):
    agent_access.set_choice("allowed")
    call(client, "manage_movie", {"action": "create", "name": "First"})
    result = call(client, "run_command", {"id": "set_tags", "params": {"movie": "First", "tags": "hero"}})
    assert result["isError"] is True


def test_export_needs_the_open_window(client):
    agent_access.set_choice("allowed")
    call(client, "manage_movie", {"action": "create", "name": "First"})
    result = call(client, "export_movie", {"movie": "First", "format": "mp4"})
    assert result["isError"] is True


def test_the_size_helper_never_shows_zero(client):
    assert mcp._size(0) == "1 KB"
    assert mcp._size(2048) == "2 KB"
    assert mcp._size(3 * 1048576) == "3.0 MB"


def test_inside_refuses_a_path_that_climbs_out_of_the_folder(tmp_path):
    folder = tmp_path / "lib"
    folder.mkdir()
    assert mcp._inside(folder / "a.fmo", folder) is True
    assert mcp._inside(folder, folder) is True
    assert mcp._inside(folder / ".." / "secret.txt", folder) is False
