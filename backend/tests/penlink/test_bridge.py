import asyncio
import collections
import time

import pytest

from app.services import bridge


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(bridge, "_pending", collections.deque())
    monkeypatch.setattr(bridge, "_ready", None)
    monkeypatch.setattr(bridge, "_waiting", {})
    monkeypatch.setattr(bridge, "_taken", {})
    monkeypatch.setattr(bridge, "_files", {})
    monkeypatch.setattr(bridge, "_questions", {})
    monkeypatch.setattr(bridge, "_seen", [0.0])


async def _never():
    return False


async def _always():
    return True


def test_a_call_gets_the_result_the_window_sends():
    async def run():
        task = asyncio.create_task(bridge.call("export", {"a": 1}, timeout=5, file="/tmp/out.mp4"))
        item = await bridge.next_item(_never)
        path = bridge.file_for(item["id"])
        accepted = bridge.result(item["id"], {"ok": True, "n": 3})
        return item, path, accepted, await task

    item, path, accepted, value = asyncio.run(run())
    assert item["kind"] == "export" and item["arguments"] == {"a": 1}
    assert path == "/tmp/out.mp4"
    assert accepted is True
    assert value == {"ok": True, "n": 3}
    assert bridge.file_for(item["id"]) is None
    assert bridge.result(item["id"], {"ok": True}) is False


def test_a_result_that_is_not_a_dict_becomes_a_failure():
    async def run():
        task = asyncio.create_task(bridge.call("import", {}, timeout=5))
        item = await bridge.next_item(_never)
        bridge.result(item["id"], "garbage")
        return await task

    value = asyncio.run(run())
    assert value["ok"] is False and value["error"]


def test_a_call_nobody_answers_times_out_and_leaves_the_queue():
    assert asyncio.run(bridge.call("export", {}, timeout=0)) is None
    assert list(bridge._pending) == []
    assert bridge._waiting == {}


def test_the_window_is_live_only_after_it_was_seen_recently():
    assert bridge.live() is False
    bridge.result("w999", {"ok": True})
    assert bridge.live() is True
    bridge._seen[0] = time.monotonic() - bridge.LIVE - 5
    assert bridge.live() is False
    bridge._taken["w1"] = time.monotonic()
    assert bridge.live() is True


def test_a_consent_question_is_listed_and_answered():
    async def run():
        task = asyncio.create_task(bridge.ask("helper", "export a movie", ["once", "always"], timeout=5))
        await asyncio.sleep(0)
        listed = bridge.questions()
        item = await bridge.next_item(_never)
        ok = bridge.answer(item["id"], "once")
        again = bridge.answer(item["id"], "always")
        return listed, item, ok, again, await task

    listed, item, ok, again, choice = asyncio.run(run())
    assert len(listed) == 1
    assert listed[0]["agent"] == "helper" and listed[0]["offers"] == ["once", "always"] and listed[0]["escape"] == "deny"
    assert item["kind"] == "consent" and item["request"]["id"] == item["id"]
    assert ok is True and again is False
    assert choice == "once"
    assert bridge.questions() == []
    gone = list(bridge._pending)
    assert len(gone) == 1 and gone[0]["kind"] == "consent_gone"
    assert gone[0]["request"] == item["id"] and gone[0]["reason"] == "answered"
    assert item["id"] not in bridge._taken


def test_an_unshown_question_that_expires_leaves_no_trace():
    assert asyncio.run(bridge.ask("helper", "x", ["once"], timeout=0)) is None
    assert list(bridge._pending) == []
    assert bridge.questions() == []


def test_a_question_cannot_be_answered_through_result_and_a_call_not_through_answer():
    async def run():
        q = asyncio.create_task(bridge.ask("helper", "x", ["once"], timeout=5))
        c = asyncio.create_task(bridge.call("export", {}, timeout=5))
        await asyncio.sleep(0)
        qid = bridge.questions()[0]["id"]
        cid = next(k for k in bridge._waiting if k != qid)
        out = (bridge.result(qid, {"ok": True}), bridge.answer(cid, "once"), bridge.answer("q404", "once"))
        bridge.refuse_all("closed")
        return out, await q, await c

    out, q, c = asyncio.run(run())
    assert out == (False, False, False)
    assert q == "deny"
    assert c == {"ok": False, "error": "closed"}


def test_next_item_returns_nothing_when_the_window_is_gone_and_keeps_the_work():
    bridge._put({"id": "w1", "kind": "export", "arguments": {}})
    assert asyncio.run(bridge.next_item(_always)) is None
    assert [i["id"] for i in bridge._pending] == ["w1"]


def test_work_taken_by_a_window_that_left_goes_back_to_the_front():
    bridge._put({"id": "w1", "kind": "export", "arguments": {}})
    bridge._put({"id": "w2", "kind": "export", "arguments": {}})
    calls = []

    async def gone_after_pop():
        calls.append(1)
        return len(calls) > 1

    assert asyncio.run(bridge.next_item(gone_after_pop)) is None
    assert [i["id"] for i in bridge._pending] == ["w1", "w2"]
    assert bridge._taken == {}


def test_items_are_handed_out_in_order_and_only_work_is_marked_taken():
    bridge._put({"id": "w1", "kind": "export", "arguments": {}})
    bridge._put({"id": "q2", "kind": "consent", "request": {}})

    async def run():
        return await bridge.next_item(_never), await bridge.next_item(_never)

    first, second = asyncio.run(run())
    assert first["id"] == "w1" and second["id"] == "q2"
    assert "w1" in bridge._taken and "q2" not in bridge._taken


def test_an_empty_poll_ends_with_nothing_and_marks_the_window_seen(monkeypatch):
    monkeypatch.setattr(bridge, "POLL", 0.0)
    assert asyncio.run(bridge.next_item(_never)) is None
    assert bridge.live() is True
