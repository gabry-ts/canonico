"""Regressions from the manual QA pass: routing, estimates, closed questions, uploads, webhooks, export, search."""

import json

from app import store
from app.store import STORE
from tests.conftest import assert_contract

CLEARPATH, INTERNAL = "proj-clearpath", "proj-internal"
PROJECT_TOKEN = {"X-Canonico-Token": "whsec_clearpathdemo51c7"}
WHO = {"actor": "Giulia"}
NOTE = {"type": "note", "title": "Call with ClearPath ops", "date": "2026-11-13T16:00:00Z", "text": "They said the onboarding target is 6 weeks.", "tags": ["topic:onboarding-target"]}


def ask(client, question, **extra):
    return assert_contract(client.post("/ask", json={"question": question, **extra}), "POST", "/ask")


def test_a_single_shared_keyword_is_not_a_match(client, monkeypatch):
    monkeypatch.setenv("CANONICO_ROUTER", "lexical")
    for question in ("What is the capital of France?", "Which repository hosts the project?"):
        for scope in ({}, {"project_id": CLEARPATH}):
            body = ask(client, question, **scope)
            assert body["status"] == "no_answer" and body["binding"] is None and body["topic"] is None, (question, scope)
            assert body["citations"] == []
    # The scripted demo questions still land on their topics.
    assert ask(client, "How long does onboarding take?")["topic"] == "onboarding-target"
    assert ask(client, "Is the Milan office in scope?")["topic"] == "milan-office-scope"


def test_an_estimate_is_cited_but_never_binding(client):
    body = ask(client, "Who is expanding into Germany?", topic="competitor-landscape")
    estimate = ask(client, "Which competitor is expanding southward into Germany and France?")
    assert estimate["status"] == "no_answer" and estimate["binding"] is None
    assert estimate["topic"] == "competitor-landscape"
    assert estimate["answer"].startswith("No decision is recorded on this, only an estimate")
    assert estimate["citations"] and estimate["citations"][0]["doc_id"] == "06-market-context/competitor-benchmark"
    # The topic itself has no binding fact either, so the panel and the answer agree.
    chain = assert_contract(client.get("/topics/competitor-landscape/chain"), "GET", "/topics/{topic_id}/chain")
    assert chain["topic"]["binding_fact_id"] is None
    assert body["status"] in ("contested", "no_answer")


def test_topics_name_the_fact_answers_use(client):
    topics = {t["id"]: t for t in assert_contract(client.get("/topics"), "GET", "/topics")}
    assert topics["onboarding-target"]["binding_fact_id"] == "M-106"
    assert ask(client, "How long does onboarding take?")["binding"]["id"] == topics["onboarding-target"]["binding_fact_id"]
    assert topics["audit-queue-time"]["binding_fact_id"] is None


def test_closing_an_open_question_with_an_answer_changes_ask_and_reopening_reverts(client):
    question = "What is the real audit queue time?"
    assert ask(client, question)["status"] == "contested"
    client.post("/open-questions/OQ-001/close", json={**WHO, "answer_fact_id": "M-206"})
    after = ask(client, question)
    assert after["status"] == "binding" and after["binding"]["id"] == "M-206" and after["conflicts"] == []
    assert "open question “What is the real audit queue time?”" in after["answer"]
    assert client.get("/topics/audit-queue-time/chain").json()["topic"]["binding_fact_id"] == "M-206"
    resolved = {c["id"]: c for c in client.get("/conflicts", params={"status": "resolved"}).json()}
    assert resolved["C-002"]["resolution"]["winning_fact_id"] == "M-206" and resolved["C-002"]["resolution"]["actor"] == "Giulia"
    italian = ask(client, question, locale="it")
    assert "Risponde alla domanda aperta “Qual è il tempo reale in coda di audit?”" in italian["answer"]

    close = client.get("/audit", params={"action": "close"}).json()[0]
    client.post(f"/audit/{close['id']}/undo", json={**WHO, "reason": "Reopened."})
    reopened = ask(client, question)
    assert reopened["status"] == "contested" and reopened["binding"] is None
    assert "C-002" in [c["id"] for c in client.get("/conflicts").json()]


def test_a_note_only_closure_does_not_invent_an_answer(client):
    client.post("/open-questions/OQ-001/close", json={**WHO, "note": "Measurement starts next month."})
    assert ask(client, "What is the real audit queue time?")["status"] == "contested"


def test_search_finds_a_fact_id_first(client):
    for params in ({"q": "M-105"}, {"q": "m-105", "project_id": CLEARPATH}):
        body = assert_contract(client.get("/search", params=params), "GET", "/search")
        assert body["results"][0]["id"] == "M-105" and body["results"][0]["kind"] == "fact"
    assert client.get("/search", params={"q": "M-105", "project_id": INTERNAL}).json()["results"][:1] != [{"id": "M-105"}]
    assert "M-105" not in [r["id"] for r in client.get("/search", params={"q": "M-105", "project_id": INTERNAL}).json()["results"]]


def test_export_follows_the_scope(client):
    everything = assert_contract(client.get("/export"), "GET", "/export")
    project = assert_contract(client.get("/export", params={"project_id": INTERNAL}), "GET", "/export")
    total = client.get("/facts", params={"limit": 1}).json()["total"]
    internal = client.get("/facts", params={"limit": 1, "project_id": INTERNAL}).json()["total"]
    assert len(everything["facts"]) == total and len(project["facts"]) == internal < total
    assert {f["project_id"] for f in project["facts"]} == {INTERNAL}
    assert all(e["project_id"] in (INTERNAL,) for e in project["audit"])
    assert {t["project_id"] for t in project["topics"]} == {INTERNAL}
    assert client.get("/export", params={"project_id": "nope"}).status_code == 422


def test_webhook_checks_the_token_before_the_body(client):
    url = f"/hooks/projects/{CLEARPATH}"
    for headers in ({}, {"X-Canonico-Token": "whsec_wrong"}):
        response = client.post(url, json={"type": "meeting"}, headers=headers)
        assert response.status_code == 401 and response.json() == {"code": "unauthorized", "message": "Invalid X-Canonico-Token."}
        assert "title" not in response.text
        org = client.post("/hooks/org", json={"type": "meeting"}, headers=headers)
        assert org.status_code == 401 and "title" not in org.text
    assert client.post(url, json={"type": "meeting"}, headers=PROJECT_TOKEN).status_code == 422


def test_an_identical_webhook_payload_is_a_duplicate(client):
    url = f"/hooks/projects/{CLEARPATH}"
    first = assert_contract(client.post(url, json=NOTE, headers=PROJECT_TOKEN), "POST", "/hooks/projects/{project_id}", 202)
    facts = client.get("/facts", params={"limit": 1}).json()["total"]
    again = assert_contract(client.post(url, json=NOTE, headers=PROJECT_TOKEN), "POST", "/hooks/projects/{project_id}", 202)
    assert again == {**first, "duplicate": True}
    assert client.get(f"/projects/{CLEARPATH}/items").json()["total"] == 1
    assert client.get("/facts", params={"limit": 1}).json()["total"] == facts
    assert not any(d["id"].endswith("-2") for d in client.get("/documents", params={"project_id": CLEARPATH}).json())
    changed = client.post(url, json={**NOTE, "text": NOTE["text"] + " Confirmed."}, headers=PROJECT_TOKEN).json()
    assert changed["duplicate"] is False


def test_binary_content_is_never_stored_as_a_document(client):
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".decode("utf-8", errors="replace")
    body = {"title": "qa-image", "date": "2026-11-14", "text": png, "ingest": False}
    refused = client.post("/documents", json=body)
    assert refused.status_code == 422 and "not readable text" in refused.json()["message"]
    assert client.get("/documents/qa-image").status_code == 404
    upload = client.post("/documents", files={"file": ("qa-image.png", b"\x89PNG\r\n\x1a\n\x00\x00", "image/png")}, data={"title": "qa-image", "date": "2026-11-14"})
    assert upload.status_code == 415
    spoofed = client.post("/documents", files={"file": ("qa-image.txt", b"\x89PNG\r\n\x1a\n\x00\x00", "text/plain")}, data={"title": "qa-image", "date": "2026-11-14"})
    assert spoofed.status_code in (415, 422)
    assert client.post("/documents/library/onboarding-standard/versions", json={"text": png}).status_code == 422
    assert client.post(f"/projects/{CLEARPATH}/items", json={**NOTE, "text": png}).status_code == 422
    fine = client.post("/documents", json={**body, "title": "Notes", "text": "Perché è così: 5 settimane."})
    assert fine.status_code == 201


def test_a_new_library_document_is_a_library_document(client):
    library = client.get(f"/projects/{CLEARPATH}/sources").json()["items"]
    lib = next(s for s in library if s["type"] == "document_library")
    before = lib["items"]
    body = {"title": "Travel policy", "date": "2026-11-14", "text": "Travel is booked two weeks ahead.", "ingest": False, "source_id": lib["id"], "project_id": CLEARPATH}
    created = assert_contract(client.post("/documents", json=body), "POST", "/documents", 201)
    doc = created["document"]
    assert doc["id"] == "library/travel-policy" and doc["source_id"] == lib["id"] and doc["source_type"] == "document_library"
    assert client.get(f"/sources/{lib['id']}").json()["items"] == before + 1
    assert "library/travel-policy" in [d["id"] for d in client.get(f"/sources/{lib['id']}/documents").json()]
    assert [v["version"] for v in client.get("/documents/library/travel-policy/versions").json()] == [1]
    second = client.post("/documents/library/travel-policy/versions", json={"text": "Travel is booked three weeks ahead."})
    assert second.status_code == 201 and second.json()["version"]["version"] == 2
    other = client.post("/documents", json={**body, "project_id": INTERNAL})
    assert other.status_code == 422


def test_documents_go_to_the_project_they_are_sent_to(client):
    body = {"title": "Handbook note", "date": "2026-11-14", "text": "A note for the internal project.", "ingest": False, "project_id": INTERNAL}
    doc = client.post("/documents", json=body).json()["document"]
    assert doc["project_id"] == INTERNAL and doc["source_id"] == "src-internal-docs"


def test_sources_and_members_can_be_removed(client):
    assert client.delete("/sources/src-clearpath-hook", headers={"X-Demo-Actor": "Luca"}).status_code == 403
    assert client.delete("/sources/src-clearpath-hook").json() == {"id": "src-clearpath-hook", "deleted": True}
    assert client.get("/sources/src-clearpath-hook").status_code == 404
    invited = client.post("/org/members", json={"name": "Nina Rossi", "email": "nina@meridianlabs.org", "org_role": "viewer"}).json()
    assert client.delete(f"/org/members/{invited['id']}", headers={"X-Demo-Actor": "Sara"}).status_code == 403
    assert client.delete(f"/org/members/{invited['id']}").status_code == 204
    assert invited["id"] not in [m["id"] for m in client.get("/org/members").json()["items"]]
    owners = [m for m in client.get("/org/members").json()["items"] if m["org_role"] == "owner"]
    for owner in owners[1:]:
        client.patch(f"/org/members/{owner['id']}", json={"org_role": "admin"})
    last = client.delete(f"/org/members/{owners[0]['id']}")
    assert last.status_code == 409 and last.json()["message"] == "The last owner cannot be removed."
    assert client.patch(f"/org/members/{owners[0]['id']}", json={"org_role": "viewer"}).status_code == 409


def test_a_restart_keeps_the_state_even_when_the_seed_changed(client, tmp_path, monkeypatch):
    client.post("/facts/M-105/retire", json={"reason": "Replaced.", **WHO})
    path = tmp_path / "state.json"
    monkeypatch.setenv("CANONICO_STATE_FILE", str(path))
    with STORE.read() as state:
        saved = json.loads(json.dumps(state))
    saved["seed_hash"] = "older-seed"
    del saved["tag_rules"]
    path.write_text(json.dumps(saved), encoding="utf-8")
    STORE.state = None
    try:
        assert client.get("/facts/M-105").json()["status"] == "retired"
        with STORE.read() as state:
            assert state["seed_hash"] == store.seed_hash() and "tag_rules" in state
    finally:
        STORE.state = None
        monkeypatch.undo()
        client.post("/demo/reset")
