"""Scenario 13: real mail (IMAP mode, GreenMail in the Docker stack) and the S3 document library (Garage)."""

import pytest

from tests_live.conftest import FORCED, note

DEMO_Q = "How long does onboarding take?"
DOC = "library%2Fonboarding-standard"


def library_source(api) -> dict | None:
    response = api.get("/projects/proj-clearpath/sources")
    assert response.status_code == 200, response.text
    body = response.json()
    rows = body["items"] if isinstance(body, dict) else body
    return next((s for s in rows if s["type"] == "document_library" and (s.get("config") or {}).get("provider") == "s3"), None)


def test_demo_email_goes_through_smtp_and_imap(api, request):
    mail = api.get("/org/mail").json()
    if (mail or {}).get("mode") != "imap":
        pytest.skip(f"mail mode is {(mail or {}).get('mode')}, not imap")
    if FORCED:
        pytest.skip("the canned demo email is deterministic: run it without CANONICO_FORCE_LLM")
    sent = api.post("/demo/send-email")
    assert sent.status_code == 200, sent.text
    polled = api.post("/mail/poll", json={"project_id": "proj-clearpath"})
    assert polled.status_code == 200, polled.text
    answer = api.ask(DEMO_Q)
    note(request, "imap", {"sent": sent.json(), "polled": polled.json().get("polled"), "binding": answer["binding"]})
    assert answer["binding"]["value"] == "5 weeks", answer["binding"]


def test_s3_library_versions_and_sync(api, request):
    source = library_source(api)
    if source is None:
        pytest.skip("no s3 document library source on this server")
    before = api.get(f"/documents/{DOC}/versions")
    assert before.status_code == 200, before.text
    sync = api.post(f"/sources/{source['id']}/sync")
    assert sync.status_code == 202, sync.text
    job = api.wait_job(f"/sync-jobs/{sync.json()['id']}", timeout=120, done=("done", "error", "failed"))
    text = "Onboarding standard\nVersion 3, ClearPath Solutions\nOwner: Operations\n\nTarget\nOnboarding target: 5 weeks to autonomy.\n"
    created = api.post(f"/documents/{DOC}/versions", json={"version_label": "v3-live", "date": "2026-11-14", "text": text})
    assert created.status_code == 201, created.text
    after = api.get(f"/documents/{DOC}/versions").json()
    note(request, "s3", {"source": source["id"], "sync": job, "versions_before": len(before.json()), "versions_after": len(after), "result": created.json()})
    assert job["status"] == "done", job
    assert len(after) == len(before.json()) + 1
    assert any(v.get("version_label") == "v3-live" for v in after)
