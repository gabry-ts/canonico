from tests.conftest import assert_contract, assert_matches

RETIRE = {"reason": "Replaced by the final report, which sets 3–4 weeks.", "actor": "gabriele"}


def test_health(client):
    assert assert_contract(client.get("/health"), "GET", "/health") == {"status": "ok", "version": "0.1.0"}


def test_facts_list_get_and_filters(client):
    page = assert_contract(client.get("/facts", params={"topic": "onboarding-target"}), "GET", "/facts")
    assert page["total"] == 6
    assert page["items"][0]["id"] == "M-106"
    dates = [f["date"] for f in page["items"]]
    assert dates == sorted(dates, reverse=True)
    page = assert_contract(client.get("/facts", params={"type": "HYPOTHESIS", "limit": 2, "offset": 1}), "GET", "/facts")
    assert page["limit"] == 2 and page["offset"] == 1 and len(page["items"]) == 2
    page = assert_contract(client.get("/facts", params={"doc_id": "07-documents/report-final"}), "GET", "/facts")
    assert {f["doc_id"] for f in page["items"]} == {"07-documents/report-final"}
    assert_contract(client.get("/facts", params={"limit": 0}), "GET", "/facts", 422)
    fact = assert_contract(client.get("/facts/M-103"), "GET", "/facts/{fact_id}")
    assert fact["value"] == "3 weeks or less" and fact["superseded_by"] == "M-106"
    assert_contract(client.get("/facts/M-999"), "GET", "/facts/{fact_id}", 404)


def test_retire_and_restore(client):
    assert_contract(client.post("/facts/M-103/retire", json=RETIRE), "POST", "/facts/{fact_id}/retire")
    page = client.get("/facts", params={"status": "retired"}).json()
    assert [f["id"] for f in page["items"]] == ["M-103"]
    assert_contract(client.post("/facts/M-103/restore"), "POST", "/facts/{fact_id}/restore")
    assert_contract(client.post("/facts/M-999/restore"), "POST", "/facts/{fact_id}/restore", 404)


def test_malformed_json_is_a_bad_request(client):
    response = client.post("/facts/M-103/retire", content="{not json", headers={"content-type": "application/json"})
    assert_contract(response, "POST", "/facts/{fact_id}/retire", 400)


def test_topics_and_chain(client):
    topics = assert_contract(client.get("/topics"), "GET", "/topics")
    by_id = {t["id"]: t for t in topics}
    assert by_id["onboarding-target"]["fact_ids"] == [f"M-10{n}" for n in range(1, 7)]
    assert by_id["onboarding-standard"]["fact_ids"] == ["L-400", "L-401"]
    assert by_id["audit-queue-time"]["fact_ids"] == [f"M-20{n}" for n in range(1, 9)]
    chain = assert_contract(client.get("/topics/onboarding-target/chain"), "GET", "/topics/{topic_id}/chain")
    assert [f["id"] for f in chain["facts"]] == ["M-101", "M-102", "M-103", "M-104", "M-105", "M-106"]
    by_fact = {f["id"]: f for f in chain["facts"]}
    assert by_fact["M-106"]["supersedes"] == "M-105"
    assert by_fact["M-105"]["superseded_by"] == "M-106"
    assert_contract(client.get("/topics/nope/chain"), "GET", "/topics/{topic_id}/chain", 404)


def test_chain_keeps_retired_facts(client):
    client.post("/facts/M-103/retire", json=RETIRE)
    chain = client.get("/topics/onboarding-target/chain").json()
    assert {f["id"]: f["status"] for f in chain["facts"]}["M-103"] == "retired"


def test_conflicts(client, spec):
    listed = assert_contract(client.get("/conflicts"), "GET", "/conflicts")
    example = spec["paths"]["/conflicts"]["get"]["responses"]["200"]["content"]["application/json"]["example"]
    assert [f["id"] for f in listed[0]["facts"]] == ["M-105", "M-106"] and listed[0]["status"] == "open"
    assert_matches(listed[1], example[1])
    only = assert_contract(client.get("/conflicts", params={"topic": "audit-queue-time"}), "GET", "/conflicts")
    assert [c["id"] for c in only] == ["C-002"]
    assert client.get("/conflicts", params={"status": "bogus"}).status_code == 422


def test_audit(client):
    client.post("/facts/M-103/retire", json=RETIRE)
    client.post("/facts/M-103/restore", json={"actor": "ema"})
    events = assert_contract(client.get("/audit"), "GET", "/audit")
    assert [e["action"] for e in events[:2]] == ["restore", "retire"]
    assert [e["action"] for e in client.get("/audit", params={"actor": "ema"}).json()] == ["restore"]
    assert [e["action"] for e in client.get("/audit", params={"action": "retire"}).json()] == ["retire"]
    assert len(client.get("/audit", params={"limit": 1}).json()) == 1
    assert client.get("/audit", params={"since": "2999-01-01T00:00:00Z"}).json() == []
    assert_contract(client.get("/audit", params={"action": "bogus"}), "GET", "/audit", 422)


def test_documents(client):
    docs = assert_contract(client.get("/documents"), "GET", "/documents")
    assert len(docs) == 49
    assert len([d for d in docs if d["source_id"] == "src-clearpath-docs"]) == 46
    assert all("text" not in d for d in docs)
    doc = assert_contract(client.get("/documents/07-documents%2Freport-final"), "GET", "/documents/{doc_id}")
    assert doc["id"] == "07-documents/report-final"
    assert doc["date"] == "2025-11-28"
    assert "Establish onboarding SLA: 3–4 weeks" in doc["text"]
    assert client.get("/documents/07-documents/report-final").status_code == 200
    assert_contract(client.get("/documents/nope%2Fnope"), "GET", "/documents/{doc_id}", 404)


def test_stats_and_reset(client):
    stats = assert_contract(client.get("/stats"), "GET", "/stats")
    assert stats["documents"] == 49
    assert stats["open_conflicts"] >= 2
    assert stats["facts_total"] >= 15
    assert_contract(client.post("/demo/reset"), "POST", "/demo/reset")


def test_contract_examples_describe_the_demo_seed(client, spec):
    example = spec["paths"]["/stats"]["get"]["responses"]["200"]["content"]["application/json"]["example"]
    live = client.get("/stats").json()
    for key in ("documents", "topics", "facts_total", "by_type", "by_status", "open_conflicts", "open_questions", "maintenance_pending", "needs_attention"):
        assert live[key] == example[key], key
    assert [s["source_id"] for s in live["sources"]] == [s["source_id"] for s in example["sources"]]
    topics = spec["paths"]["/topics"]["get"]["responses"]["200"]["content"]["application/json"]["example"]
    assert_matches(client.get("/topics", params={"project_id": "proj-clearpath"}).json()[:2], topics)
    tests = spec["components"]["schemas"]["EvalResult"]["properties"]["per_query"]["items"]["properties"]["tests"]
    assert set(tests) == {"type", "description"}


def test_anthropic_is_the_default_provider(monkeypatch):
    from app import llm

    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert llm.provider() == "anthropic"
    monkeypatch.setenv("LLM_PROVIDER", "gateway")
    assert llm.provider() == "gateway"
