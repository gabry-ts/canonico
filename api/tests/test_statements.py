"""Inbound text that only mentions an old value must not change the binding fact."""

Q = "How long does onboarding take?"


def email(message_id: str, text: str) -> dict:
    return {
        "message_id": f"<{message_id}@meridianlabs.org>",
        "from": "pm@meridianlabs.org",
        "to": ["brain@inbound.meridianlabs.org"],
        "subject": "Recap",
        "date": "2026-11-14T10:00:00Z",
        "text": text,
    }


def binding(client, question: str = Q, **extra) -> dict:
    return client.post("/ask", json={"question": question, **extra}).json()["binding"]


def test_a_passing_mention_of_the_old_target_does_not_supersede_the_binding_fact(client):
    text = "Hi all, as we said, the 4 weeks onboarding target was the old plan and nobody uses it anymore. Talk soon."
    result = client.post("/mail/inbound", json=email("old-plan", text)).json()
    assert result["routed_project_id"] == "proj-clearpath"
    assert result["supersedes_created"] == []
    assert binding(client)["id"] == "M-106"


def test_a_change_from_one_value_to_another_files_the_new_value(client):
    text = "After the steering committee we moved the onboarding target from 3–4 weeks to 6 weeks."
    result = client.post("/mail/inbound", json=email("moved", text)).json()
    assert [link["supersedes"] for link in result["supersedes_created"]] == ["M-106"]
    now = binding(client)
    assert now["value"] == "6 weeks" and now["doc_id"] == result["document_id"]


def test_the_demo_question_in_italian_is_a_known_phrasing(client):
    for question in ("Quanto dura l'onboarding?", "Tempo di onboarding?", "Qual è il target di onboarding?"):
        body = client.post("/ask", json={"question": question, "locale": "it"}).json()
        assert body["status"] == "binding" and body["binding"]["id"] == "M-106", question


def test_a_decision_naming_the_steering_committee_is_filed_under_the_onboarding_time(client):
    text = "The steering committee confirmed the onboarding target at 6 weeks."
    result = client.post("/mail/inbound", json=email("committee", text)).json()
    assert [link["supersedes"] for link in result["supersedes_created"]] == ["M-106"]
    assert binding(client)["value"] == "6 weeks"
