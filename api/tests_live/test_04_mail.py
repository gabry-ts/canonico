"""Scenario 4: inbound mail read live, beyond the canned demo email."""

import uuid

from tests_live.conftest import check_invariants, note

DEMO_Q = "How long does onboarding take?"


def email(sender: str, subject: str, text: str) -> dict:
    return {
        "message_id": f"<{uuid.uuid4().hex}@{sender.split('@')[1]}>",
        "from": sender,
        "to": ["brain@inbound.meridianlabs.org"],
        "subject": subject,
        "date": "2026-11-14T10:00:00Z",
        "text": text,
    }


def send(api, message: dict) -> dict:
    response = api.post("/mail/inbound", json=message)
    assert response.status_code == 200, response.text
    return response.json()


def test_new_onboarding_target_by_email_supersedes_the_binding(api, request):
    api.reset()
    result = send(api, email("pm@meridianlabs.org", "Steering committee outcome", "Hi all,\nafter the steering committee we decided to move the onboarding target to 6 weeks for new consultants.\nBest, the PMO"))
    answer = api.ask(DEMO_Q)
    note(request, "new_target", {"result": result, "binding": answer["binding"], "status": answer["status"]})
    assert result["routed_project_id"] == "proj-clearpath"
    assert answer["status"] == "binding"
    assert "6 weeks" in answer["binding"]["value"] and answer["binding"]["doc_id"] == result["document_id"]


def test_passing_mention_of_the_old_target_does_not_bind(api, request):
    rows = []
    for text in [
        "Hi team, as we said, the 4 weeks onboarding target was the old plan and nobody uses it anymore. Talk soon.",
        "Hi team, as we said, four weeks was the old plan for onboarding and nobody uses it anymore. Talk soon.",
    ]:
        api.reset()
        result = send(api, email("pm@meridianlabs.org", "Quick recap", text))
        answer = api.ask(DEMO_Q)
        rows.append({"text": text, "facts_created": result["facts_created"], "supersedes": result["supersedes_created"], "binding": answer["binding"]["id"] if answer["binding"] else None})
    note(request, "passing_mentions", rows)
    assert all(r["binding"] == "M-106" for r in rows), rows


def test_unknown_domain_stays_at_organisation_scope(api, request):
    api.reset()
    result = send(api, email("someone@unknown-vendor.example", "Onboarding", "We decided the onboarding target is 9 weeks."))
    answer = api.ask(DEMO_Q)
    note(request, "unknown_domain", result)
    assert result["routed_project_id"] is None and result["facts_created"] == []
    assert answer["binding"]["id"] == "M-106"


def test_italian_email(api, request):
    api.reset()
    result = send(api, email("pm@meridianlabs.org", "Target onboarding", "Ciao a tutti,\nconfermiamo che il target di onboarding passa a 5 settimane per i nuovi consulenti.\nGrazie"))
    answer = api.ask(DEMO_Q)
    facts = [api.get(f"/facts/{i}").json() for i in result["facts_created"]]
    note(request, "italian_email", {"result": result, "facts": [{k: f[k] for k in ("id", "topic", "value", "type", "quote")} for f in facts], "binding": answer["binding"]})
    assert answer["status"] in ("binding", "contested")
    for fact in facts:
        assert fact["quote"] in api.document(result["document_id"])["text"]
    assert not check_invariants(api)
