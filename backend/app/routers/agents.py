"""Outside agents as the window sees them: the standing choice, the questions waiting for the person and their answers
(dock contract clauses 14 to 16). Every route needs the window's key, so only the window can answer."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core import window_key
from app.services import agent_access, bridge, terminal

router = APIRouter(prefix="/api/agents", tags=["agents"])
CONTRACT = "2.2.1"
TABS = ["shell", "claude", "codex", "cursor", "antigravity"]


class ChoiceBody(BaseModel):
    value: str


class AnswerBody(BaseModel):
    choice: str


def _state(request: Request) -> dict:
    terminal.heard_on((request.scope.get("server") or (None, None))[1])
    return agent_access.state() | {"contract": CONTRACT, "pty": terminal.available(), "tabs": TABS if terminal.available() else [],
                                   "window": bridge.live(), "mcp": terminal.engine_url() + "/mcp", "waiting": len(bridge.questions())}


@router.get("")
def agents_state(request: Request) -> dict:
    window_key.require(request)
    return _state(request)


@router.post("/choice")
def set_choice(body: ChoiceBody, request: Request) -> dict:
    window_key.require(request)
    try:
        agent_access.set_choice(body.value)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if body.value == "blocked":
        bridge.refuse_all("The person blocked agents in FormMorpheus.")
    return _state(request)


@router.get("/consent")
def waiting(request: Request) -> dict:
    window_key.require(request)
    return {"requests": bridge.questions()}


@router.post("/consent/{rid}")
def answer(rid: str, body: AnswerBody, request: Request) -> dict:
    window_key.require(request)
    if body.choice not in ("deny", "once", "always"):
        raise HTTPException(422, "The answer is deny, once or always.")
    offered = next((q["offers"] for q in bridge.questions() if q["id"] == rid), None)
    if offered is not None and body.choice not in offered:
        raise HTTPException(422, f"That question offers {', '.join(offered)} only.")
    if offered is None or not bridge.answer(rid, body.choice):
        raise HTTPException(404, "That question is no longer waiting.")
    return {"ok": True}
