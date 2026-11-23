import pytest

from app.core import config
from app.services import agent_access, bridge, terminal


@pytest.fixture
def world(monkeypatch):
    seen = {"refused": [], "answered": [], "questions": [], "accept": True}
    monkeypatch.setattr(terminal, "heard_on", lambda port: None)
    monkeypatch.setattr(terminal, "available", lambda: False)
    monkeypatch.setattr(terminal, "engine_url", lambda: "http://127.0.0.1:7000")
    monkeypatch.setattr(bridge, "live", lambda: True)
    monkeypatch.setattr(bridge, "questions", lambda: list(seen["questions"]))
    monkeypatch.setattr(bridge, "refuse_all", lambda why: seen["refused"].append(why))

    def answer(rid, choice):
        seen["answered"].append((rid, choice))
        return seen["accept"]

    monkeypatch.setattr(bridge, "answer", answer)
    return seen


def test_access_starts_at_ask_and_round_trips_each_choice(data_dir):
    assert agent_access.choice() == "ask"
    for value in ("allowed", "blocked", "ask", "allowed"):
        assert agent_access.set_choice(value)["choice"] == value
        assert agent_access.choice() == value


def test_access_switching_choice_clears_the_other_flag(data_dir):
    agent_access.set_choice("allowed")
    agent_access.set_choice("blocked")
    stored = config.read_settings()
    assert stored.get("agentsBlocked") is True and "agentsAllowed" not in stored


def test_access_refuses_an_unknown_choice_and_keeps_the_old_one(data_dir):
    agent_access.set_choice("blocked")
    with pytest.raises(ValueError):
        agent_access.set_choice("sometimes")
    assert agent_access.choice() == "blocked"


def test_every_agents_route_refuses_a_caller_without_the_window_key(anon_client, world):
    assert anon_client.get("/api/agents").status_code == 403
    assert anon_client.post("/api/agents/choice", json={"value": "allowed"}).status_code == 403
    assert anon_client.get("/api/agents/consent").status_code == 403
    assert anon_client.post("/api/agents/consent/q1", json={"choice": "once"}).status_code == 403
    assert agent_access.choice() == "ask"


def test_state_reports_choice_tabs_and_waiting_count(client, world, monkeypatch):
    world["questions"] = [{"id": "a", "offers": ["deny"]}, {"id": "b", "offers": ["deny"]}]
    body = client.get("/api/agents").json()
    assert (body["choice"], body["pty"], body["tabs"], body["waiting"], body["window"]) == ("ask", False, [], 2, True)
    assert body["mcp"] == "http://127.0.0.1:7000/mcp"
    monkeypatch.setattr(terminal, "available", lambda: True)
    assert "claude" in client.get("/api/agents").json()["tabs"]


def test_blocking_refuses_every_waiting_question(client, world):
    body = client.post("/api/agents/choice", json={"value": "blocked"}).json()
    assert body["choice"] == "blocked" and len(world["refused"]) == 1
    client.post("/api/agents/choice", json={"value": "allowed"})
    assert len(world["refused"]) == 1


def test_an_unknown_choice_is_refused_with_422(client, world):
    assert client.post("/api/agents/choice", json={"value": "maybe"}).status_code == 422
    assert agent_access.choice() == "ask"


def test_consent_lists_the_waiting_questions(client, world):
    world["questions"] = [{"id": "q1", "offers": ["deny", "once"]}]
    assert client.get("/api/agents/consent").json() == {"requests": world["questions"]}


def test_an_answer_outside_deny_once_always_is_refused(client, world):
    world["questions"] = [{"id": "q1", "offers": ["deny", "once", "always"]}]
    assert client.post("/api/agents/consent/q1", json={"choice": "forever"}).status_code == 422
    assert world["answered"] == []


def test_an_answer_the_question_does_not_offer_is_refused(client, world):
    world["questions"] = [{"id": "q1", "offers": ["deny", "once"]}]
    assert client.post("/api/agents/consent/q1", json={"choice": "always"}).status_code == 422
    assert world["answered"] == []


def test_an_answer_to_a_question_no_longer_waiting_is_404(client, world):
    assert client.post("/api/agents/consent/gone", json={"choice": "deny"}).status_code == 404
    world["questions"] = [{"id": "q1", "offers": ["deny", "once"]}]
    world["accept"] = False
    assert client.post("/api/agents/consent/q1", json={"choice": "once"}).status_code == 404


def test_a_valid_answer_reaches_the_bridge(client, world):
    world["questions"] = [{"id": "q1", "offers": ["deny", "once"]}]
    res = client.post("/api/agents/consent/q1", json={"choice": "once"})
    assert res.status_code == 200 and res.json() == {"ok": True}
    assert world["answered"] == [("q1", "once")]
