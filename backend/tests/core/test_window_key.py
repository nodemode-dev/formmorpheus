from types import SimpleNamespace

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core import window_key


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(window_key, "time", SimpleNamespace(monotonic=lambda: now[0]))
    monkeypatch.setattr(window_key, "TICKETS", {})
    monkeypatch.setattr(window_key, "STATE", {"claimed": False, "secondClaim": False})
    monkeypatch.delenv(window_key.STDOUT_ENV, raising=False)
    return now


@pytest.fixture
def api(clock):
    app = FastAPI()
    app.include_router(window_key.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/api/thing")
    def thing() -> dict:
        return {"secret": True}

    @app.post("/api/thing")
    def change() -> dict:
        return {"changed": True}

    @app.get("/page")
    def page() -> dict:
        return {"page": True}

    @app.websocket("/api/ws")
    async def ws(socket: WebSocket) -> None:
        await socket.accept()
        await socket.send_text("hello")
        await socket.close()

    app.add_middleware(window_key.WindowKeyGuard)
    return TestClient(app, base_url="http://127.0.0.1:9494")


def key_headers() -> dict:
    return {window_key.HEADER: window_key.KEY}


def test_only_the_exact_key_is_valid():
    assert window_key.valid(window_key.KEY)
    assert not window_key.valid(window_key.KEY + "x")
    assert not window_key.valid(window_key.KEY[:-1])
    assert not window_key.valid("")
    assert not window_key.valid(None)
    assert not window_key.valid(window_key.KEY.encode())
    assert not window_key.valid("caf\u00e9")


def test_the_key_is_given_once_and_a_second_claim_is_recorded(clock):
    assert window_key.claim() == window_key.KEY
    assert window_key.STATE == {"claimed": True, "secondClaim": False}
    assert window_key.claim() is None
    assert window_key.STATE == {"claimed": True, "secondClaim": True}


def test_a_ticket_can_be_spent_once(clock):
    value = window_key.ticket()
    assert window_key.spend(value)
    assert not window_key.spend(value)


def test_tickets_differ_from_each_other(clock):
    assert len({window_key.ticket() for _ in range(20)}) == 20


def test_a_ticket_is_good_at_the_end_of_its_life_and_dead_after(clock):
    first = window_key.ticket()
    second = window_key.ticket()
    clock[0] += window_key.TICKET_LIFE
    assert window_key.spend(first)
    clock[0] += 0.5
    assert not window_key.spend(second)
    assert second not in window_key.TICKETS


def test_an_unknown_or_malformed_ticket_is_refused(clock):
    window_key.ticket()
    assert not window_key.spend("nope")
    assert not window_key.spend("")
    assert not window_key.spend(None)
    assert not window_key.spend(7)


def test_making_a_ticket_drops_the_expired_ones(clock):
    old = window_key.ticket()
    clock[0] += window_key.TICKET_LIFE + 1
    fresh = window_key.ticket()
    assert list(window_key.TICKETS) == [fresh]
    assert not window_key.spend(old)


def test_a_guarded_route_refuses_a_call_without_the_key(api):
    answer = api.get("/api/thing")
    assert answer.status_code == 403
    assert answer.json() == {"detail": window_key.REFUSED}


def test_a_guarded_route_refuses_a_wrong_key(api):
    assert api.post("/api/thing", headers={window_key.HEADER: "wrong"}).status_code == 403
    assert api.get("/api/thing", headers={window_key.HEADER: ""}).status_code == 403


def test_a_guarded_route_answers_the_window(api):
    assert api.get("/api/thing", headers=key_headers()).json() == {"secret": True}
    assert api.post("/api/thing", headers={window_key.HEADER.upper(): window_key.KEY}).json() == {"changed": True}


def test_health_and_pages_outside_the_api_need_no_key(api):
    assert api.get("/api/health").status_code == 200
    assert api.get("/page").json() == {"page": True}


def test_a_preflight_passes_the_key_guard(api):
    assert api.options("/api/thing").status_code != 403


def test_the_first_window_gets_the_key_and_the_second_is_refused(api):
    assert api.get("/api/window/key").json() == {"claimed": False, "secondClaim": False, "packaged": False}
    assert api.post("/api/window/key").json() == {"key": window_key.KEY}
    assert api.post("/api/window/key").status_code == 409
    assert api.get("/api/window/key").json() == {"claimed": True, "secondClaim": True, "packaged": False}


def test_the_key_is_never_served_when_it_goes_to_the_shell_over_stdout(api, monkeypatch):
    monkeypatch.setenv(window_key.STDOUT_ENV, "1")
    assert api.post("/api/window/key").status_code == 404
    state = api.get("/api/window/key").json()
    assert state["packaged"] is True
    assert state["claimed"] is False


def test_a_stream_ticket_needs_the_key(api):
    assert api.post("/api/window/ticket").status_code == 403
    assert window_key.TICKETS == {}
    given = api.post("/api/window/ticket", headers=key_headers()).json()["ticket"]
    assert given in window_key.TICKETS


def test_a_socket_opens_with_a_fresh_ticket_and_only_once(api):
    given = api.post("/api/window/ticket", headers=key_headers()).json()["ticket"]
    with api.websocket_connect(f"/api/ws?ticket={given}") as socket:
        assert socket.receive_text() == "hello"
    with pytest.raises(WebSocketDisconnect) as refused:
        with api.websocket_connect(f"/api/ws?ticket={given}"):
            pass
    assert refused.value.code == 4403


def test_a_socket_without_a_ticket_is_closed_even_with_the_key_header(api):
    with pytest.raises(WebSocketDisconnect) as refused:
        with api.websocket_connect("/api/ws", headers=key_headers()):
            pass
    assert refused.value.code == 4403


def test_a_socket_with_an_expired_ticket_is_closed(api, clock):
    given = api.post("/api/window/ticket", headers=key_headers()).json()["ticket"]
    clock[0] += window_key.TICKET_LIFE + 1
    with pytest.raises(WebSocketDisconnect):
        with api.websocket_connect(f"/api/ws?ticket={given}"):
            pass
