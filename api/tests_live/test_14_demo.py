"""Scenario 14: the exact video flow after a reset, in English and in Italian."""

import pytest

from tests_live.conftest import FORCED, note

pytestmark = pytest.mark.skipif(FORCED, reason="the canned demo path is deterministic: run it without CANONICO_FORCE_LLM")

DEMO_Q = "How long does onboarding take?"
RETIRE = {"reason": "The final report replaced the verbal preview.", "actor": "Giulia"}


def flow(api, **extra) -> dict:
    api.reset()
    first = api.ask(DEMO_Q, **extra)
    assert first["status"] == "binding" and first["binding"]["id"] == "M-106" and first["binding"]["value"] == "3–4 weeks"
    assert [f["id"] for f in first["superseded"]] == ["M-101", "M-102", "M-103", "M-104"]
    assert [f["id"] for f in first["conflicts"]] == ["M-105"] and first["changed_because"] is None
    assert api.post("/facts/M-105/retire", json=RETIRE).status_code == 200
    retired = api.ask(DEMO_Q, **extra)
    assert retired["binding"]["id"] == "M-106" and retired["conflicts"] == [] and retired["changed_because"]
    assert api.post("/facts/M-105/restore", json={"reason": "Retired by mistake.", "actor": "Giulia"}).status_code == 200
    restored = api.ask(DEMO_Q, **extra)
    assert [f["id"] for f in restored["conflicts"]] == ["M-105"]
    email = api.post("/demo/send-email")
    assert email.status_code == 200, email.text
    after_email = api.ask(DEMO_Q, **extra)
    assert after_email["binding"]["value"] == "5 weeks" and after_email["binding"]["id"].startswith("E-")
    chain = api.get("/topics/onboarding-target/chain").json()
    return {"first": first["answer"], "retired": retired["changed_because"], "restored": restored["changed_because"], "email": after_email["answer"], "chain": len(chain["facts"])}


def test_video_flow_in_english(api, request):
    note(request, "en", flow(api))
    api.reset()


def test_video_flow_in_italian(api, request):
    result = flow(api, locale="it")
    api.reset()
    free = api.ask("Quanto dura l'onboarding?", locale="it")
    result["free_it"] = [free["status"], (free["binding"] or {}).get("id"), free["answer"][:120]]
    note(request, "it", result)
    assert "settimane" in result["first"]
    api.reset()
