import importlib.util
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "setup" / "mcp_stdio.py"


@pytest.fixture
def mcp(monkeypatch, tmp_path):
    for name in ("FORMMORPHEUS_MCP_URL", "FORMMORPHEUS_PORT", "FORMMORPHEUS_MCP_AUTOSTART"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("mcp_stdio_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    monkeypatch.setattr(mod, "ours", lambda base, timeout=2: False)
    return mod


def test_a_line_that_is_not_json_gets_a_parse_error(mcp):
    out = json.loads(mcp.forward("{not json"))
    assert out["id"] is None
    assert out["error"]["code"] == -32700


def test_a_batch_is_refused(mcp):
    out = json.loads(mcp.forward('[{"jsonrpc":"2.0","id":1,"method":"ping"}]'))
    assert out["error"]["code"] == -32600


def test_candidates_follow_the_url_then_the_port_then_the_defaults(mcp, monkeypatch):
    assert mcp.candidates() == ["http://127.0.0.1:9494", "http://127.0.0.1:9496"]
    monkeypatch.setenv("FORMMORPHEUS_PORT", "0")
    assert mcp.candidates() == ["http://127.0.0.1:9494", "http://127.0.0.1:9496"]
    monkeypatch.setenv("FORMMORPHEUS_PORT", " 7123 ")
    assert mcp.candidates() == ["http://127.0.0.1:7123"]
    monkeypatch.setenv("FORMMORPHEUS_MCP_URL", " http://10.0.0.2:5000/mcp ")
    assert mcp.candidates() == ["http://10.0.0.2:5000"]


def test_base_falls_back_to_the_first_candidate_when_none_answers(mcp):
    assert mcp.base() == "http://127.0.0.1:9494"
    assert mcp.STATE["base"] is None


def test_base_picks_the_candidate_that_answers_as_this_app(mcp, monkeypatch):
    monkeypatch.setattr(mcp, "ours", lambda base, timeout=2: base.endswith(":9496"))
    assert mcp.base() == "http://127.0.0.1:9496"
    assert mcp.STATE["base"] == "http://127.0.0.1:9496"


def test_an_answer_is_returned_and_the_session_and_version_are_kept(mcp, monkeypatch):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2099-01-01"}})
    monkeypatch.setattr(mcp, "post", lambda line, msg: ("  " + body + "\n", {"MCP-Session-ID": "s-1"}))
    out = mcp.forward('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
    assert json.loads(out)["result"]["protocolVersion"] == "2099-01-01"
    assert mcp.STATE["session"] == "s-1"
    assert mcp.STATE["version"] == "2099-01-01"


def test_a_notification_gets_no_answer(mcp, monkeypatch):
    monkeypatch.setattr(mcp, "post", lambda line, msg: ('{"x":1}', {}))
    assert mcp.forward('{"jsonrpc":"2.0","method":"notifications/initialized"}') is None


def test_an_empty_answer_to_a_request_is_dropped(mcp, monkeypatch):
    monkeypatch.setattr(mcp, "post", lambda line, msg: ("  \n", {}))
    assert mcp.forward('{"jsonrpc":"2.0","id":3,"method":"ping"}') is None


def test_an_engine_that_does_not_answer_gives_an_error_with_the_request_id(mcp, monkeypatch):
    monkeypatch.setenv("FORMMORPHEUS_MCP_AUTOSTART", "0")

    def down(line, msg):
        raise urllib.error.URLError("refused")

    monkeypatch.setattr(mcp, "post", down)
    out = json.loads(mcp.forward('{"jsonrpc":"2.0","id":"abc","method":"tools/list"}'))
    assert out["id"] == "abc"
    assert out["error"]["code"] == -32000
    assert mcp.forward('{"jsonrpc":"2.0","method":"notifications/x"}') is None


def test_start_engine_is_off_when_autostart_is_zero_or_a_url_is_given(mcp, monkeypatch):
    monkeypatch.setenv("FORMMORPHEUS_MCP_AUTOSTART", "0")
    assert mcp.start_engine() is False
    assert mcp.STATE["started"] is False
    monkeypatch.delenv("FORMMORPHEUS_MCP_AUTOSTART")
    monkeypatch.setenv("FORMMORPHEUS_MCP_URL", "http://127.0.0.1:1/mcp")
    assert mcp.start_engine() is False
    assert mcp.STATE["started"] is False


def test_start_engine_without_a_venv_tries_once_and_starts_nothing(mcp, monkeypatch, capsys):
    def no_spawn(*a, **k):
        raise AssertionError("must not start a program")

    monkeypatch.setattr(mcp.subprocess, "Popen", no_spawn)
    assert mcp.start_engine() is False
    assert mcp.STATE["started"] is True
    assert "no engine found" in capsys.readouterr().err
    assert mcp.start_engine() is False
    assert capsys.readouterr().err == ""


class FakeResponse:
    def __init__(self, body: str, headers: dict):
        self.body, self.headers = body, headers

    def read(self):
        return self.body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def capture_post(mcp, monkeypatch, line: str) -> dict:
    seen = {}

    def fake_urlopen(req, timeout=None):
        seen["url"] = req.full_url
        seen["headers"] = {k.lower(): v for k, v in req.header_items()}
        seen["data"] = req.data
        return FakeResponse('{"ok":true}', {"A": "b"})

    monkeypatch.setattr(mcp, "base", lambda: "http://127.0.0.1:9999")
    monkeypatch.setattr(mcp.urllib.request, "urlopen", fake_urlopen)
    body, headers = mcp.post(line, json.loads(line))
    assert body == '{"ok":true}'
    assert headers == {"A": "b"}
    return seen


def test_post_sends_the_line_to_mcp_with_the_default_protocol_version(mcp, monkeypatch):
    line = '{"jsonrpc":"2.0","id":1,"method":"ping"}'
    seen = capture_post(mcp, monkeypatch, line)
    assert seen["url"] == "http://127.0.0.1:9999/mcp"
    assert seen["data"] == line.encode("utf-8")
    assert seen["headers"]["mcp-protocol-version"] == "2025-11-25"
    assert "mcp-session-id" not in seen["headers"]


def test_post_prefers_the_meta_version_then_the_kept_version_then_the_asked_one(mcp, monkeypatch):
    meta = '{"id":1,"method":"x","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"m-1"},"protocolVersion":"p-1"}}'
    assert capture_post(mcp, monkeypatch, meta)["headers"]["mcp-protocol-version"] == "m-1"
    asked = '{"id":1,"method":"x","params":{"protocolVersion":"p-1"}}'
    assert capture_post(mcp, monkeypatch, asked)["headers"]["mcp-protocol-version"] == "p-1"
    mcp.STATE["version"] = "kept-1"
    assert capture_post(mcp, monkeypatch, asked)["headers"]["mcp-protocol-version"] == "kept-1"


def test_post_sends_the_session_except_on_initialize(mcp, monkeypatch):
    mcp.STATE["session"] = "s-9"
    seen = capture_post(mcp, monkeypatch, '{"id":1,"method":"tools/list"}')
    assert seen["headers"]["mcp-session-id"] == "s-9"
    seen = capture_post(mcp, monkeypatch, '{"id":1,"method":"initialize"}')
    assert "mcp-session-id" not in seen["headers"]


def test_main_skips_blank_lines_and_writes_each_answer_on_one_line(mcp, monkeypatch):
    got = []

    def fake_forward(line):
        got.append(line)
        return "a\nb" if line == "one" else None

    monkeypatch.setattr(mcp, "forward", fake_forward)
    out = io.StringIO()
    monkeypatch.setattr(sys, "stdin", io.StringIO("one\n\n   \n two \n"))
    monkeypatch.setattr(sys, "stdout", out)
    mcp.main()
    assert got == ["one", "two"]
    assert out.getvalue() == "a b\n"
