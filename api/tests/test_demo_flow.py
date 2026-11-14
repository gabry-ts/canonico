"""The live demo, step by step: ask, see what was replaced, retire the stale fact, ask again."""

from tests.conftest import assert_contract

Q = "How long does onboarding take?"
Q_TARGET = "What is the target time for onboarding new consultants?"
Q_LONG = "What onboarding time target did Meridian Labs ultimately recommend, and how did that target shift from the client’s original goal over the engagement?"
Q2 = "How long does a report spend in the audit queue?"
Q2_LONG = "Why do the team leads disagree about how long a report spends in the audit queue, and was the discrepancy ever resolved with hard data?"
RETIRE = {"reason": "The final report replaced the verbal preview.", "actor": "Giulia"}
REPLACED = ["M-101", "M-102", "M-103", "M-104"]


def ask(client, question, **extra):
    return assert_contract(client.post("/ask", json={"question": question, **extra}), "POST", "/ask")


def test_first_answer_is_the_final_report_with_the_four_versions_it_replaced(client):
    body = ask(client, Q)
    assert body["status"] == "binding"
    assert body["answer"].startswith("Three to four weeks")
    binding = body["binding"]
    assert (binding["id"], binding["value"], binding["doc_id"], binding["date"]) == ("M-106", "3–4 weeks", "07-documents/report-final", "2025-11-28")
    assert binding["type"] == "DECISION" and binding["status"] == "active" and binding["superseded_by"] is None
    assert binding["quote"] == "Establish onboarding SLA: 3–4 weeks (vs. current 6–8 weeks)"
    assert [f["id"] for f in body["superseded"]] == REPLACED
    assert [f["value"] for f in body["superseded"]] == ["≈6 weeks", "below 3 weeks", "3 weeks or less", "≈6.5–7 weeks"]
    assert {f["superseded_by"] for f in body["superseded"]} == {"M-106"}
    assert [f["doc_id"] for f in body["superseded"]] == ["01-scope/project-brief", "01-scope/project-brief", "01-scope/requirements", "05-meetings/meeting-003-interim-review"]
    assert [f["date"] for f in body["superseded"]] == ["2025-08-22", "2025-08-22", "2025-09-29", "2025-10-15"]
    stale = body["conflicts"]
    assert [f["id"] for f in stale] == ["M-105"]
    assert (stale[0]["value"], stale[0]["status"], stale[0]["superseded_by"]) == ("4 weeks", "active", "M-106")
    assert (stale[0]["doc_id"], stale[0]["date"]) == ("05-meetings/meeting-005-final-presentation", "2025-11-21")
    assert "R1.1" not in body["answer"]
    assert body["changed_because"] is None
    assert "plain_retrieval" not in body


def test_retiring_the_stale_fact_changes_the_next_answer_and_says_why(client):
    before = ask(client, Q)
    retired = assert_contract(client.post("/facts/M-105/retire", json=RETIRE), "POST", "/facts/{fact_id}/retire")
    assert retired["status"] == "retired" and retired["retired_reason"] == RETIRE["reason"]
    assert retired["retired_by"] == "Giulia" and retired["retired_at"].endswith("Z")
    assert retired["superseded_by"] == "M-106"

    after = ask(client, Q)
    assert after["status"] == "binding" and after["binding"]["id"] == "M-106"
    assert after["conflicts"] == []
    assert [f["id"] for f in after["superseded"]] == REPLACED
    assert after["changed_because"] == "Giulia retired 4 weeks (final presentation)"
    assert after["answer"].startswith("Three to four weeks") and after["answer"] != before["answer"]

    shown = assert_contract(client.get("/facts/M-105"), "GET", "/facts/{fact_id}")
    assert shown["status"] == "retired" and shown["retired_by"] == "Giulia" and shown["retired_at"] == retired["retired_at"]

    again = ask(client, Q)
    assert again["changed_because"] == "Giulia retired 4 weeks (final presentation)" and again["answer"] == after["answer"]

    restored = assert_contract(client.post("/facts/M-105/restore", json={"actor": "Giulia", "reason": "Retired by mistake."}), "POST", "/facts/{fact_id}/restore")
    assert restored["status"] == "active" and restored["retired_by"] is None and restored["retired_at"] is None and restored["retired_reason"] is None
    back = ask(client, Q)
    assert back["answer"] == before["answer"] and [f["id"] for f in back["conflicts"]] == ["M-105"]
    assert back["changed_because"] == "Giulia restored 4 weeks (final presentation)"


def test_chain_shows_the_onboarding_time_document_by_document(client):
    chain = assert_contract(client.get("/topics/onboarding-target/chain"), "GET", "/topics/{topic_id}/chain")
    assert chain["topic"]["label"] == "Onboarding time"
    rows = chain["facts"]
    assert [f["id"] for f in rows] == ["M-101", "M-102", "M-103", "M-104", "M-105", "M-106"]
    assert [f["date"] for f in rows] == sorted(f["date"] for f in rows)
    assert [f["value"] for f in rows] == ["≈6 weeks", "below 3 weeks", "3 weeks or less", "≈6.5–7 weeks", "4 weeks", "3–4 weeks"]
    assert rows[0]["doc_title"] == "Project Brief — ClearPath Solutions Process Review"
    assert rows[5]["doc_title"] == "ClearPath Solutions Inc. – Final Engagement Report"
    assert all(f["doc_title"] for f in rows)
    assert chain["changes"] == 5


def test_default_identity_is_giulia(client):
    me = assert_contract(client.get("/me"), "GET", "/me")
    assert (me["name"], me["role"], me["title"]) == ("Giulia", "owner", "Operations lead")
    assert me["member"]["id"] == "mem-giulia-ferri" and "admin_demo" in me["permissions"]
    other = assert_contract(client.get("/me", headers={"X-Demo-Actor": "mem-sara-conti"}), "GET", "/me")
    assert (other["name"], other["role"]) == ("Sara", "editor") and "manage_members" not in other["permissions"]
    assert client.get("/me", params={"actor": "Luca Bassi"}).json()["role"] == "viewer"


def test_reset_restores_the_initial_state(client):
    first = ask(client, Q)
    client.post("/facts/M-105/retire", json=RETIRE)
    ask(client, Q)
    stats = assert_contract(client.post("/demo/reset"), "POST", "/demo/reset")
    assert stats["by_status"]["retired"] == 0 and stats["open_conflicts"] >= 2
    assert client.get("/facts/M-105").json()["status"] == "active"
    assert "C-001" in [c["id"] for c in client.get("/conflicts").json()]
    again = ask(client, Q)
    assert again == first


def test_demo_path_makes_no_model_calls(client, monkeypatch):
    from app import llm

    def boom(*args, **kwargs):
        raise AssertionError("a model call was made")

    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", boom)
    assert client.patch("/config", json={"offline_mode": True}).json()["offline_mode"] is True
    assert ask(client, Q)["binding"]["id"] == "M-106"
    client.post("/facts/M-105/retire", json=RETIRE)
    assert ask(client, Q)["conflicts"] == []
    assert client.post("/demo/reset").status_code == 200


def test_other_phrasings_reach_the_same_topic(client):
    for question in (Q_TARGET, Q_LONG, "how long does onboarding take"):
        body = ask(client, question)
        assert body["binding"]["id"] == "M-106" and [f["id"] for f in body["conflicts"]] == ["M-105"]
    assert ask(client, Q2_LONG)["status"] == "contested"


def test_retire_is_idempotent_and_audited_once(client):
    client.post("/facts/M-105/retire", json=RETIRE)
    client.post("/facts/M-105/retire", json=RETIRE)
    events = assert_contract(client.get("/audit", params={"fact_id": "M-105"}), "GET", "/audit")
    assert [e["action"] for e in events] == ["retire"]
    assert events[0]["actor"] == "Giulia" and events[0]["reason"] == RETIRE["reason"]


def test_retire_requires_reason_and_actor(client):
    body = assert_contract(client.post("/facts/M-105/retire", json={"actor": "Giulia"}), "POST", "/facts/{fact_id}/retire", 422)
    assert body["code"] == "validation_error"
    assert_contract(client.post("/facts/M-999/retire", json=RETIRE), "POST", "/facts/{fact_id}/retire", 404)


def test_q02_is_contested_with_the_three_estimates(client, spec):
    example = spec["paths"]["/ask"]["post"]["responses"]["200"]["content"]["application/json"]["examples"]["q02_contested"]["value"]
    body = ask(client, Q2, topic="audit-queue-time")
    assert body["status"] == "contested" and body["binding"] is None
    assert body["answer"] == example["answer"]
    assert [f["id"] for f in body["conflicts"]] == ["M-201", "M-202", "M-203"]
    for got, want in zip(body["conflicts"], example["conflicts"]):
        assert {k: got[k] for k in want} == want
    assert body["citations"] == example["citations"]
    assert ask(client, Q2)["status"] == "contested"


def test_plain_retrieval_is_returned_only_on_request(client):
    body = ask(client, Q, include_plain_retrieval=True)
    assert body["plain_retrieval"]["rank"] == 1 and body["plain_retrieval"]["doc_id"] and body["plain_retrieval"]["quote"]


def test_unrelated_question_has_no_answer(client):
    body = ask(client, "Who won the football world cup in 1982?")
    assert body["status"] == "no_answer" and body["binding"] is None


def test_conflicts_follow_retire_and_restore(client):
    listed = assert_contract(client.get("/conflicts"), "GET", "/conflicts")
    assert [c["id"] for c in listed][:2] == ["C-001", "C-002"]
    assert [f["id"] for f in listed[0]["facts"]] == ["M-105", "M-106"]
    client.post("/facts/M-105/retire", json=RETIRE)
    assert "C-001" not in [c["id"] for c in client.get("/conflicts").json()]
    resolved = assert_contract(client.get("/conflicts", params={"status": "resolved"}), "GET", "/conflicts")
    assert resolved[0]["id"] == "C-001" and resolved[0]["resolution"]["winning_fact_id"] == "M-106"
    client.post("/facts/M-105/restore", json={"actor": "Giulia"})
    assert [c["id"] for c in client.get("/conflicts").json()][:2] == ["C-001", "C-002"]


def test_stale_fact_is_proposed_for_retirement(client):
    queue = assert_contract(client.get("/maintenance/queue"), "GET", "/maintenance/queue")
    assert queue[0]["id"] == "MQ-001" and queue[0]["fact"]["id"] == "M-105"
    assert queue[0]["reason"] == "superseded_still_retrievable"
    assert queue[0]["detail"] == "Superseded by M-106 on 2025-11-28 but still ranked in plain retrieval."


def test_retiring_the_binding_fact_falls_back_to_the_previous_decision(client):
    client.post("/facts/M-106/retire", json={"reason": "Report withdrawn.", "actor": "Giulia"})
    body = ask(client, Q)
    assert body["binding"]["id"] == "M-105" and body["binding"]["type"] == "DECISION"
    assert "M-103" in [f["id"] for f in body["conflicts"]]
