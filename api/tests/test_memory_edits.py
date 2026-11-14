from tests.conftest import assert_contract

Q1 = "What is the target time for onboarding new consultants?"
Q2 = "How long does a report spend in the audit queue?"
WHO = {"actor": "gabriele"}


def ask(client, question):
    return assert_contract(client.post("/ask", json={"question": question}), "POST", "/ask")


def test_resolving_a_conflict_retires_the_losers_and_changes_the_answer(client):
    before = ask(client, Q1)
    body = {"winning_fact_id": "M-106", "reason": "Final report is later and approved by the client.", **WHO}
    resolved = assert_contract(client.post("/conflicts/C-001/resolve", json=body), "POST", "/conflicts/{conflict_id}/resolve")
    assert resolved["status"] == "resolved"
    assert resolved["resolution"]["winning_fact_id"] == "M-106"
    facts = {f["id"]: f for f in resolved["facts"]}
    assert facts["M-103"]["status"] == "retired" and facts["M-103"]["superseded_by"] == "M-106"
    assert facts["M-106"]["status"] == "active" and facts["M-106"]["pinned"] is False
    after = ask(client, Q1)
    assert after["conflicts"] == [] and after["answer"] != before["answer"]
    assert after["changed_because"] == "you resolved the conflict on requirement R1.1"
    assert [e["action"] for e in client.get("/audit", params={"fact_id": "M-103"}).json()] == ["resolve"]
    assert_contract(client.post("/conflicts/C-001/resolve", json=body), "POST", "/conflicts/{conflict_id}/resolve", 409)
    assert_contract(client.post("/conflicts/C-999/resolve", json=body), "POST", "/conflicts/{conflict_id}/resolve", 404)
    assert_contract(client.post("/conflicts/C-002/resolve", json=body), "POST", "/conflicts/{conflict_id}/resolve", 422)


def test_resolving_a_contested_topic_makes_the_winner_binding(client):
    assert ask(client, Q2)["status"] == "contested"
    body = {"winning_fact_id": "M-202", "reason": "Laura runs the queue day to day.", **WHO}
    assert_contract(client.post("/conflicts/C-002/resolve", json=body), "POST", "/conflicts/{conflict_id}/resolve")
    after = ask(client, Q2)
    assert after["status"] == "binding"
    assert after["binding"]["id"] == "M-202" and after["binding"]["pinned"] is True
    assert after["changed_because"]


def test_correcting_a_fact_changes_the_next_answer(client):
    ask(client, Q1)
    patch = {"value": "Onboarding SLA: 3–4 weeks (target, not guarantee)", "reason": "Clarified wording after review with the engagement lead.", **WHO}
    fact = assert_contract(client.patch("/facts/M-106", json=patch), "PATCH", "/facts/{fact_id}")
    assert fact["value"] == patch["value"]
    after = ask(client, Q1)
    assert "target, not guarantee" in after["answer"]
    assert after["binding"]["value"] == patch["value"]
    assert after["changed_because"] == "you corrected the final report SLA"
    assert_contract(client.patch("/facts/M-106", json={"reason": "x", **WHO}), "PATCH", "/facts/{fact_id}", 422)
    assert_contract(client.patch("/facts/M-999", json=patch), "PATCH", "/facts/{fact_id}", 404)
    assert_contract(client.patch("/facts/M-106", json={"topic": "nope", "reason": "x", **WHO}), "PATCH", "/facts/{fact_id}", 404)


def test_history_lists_every_version_newest_first(client):
    client.post("/facts/M-103/retire", json={"reason": "Replaced by the final report, which sets 3–4 weeks.", **WHO})
    versions = assert_contract(client.get("/facts/M-103/history"), "GET", "/facts/{fact_id}/history")
    assert [v["version"] for v in versions] == [2, 1]
    assert versions[0]["action"] == "retire"
    assert versions[0]["changes"]["status"] == {"from": "active", "to": "retired"}
    assert versions[0]["changes"]["superseded_by"] == {"from": None, "to": "M-106"}
    assert versions[1]["action"] == "classify" and versions[1]["snapshot"]["status"] == "active"
    untouched = assert_contract(client.get("/facts/M-101/history"), "GET", "/facts/{fact_id}/history")
    assert len(untouched) == 1


def test_pin_moves_between_facts_of_a_topic(client):
    pin = {"reason": "Final report is the approved deliverable.", **WHO}
    assert assert_contract(client.post("/facts/M-106/pin", json=pin), "POST", "/facts/{fact_id}/pin")["pinned"] is True
    assert_contract(client.post("/facts/M-103/pin", json=pin), "POST", "/facts/{fact_id}/pin")
    assert client.get("/facts/M-106").json()["pinned"] is False
    assert "pin moved from M-106" in client.get("/audit", params={"fact_id": "M-103"}).json()[0]["reason"]
    answer = ask(client, Q1)
    assert answer["binding"]["id"] == "M-103"
    assert assert_contract(client.post("/facts/M-103/unpin", json=pin), "POST", "/facts/{fact_id}/unpin")["pinned"] is False
    assert ask(client, Q1)["binding"]["id"] == "M-106"
    client.post("/facts/M-104/retire", json={"reason": "x", **WHO})
    assert_contract(client.post("/facts/M-104/pin", json=pin), "POST", "/facts/{fact_id}/pin", 409)


def test_supersede_and_unlink(client):
    body = {"by_fact_id": "M-106", "reason": "The final report restates the target as 3–4 weeks.", **WHO}
    older = assert_contract(client.post("/facts/M-103/supersede", json=body), "POST", "/facts/{fact_id}/supersede")
    assert older["superseded_by"] == "M-106" and older["type"] == "CONSTRAINT" and older["status"] == "active"
    assert client.get("/facts/M-106").json()["supersedes"] == "M-103"
    answer = ask(client, Q1)
    assert answer["conflicts"] == [] and "M-103" in [f["id"] for f in answer["superseded"]]
    assert_contract(client.post("/facts/M-106/supersede", json={**body, "by_fact_id": "M-103"}), "POST", "/facts/{fact_id}/supersede", 422)
    assert_contract(client.post("/facts/M-106/supersede", json={**body, "by_fact_id": "M-107"}), "POST", "/facts/{fact_id}/supersede")
    assert_contract(client.post("/facts/M-107/supersede", json={**body, "by_fact_id": "M-107"}), "POST", "/facts/{fact_id}/supersede", 422)
    assert_contract(client.post("/facts/M-103/supersede", json={**body, "by_fact_id": "M-201"}), "POST", "/facts/{fact_id}/supersede", 422)
    params = {"reason": "Wrongly linked.", **WHO}
    newer = assert_contract(client.delete("/facts/M-106/supersedes", params=params), "DELETE", "/facts/{fact_id}/supersedes")
    assert newer["supersedes"] is None
    assert client.get("/facts/M-103").json()["superseded_by"] is None
    assert_contract(client.delete("/facts/M-106/supersedes", params=params), "DELETE", "/facts/{fact_id}/supersedes", 404)
    assert_contract(client.delete("/facts/M-107/supersedes", params={"actor": "x"}), "DELETE", "/facts/{fact_id}/supersedes", 422)


def test_same_day_cycle_is_a_conflict(client):
    body = {"reason": "Same day.", **WHO}
    assert_contract(client.post("/facts/M-201/supersede", json={**body, "by_fact_id": "M-202"}), "POST", "/facts/{fact_id}/supersede")
    assert_contract(client.post("/facts/M-202/supersede", json={**body, "by_fact_id": "M-201"}), "POST", "/facts/{fact_id}/supersede", 409)


def test_created_fact_enters_the_topic_and_conflicts_with_the_binding_one(client):
    ask(client, Q1)
    body = {"topic": "onboarding-target", "value": "Steering committee sets onboarding at 5 weeks", "type": "DECISION", "doc_id": None,
            "quote": "Typed in after the steering committee call.", "date": "2025-12-02", "confidence": 1.0, **WHO}
    fact = assert_contract(client.post("/facts", json=body), "POST", "/facts", 201)
    assert fact["status"] == "active" and fact["supersedes"] is None and fact["pinned"] is False
    assert fact["id"] in client.get("/topics/onboarding-target/chain").json()["topic"]["fact_ids"]
    answer = ask(client, Q1)
    assert answer["binding"]["id"] == fact["id"]
    assert "M-106" in [f["id"] for f in answer["conflicts"]]
    assert answer["changed_because"].startswith("you added")
    assert client.get("/audit", params={"action": "create"}).json()[0]["fact_id"] == fact["id"]
    assert_contract(client.post("/facts", json={**body, "topic": "nope"}), "POST", "/facts", 404)
    assert_contract(client.post("/facts", json={**body, "doc_id": "nope"}), "POST", "/facts", 404)
    assert_contract(client.post("/facts", json={"topic": "onboarding-target"}), "POST", "/facts", 422)


def test_dependents(client):
    ask(client, Q1)
    deps = assert_contract(client.get("/facts/M-103/dependents"), "GET", "/facts/{fact_id}/dependents")
    assert "M-106" in [f["id"] for f in deps["facts"]]
    assert deps["conflicts"] == ["C-001"]
    assert deps["answers"][0]["question"] == Q1
    assert_contract(client.get("/facts/M-999/dependents"), "GET", "/facts/{fact_id}/dependents", 404)


def test_open_questions(client):
    listed = assert_contract(client.get("/open-questions", params={"topic": "audit-queue-time"}), "GET", "/open-questions")
    assert listed[0]["id"] == "OQ-001" and listed[0]["fact_id"] == "M-204"
    assert listed[0]["question"] == "What is the real audit queue time?"
    body = {"note": "Instrumentation added to the audit queue, measurement starts next month.", **WHO}
    closed = assert_contract(client.post("/open-questions/OQ-001/close", json=body), "POST", "/open-questions/{question_id}/close")
    assert closed["status"] == "closed" and closed["note"] == body["note"] and closed["closed_at"]
    assert "OQ-001" not in [q["id"] for q in client.get("/open-questions").json()]
    assert "OQ-001" in [q["id"] for q in client.get("/open-questions", params={"status": "closed"}).json()]
    assert client.get("/audit", params={"action": "close"}).json()[0]["fact_id"] == "M-204"
    assert_contract(client.post("/open-questions/OQ-001/close", json=body), "POST", "/open-questions/{question_id}/close", 409)
    assert_contract(client.post("/open-questions/OQ-999/close", json=body), "POST", "/open-questions/{question_id}/close", 404)
    assert_contract(client.post("/open-questions/OQ-002/close", json=WHO), "POST", "/open-questions/{question_id}/close", 422)


def test_maintenance_queue_approve_and_dismiss(client):
    queue = assert_contract(client.get("/maintenance/queue", params={"limit": 500}), "GET", "/maintenance/queue")
    by_fact = {m["fact"]["id"]: m for m in queue}
    assert by_fact["M-105"]["reason"] == "superseded_still_retrievable"
    assert by_fact["M-105"]["detail"] == "Superseded by M-106 on 2025-11-28 but still ranked in plain retrieval."
    assert by_fact["M-103"]["reason"] == "stale"
    stale = assert_contract(client.get("/maintenance/queue", params={"reason": "stale"}), "GET", "/maintenance/queue")
    assert all(m["reason"] == "stale" for m in stale)
    item = by_fact["M-103"]["id"]
    approved = assert_contract(client.post(f"/maintenance/{item}/approve", json={**WHO, "note": "Replaced by the final report."}), "POST", "/maintenance/{item_id}/approve")
    assert approved["status"] == "approved" and approved["fact"]["status"] == "retired" and approved["fact"]["superseded_by"] == "M-106"
    assert [e["action"] for e in client.get("/audit", params={"fact_id": "M-103"}).json()] == ["retire", "approve"]
    assert ask(client, Q1)["conflicts"] == []
    assert_contract(client.post(f"/maintenance/{item}/approve", json=WHO), "POST", "/maintenance/{item_id}/approve", 409)
    other = by_fact["M-105"]["id"]
    dismissed = assert_contract(client.post(f"/maintenance/{other}/dismiss", json={**WHO, "note": "Still valid for the pilot team."}), "POST", "/maintenance/{item_id}/dismiss")
    assert dismissed["status"] == "dismissed" and dismissed["fact"]["status"] == "active"
    pending = [m["id"] for m in client.get("/maintenance/queue", params={"limit": 500}).json()]
    assert item not in pending and other not in pending
    assert_contract(client.post("/maintenance/MQ-999/dismiss", json=WHO), "POST", "/maintenance/{item_id}/dismiss", 404)


def test_undo_reverts_a_retire_and_refuses_what_cannot_be_undone(client):
    client.post("/facts/M-103/retire", json={"reason": "Replaced.", **WHO})
    event = client.get("/audit", params={"fact_id": "M-103"}).json()[0]
    undo = assert_contract(client.post(f"/audit/{event['id']}/undo", json={**WHO, "reason": "Retired by mistake."}), "POST", "/audit/{event_id}/undo")
    assert undo["action"] == "undo" and undo["fact_id"] == "M-103"
    fact = client.get("/facts/M-103").json()
    assert fact["status"] == "active" and fact["superseded_by"] is None and fact["retired_reason"] is None
    assert [c["id"] for c in client.get("/conflicts").json()][0] == "C-001"
    body = {**WHO, "reason": "Again."}
    assert_contract(client.post(f"/audit/{event['id']}/undo", json=body), "POST", "/audit/{event_id}/undo", 409)
    assert_contract(client.post(f"/audit/{undo['id']}/undo", json=body), "POST", "/audit/{event_id}/undo", 409)
    assert_contract(client.post("/audit/a-9999/undo", json=body), "POST", "/audit/{event_id}/undo", 404)
    assert_contract(client.post(f"/audit/{event['id']}/undo", json=WHO), "POST", "/audit/{event_id}/undo", 422)


def test_undo_is_refused_when_a_later_change_depends_on_it(client):
    client.post("/facts/M-103/retire", json={"reason": "Replaced.", **WHO})
    first = client.get("/audit", params={"fact_id": "M-103"}).json()[0]
    client.post("/facts/M-103/restore", json=WHO)
    assert_contract(client.post(f"/audit/{first['id']}/undo", json={**WHO, "reason": "x"}), "POST", "/audit/{event_id}/undo", 409)
