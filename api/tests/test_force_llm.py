"""CANONICO_FORCE_LLM is a switch for live tests. It is off by default and the demo path never needs it."""

import pytest

from app import engine, extract, llm, statements
from app.store import STORE

Q = "How long does onboarding take?"


def test_the_switch_is_off_by_default():
    assert llm.forced() is False


def test_with_the_switch_off_the_demo_flow_makes_no_model_call(client, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("the demo path called the model")

    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(engine, "model_route", refuse)
    monkeypatch.setattr(extract, "extract_document", refuse)
    body = client.post("/ask", json={"question": Q}).json()
    assert body["binding"]["id"] == "M-106" and [f["id"] for f in body["conflicts"]] == ["M-105"]
    sent = client.post("/demo/send-email").json()
    assert sent["supersedes_created"] and client.post("/ask", json={"question": Q}).json()["binding"]["value"] == "5 weeks"


def test_with_the_switch_on_rules_aliases_and_cache_are_skipped(monkeypatch, tmp_path):
    monkeypatch.setenv("CANONICO_LLM_CACHE", str(tmp_path))
    monkeypatch.setattr(llm, "available", lambda: False)
    schema = {"type": "object"}
    path = tmp_path / f"{llm._cache_key('claude-haiku-5-5', 's', 'u', schema, 10, 'low')}.json"
    path.write_text('{"data": {"cached": true}}', encoding="utf-8")
    assert llm.complete_json("claude-haiku-5-5", "s", "u", schema, llm.Meter(cap_usd=1), max_tokens=10) == {"cached": True}
    monkeypatch.setenv("CANONICO_FORCE_LLM", "1")
    with pytest.raises(llm.LLMUnavailable):
        llm.complete_json("claude-haiku-5-5", "s", "u", schema, llm.Meter(cap_usd=1), max_tokens=10)
    with STORE.read() as state:
        assert engine.alias_topic(state, Q) is None
        assert statements.find(state, "We confirm the onboarding target at 5 weeks.", "proj-clearpath") == []
