"""Scenario 5: webhooks and uploaded items read live."""

import http.server
import json
import re
import tempfile
import threading
import uuid
from pathlib import Path

import httpx
import pytest

from tests_live import fixtures
from tests_live.conftest import FORCED, note, spawn_server, stop_server

PROJECT = "proj-clearpath"
PROJECT_TOKEN = {"X-Canonico-Token": "whsec_clearpathdemo51c7"}
ORG_TOKEN = {"X-Canonico-Token": "whsec_x7Kq2demo9f2a"}
DEMO_Q = "How long does onboarding take?"


def item(kind: str, title: str, text: str | None = None, **extra) -> dict:
    body = {"type": kind, "title": title, "date": "2026-11-13T10:00:00Z", **extra}
    if text is not None:
        body["text"] = text
    return body


def verbatim(api, result: dict) -> list[str]:
    text = api.document(result["document_id"])["text"]
    bad = []
    for fact_id in result["facts_created"]:
        fact = api.get(f"/facts/{fact_id}").json()
        if fact["quote"] not in text:
            bad.append(fact_id)
    return bad


def facts_of(api, fact_ids: list[str]) -> list[dict]:
    return [api.get(f"/facts/{i}").json() for i in fact_ids]


def test_long_meeting_transcript_with_a_reversal(api, request):
    text, expected = fixtures.transcript()
    response = api.post(f"/hooks/projects/{PROJECT}", json=item("meeting", "Ops steering meeting", text, participants=["Alessia", "Tomas", "Priya", "Jonas", "Marta"], tags=["ops"]), headers=PROJECT_TOKEN)
    assert response.status_code == 202, response.text
    result = response.json()
    facts = facts_of(api, result["facts_created"])
    rows = [{k: f[k] for k in ("id", "topic", "value", "type", "status", "superseded_by", "quote")} for f in facts]
    sla = [f for f in facts if "intake" in (f["value"] + f["topic"]).lower() and ("sla" in (f["value"] + f["topic"]).lower() or "response" in f["value"].lower())]
    bindings = {}
    for topic in {f["topic"] for f in sla}:
        answer = api.post("/ask", json={"question": "intake response SLA", "topic": topic}).json()
        bindings[topic] = (answer["binding"] or {}).get("value"), answer["status"]
    note(request, "transcript", {"words": len(text.split()), "facts": rows, "sla_bindings": bindings, "expected": expected})
    assert len(result["facts_created"]) >= 3
    assert not verbatim(api, result)
    # the binding states the later value; it may mention the earlier one ("after reversing the 5-day decision")
    reversal_ok = any(value and re.search(r"\b3 business days?\b|\bthree business days?\b", value) for value, _ in bindings.values())
    note(request, "reversal_reflected", reversal_ok)
    assert reversal_ok, f"later value (3 business days) not binding: {bindings}"


def test_note_and_ticket(api, request):
    rows = []
    for kind, title, text in [
        ("note", "Call with the ClearPath service desk", "Spoke with the desk lead: they now process about 120 tickets a week, up from 90 in the summer, and the backlog is under control."),
        ("ticket", "CR-118 change of reporting cadence", "Approved by the steering group: the client status report moves from weekly to every two weeks starting in December."),
    ]:
        response = api.post(f"/hooks/projects/{PROJECT}", json=item(kind, title, text), headers=PROJECT_TOKEN)
        assert response.status_code == 202, response.text
        result = response.json()
        rows.append({"kind": kind, "facts": [{k: f[k] for k in ("id", "topic", "value", "type")} for f in facts_of(api, result["facts_created"])]})
        assert not verbatim(api, result)
    note(request, "note_ticket", rows)
    assert all(r["facts"] for r in rows), rows


def multipart(api, filename: str, data: bytes, content_type: str, metadata: dict):
    return api.post(f"/projects/{PROJECT}/items", files={"file": (filename, data, content_type)}, data={"metadata": json.dumps(metadata)})


def test_docx_and_pdf_uploads(api, request):
    docx = fixtures.docx_bytes(["Quality review policy", "Decision of the quality board: every escalated request gets a second review within 2 days.", "Owner: quality team."])
    pdf = fixtures.pdf_bytes(["Vendor review", "The vendor contract renewal was approved for 24 months.", "Signed off by finance."])
    rows = []
    for name, data, kind in [("policy.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), ("vendor.pdf", pdf, "application/pdf")]:
        response = multipart(api, name, data, kind, {"type": "document", "title": name, "date": "2026-11-12T09:00:00Z"})
        assert response.status_code == 202, response.text
        result = response.json()
        stored = api.document(result["document_id"])["text"]
        rows.append({"file": name, "facts": result["facts_created"], "text_has_body": "approved" in stored or "second review" in stored})
        assert not verbatim(api, result)
    note(request, "files", rows)
    assert all(r["text_has_body"] and r["facts"] for r in rows), rows


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def test_file_url(api, request):
    folder = Path(tempfile.mkdtemp(prefix="canonico-files-"))
    (folder / "minutes.txt").write_text("Minutes of the capacity review.\nDecision: the intake team grows from 4 to 6 coordinators in January.\n", encoding="utf-8")
    handler = lambda *a, **kw: _Quiet(*a, directory=str(folder), **kw)  # noqa: E731
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/minutes.txt"
    try:
        body = item("document", "Capacity review minutes", file_url=url)
        refused = api.post(f"/hooks/projects/{PROJECT}", json=body, headers=PROJECT_TOKEN)
        note(request, "private_refused", refused.status_code)
        assert refused.status_code == 422, refused.text
        if not api.local:
            return
        workdir = Path(tempfile.mkdtemp(prefix="canonico-live-fetch-"))
        proc, base = spawn_server(workdir, {"CANONICO_ALLOW_PRIVATE_FETCH": "1"})
        try:
            response = httpx.post(f"{base}/hooks/projects/{PROJECT}", json=body, headers=PROJECT_TOKEN, timeout=120)
            assert response.status_code == 202, response.text
            result = response.json()
            text = httpx.get(f"{base}/documents/{result['document_id']}").json()["text"]
            spent = httpx.get(f"{base}/stats").json()["cost"]["spent_usd"]
            note(request, "file_url", {"result": result, "cost_usd_second_server": spent})
            assert "6 coordinators" in text and result["facts_created"]
        finally:
            stop_server(proc)
    finally:
        server.shutdown()


def test_topic_tag_forces_the_topic_and_confirms(api, request):
    response = api.post("/hooks/org", json=item("meeting", "Steering committee 12 Nov", "We agreed the onboarding target stays at 3–4 weeks.", tags=["clearpath", "topic:onboarding-target"]), headers=ORG_TOKEN)
    assert response.status_code == 202, response.text
    result = response.json()
    answer = api.ask(DEMO_Q)
    note(request, "forced_topic", {"result": result, "binding": answer["binding"]["id"]})
    assert result["routed_by"] == "tag_rule"
    if FORCED:
        # the model may file the restatement as a newer fact replacing M-106: the value must not change
        assert answer["binding"]["value"].replace("-", "–").find("3–4 weeks") >= 0, answer["binding"]
    else:
        assert result["supersedes_created"] == [] and answer["binding"]["id"] == "M-106"


def test_version_of_creates_a_library_version(api, request):
    current = api.document("library%2Fonboarding-standard")["text"]
    text = current.replace("Version 2", "Version 3").replace("3–4 weeks", "5 weeks")
    response = api.post(f"/hooks/projects/{PROJECT}", json=item("document", "Onboarding standard", text, version_of="library/onboarding-standard"), headers=PROJECT_TOKEN)
    assert response.status_code == 202, response.text
    versions = api.get("/documents/library%2Fonboarding-standard/versions").json()
    note(request, "version_of", {"result": response.json(), "versions": [v.get("version") for v in versions]})
    assert len(versions) == 3


def test_external_id_is_idempotent(api, request):
    body = item("note", "Desk call", "Agreed with the desk: weekly backlog review moves to Thursdays at 10.", external_id=f"ext-{uuid.uuid4().hex}")
    first = api.post(f"/hooks/projects/{PROJECT}", json=body, headers=PROJECT_TOKEN).json()
    facts_before = api.stats()["facts_total"]
    second = api.post(f"/hooks/projects/{PROJECT}", json=body, headers=PROJECT_TOKEN).json()
    note(request, "idempotency", {"first": first, "second": second})
    assert second["duplicate"] is True and second["item_id"] == first["item_id"]
    assert api.stats()["facts_total"] == facts_before


def test_wrong_token_and_routing(api, request):
    wrong = api.post(f"/hooks/projects/{PROJECT}", json=item("note", "x", "y"), headers={"X-Canonico-Token": "whsec_wrong"})
    assert wrong.status_code == 401
    wrong_org = api.post("/hooks/org", json=item("note", "x", "y", tags=["clearpath"]), headers={"X-Canonico-Token": "whsec_wrong"})
    assert wrong_org.status_code == 401
    routed = api.post("/hooks/org", json=item("note", "Ops note", "Agreed: the backlog review is held every Monday.", tags=["clearpath"]), headers=ORG_TOKEN)
    assert routed.status_code == 202 and routed.json()["routed_by"] == "tag_rule"
    unroutable = api.post("/hooks/org", json=item("note", "Stray", "Nothing to route here.", tags=["nobody-knows-this-tag"]), headers=ORG_TOKEN)
    note(request, "routing", {"routed": routed.json(), "unroutable": unroutable.json()})
    assert unroutable.status_code == 422 and unroutable.json()["code"] == "unroutable"
