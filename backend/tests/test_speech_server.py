import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.services import speech_server as relay

BASE = "/api/speech-server"
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + bytes(range(64))
LONG = "the voice is not loaded " * 40
# address mode -> the Content-Type the stand-in answers a speak with (None: no header at all)
KINDS = {
    "kind-params": "Audio/MPEG; codecs=mp3", "kind-octet": "application/octet-stream", "kind-none": None, "kind-flac": "audio/flac",
    "kind-two": "audio/x, text/html", "kind-unknown": "audio/x-made-up", "kind-svg": "image/svg+xml", "kind-script": "audio/wav\x0bx",
}


class Upstream(BaseHTTPRequestHandler):
    """A speech server on loopback. The first path segment of the address picks how it behaves."""

    def log_message(self, *args):
        pass

    def _send(self, status, kind, body, extra=()):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        for name, value in extra:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _answer(self, sent):
        mode, _, rest = self.path.lstrip("/").partition("/")
        self.server.seen.append({"method": self.command, "path": self.path, "body": sent, "type": self.headers.get("Content-Type", "")})
        if mode == "fail":
            self._send(500, "application/json", json.dumps({"error": {"message": LONG}}).encode())
        elif mode == "plain":
            self._send(404, "text/plain", b"Not Found")
        elif mode == "away":
            self._send(302, "text/plain", b"", [("Location", f"http://example.invalid/{rest}")])
        elif mode == "hop":
            self._send(302, "text/plain", b"", [("Location", f"http://localhost:{self.server.server_port}/ok/{rest}")])
        elif mode == "slow":
            self.server.release.wait(10)
            self._send(200, "audio/wav", WAV)
        elif mode == "page":
            self._send(200, "text/html", b"<h1>Not a speech server</h1>")
        elif mode == "drip":
            # headers at once, then a byte now and then for as long as anyone listens
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.end_headers()
            try:
                while not self.server.release.wait(0.05):
                    self.wfile.write(b"x")
                    self.wfile.flush()
            except OSError:
                pass
        elif mode == "driphead":
            # a status line, then a header now and then: the reply never starts
            try:
                self.wfile.write(b"HTTP/1.1 200 OK\r\n")
                count = 0
                while not self.server.release.wait(0.05) and count < 90:
                    self.wfile.write(f"X-Wait-{count}: 1\r\n".encode())
                    self.wfile.flush()
                    count += 1
            except OSError:
                pass
        elif mode == "control":
            self._send(500, "text/plain", b"bad\x00 \x1b[31mvoice\x7f\x08 \xc2\x9bname\xe2\x80\xae")
        elif mode in KINDS:
            self.send_response(200)
            if KINDS[mode] is not None:
                self.send_header("Content-Type", KINDS[mode])
            self.send_header("Content-Length", str(len(WAV)))
            self.end_headers()
            self.wfile.write(WAV)
        elif rest == "v1/models":
            shapes = {"ok": {"object": "list", "data": [{"id": "one"}, {"id": "two"}, {"id": "one"}]}, "names": {"models": [{"name": "a"}, "b", 7, {}]},
                      "bare": ["x", {"model": "y"}], "odd": {"data": "nothing"}}
            self._send(200, "application/json", json.dumps(shapes[mode]).encode())
        elif rest == "v1/audio/speech":
            self._send(200, "audio/x-wav", WAV)
        else:
            self._send(404, "text/plain", b"Not Found")

    def do_GET(self):
        self._answer(b"")

    def do_POST(self):
        self._answer(self.rfile.read(int(self.headers.get("Content-Length", "0"))))


@pytest.fixture
def upstream():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    server.daemon_threads = True
    server.seen = []
    server.release = threading.Event()
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    yield server
    server.release.set()
    server.shutdown()
    server.server_close()
    thread.join(5)


def at(server, mode="ok"):
    return f"http://127.0.0.1:{server.server_port}/{mode}"


@pytest.mark.parametrize("raw, base", [
    ("http://127.0.0.1:8080", "http://127.0.0.1:8080"),
    ("http://localhost:8080/", "http://localhost:8080"),
    ("http://[::1]:8080", "http://[::1]:8080"),
    ("https://LOCALHOST/tts/", "https://localhost/tts"),
    ("  http://127.0.0.1  ", "http://127.0.0.1"),
])
def test_the_three_loopback_hosts_are_accepted(raw, base):
    assert relay.base_url(raw) == base


@pytest.mark.parametrize("raw", [
    "http://192.168.1.20:8080", "http://10.0.0.5", "http://0.0.0.0:8080", "http://127.0.0.2:8080", "http://[::ffff:127.0.0.1]:8080",
    "http://example.com", "http://localhost.example.com", "http://127.0.0.1.example.com", "http://localhost.:8080",
    "http://user@127.0.0.1:8080", "http://user:pass@localhost", "http://127.0.0.1@example.com", "http://example.com@127.0.0.1",
    "http://@127.0.0.1", "ftp://127.0.0.1", "file:///etc/hosts", "ws://localhost:8080", "127.0.0.1:8080", "//127.0.0.1:8080", "",
    "http://127.0.0.1:port", "http://127.0.0.1:99999", "http://[::1", "http://127.0.0.1\\@example.com", "http://127.0.0.1 .example.com",
    "http://127.0.0.1:8080/?next=1", "http://127.0.0.1:8080/#top", "http://127.0.0.1\n.example.com", "http://2130706433", "http://0x7f.1",
])
def test_any_other_address_is_refused(raw):
    with pytest.raises(relay.Refused):
        relay.base_url(raw)


def test_check_lists_the_models(upstream):
    assert relay.check(at(upstream)) == {"ok": True, "models": ["one", "two"], "error": ""}
    assert upstream.seen[0]["method"] == "GET" and upstream.seen[0]["path"] == "/ok/v1/models"


@pytest.mark.parametrize("mode, models", [("names", ["a", "b"]), ("bare", ["x", "y"]), ("odd", []), ("page", [])])
def test_check_is_tolerant_of_the_shape(upstream, mode, models):
    assert relay.check(at(upstream, mode)) == {"ok": True, "models": models, "error": ""}


def test_check_reports_a_server_that_fails_or_is_not_there(upstream):
    reply = relay.check(at(upstream, "plain"))
    assert reply == {"ok": False, "models": [], "error": "The speech server answered 404: Not Found"}
    port = upstream.server_port
    upstream.release.set()
    upstream.shutdown()
    upstream.server_close()
    reply = relay.check(f"http://127.0.0.1:{port}")
    assert reply["ok"] is False and reply["error"].startswith("The speech server could not be reached: ")


def test_check_route_answers_400_for_an_address_off_this_computer(client, upstream):
    reply = client.post(f"{BASE}/check", json={"url": "http://192.168.1.20:8080"})
    assert (reply.status_code, reply.json()["detail"]) == (400, "The speech server must be on this computer: 127.0.0.1, localhost or [::1].")
    assert client.post(f"{BASE}/check", json={"url": "ftp://127.0.0.1"}).status_code == 400
    assert client.post(f"{BASE}/check", json={"url": f"http://user@127.0.0.1:{upstream.server_port}"}).status_code == 400
    assert upstream.seen == []
    assert client.post(f"{BASE}/check", json={"url": at(upstream)}).json() == {"ok": True, "models": ["one", "two"], "error": ""}


def test_speak_relays_the_body_and_the_content_type(client, upstream):
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream), "model": "m", "voice": "v", "input": "Hello there.", "speed": 1.25})
    assert reply.status_code == 200
    assert reply.content == WAV
    assert reply.headers["content-type"] == "audio/x-wav"
    asked = upstream.seen[0]
    assert (asked["method"], asked["path"], asked["type"]) == ("POST", "/ok/v1/audio/speech", "application/json")
    assert json.loads(asked["body"]) == {"model": "m", "input": "Hello there.", "voice": "v", "speed": 1.25, "response_format": "wav"}


def test_speak_refuses_an_address_off_this_computer_and_an_empty_text(client, upstream):
    reply = client.post(f"{BASE}/speak", json={"url": "http://example.com", "model": "", "voice": "", "input": "Hi", "speed": 1})
    assert reply.status_code == 400
    assert client.post(f"{BASE}/speak", json={"url": at(upstream), "model": "", "voice": "", "input": "", "speed": 1}).status_code == 422
    assert upstream.seen == []


def test_an_upstream_error_is_502_with_the_message_trimmed(client, upstream):
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, "fail"), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert reply.status_code == 502
    said = reply.json()["detail"]
    lead = "The speech server answered 500: "
    assert said.startswith(lead + "the voice is not loaded the voice")
    assert len(said) == len(lead) + 300


def test_a_reply_that_is_not_sound_is_502(client, upstream):
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, "page"), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert reply.status_code == 502
    assert reply.json()["detail"].startswith("The speech server did not send sound (it sent text/html)")


def test_a_redirect_off_this_computer_is_refused(client, upstream):
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, "away"), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert (reply.status_code, reply.json()["detail"]) == (502, "The speech server sent the engine to an address that is not on this computer.")
    assert len(upstream.seen) == 1
    check = relay.check(at(upstream, "away"))
    assert check == {"ok": False, "models": [], "error": "The speech server sent the engine to an address that is not on this computer."}
    handler = relay._LoopbackOnly()
    for target in ("http://example.invalid/x", "http://192.168.1.20/x", "http://user@127.0.0.1/x", "ftp://127.0.0.1/x"):
        with pytest.raises(relay.urllib.error.URLError):
            handler.redirect_request(None, None, 302, "Found", {}, target)


def test_a_redirect_that_stays_on_this_computer_is_followed(upstream):
    assert relay.check(at(upstream, "hop")) == {"ok": True, "models": ["one", "two"], "error": ""}
    assert [seen["path"] for seen in upstream.seen] == ["/hop/v1/models", "/ok/v1/models"]


def test_a_server_that_does_not_answer_in_time_is_504(client, upstream, monkeypatch):
    monkeypatch.setattr(relay, "SPEAK_TIMEOUT_SECONDS", 0.2)
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, "slow"), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert (reply.status_code, reply.json()["detail"]) == (504, "The speech server did not answer within 0.2 seconds.")


def test_a_reply_over_the_cap_is_dropped(client, upstream, monkeypatch):
    monkeypatch.setattr(relay, "MAX_REPLY_BYTES", 16)
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert reply.status_code == 502 and "more than 200 MB" in reply.json()["detail"]


def test_the_relay_needs_the_window_key_and_never_uses_a_proxy(anon_client, upstream, monkeypatch):
    assert anon_client.post(f"{BASE}/check", json={"url": at(upstream)}).status_code == 403
    assert upstream.seen == []
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9")
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.delenv("no_proxy", raising=False)
    monkeypatch.delenv("NO_PROXY", raising=False)
    assert relay.check(at(upstream))["ok"] is True


@pytest.mark.parametrize("raw", ["http://127.0.0.1/é", "http://127.0.0.1:8080/голос", "http://ｌｏｃａｌｈｏｓｔ:8080", "http://localhost:٨٠/", "http://127.0.0.1/a\x7fb"])
def test_an_address_that_is_not_plain_ascii_is_refused_with_a_sentence(client, upstream, raw):
    with pytest.raises(relay.Refused):
        relay.base_url(raw)
    for route, body in (("check", {"url": raw}), ("speak", {"url": raw, "model": "m", "voice": "v", "input": "Hi", "speed": 1})):
        reply = client.post(f"{BASE}/{route}", json=body)
        assert reply.status_code == 400
        assert reply.json()["detail"].startswith("The speech server address ")
    assert upstream.seen == []


def test_a_reply_that_drips_is_cut_off_at_the_total_deadline(client, upstream, monkeypatch):
    monkeypatch.setattr(relay, "CHECK_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(relay, "SPEAK_TIMEOUT_SECONDS", 0.3)
    began = time.monotonic()
    assert relay.check(at(upstream, "drip")) == {"ok": False, "models": [], "error": "The speech server did not answer within 0.3 seconds."}
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, "drip"), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert (reply.status_code, reply.json()["detail"]) == (504, "The speech server did not answer within 0.3 seconds.")
    assert time.monotonic() - began < 3


def test_headers_that_drip_are_cut_off_at_the_total_deadline(upstream, monkeypatch):
    monkeypatch.setattr(relay, "CHECK_TIMEOUT_SECONDS", 0.3)
    began = time.monotonic()
    assert relay.check(at(upstream, "driphead")) == {"ok": False, "models": [], "error": "The speech server did not answer within 0.3 seconds."}
    assert time.monotonic() - began < 3


def test_the_deadlines_are_five_seconds_to_check_and_five_minutes_to_speak():
    assert (relay.CHECK_TIMEOUT_SECONDS, relay.SPEAK_TIMEOUT_SECONDS) == (5, 300)


@pytest.mark.parametrize("mode, kind", [("kind-params", "audio/mpeg"), ("kind-octet", "application/octet-stream"), ("kind-none", "audio/wav"),
                                        ("kind-flac", "audio/flac"), ("ok", "audio/x-wav")])
def test_a_known_sound_type_is_answered_in_its_plain_form(client, upstream, mode, kind):
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, mode), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert reply.status_code == 200
    assert reply.headers["content-type"] == kind
    assert reply.content == WAV


@pytest.mark.parametrize("mode", ["kind-two", "kind-unknown", "kind-svg", "kind-script", "page"])
def test_any_other_type_is_502_and_never_passed_on(client, upstream, mode):
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, mode), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert reply.status_code == 502
    said = reply.json()["detail"]
    assert said.startswith("The speech server did not send sound (it sent ")
    assert reply.headers["content-type"] == "application/json"
    assert all(ch.isprintable() for ch in said)


def test_the_accepted_sound_types_are_the_eleven_listed():
    assert set(relay.SOUND_TYPES) == {"audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/flac", "audio/aac",
                                      "audio/mp4", "audio/webm", "application/octet-stream"}


def test_what_a_failing_server_said_is_echoed_without_control_characters(client, upstream):
    reply = client.post(f"{BASE}/speak", json={"url": at(upstream, "control"), "model": "m", "voice": "v", "input": "Hi", "speed": 1})
    assert reply.status_code == 502
    assert reply.json()["detail"] == "The speech server answered 500: bad [31mvoice name"
    assert relay._message(("a\x00b\x01" * 400).encode()) == "ab" * 150
