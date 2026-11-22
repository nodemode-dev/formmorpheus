"""The queue between agent calls and the open window, which polls it with its key (GET /api/mcp/bridge/next).

Work the engine cannot do alone (an export, an import into a movie) and the questions the dock's consent panel shows go
out through it. The pattern is FormVis 2.8.1's bridge (routers/mcp.py bridge_next, _ask); the consent request is the
dock contract's (clause 15). Only one window holds the key, so there is one poller."""
import asyncio
import collections
import itertools
import time

LIVE = 30.0
POLL = 20.0
TAKEN_LIFE = 900.0
NOTES = ["Agents change only your movie library and the movie open in this window.", "You can turn outside agents off any time in Preferences."]

_pending: collections.deque = collections.deque()
_ready: asyncio.Event | None = None
_waiting: dict[str, asyncio.Future] = {}
_taken: dict[str, float] = {}
_files: dict[str, str] = {}
_questions: dict[str, dict] = {}
_ids = itertools.count(1)
_seen = [0.0]


def _event() -> asyncio.Event:
    global _ready
    if _ready is None:
        _ready = asyncio.Event()
    return _ready


def _put(item: dict, front: bool = False) -> None:
    (_pending.appendleft if front else _pending.append)(item)
    _event().set()


def live() -> bool:
    now = time.monotonic()
    return (_seen[0] > 0 and now - _seen[0] <= LIVE) or any(now - t < TAKEN_LIFE for t in _taken.values())


async def call(kind: str, arguments: dict, timeout: float, file: str | None = None) -> dict | None:
    rid = f"w{next(_ids)}"
    fut = asyncio.get_running_loop().create_future()
    _waiting[rid] = fut
    if file:
        _files[rid] = file
    item = {"id": rid, "kind": kind, "arguments": arguments}
    _put(item)
    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        return None
    finally:
        _waiting.pop(rid, None)
        _taken.pop(rid, None)
        _files.pop(rid, None)
        if item in _pending:
            _pending.remove(item)


async def ask(agent: str, what: str, offers: list[str], timeout: float) -> str | None:
    rid = f"q{next(_ids)}"
    fut = asyncio.get_running_loop().create_future()
    _waiting[rid] = fut
    request = {"id": rid, "agent": agent, "what": what, "offers": offers, "always": "all", "expires": int((time.time() + timeout) * 1000), "escape": "deny", "notes": NOTES}
    _questions[rid] = request
    item = {"id": rid, "kind": "consent", "request": request}
    _put(item)
    reason = "expired"
    try:
        answer = await asyncio.wait_for(fut, timeout=timeout)
        reason = "answered"
        return answer
    except asyncio.TimeoutError:
        return None
    except asyncio.CancelledError:
        reason = "dropped"
        raise
    finally:
        _waiting.pop(rid, None)
        _questions.pop(rid, None)
        if item in _pending:
            _pending.remove(item)
        else:
            _put({"id": f"g{next(_ids)}", "kind": "consent_gone", "request": rid, "reason": reason})


def questions() -> list[dict]:
    return list(_questions.values())


def answer(rid: str, choice: str) -> bool:
    fut = _waiting.get(rid)
    if rid not in _questions or fut is None or fut.done():
        return False
    fut.set_result(choice)
    return True


def result(rid: str, body) -> bool:
    _seen[0] = time.monotonic()
    _taken.pop(rid, None)
    fut = _waiting.get(rid)
    if rid in _questions or fut is None or fut.done():
        return False
    fut.set_result(body if isinstance(body, dict) else {"ok": False, "error": "The window sent no result."})
    return True


def file_for(rid: str) -> str | None:
    return _files.get(rid) if rid in _taken or rid in _waiting else None


def refuse_all(text: str) -> None:
    for rid, fut in list(_waiting.items()):
        if not fut.done():
            fut.set_result("deny" if rid in _questions else {"ok": False, "error": text})


async def next_item(is_gone) -> dict | None:
    deadline = time.monotonic() + POLL
    while time.monotonic() < deadline:
        _seen[0] = time.monotonic()
        if await is_gone():
            return None
        if not _pending:
            _event().clear()
            try:
                await asyncio.wait_for(_event().wait(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
        if not _pending:
            continue
        item = _pending.popleft()
        if await is_gone():
            _put(item, front=True)
            return None
        if item["kind"] not in ("consent", "consent_gone"):
            _taken[item["id"]] = time.monotonic()
        return item
    _seen[0] = time.monotonic()
    return None
