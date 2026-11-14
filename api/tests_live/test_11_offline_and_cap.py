"""Scenario 11: offline mode makes no model calls, a low cost cap refuses cleanly."""

import uuid

from tests_live.conftest import CAP_USD, note

PROJECT = "proj-clearpath"
TOKEN = {"X-Canonico-Token": "whsec_clearpathdemo51c7"}
DEMO_Q = "How long does onboarding take?"


def test_offline_mode_makes_no_model_calls(api, request):
    api.configure(offline_mode=True)
    try:
        start = api.spend()
        free = api.ask("Which vendor did the board prefer for document management?")
        mail = api.post("/mail/inbound", json={"message_id": f"<{uuid.uuid4().hex}@meridianlabs.org>", "from": "pm@meridianlabs.org", "to": ["brain@inbound.meridianlabs.org"], "subject": "Hello", "date": "2026-11-13T09:00:00Z", "text": "We met the new facilities manager, very nice person."})
        item = api.post(f"/hooks/projects/{PROJECT}", json={"type": "note", "title": "Offline note", "date": "2026-11-13T09:00:00Z", "text": "The vendor shortlist now has two names."}, headers=TOKEN)
        version = api.post("/documents/library%2Faudit-handbook/versions", json={"text": "Audit handbook\nVersion 2\nEvery audit report is reviewed by one person before release."})
        ingest = api.post("/ingest", json={"force": True})
        eval_run = api.post("/eval/run")
        run = api.wait_job(f"/eval/runs/{eval_run.json()['id']}", timeout=300)
        demo = api.ask(DEMO_Q)
        retire = api.post("/facts/M-105/retire", json={"reason": "offline demo", "actor": "Giulia"})
        after = api.ask(DEMO_Q)
        restore = api.post("/facts/M-105/restore", json={"reason": "offline demo", "actor": "Giulia"})
        spent = api.spend() - start
        note(request, "offline", {"spent": spent, "free_status": free["status"], "mail": mail.status_code, "mail_facts": mail.json().get("facts_created"), "item": item.status_code, "item_facts": item.json().get("facts_created"), "version": version.status_code, "ingest": [ingest.status_code, ingest.json().get("code")], "eval_router": (run.get("result") or {}).get("router")})
        assert spent == 0
        assert mail.status_code == 200 and item.status_code == 202 and version.status_code == 201
        assert ingest.status_code == 422 and ingest.json()["code"] == "offline_mode"
        assert run["status"] == "done" and run["result"]["router"] == "keywords"
        assert demo["binding"]["id"] == "M-106" and [f["id"] for f in demo["conflicts"]] == ["M-105"]
        assert retire.status_code == 200 and after["conflicts"] == [] and after["changed_because"]
        assert restore.status_code == 200
    finally:
        api.configure(offline_mode=False)


def test_low_cost_cap_refuses_cleanly(api, request):
    spent = api.spent()
    api.configure(cost_cap_usd=min(0.01, spent) if spent > 0 else 0.0)
    try:
        ingest = api.post("/ingest", json={"force": True})
        free = api.ask("Which vendor did the board prefer for document management?")
        demo = api.ask(DEMO_Q)
        after = api.spent()
        note(request, "low_cap", {"ingest": [ingest.status_code, ingest.json()], "free_status": free["status"], "spent_delta": after - spent})
        assert ingest.status_code == 422 and ingest.json()["code"] == "cost_cap_reached"
        assert demo["binding"]["id"] == "M-106"
        assert after == spent
    finally:
        api.configure(cost_cap_usd=CAP_USD)
