"""The person's standing choice for outside agents: ask (the default: nothing changes until the person says yes in the
window), allowed or blocked. Kept in settings.json beside libraryDir and sealed (core/seal.py), as FormDeck keeps it."""
from app.core import config, seal

CHOICES = ("ask", "allowed", "blocked")


def state() -> dict:
    s = seal.effective(config.read_settings())
    value = "blocked" if s.get("agentsBlocked") is True else "allowed" if s.get("agentsAllowed") is True else "ask"
    return {"choice": value, "changedOutside": bool(s.get("sealBroken")), "seal": s.get("seal")}


def choice() -> str:
    return state()["choice"]


def set_choice(value: str) -> dict:
    if value not in CHOICES:
        raise ValueError(f"The choice is one of {', '.join(CHOICES)}.")
    stored = {k: v for k, v in config.read_settings().items() if k not in ("agentsAllowed", "agentsBlocked", seal.FIELD)}
    if value == "allowed":
        stored["agentsAllowed"] = True
    elif value == "blocked":
        stored["agentsBlocked"] = True
    config.write_settings(seal.sign(stored))
    return state()
