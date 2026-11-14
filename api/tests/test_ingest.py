import time

import pytest

from app import extract, llm
from tests.conftest import assert_contract


def fake_complete(model, system, user, schema, meter, name="result", max_tokens=8000, effort="low"):
    meter.settle(0.0, 0.001, 100, 50)
    if name == "facts":
        if "Document id: 01-scope/requirements" not in user:
            return {"facts": []}
        return {
            "facts": [
                {"topic": "audit turnaround requirement", "value": "Audit turnaround must drop to 5 business days", "short": "5 business days", "type": "CONSTRAINT",
                 "quote": "Reduce time-to-independence for new consultants from the current ~6 weeks to 3 weeks or less.", "date": "2025-09-29", "confidence": 0.9},
                {"topic": "audit turnaround requirement", "value": "Invented fact", "short": "x", "type": "EVIDENCE",
                 "quote": "this sentence is not in the document at all", "date": "2025-09-29", "confidence": 0.9},
            ]
        }
    if name == "topics":
        ids = [line.split(" | ")[0] for line in user.splitlines() if line.startswith("F")]
        return {"topics": [{"id": "audit-turnaround", "label": "Audit turnaround", "question": "What is the audit turnaround requirement?", "keywords": ["audit", "turnaround"], "fact_ids": ids}]}
    if name == "types":
        ids = [line.split(" | ")[0] for line in user.splitlines() if line.startswith("M-")]
        return {"facts": [{"id": i, "type": "HYPOTHESIS", "confidence": 0.4} for i in ids]}
    return {"links": [], "conflicts": []}


def wait_for(client, job_id):
    for _ in range(100):
        job = client.get(f"/ingest/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_ingest_returns_the_existing_job_unless_forced(client):
    job = assert_contract(client.post("/ingest", json={"corpus": "org-consulting-clearpath", "force": False}), "POST", "/ingest", 202)
    assert job["status"] == "done" and job["docs"] == 46
    assert assert_contract(client.get(f"/ingest/{job['id']}"), "GET", "/ingest/{job_id}") == job
    assert assert_contract(client.get("/ingest/jobs"), "GET", "/ingest/jobs")[0] == job
    assert client.get("/ingest/jobs", params={"status": "running"}).json() == []
    assert_contract(client.get("/ingest/job-nope"), "GET", "/ingest/{job_id}", 404)
    assert_contract(client.post("/ingest", json={"corpus": "other"}), "POST", "/ingest", 422)


def test_forced_ingest_without_a_provider_is_refused(client):
    body = assert_contract(client.post("/ingest", json={"force": True}), "POST", "/ingest", 422)
    assert body["code"] == "llm_unavailable"


def test_forced_ingest_replaces_extracted_facts_and_keeps_curated_ones(client, monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", fake_complete)
    job = assert_contract(client.post("/ingest", json={"force": True}), "POST", "/ingest", 202)
    assert job["status"] in ("queued", "running")
    done = wait_for(client, job["id"])
    assert done["status"] == "done" and done["docs"] == 46
    facts = [f for f in client.get("/facts", params={"limit": 500}).json()["items"] if f["project_id"] != "proj-canonico"]
    curated = 15 + 3 + 3
    assert len(facts) == curated + 1
    assert {"L-401", "L-410", "M-905"} <= {f["id"] for f in facts}
    extracted = [f for f in facts if f["topic"] == "audit-turnaround"]
    assert len(extracted) == 1 and extracted[0]["type"] == "CONSTRAINT"
    assert client.get("/facts/M-106").json()["supersedes"] == "M-105"
    assert client.post("/ask", json={"question": "What is the target time for onboarding new consultants?"}).json()["binding"]["id"] == "M-106"
    assert client.get("/audit", params={"action": "ingest"}).json()[0]["actor"] == "system"
    assert client.get("/stats").json()["cost"]["spent_usd"] > 0


def test_classify_retypes_facts_but_keeps_pinned_ones(client, monkeypatch):
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", fake_complete)
    client.post("/facts/M-106/pin", json={"reason": "Approved deliverable.", "actor": "gabriele"})
    job = assert_contract(client.post("/classify", json={"fact_ids": ["M-105", "M-106"], "force": False}), "POST", "/classify", 202)
    assert job["kind"] == "classify"
    assert wait_for(client, job["id"])["status"] == "done"
    assert client.get("/facts/M-105").json()["type"] == "HYPOTHESIS"
    assert client.get("/facts/M-106").json()["type"] == "DECISION"
    assert client.get("/audit", params={"fact_id": "M-105"}).json()[0]["action"] == "classify"
    assert_contract(client.post("/classify", json={"doc_id": "nope", "force": False}), "POST", "/classify", 404)
    assert_contract(client.post("/classify", json={"force": False}), "POST", "/classify", 422)


def test_quotes_must_be_verbatim():
    text = "The audit queue\nbacks up – we’ve never measured it. Target: 3-4 weeks."
    assert extract.locate_quote(text, "we’ve never measured it") == "we’ve never measured it"
    assert extract.locate_quote(text, "we've never measured it") == "we’ve never measured it"
    assert extract.locate_quote(text, "The audit queue backs up") == "The audit queue\nbacks up"
    assert extract.locate_quote(text, "we have never measured it") is None


def test_cost_cap_blocks_calls_before_they_are_made(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("CANONICO_LLM_CACHE", str(tmp_path))
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "provider", lambda: "anthropic")
    monkeypatch.setattr(llm, "_anthropic", lambda *a: calls.append(a) or ('{"ok": true}', 1000, 1000))
    schema = {"type": "object"}
    meter = llm.Meter(cap_usd=0.05)
    assert llm.complete_json("claude-sonnet-5-5", "s", "u", schema, meter, max_tokens=1000) == {"ok": True}
    assert meter.spent == pytest.approx(0.012)
    assert llm.complete_json("claude-sonnet-5-5", "s", "u", schema, meter, max_tokens=1000) == {"ok": True}
    assert len(calls) == 1 and meter.cached == 1
    with pytest.raises(llm.CostCapReached):
        llm.complete_json("claude-sonnet-5-5", "s", "other", schema, meter, max_tokens=8000)
    assert len(calls) == 1


def test_gateway_model_names():
    assert llm.gateway_model("claude-haiku-5-5") == "anthropic/claude-haiku-5.5"
    assert llm.gateway_model("anthropic/claude-sonnet-5.5") == "anthropic/claude-sonnet-5.5"
    assert llm.price("anthropic/claude-haiku-5.5") == (0.10, 0.50)
