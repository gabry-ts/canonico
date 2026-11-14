from tests.conftest import assert_contract

Q1 = "What is the target time for onboarding new consultants?"
Q1_LONG = "What onboarding time target did Meridian Labs ultimately recommend, and how did that target shift from the client’s original goal over the engagement?"
Q2 = "How long does a report spend in the audit queue?"
Q2_LONG = "Why do the team leads disagree about how long a report spends in the audit queue, and was the discrepancy ever resolved with hard data?"
RETIRE = {"reason": "Replaced by the final report, which sets 3–4 weeks.", "actor": "gabriele"}


def ask(client, question, **extra):
    return assert_contract(client.post("/ask", json={"question": question, **extra}), "POST", "/ask")


def test_q01_binding_with_conflict_matches_the_contract_example(client, spec):
    example = spec["paths"]["/ask"]["post"]["responses"]["200"]["content"]["application/json"]["examples"]["q01_before_retire"]["value"]
    body = ask(client, Q1)
    assert body["status"] == "binding"
    assert body["answer"] == example["answer"]
    assert body["changed_because"] is None
    for key in ("binding",):
        assert {k: body[key][k] for k in example[key]} == example[key]
    assert [f["id"] for f in body["superseded"]] == ["M-105"]
    assert {k: body["superseded"][0][k] for k in example["superseded"][0]} == example["superseded"][0]
    assert {k: body["conflicts"][0][k] for k in example["conflicts"][0]} == example["conflicts"][0]
    assert body["citations"] == example["citations"]
    assert "plain_retrieval" not in body


def test_long_benchmark_questions_reach_the_same_topics(client):
    assert ask(client, Q1_LONG)["binding"]["id"] == "M-106"
    assert ask(client, Q2_LONG)["status"] == "contested"


def test_retire_changes_the_next_answer_and_restore_brings_it_back(client, spec):
    examples = spec["paths"]["/ask"]["post"]["responses"]["200"]["content"]["application/json"]["examples"]
    before = ask(client, Q1)
    assert [f["id"] for f in before["conflicts"]] == ["M-103"]

    retired = assert_contract(client.post("/facts/M-103/retire", json=RETIRE), "POST", "/facts/{fact_id}/retire")
    expected = spec["paths"]["/facts/{fact_id}/retire"]["post"]["responses"]["200"]["content"]["application/json"]["example"]
    assert {k: retired[k] for k in expected} == expected

    after = ask(client, Q1)
    assert after["status"] == "binding"
    assert after["binding"]["id"] == "M-106"
    assert after["conflicts"] == []
    assert after["answer"] == examples["q01_after_retire"]["value"]["answer"]
    assert after["changed_because"] == "you retired requirement R1.1"
    assert after["answer"] != before["answer"]

    again = ask(client, Q1)
    assert again["changed_because"] == "you retired requirement R1.1"
    assert again["answer"] == after["answer"]

    restored = assert_contract(client.post("/facts/M-103/restore", json={"actor": "gabriele", "reason": "Retired by mistake."}), "POST", "/facts/{fact_id}/restore")
    expected = spec["paths"]["/facts/{fact_id}/restore"]["post"]["responses"]["200"]["content"]["application/json"]["example"]
    assert {k: restored[k] for k in expected} == expected

    back = ask(client, Q1)
    assert back["answer"] == before["answer"]
    assert [f["id"] for f in back["conflicts"]] == ["M-103"]
    assert back["changed_because"] == "you restored requirement R1.1"


def test_retire_is_idempotent_and_audited_once(client):
    client.post("/facts/M-103/retire", json=RETIRE)
    client.post("/facts/M-103/retire", json=RETIRE)
    events = assert_contract(client.get("/audit", params={"fact_id": "M-103"}), "GET", "/audit")
    assert [e["action"] for e in events] == ["retire"]
    assert events[0]["actor"] == "gabriele"
    assert events[0]["reason"] == RETIRE["reason"]


def test_retire_requires_reason_and_actor(client):
    response = client.post("/facts/M-103/retire", json={"actor": "gabriele"})
    body = assert_contract(response, "POST", "/facts/{fact_id}/retire", 422)
    assert body["code"] == "validation_error"
    assert_contract(client.post("/facts/M-999/retire", json=RETIRE), "POST", "/facts/{fact_id}/retire", 404)


def test_q02_is_contested_with_the_three_estimates(client, spec):
    example = spec["paths"]["/ask"]["post"]["responses"]["200"]["content"]["application/json"]["examples"]["q02_contested"]["value"]
    body = ask(client, Q2, topic="audit-queue-time")
    assert body["status"] == "contested"
    assert body["binding"] is None
    assert body["answer"] == example["answer"]
    assert [f["id"] for f in body["conflicts"]] == ["M-201", "M-202", "M-203"]
    for got, want in zip(body["conflicts"], example["conflicts"]):
        assert {k: got[k] for k in want} == want
    assert body["citations"] == example["citations"]
    assert ask(client, Q2)["status"] == "contested"


def test_plain_retrieval_is_returned_only_on_request(client):
    body = ask(client, Q1, include_plain_retrieval=True)
    assert body["plain_retrieval"]["rank"] == 1
    assert body["plain_retrieval"]["doc_id"]
    assert body["plain_retrieval"]["quote"]


def test_unrelated_question_has_no_answer(client):
    body = ask(client, "Who won the football world cup in 1982?")
    assert body["status"] == "no_answer"
    assert body["binding"] is None


def test_conflicts_follow_retire_and_restore(client):
    listed = assert_contract(client.get("/conflicts"), "GET", "/conflicts")
    assert [c["id"] for c in listed][:2] == ["C-001", "C-002"]
    client.post("/facts/M-103/retire", json=RETIRE)
    assert "C-001" not in [c["id"] for c in client.get("/conflicts").json()]
    resolved = assert_contract(client.get("/conflicts", params={"status": "resolved"}), "GET", "/conflicts")
    assert resolved[0]["id"] == "C-001"
    assert resolved[0]["resolution"]["winning_fact_id"] == "M-106"
    client.post("/facts/M-103/restore", json={"actor": "gabriele"})
    assert [c["id"] for c in client.get("/conflicts").json()][:2] == ["C-001", "C-002"]


def test_reset_restores_the_seeded_state(client):
    client.post("/facts/M-103/retire", json=RETIRE)
    ask(client, Q1)
    stats = assert_contract(client.post("/demo/reset"), "POST", "/demo/reset")
    assert stats["by_status"]["retired"] == 0
    assert stats["open_conflicts"] >= 2
    assert "C-001" in [c["id"] for c in client.get("/conflicts").json()]
    assert client.get("/facts/M-103").json()["status"] == "active"
    assert ask(client, Q1)["changed_because"] is None


def test_retiring_the_binding_fact_falls_back_to_the_previous_decision(client):
    client.post("/facts/M-106/retire", json={"reason": "Report withdrawn.", "actor": "gabriele"})
    body = ask(client, Q1)
    assert body["binding"]["id"] == "M-105"
    assert body["binding"]["type"] == "DECISION"
    assert "M-103" in [f["id"] for f in body["conflicts"]]
