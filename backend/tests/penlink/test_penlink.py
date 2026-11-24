import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import penlink

HOST = "10.0.0.5:9495"
ORIGIN = "http://10.0.0.5:9495"


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(penlink, "S", penlink._State())


def _live_code(code="123456"):
    penlink.S.hosts = {HOST}
    penlink.S.code = code
    penlink.S.code_until = time.time() + 100


class Desk:
    def __init__(self):
        self.out = []

    async def send_text(self, text):
        self.out.append(json.loads(text))

    async def send_bytes(self, data):
        self.out.append(data)


def _http(path, method="GET", host=HOST, origin=ORIGIN, body=b"", addr="10.0.0.9"):
    headers = [(b"host", host.encode())]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    scope = {"type": "http", "path": path, "method": method, "headers": headers, "client": (addr, 5000)}
    queue = [{"type": "http.request", "body": body, "more_body": False}]
    sent = []

    async def receive():
        return queue.pop(0)

    async def send(m):
        sent.append(m)

    asyncio.run(penlink.lan_app(scope, receive, send))
    return sent[0]["status"], sent[1]["body"], {k.decode(): v.decode() for k, v in sent[0]["headers"]}


def _pair(code, addr="10.0.0.9", device=None):
    payload = {"code": code}
    if device is not None:
        payload["device"] = device
    return _http("/penlink/pair", "POST", body=json.dumps(payload).encode(), addr=addr)


def _ws(messages, path="/penlink/ws", host=HOST, origin=ORIGIN):
    headers = [(b"host", host.encode())]
    if origin is not None:
        headers.append((b"origin", origin.encode()))
    scope = {"type": "websocket", "path": path, "headers": headers, "client": ("10.0.0.9", 1)}
    queue = list(messages)
    sent = []

    async def receive():
        return queue.pop(0) if queue else {"type": "websocket.disconnect", "code": 1000}

    async def send(m):
        sent.append(m)

    asyncio.run(penlink.lan_app(scope, receive, send))
    return sent


def _hello(token):
    return [{"type": "websocket.connect"}, {"type": "websocket.receive", "text": json.dumps({"t": "hello", "token": token})}]


def _text(obj):
    return {"type": "websocket.receive", "text": json.dumps(obj)}


def test_lan_ips_drops_loopback_and_link_local_and_duplicates(monkeypatch):
    class Probe:
        def __init__(self, *a):
            pass

        def connect(self, addr):
            pass

        def getsockname(self):
            return ("192.168.1.20", 5555)

        def close(self):
            pass

    rows = [(2, 1, 6, "", (ip, 0)) for ip in ("127.0.1.1", "169.254.3.3", "192.168.1.20", "10.1.2.3")]
    monkeypatch.setattr(penlink.socket, "socket", Probe)
    monkeypatch.setattr(penlink.socket, "gethostname", lambda: "desk")
    monkeypatch.setattr(penlink.socket, "getaddrinfo", lambda *a: rows)
    assert penlink.lan_ips() == ["192.168.1.20", "10.1.2.3"]


def test_lan_ips_is_empty_when_every_lookup_fails(monkeypatch):
    def boom(*a):
        raise OSError("no network")

    monkeypatch.setattr(penlink.socket, "socket", boom)
    monkeypatch.setattr(penlink.socket, "gethostname", lambda: "desk")
    monkeypatch.setattr(penlink.socket, "getaddrinfo", boom)
    assert penlink.lan_ips() == []


def test_a_fresh_code_is_six_digits_and_live():
    penlink._new_code()
    assert len(penlink.S.code) == 6 and penlink.S.code.isdigit()
    assert penlink._code_live() is True


def test_an_expired_code_is_not_live():
    _live_code()
    penlink.S.code_until = time.time() - 1
    assert penlink._code_live() is False
    assert penlink._view()["code"] == ""


def test_the_view_reports_locked_once_the_ceiling_is_reached():
    _live_code()
    penlink.S.tries = penlink.CODE_CEILING
    view = penlink._view()
    assert view["locked"] is True and view["code"] == "" and view["codeSeconds"] == 0


def test_the_view_hides_the_code_while_paired():
    _live_code()
    penlink.S.token = "tok"
    view = penlink._view()
    assert view["paired"] is True and view["code"] == "" and view["connected"] is False


def test_a_request_for_a_foreign_host_is_refused():
    _live_code()
    status, _, _ = _http("/penlink/", host="evil.example:9495")
    assert status == 403


def test_the_companion_page_is_served_with_strict_headers():
    _live_code()
    status, body, headers = _http("/penlink/")
    assert status == 200 and body
    assert headers["content-type"].startswith("text/html")
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in headers["content-security-policy"]


def test_engine_paths_are_not_reachable_through_the_listener():
    _live_code()
    assert _http("/api/penlink/status")[0] == 404
    assert _http("/penlink/../app/main.py")[0] == 404
    assert _http("/penlink/secret.txt")[0] == 404


def test_pairing_with_get_is_refused():
    _live_code()
    assert _http("/penlink/pair")[0] == 405


def test_pairing_without_origin_or_with_a_foreign_origin_is_refused():
    _live_code()
    body = json.dumps({"code": "123456"}).encode()
    assert _http("/penlink/pair", "POST", origin=None, body=body)[0] == 403
    assert _http("/penlink/pair", "POST", origin="http://evil.example", body=body)[0] == 403
    assert penlink.S.token == ""


def test_a_malformed_pair_body_is_a_bad_request():
    _live_code()
    assert _http("/penlink/pair", "POST", body=b"not json")[0] == 400
    assert _http("/penlink/pair", "POST", body=b"{}")[0] == 400


def test_an_oversized_pair_body_is_a_bad_request():
    _live_code()
    body = json.dumps({"code": "123456", "device": "x" * 600}).encode()
    assert _http("/penlink/pair", "POST", body=body)[0] == 400
    assert penlink.S.token == ""


def test_the_right_code_pairs_and_spends_the_code():
    _live_code()
    status, body, headers = _pair("123456", device="Pad " + "y" * 100)
    assert status == 200
    assert headers["content-type"] == "application/json"
    token = json.loads(body)["token"]
    assert token and token == penlink.S.token
    assert penlink.S.code == ""
    assert penlink.S.device == ("Pad " + "y" * 100)[:60]


def test_a_tablet_without_a_name_is_called_tablet():
    _live_code()
    assert _pair("123456")[0] == 200
    assert penlink.S.device == "Tablet"


def test_a_second_pairing_is_refused_while_one_tablet_is_paired():
    _live_code()
    assert _pair("123456")[0] == 200
    first = penlink.S.token
    assert _pair("123456")[0] == 409
    assert penlink.S.token == first


def test_an_expired_code_cannot_pair():
    _live_code()
    penlink.S.code_until = time.time() - 1
    assert _pair("123456")[0] == 410
    assert penlink.S.token == ""


def test_a_wrong_code_is_refused_and_counted():
    _live_code()
    assert _pair("000000")[0] == 401
    assert penlink.S.tries == 1 and penlink.S.tries_by == {"10.0.0.9": 1}


def test_one_address_is_locked_out_after_its_tries_but_another_can_still_pair():
    _live_code()
    for _ in range(penlink.CODE_TRIES):
        assert _pair("000000", addr="10.0.0.9")[0] == 401
    assert _pair("123456", addr="10.0.0.9")[0] == 429
    assert _pair("123456", addr="10.0.0.10")[0] == 200


def test_the_code_is_spent_after_the_ceiling_over_all_addresses():
    _live_code()
    desk = Desk()
    penlink.S.desk = desk
    for i in range(penlink.CODE_CEILING):
        assert _pair("000000", addr=f"10.0.1.{i}")[0] == 401
    assert _pair("123456", addr="10.0.2.1")[0] == 410
    assert penlink._view()["locked"] is True
    assert desk.out[-1]["t"] == "status" and desk.out[-1]["locked"] is True


def test_a_tablet_socket_on_another_path_or_origin_is_closed():
    _live_code()
    penlink.S.token = "tok"
    for sent in (_ws(_hello("tok"), path="/penlink/other"), _ws(_hello("tok"), origin="http://evil.example"), _ws(_hello("tok"), origin=None)):
        assert sent == [{"type": "websocket.close", "code": 1008}]


def test_a_tablet_with_a_wrong_token_is_closed_after_accept():
    _live_code()
    penlink.S.token = "tok"
    sent = _ws(_hello("nope"))
    assert sent[0]["type"] == "websocket.accept"
    assert sent[-1] == {"type": "websocket.close", "code": 1008}
    assert penlink.S.tablet is None


def test_a_second_tablet_socket_is_refused_while_one_is_connected():
    _live_code()
    penlink.S.token = "tok"
    penlink.S.tablet = object()
    sent = _ws(_hello("tok"))
    assert sent[-1] == {"type": "websocket.close", "code": 1008}


def test_a_paired_tablet_gets_pongs_and_its_strokes_reach_the_desk():
    _live_code()
    penlink.S.token = "tok"
    desk = Desk()
    penlink.S.desk = desk
    messages = _hello("tok") + [
        _text({"t": "ping", "ts": 42}),
        _text({"t": "tool", "name": "brush"}),
        _text({"t": "shell", "cmd": "rm"}),
        {"type": "websocket.receive", "text": "not json"},
        {"type": "websocket.receive", "bytes": b"\x01\x02"},
    ]
    sent = _ws(messages)
    replies = [json.loads(m["text"]) for m in sent if m["type"] == "websocket.send"]
    assert replies == [{"t": "ok", "v": 1}, {"t": "pong", "ts": 42}]
    forwarded = [m for m in desk.out if not (isinstance(m, dict) and m.get("t") == "status")]
    assert forwarded == [{"t": "tool", "name": "brush"}, b"\x01\x02"]
    assert penlink.S.tablet is None and penlink.S.token == "tok"
    assert desk.out[-1]["t"] == "status" and desk.out[-1]["connected"] is False and desk.out[-1]["paired"] is True


def test_messages_over_the_per_second_cap_are_dropped(monkeypatch):
    monkeypatch.setattr(penlink, "time", SimpleNamespace(time=lambda: 1000.0))
    monkeypatch.setattr(penlink, "MAX_PER_SECOND", 2)
    penlink.S.hosts = {HOST}
    penlink.S.token = "tok"
    sent = _ws(_hello("tok") + [_text({"t": "ping", "ts": i}) for i in range(5)])
    pongs = [json.loads(m["text"]) for m in sent if m["type"] == "websocket.send"][1:]
    assert pongs == [{"t": "pong", "ts": 0}, {"t": "pong", "ts": 1}]


def test_the_grace_period_forgets_a_tablet_that_did_not_come_back(monkeypatch):
    monkeypatch.setattr(penlink, "GRACE_SECONDS", 0)
    penlink.S.token = "tok"
    penlink.S.device = "Pad"
    asyncio.run(penlink._grace("tok"))
    assert penlink.S.token == "" and penlink.S.device == ""


def test_the_grace_period_keeps_a_tablet_that_came_back(monkeypatch):
    monkeypatch.setattr(penlink, "GRACE_SECONDS", 0)
    penlink.S.token = "tok"
    penlink.S.tablet = object()
    asyncio.run(penlink._grace("tok"))
    assert penlink.S.token == "tok"


def test_a_new_code_forgets_the_paired_tablet_and_closes_its_socket():
    closed = []

    async def close():
        closed.append(True)

    penlink.S.server = object()
    penlink.S.token = "tok"
    penlink.S.tablet_close = close
    view = asyncio.run(penlink.new_code())
    assert closed == [True]
    assert penlink.S.token == "" and view["paired"] is False
    assert len(view["code"]) == 6 and view["code"] == penlink.S.code


def test_a_new_code_while_off_is_refused():
    with pytest.raises(HTTPException) as err:
        asyncio.run(penlink.new_code())
    assert err.value.status_code == 409


class FakeServer:
    def __init__(self, config):
        self.config = config
        self.started = False
        self.should_exit = False
        self.force_exit = False

    async def serve(self):
        self.started = True
        while not self.should_exit:
            await asyncio.sleep(0)


class DeadServer(FakeServer):
    async def serve(self):
        return None


@pytest.fixture
def quick(monkeypatch):
    real = asyncio.sleep

    async def fast(_seconds):
        await real(0)

    monkeypatch.setattr(penlink.asyncio, "sleep", fast)
    monkeypatch.setattr(penlink, "lan_ips", lambda: ["192.168.1.20"])


def test_start_opens_the_listener_and_stop_closes_it(monkeypatch, quick):
    monkeypatch.setattr(penlink, "_Quiet", FakeServer)

    async def run():
        view = await penlink.start(penlink.StartBody(port=9600))
        again = await penlink.start(penlink.StartBody(port=9700))
        server = penlink.S.server
        after = await penlink.stop()
        return view, again, server, after

    view, again, server, after = asyncio.run(run())
    assert view["on"] is True and view["port"] == 9600
    assert view["urls"] == ["http://192.168.1.20:9600/penlink/"]
    assert len(view["code"]) == 6 and 0 < view["codeSeconds"] <= penlink.CODE_SECONDS
    assert again["port"] == 9600
    assert server.config.host == "0.0.0.0" and server.config.port == 9600
    assert server.should_exit is True
    assert after["on"] is False and after["code"] == "" and after["urls"] == []
    assert penlink.S.hosts == set()


def test_start_reports_a_port_that_could_not_be_opened(monkeypatch, quick):
    monkeypatch.setattr(penlink, "_Quiet", DeadServer)
    with pytest.raises(HTTPException) as err:
        asyncio.run(penlink.start(penlink.StartBody(port=9601)))
    assert err.value.status_code == 409
    assert penlink.S.server is None and penlink.S.code == ""


def test_shutdown_forgets_the_tablet_and_tells_the_desk():
    desk = Desk()
    penlink.S.desk = desk
    penlink.S.token = "tok"
    penlink.S.code = "123456"
    asyncio.run(penlink.shutdown())
    assert penlink.S.token == "" and penlink.S.code == ""
    assert desk.out == [{"t": "status", **penlink._view()}]


class DeskSocket:
    def __init__(self, events):
        self.events = list(events)
        self.out = []
        self.closed = None
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000):
        self.closed = code

    async def send_text(self, text):
        self.out.append(json.loads(text))

    async def send_bytes(self, data):
        self.out.append(data)

    async def receive(self):
        return self.events.pop(0) if self.events else {"type": "websocket.disconnect"}


def test_the_desk_replaces_the_old_desk_and_relays_frames_but_not_huge_ones():
    got = []

    async def tx(data):
        got.append(data)

    penlink.S.tablet = tx
    old = DeskSocket([])
    penlink.S.desk = old
    ws = DeskSocket([
        {"type": "websocket.receive", "text": '{"t":"frame"}'},
        {"type": "websocket.receive", "bytes": b"ab"},
        {"type": "websocket.receive", "bytes": b"x" * 4_000_001},
    ])
    asyncio.run(penlink.desk(ws))
    assert old.closed == 1000
    assert ws.accepted is True and ws.out[0]["t"] == "status"
    assert got == ['{"t":"frame"}', b"ab"]
    assert penlink.S.desk is None


def test_the_desk_drops_frames_while_no_tablet_is_connected():
    ws = DeskSocket([{"type": "websocket.receive", "text": "frame"}])
    asyncio.run(penlink.desk(ws))
    assert ws.out == [{"t": "status", **penlink._view()}]
    assert penlink.S.desk is None


def test_the_status_route_reports_off(client):
    res = client.get("/api/penlink/status")
    assert res.status_code == 200
    assert res.json()["on"] is False and res.json()["paired"] is False


def test_the_start_route_refuses_a_privileged_or_out_of_range_port(client):
    assert client.post("/api/penlink/start", json={"port": 80}).status_code == 400
    assert client.post("/api/penlink/start", json={"port": 70000}).status_code == 400


def test_the_code_route_refuses_while_off(client):
    assert client.post("/api/penlink/code").status_code == 409
