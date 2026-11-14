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


def test_a_quantity_on_an_extracted_topic_is_left_to_the_model(client):
    text = "Rachel asked that every client deliverable gets a quality review within 48 hours, and the primary contact on the client side signs off."
    item = {"type": "note", "title": "Delivery sync", "date": "2026-11-13T10:00:00Z", "text": text}
    result = client.post("/projects/proj-clearpath/items", json=item).json()
    assert result["facts_created"] == []


def test_a_sentence_starting_with_decision_is_a_decision(client):
    item = {"type": "ticket", "title": "Change request 9", "date": "2026-11-13T09:00:00Z", "text": "Decision: onboarding of new consultants takes 6 weeks.", "tags": ["topic:onboarding-target"]}
    result = client.post("/projects/proj-clearpath/items", json=item).json()
    fact = client.get(f"/facts/{result['facts_created'][0]}").json()
    assert fact["type"] == "DECISION" and result["supersedes_created"][0]["supersedes"] == "M-106"


def test_a_quantity_in_another_unit_is_not_filed_under_a_curated_topic(client):
    text = "Alessia: Decision: the intake response SLA for new service requests is set at 5 business days, effective next month."
    item = {"type": "meeting", "title": "Ops steering meeting", "date": "2026-11-13T10:00:00Z", "text": text}
    result = client.post("/projects/proj-clearpath/items", json=item).json()
    assert result["facts_created"] == []
    assert binding(client)["id"] == "M-106"


def test_a_decision_reversed_in_the_same_item_is_linked_by_the_model(client, monkeypatch):
    from app import extract, llm

    text = "The intake SLA is set at 5 business days.\nCorrection: we reverse that, the intake SLA is 3 business days."
    extracted = [
        {"topic_hint": "intake response SLA", "value": "The intake SLA is 3 business days.", "short": "3 business days", "type": "DECISION", "doc_id": "", "quote": "the intake SLA is 3 business days.", "date": "2026-11-13", "confidence": 0.9},
        {"topic_hint": "intake response SLA", "value": "The intake SLA is 5 business days.", "short": "5 business days", "type": "DECISION", "doc_id": "", "quote": "The intake SLA is set at 5 business days.", "date": "2026-11-13", "confidence": 0.9},
    ]

    def link(topic, members, model, meter, **limits):
        new = [m for m in members if m["doc_id"].startswith("hooks/")]
        three = next(m for m in new if m["value"].endswith("3 business days."))
        five = next(m for m in new if m["value"].endswith("5 business days."))
        return {"links": [{"older": five["tid"], "newer": three["tid"], "reason": "Reversed later in the meeting."}], "conflicts": []}

    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(extract, "extract_document", lambda doc, model, meter, **limits: [dict(f, doc_id=doc["id"]) for f in extracted])
    monkeypatch.setattr(extract, "link_topic", link)
    item = {"type": "meeting", "title": "Ops meeting", "date": "2026-11-13T10:00:00Z", "text": text}
    result = client.post("/projects/proj-clearpath/items", json=item).json()
    topic = client.get(f"/facts/{result['facts_created'][0]}").json()["topic"]
    answer = client.post("/ask", json={"question": "intake SLA", "topic": topic}).json()
    assert answer["binding"]["value"] == "The intake SLA is 3 business days."
