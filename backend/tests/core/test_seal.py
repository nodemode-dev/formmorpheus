import sys
from types import SimpleNamespace

import pytest

from app.core import seal


@pytest.fixture
def ring(monkeypatch):
    store = {}
    fake = SimpleNamespace(
        get_password=lambda service, account: store.get((service, account)),
        set_password=lambda service, account, value: store.__setitem__((service, account), value),
    )
    monkeypatch.setitem(sys.modules, "keyring", fake)
    monkeypatch.setattr(seal, "_no_ld_probe", lambda: None)
    monkeypatch.setattr(seal, "_CACHE", {"tried": False, "available": False, "key": None})
    return store


@pytest.fixture
def no_ring(monkeypatch):
    def broken(*args):
        raise RuntimeError("no keychain")

    monkeypatch.setitem(sys.modules, "keyring", SimpleNamespace(get_password=broken, set_password=broken))
    monkeypatch.setattr(seal, "_no_ld_probe", lambda: None)
    monkeypatch.setattr(seal, "_CACHE", {"tried": False, "available": False, "key": None})


def test_only_the_agent_choice_is_sealed():
    assert seal.sealed({"agentsAllowed": 1, "theme": "dark"}) == {"agentsAllowed": True}
    assert seal.sealed({}) == {"agentsAllowed": False}
    assert seal.sealed({"agentsBlocked": True}) == {"agentsAllowed": False, "agentsBlocked": True}
    assert seal.sealed({"agentsBlocked": "yes"}) == {"agentsAllowed": False}


def test_the_digest_follows_the_choice_and_the_key_and_nothing_else():
    key = b"k" * 32
    on = seal.digest({"agentsAllowed": True}, key)
    assert on == seal.digest({"agentsAllowed": True, "theme": "dark", "seal": "zzz"}, key)
    assert on != seal.digest({"agentsAllowed": False}, key)
    assert on != seal.digest({"agentsAllowed": True, "agentsBlocked": True}, key)
    assert on != seal.digest({"agentsAllowed": True}, b"j" * 32)
    assert len(on) == 64


def test_signing_makes_a_key_once_and_the_settings_then_read_as_ok(ring):
    signed = seal.sign({"agentsAllowed": True, "theme": "dark"})
    stored = ring[(seal.SERVICE, seal.ACCOUNT)]
    assert len(bytes.fromhex(stored)) == 32
    assert signed["seal"] == seal.digest(signed, bytes.fromhex(stored))
    assert seal.effective(signed) == {"agentsAllowed": True, "theme": "dark", "seal": "ok", "sealBroken": False}
    seal.sign({"agentsAllowed": False})
    assert ring[(seal.SERVICE, seal.ACCOUNT)] == stored


def test_agents_turned_on_outside_the_app_are_turned_back_off(ring):
    signed = seal.sign({"agentsAllowed": False, "theme": "dark"})
    tampered = {**signed, "agentsAllowed": True}
    assert seal.effective(tampered) == {"agentsAllowed": False, "theme": "dark", "seal": "broken", "sealBroken": True}


def test_a_forged_or_missing_seal_cannot_turn_agents_on(ring):
    seal.sign({"agentsAllowed": False})
    for mark in ("0" * 64, "", None, 5):
        seen = seal.effective({"agentsAllowed": True, "seal": mark})
        assert seen["agentsAllowed"] is False
        assert seen["sealBroken"] is True
    assert seal.effective({"agentsAllowed": True})["seal"] == "broken"


def test_an_outside_change_to_an_unsealed_field_keeps_the_seal(ring):
    signed = seal.sign({"agentsAllowed": True, "theme": "dark"})
    assert seal.effective({**signed, "theme": "light"})["seal"] == "ok"


def test_settings_that_ask_for_nothing_read_as_unsealed_not_broken(ring):
    assert seal.effective({"theme": "dark"}) == {"theme": "dark", "seal": "unsealed", "sealBroken": False}
    assert seal.effective({"agentsAllowed": False, "seal": "junk"}) == {"agentsAllowed": False, "seal": "unsealed", "sealBroken": False}
    assert ring == {}


def test_agents_cannot_be_on_before_any_key_exists(ring):
    assert seal.available() is True
    seen = seal.effective({"agentsAllowed": True, "seal": "0" * 64})
    assert seen["agentsAllowed"] is False
    assert seen["seal"] == "broken"


def test_without_a_keychain_the_seal_is_reported_unavailable(no_ring):
    assert seal.available() is False
    assert seal.effective({"agentsAllowed": True, "seal": "x"}) == {"agentsAllowed": True, "seal": "unavailable", "sealBroken": False}
    assert seal.sign({"agentsAllowed": True, "seal": "old"}) == {"agentsAllowed": True}


def test_reset_forgets_what_was_learnt_about_the_keychain(ring):
    seal.sign({"agentsAllowed": True})
    assert seal._CACHE["key"] is not None
    seal.reset()
    assert seal._CACHE == {"tried": False, "available": False, "key": None}
