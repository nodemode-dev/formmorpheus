import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core import config, guard


def make_app() -> FastAPI:
    app = FastAPI()

    @app.get("/thing")
    def read() -> dict:
        return {"ok": True}

    @app.post("/thing")
    def write() -> dict:
        return {"saved": True}

    @app.websocket("/ws")
    async def ws(socket: WebSocket) -> None:
        await socket.accept()
        await socket.send_text("hello")
        await socket.close()

    app.add_middleware(guard.GuardMiddleware)
    return app


def client(host: str = "127.0.0.1:9494") -> TestClient:
    return TestClient(make_app(), base_url=f"http://{host}")


@pytest.mark.parametrize("raw,expected", [
    ("127.0.0.1:9494", "127.0.0.1"),
    ("LOCALHOST:80", "localhost"),
    ("  localhost  ", "localhost"),
    ("[::1]:9494", "[::1]"),
    ("[::1]", "[::1]"),
    ("evil.example:9494", "evil.example"),
    ("", ""),
])
def test_host_name_drops_the_port_and_lowers_the_case(raw, expected):
    assert guard.host_name(raw) == expected


def test_a_host_that_only_starts_with_a_loopback_address_is_not_loopback():
    assert guard.host_name("127.0.0.1.evil.example:9494") not in guard.LOOPBACK_HOSTS
    assert guard.host_name("localhost.evil.example") not in guard.LOOPBACK_HOSTS


def test_every_window_origin_is_allowed_whatever_the_host():
    for origin in config.window_origins():
        assert guard.origin_allowed(origin, "127.0.0.1:1")
        assert guard.origin_allowed("  " + origin.upper() + " ", "127.0.0.1:1")


def test_the_engine_own_origin_is_allowed_on_both_schemes():
    assert guard.origin_allowed("http://127.0.0.1:41234", "127.0.0.1:41234")
    assert guard.origin_allowed("https://LOCALHOST:41234", "localhost:41234")


@pytest.mark.parametrize("origin", [
    "http://evil.example",
    "http://127.0.0.1:41235",
    "http://127.0.0.1:41234.evil.example",
    "null",
    "",
    "file://127.0.0.1:41234",
    "127.0.0.1:41234",
])
def test_a_foreign_origin_is_refused(origin):
    assert not guard.origin_allowed(origin, "127.0.0.1:41234")


def test_a_loopback_host_may_read():
    assert client().get("/thing").json() == {"ok": True}
    assert client("localhost:9494").get("/thing").status_code == 200
    assert client("[::1]:9494").get("/thing").status_code == 200


def test_a_rebound_host_is_refused_even_for_a_read():
    answer = client("evil.example:9494").get("/thing")
    assert answer.status_code == 403
    assert "loopback" in answer.json()["detail"]


def test_a_missing_host_is_refused():
    answer = client().get("/thing", headers={"host": ""})
    assert answer.status_code == 403


def test_a_write_without_an_origin_is_allowed():
    assert client().post("/thing").json() == {"saved": True}


def test_a_write_from_a_window_origin_is_allowed():
    for origin in config.window_origins():
        assert client().post("/thing", headers={"origin": origin}).status_code == 200


def test_a_write_from_the_engine_own_origin_is_allowed():
    assert client("127.0.0.1:41234").post("/thing", headers={"origin": "http://127.0.0.1:41234"}).status_code == 200


def test_a_write_from_a_foreign_origin_is_refused():
    answer = client().post("/thing", headers={"origin": "http://evil.example"})
    assert answer.status_code == 403
    assert "origin" in answer.json()["detail"]
    assert int(answer.headers["content-length"]) == len(answer.content)


def test_a_write_with_a_null_origin_is_refused():
    assert client().post("/thing", headers={"origin": "null"}).status_code == 403


def test_a_read_from_a_foreign_origin_passes_the_guard():
    assert client().get("/thing", headers={"origin": "http://evil.example"}).status_code == 200


def test_a_socket_from_a_window_origin_opens():
    with client().websocket_connect("/ws", headers={"host": "127.0.0.1:9494", "origin": config.window_origins()[0]}) as socket:
        assert socket.receive_text() == "hello"


def test_a_socket_without_an_origin_or_from_the_engine_own_origin_opens():
    for headers in ({"host": "localhost:41234"}, {"host": "localhost:41234", "origin": "http://localhost:41234"}):
        with client().websocket_connect("/ws", headers=headers) as socket:
            assert socket.receive_text() == "hello"


def test_a_socket_from_a_foreign_origin_is_closed_as_a_policy_violation():
    with pytest.raises(WebSocketDisconnect) as refused:
        with client().websocket_connect("/ws", headers={"host": "127.0.0.1:9494", "origin": "http://evil.example"}):
            pass
    assert refused.value.code == 1008


def test_a_socket_on_a_rebound_host_is_closed():
    with pytest.raises(WebSocketDisconnect) as refused:
        with client().websocket_connect("/ws", headers={"host": "evil.example"}):
            pass
    assert refused.value.code == 1008
