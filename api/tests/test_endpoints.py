import json

from tests.conftest import assert_contract

Q1 = "What is the target time for onboarding new consultants?"
WHO = {"actor": "gabriele"}
RETIRE = {"reason": "Replaced by the final report, which sets 3–4 weeks.", **WHO}


def test_search_facts_and_documents(client):
    body = assert_contract(client.get("/search", params={"q": "onboarding SLA weeks"}), "GET", "/search")
    assert body["query"] == "onboarding SLA weeks" and body["total"] >= len(body["results"]) > 0
    kinds = {r["kind"] for r in body["results"]}
    assert kinds == {"fact", "document"}
    top_fact = next(r for r in body["results"] if r["kind"] == "fact")
    assert top_fact["id"] == "M-106" and top_fact["snippet"] == "Establish onboarding SLA: 3–4 weeks (vs. current 6–8 weeks)"
    only = assert_contract(client.get("/search", params={"q": "audit queue", "kind": "fact", "type": ["HYPOTHESIS", "OPEN"], "topic": "audit-queue-time"}), "GET", "/search")
    assert only["results"] and {r["type"] for r in only["results"]} <= {"HYPOTHESIS", "OPEN"}
    docs = assert_contract(client.get("/search", params={"q": "audit queue", "kind": "document", "limit": 3}), "GET", "/search")
    assert len(docs["results"]) == 3 and all(r["topic"] is None and r["type"] is None for r in docs["results"])
    client.post("/facts/M-103/retire", json=RETIRE)
    retired = client.get("/search", params={"q": "requirement weeks", "status": "retired"}).json()
    assert [r["id"] for r in retired["results"]] == ["M-103"]
    assert_contract(client.get("/search"), "GET", "/search", 422)


def test_plain_retrieval_baseline(client):
    body = assert_contract(client.post("/retrieve/plain", json={"query": Q1, "top_k": 3, "method": "bm25"}), "POST", "/retrieve/plain")
    assert [r["rank"] for r in body["results"]] == [1, 2, 3]
    scores = [r["score"] for r in body["results"]]
    assert scores == sorted(scores, reverse=True) and all(r["quote"] for r in body["results"])
    assert_contract(client.post("/retrieve/plain", json={"query": Q1, "method": "embedding"}), "POST", "/retrieve/plain", 422)
    assert_contract(client.post("/retrieve/plain", json={"top_k": 3}), "POST", "/retrieve/plain", 422)


def test_ask_history_answer_record_and_replay(client):
    first = client.post("/ask", json={"question": Q1}).json()
    client.post("/ask", json={"question": "How long does a report spend in the audit queue?"})
    history = assert_contract(client.get("/ask/history"), "GET", "/ask/history")
    assert [h["status"] for h in history] == ["contested", "binding"]
    assert history[1]["id"] == first["answer_id"]
    record = assert_contract(client.get(f"/answers/{first['answer_id']}"), "GET", "/answers/{answer_id}")
    assert [f["id"] for f in record["fact_snapshot"]] == ["M-106", "M-105", "M-103"]
    assert record["response"]["answer"] == first["answer"]
    same = assert_contract(client.post(f"/answers/{first['answer_id']}/replay"), "POST", "/answers/{answer_id}/replay")
    assert same["changed"] is False and same["diffs"] == [] and same["changed_because"] is None
    client.post("/facts/M-103/retire", json=RETIRE)
    diff = assert_contract(client.post(f"/answers/{first['answer_id']}/replay"), "POST", "/answers/{answer_id}/replay")
    assert diff["changed"] is True and diff["changed_because"] == "you retired requirement R1.1"
    by_field = {d["field"]: d for d in diff["diffs"]}
    assert by_field["conflicts"]["before"] == ["M-103"] and by_field["conflicts"]["after"] == []
    assert by_field["answer"]["after"].endswith("is no longer binding.")
    assert diff["new_answer_id"] != first["answer_id"]
    assert_contract(client.get("/answers/ans-9999"), "GET", "/answers/{answer_id}", 404)
    assert_contract(client.post("/answers/ans-9999/replay"), "POST", "/answers/{answer_id}/replay", 404)


def test_ask_stream_sends_retrieval_tokens_and_the_final_answer(client):
    with client.stream("POST", "/ask/stream", json={"question": Q1}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        raw = "".join(response.iter_text())
    events = [block.split("\n", 1) for block in raw.strip().split("\n\n")]
    names = [name.removeprefix("event: ") for name, _ in events]
    payloads = [json.loads(data.removeprefix("data: ")) for _, data in events]
    assert names[0] == "retrieval" and names[-1] == "final" and set(names[1:-1]) == {"token"}
    assert payloads[0] == {"fact_ids": ["M-106", "M-105", "M-103"]}
    final = payloads[-1]
    assert "".join(p["text"] for p in payloads[1:-1]) == final["answer"]
    assert final["status"] == "binding" and final["answer_id"].startswith("ans-")
    assert client.get(f"/answers/{final['answer_id']}").status_code == 200
    assert client.post("/ask/stream", json={}).status_code == 422


def test_config_get_and_patch(client):
    config = assert_contract(client.get("/config"), "GET", "/config")
    assert config["active_corpus"] == "org-consulting-clearpath" and config["models"]["extraction"]
    patched = assert_contract(client.patch("/config", json={"cost_cap_usd": 15.0, "models": {"answer": "another-model"}}), "PATCH", "/config")
    assert patched["cost_cap_usd"] == 15.0 and patched["models"]["answer"] == "another-model"
    assert patched["models"]["extraction"] == config["models"]["extraction"]
    assert client.get("/stats").json()["cost"]["cap_usd"] == 15.0
    assert_contract(client.patch("/config", json={}), "PATCH", "/config", 422)
    assert_contract(client.patch("/config", json={"cost_cap_usd": -1}), "PATCH", "/config", 422)


def test_export_and_import_round_trip(client):
    client.post("/facts/M-103/retire", json=RETIRE)
    client.post("/ask", json={"question": Q1})
    bundle = assert_contract(client.get("/export"), "GET", "/export")
    assert len(bundle["documents"]) == 46 and bundle["documents"][0]["text"]
    assert any(e["action"] == "retire" for e in bundle["audit"]) and len(bundle["answers"]) == 1
    client.post("/demo/reset")
    assert client.get("/facts/M-103").json()["status"] == "active"
    summary = assert_contract(client.post("/import", json=bundle), "POST", "/import")
    assert summary["documents"] == 46 and summary["facts"] == len(bundle["facts"]) and summary["topics"] == len(bundle["topics"])
    assert client.get("/facts/M-103").json()["status"] == "retired"
    answer = client.post("/ask", json={"question": Q1}).json()
    assert answer["binding"]["id"] == "M-106" and answer["conflicts"] == []
    assert client.get("/audit", params={"action": "import"}).json()
    merged = assert_contract(client.post("/import", params={"mode": "merge"}, json=bundle), "POST", "/import")
    assert merged["audit_events"] == 0
    assert_contract(client.post("/import", json={**bundle, "version": "9.0.0"}), "POST", "/import", 422)
    assert_contract(client.post("/import", json={"version": "0.1.0"}), "POST", "/import", 422)


def test_topics_create_rename_and_merge(client):
    created = assert_contract(client.post("/topics", json={"id": "billing-rate", "label": "Billing rate"}), "POST", "/topics", 201)
    assert created == {"id": "billing-rate", "label": "Billing rate", "fact_ids": []}
    assert assert_contract(client.post("/topics", json={"label": "Travel Policy"}), "POST", "/topics", 201)["id"] == "travel-policy"
    assert_contract(client.post("/topics", json={"id": "billing-rate", "label": "Again"}), "POST", "/topics", 409)
    assert_contract(client.post("/topics", json={}), "POST", "/topics", 422)
    renamed = assert_contract(client.patch("/topics/onboarding-target", json={"label": "Onboarding time target"}), "PATCH", "/topics/{topic_id}")
    assert renamed["label"] == "Onboarding time target" and len(renamed["fact_ids"]) == 7
    assert_contract(client.patch("/topics/nope", json={"label": "x"}), "PATCH", "/topics/{topic_id}", 404)
    fact = {"topic": "billing-rate", "value": "Onboarding target confirmed at 3–4 weeks", "type": "EVIDENCE", "quote": "Confirmed on the call.", "date": "2025-12-03", **WHO}
    new_id = client.post("/facts", json=fact).json()["id"]
    merged = assert_contract(client.post("/topics/billing-rate/merge", json={"into_topic_id": "onboarding-target", **WHO}), "POST", "/topics/{topic_id}/merge")
    assert merged["id"] == "onboarding-target" and new_id in merged["fact_ids"] and len(merged["fact_ids"]) == 8
    assert client.get(f"/facts/{new_id}").json()["topic"] == "onboarding-target"
    assert "billing-rate" not in [t["id"] for t in client.get("/topics").json()]
    assert client.get("/audit", params={"action": "merge"}).json()[0]["actor"] == "gabriele"
    assert_contract(client.post("/topics/billing-rate/merge", json={"into_topic_id": "onboarding-target", **WHO}), "POST", "/topics/{topic_id}/merge", 404)
    assert_contract(client.post("/topics/onboarding-target/merge", json={"into_topic_id": "onboarding-target", **WHO}), "POST", "/topics/{topic_id}/merge", 409)


def test_documents_create_list_facts_and_delete(client):
    body = {"id": "07-documents/addendum-onboarding", "title": "Onboarding addendum", "date": "2025-12-05", "format": "markdown",
            "text": "# Addendum\n\nThe onboarding SLA stays at 3–4 weeks.\n", "ingest": False}
    created = assert_contract(client.post("/documents", json=body), "POST", "/documents", 201)
    assert created["document"] == {"id": body["id"], "title": body["title"], "date": body["date"], "path": "07-documents/addendum-onboarding.md"}
    assert created["ingest_job"] is None
    assert client.get("/documents/07-documents%2Faddendum-onboarding").json()["text"] == body["text"]
    assert_contract(client.post("/documents", json=body), "POST", "/documents", 409)
    assert_contract(client.post("/documents", json={"title": "x"}), "POST", "/documents", 422)
    queued = assert_contract(client.post("/documents", json={**body, "id": "notes/second", "ingest": True}), "POST", "/documents", 201)
    assert queued["ingest_job"]["status"] == "error" and queued["ingest_job"]["kind"] == "ingest"
    upload = client.post("/documents", data={"title": "Uploaded note", "date": "2025-12-06", "ingest": "false"}, files={"file": ("note.md", b"# Note\n\nAudit queue target stays at 3-4 days.\n", "text/markdown")})
    uploaded = assert_contract(upload, "POST", "/documents", 201)
    assert uploaded["document"]["id"] == "uploaded-note"
    facts = assert_contract(client.get("/documents/07-documents%2Freport-final/facts"), "GET", "/documents/{doc_id}/facts")
    assert {"M-106", "M-206"} <= {f["id"] for f in facts}
    assert_contract(client.get("/documents/nope/facts"), "GET", "/documents/{doc_id}/facts", 404)

    deleted = assert_contract(client.delete("/documents/05-meetings%2Fmeeting-005-final-presentation", params=WHO), "DELETE", "/documents/{doc_id}")
    assert {"M-105", "M-207"} <= set(deleted["deleted_fact_ids"])
    assert client.get("/facts/M-105").status_code == 404
    assert client.get("/facts/M-106").json()["supersedes"] is None
    assert client.post("/ask", json={"question": Q1}).json()["superseded"] == []
    assert_contract(client.delete("/documents/05-meetings%2Fmeeting-005-final-presentation", params=WHO), "DELETE", "/documents/{doc_id}", 404)
    undo = client.post(f"/audit/{deleted['audit_event_id']}/undo", json={**WHO, "reason": "Deleted by mistake."})
    assert undo.status_code == 200
    assert client.get("/facts/M-106").json()["supersedes"] == "M-105"
    assert client.get("/facts/M-105").json()["superseded_by"] == "M-106"
    assert client.get("/documents/05-meetings%2Fmeeting-005-final-presentation").status_code == 200


def test_every_operation_of_the_contract_is_implemented(client, spec):
    samples = {"fact_id": "M-103", "topic_id": "onboarding-target", "doc_id": "01-scope/requirements", "job_id": "job-7f3a", "run_id": "eval-none",
               "conflict_id": "C-001", "question_id": "OQ-001", "item_id": "MQ-001", "answer_id": "ans-0001", "event_id": "a-0001"}
    count = 0
    for path, item in spec["paths"].items():
        for method in item:
            if method not in ("get", "post", "patch", "delete", "put"):
                continue
            count += 1
            url = path
            for name, value in samples.items():
                url = url.replace("{" + name + "}", value)
            response = client.request(method.upper(), url, json={} if method in ("post", "patch", "put") else None)
            assert response.status_code not in (405, 501), f"{method.upper()} {path} -> {response.status_code}"
            assert response.status_code != 500, f"{method.upper()} {path} -> 500"
            if response.status_code >= 400 and path != "/ask/stream":
                assert set(response.json()) == {"code", "message"}, f"{method.upper()} {path}"
    assert count == 54
