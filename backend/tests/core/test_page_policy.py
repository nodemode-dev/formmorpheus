import base64
import hashlib

import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from app.core import page_policy


@pytest.fixture
def dist(tmp_path, monkeypatch):
    folder = tmp_path / "dist"
    folder.mkdir()
    monkeypatch.setenv("FORMMORPHEUS_DIST", str(folder))
    monkeypatch.setattr(page_policy, "_made", {})
    return folder


def mark(body: bytes) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(body).digest()).decode("ascii") + "'"


def script_rule(policy: bytes) -> str:
    return next(rule for rule in policy.decode("ascii").split("; ") if rule.startswith("script-src"))


def test_without_a_built_page_scripts_come_only_from_the_engine(dist):
    assert script_rule(page_policy.policy()) == "script-src 'self' 'wasm-unsafe-eval'"


def test_the_policy_forbids_framing_plugins_and_foreign_sources(dist):
    rules = page_policy.policy().decode("ascii").split("; ")
    assert "default-src 'self'" in rules
    assert "object-src 'none'" in rules
    assert "frame-ancestors 'none'" in rules
    assert "base-uri 'self'" in rules
    assert "form-action 'self'" in rules
    assert "'unsafe-eval'" not in script_rule(page_policy.policy())
    assert "'unsafe-inline'" not in script_rule(page_policy.policy())


def test_each_inline_script_of_the_page_is_allowed_by_its_hash(dist):
    one, two = b"window.a = 1;", b"\n  boot();\n"
    page = b"<html><script>" + one + b"</script><script src=\"/main.js\"></script><script type=\"module\">" + two + b"</script></html>"
    (dist / "index.html").write_bytes(page)
    rule = script_rule(page_policy.policy())
    assert rule == "script-src 'self' 'wasm-unsafe-eval' " + mark(one) + " " + mark(two)
    assert mark(b"") not in rule


def test_the_policy_follows_a_rebuilt_page(dist):
    (dist / "index.html").write_bytes(b"<script>first()</script>")
    assert mark(b"first()") in script_rule(page_policy.policy())
    (dist / "index.html").write_bytes(b"<script>second_longer()</script>")
    rule = script_rule(page_policy.policy())
    assert mark(b"second_longer()") in rule
    assert mark(b"first()") not in rule
    assert len(page_policy._made) == 1


def make_client() -> TestClient:
    app = FastAPI()

    @app.get("/")
    def page() -> Response:
        return Response("<html></html>", media_type="text/html", headers={"content-security-policy": "default-src *"})

    @app.get("/api/thing")
    def thing() -> dict:
        return {"ok": True}

    app.add_middleware(page_policy.PagePolicy)
    return TestClient(app, base_url="http://127.0.0.1:9494")


def test_a_page_gets_the_policy_in_place_of_any_weaker_one(dist):
    answer = make_client().get("/")
    assert answer.headers.get_list("content-security-policy") == [page_policy.policy().decode("ascii")]
    assert answer.headers["x-content-type-options"] == "nosniff"
    assert answer.headers["referrer-policy"] == "no-referrer"
    assert answer.text == "<html></html>"


def test_a_missing_page_still_gets_the_policy(dist):
    answer = make_client().get("/nowhere")
    assert answer.status_code == 404
    assert "frame-ancestors 'none'" in answer.headers["content-security-policy"]


def test_api_answers_are_left_alone(dist):
    answer = make_client().get("/api/thing")
    assert answer.json() == {"ok": True}
    assert "content-security-policy" not in answer.headers
    assert "referrer-policy" not in answer.headers
