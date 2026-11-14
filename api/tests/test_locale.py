"""Generated text in English (default) and Italian. Values and quotes of facts are never translated."""

from tests.conftest import assert_contract

Q = "How long does onboarding take?"
Q2 = "How long does a report spend in the audit queue?"
IT = {"Accept-Language": "it-IT,it;q=0.9,en;q=0.8"}
RETIRE = {"reason": "Sostituito dal report finale.", "actor": "Giulia"}
BEFORE_IT = (
    "Da tre a quattro settimane. È il tempo di onboarding, fissato nel report finale il 28 novembre 2025. "
    "Ha sostituito 4 versioni precedenti. Un valore superato è ancora attivo: 4 settimane (presentazione finale)."
)
AFTER_IT = (
    "Da tre a quattro settimane. È il tempo di onboarding, fissato nel report finale il 28 novembre 2025. "
    "Ha sostituito 4 versioni precedenti. 4 settimane (presentazione finale) è stato ritirato da Giulia."
)


def ask(client, question, headers=None, **extra):
    return assert_contract(client.post("/ask", json={"question": question, **extra}, headers=headers or {}), "POST", "/ask")


def test_demo_flow_in_italian_matches_the_contract_examples(client, spec):
    examples = spec["paths"]["/ask"]["post"]["responses"]["200"]["content"]["application/json"]["examples"]
    before = ask(client, Q, IT)
    assert before["locale"] == "it" and before["answer"] == BEFORE_IT == examples["q01_before_retire_it"]["value"]["answer"]
    assert before["answer"].startswith("Da tre a quattro settimane")
    assert before["changed_because"] is None and before["changed_because_code"] is None and before["changed_because_params"] is None
    assert before["binding"]["value"] == "3–4 weeks" and before["binding"]["quote"] == "Establish onboarding SLA: 3–4 weeks (vs. current 6–8 weeks)"
    assert [f["value"] for f in before["conflicts"]] == ["4 weeks"]

    client.post("/facts/M-105/retire", json=RETIRE)
    after = ask(client, Q, IT)
    assert after["answer"] == AFTER_IT == examples["q01_after_retire_it"]["value"]["answer"]
    assert after["changed_because"] == "Giulia ha ritirato 4 settimane (presentazione finale)"
    assert after["changed_because_code"] == "fact_retired"
    assert after["changed_because_params"] == {"actor": "Giulia", "fact_id": "M-105", "value": "4 weeks", "source": "final presentation", "count": 1, "changes": 1}
    assert after["conflicts"] == [] and [f["id"] for f in after["superseded"]] == ["M-101", "M-102", "M-103", "M-104"]


def test_locale_comes_from_body_then_query_then_header_and_defaults_to_english(client):
    english = ask(client, Q)
    assert english["locale"] == "en" and english["answer"].startswith("Three to four weeks")
    assert ask(client, Q, locale="it")["answer"] == BEFORE_IT
    assert client.post("/ask", params={"locale": "it"}, json={"question": Q}).json()["answer"] == BEFORE_IT
    assert ask(client, Q, IT, locale="en")["answer"] == english["answer"]
    assert ask(client, Q, {"Accept-Language": "fr-FR,fr;q=0.9"})["locale"] == "en"
    assert ask(client, Q, {"Accept-Language": "en;q=0.5,it;q=0.9"})["locale"] == "it"
    assert client.post("/ask", json={"question": Q, "locale": "de"}).status_code == 422


def test_the_same_change_is_explained_in_the_language_of_each_request(client):
    ask(client, Q)
    client.post("/facts/M-105/retire", json={**RETIRE, "reason": "Replaced."})
    english = ask(client, Q)
    italian = ask(client, Q, IT)
    again = ask(client, Q)
    assert english["changed_because"] == again["changed_because"] == "Giulia retired 4 weeks (final presentation)"
    assert italian["changed_because"] == "Giulia ha ritirato 4 settimane (presentazione finale)"
    assert english["changed_because_code"] == italian["changed_because_code"] == "fact_retired"
    assert english["changed_because_params"] == italian["changed_because_params"]
    client.post("/facts/M-105/restore", json={"actor": "Giulia"})
    assert ask(client, Q, IT)["changed_because"] == "Giulia ha ripristinato 4 settimane (presentazione finale)"


def test_audit_summary_maintenance_and_conflicts_follow_the_locale(client):
    client.post("/facts/M-105/retire", json=RETIRE)
    english = assert_contract(client.get("/audit", params={"fact_id": "M-105"}), "GET", "/audit")[0]
    italian = assert_contract(client.get("/audit", params={"fact_id": "M-105"}, headers=IT), "GET", "/audit")[0]
    assert english["summary"] == "Giulia retired 4 weeks (final presentation)"
    assert italian["summary"] == "Giulia ha ritirato 4 settimane (presentazione finale)"
    assert english["summary_code"] == italian["summary_code"] == "fact_retired"
    assert english["summary_params"] == italian["summary_params"] == {"actor": "Giulia", "fact_id": "M-105", "value": "4 weeks", "source": "final presentation", "count": 1}
    assert italian["reason"] == RETIRE["reason"] and italian["actor_role"] == "owner"
    assert client.get("/stats", headers=IT).json()["recent_changes"][0]["summary"] == italian["summary"]
    assert client.get("/stats", headers=IT).json()["locale"] == "it"

    client.post("/demo/reset")
    item = assert_contract(client.get("/maintenance/queue", params={"locale": "it"}), "GET", "/maintenance/queue")[0]
    assert item["detail"] == "Superato da M-106 il 2025-11-28 ma ancora restituito dal retrieval semplice."
    assert item["detail_code"] == "superseded_still_retrievable" and item["detail_params"] == {"by": "M-106", "date": "2025-11-28"}
    assert client.get("/maintenance/queue").json()[0]["detail"] == "Superseded by M-106 on 2025-11-28 but still ranked in plain retrieval."
    conflicts = assert_contract(client.get("/conflicts", headers=IT), "GET", "/conflicts")
    assert conflicts[0]["summary"].startswith("La presentazione finale indica ancora 4 settimane")
    assert conflicts[1]["summary"] == "Tre stime del tempo in coda di audit (2–3, 3–4 e 6–8 giorni), nessuno lo ha misurato."
    assert conflicts[1]["facts"][0]["value"] == "3–4 business days (Marco Fiore, audit team lead)"
    assert client.get("/open-questions", params={"topic": "audit-queue-time"}, headers=IT).json()[0]["question"] == "Qual è il tempo reale in coda di audit?"
    contested = ask(client, Q2, IT)
    assert contested["answer"] == "Tre persone hanno dato stime diverse e nessuno lo ha misurato, quindi non esiste un unico valore vincolante."
    assert ask(client, "Who won the football world cup in 1982?", IT)["answer"] == "In memoria non c'è nulla di pertinente a questa domanda."


def test_email_version_and_meeting_are_worded_in_italian(client):
    ask(client, Q)
    client.post("/demo/send-email")
    email = ask(client, Q, IT)
    assert email["answer"].startswith("5 settimane. È il tempo di onboarding, fissato nell'email di client@meridianlabs.org il ")
    assert email["changed_because"] == "un'email di client@meridianlabs.org ha sostituito 3–4 settimane (report finale)"
    assert email["changed_because_code"] == "source_replaced"
    assert email["changed_because_params"]["source_kind"] == "email" and email["changed_because_params"]["replaced_fact_id"] == "M-106"
    assert email["binding"]["value"] == "5 weeks"
    events = client.get("/audit", headers=IT).json()
    assert events[0]["summary"] == email["changed_because"] and events[0]["summary_code"] == "source_replaced"
    assert events[1]["summary"] == "Email “Onboarding target confirmed” di client@meridianlabs.org instradata a proj-clearpath dalla regola rule-001."
    assert events[1]["summary_code"] == "email_received"
    assert client.get("/audit").json()[1]["summary"] == "Email “Onboarding target confirmed” from client@meridianlabs.org routed to proj-clearpath by rule-001."

    text = client.get("/documents/library%2Fonboarding-standard").json()["text"].replace("Version 2", "Version 3").replace("3–4 weeks", "5 weeks")
    client.post("/documents/library%2Fonboarding-standard/versions", json={"version_label": "v3", "text": text})
    version = ask(client, Q, IT)
    assert "fissato nella versione 3 di “Onboarding standard”" in version["answer"]
    assert version["answer"].endswith("L'email di client@meridianlabs.org lo conferma.")
    assert version["changed_because"] == "la versione 3 di “Onboarding standard” ha sostituito 3–4 settimane (standard di onboarding v2)"

    client.post("/demo/reset")
    meeting = {"type": "meeting", "title": "Steering committee 12 Nov", "date": "2026-11-12T10:00:00Z", "text": "We agreed the onboarding target stays at 3–4 weeks.", "tags": ["clearpath", "topic:onboarding-target"]}
    client.post("/hooks/org", json=meeting, headers={"X-Canonico-Token": "whsec_x7Kq2demo9f2a"})
    confirmed = ask(client, Q, IT)
    assert confirmed["binding"]["id"] == "M-106" and confirmed["answer"].endswith("La riunione “Steering committee 12 Nov” lo conferma.")
    assert client.get("/audit", params={"limit": 2}, headers=IT).json()[1]["summary"] == "Meeting “Steering committee 12 Nov” ricevuto in proj-clearpath."


def test_error_messages_follow_the_locale(client):
    assert client.get("/facts/M-999", headers=IT).json() == {"code": "not_found", "message": "Fatto M-999 non trovato."}
    assert client.get("/facts/M-999").json() == {"code": "not_found", "message": "Fact M-999 not found."}
    assert client.get("/sources/nope", params={"locale": "it"}).json()["message"] == "Fonte nope non trovata."
    refused = client.post("/facts/M-105/retire", json=RETIRE, headers={**IT, "X-Demo-Actor": "mem-luca-bassi"})
    assert refused.status_code == 403 and refused.json() == {"code": "forbidden", "message": "Il ruolo viewer non ha il permesso retire_fact."}
    assert client.post("/hooks/org", json={}, headers=IT).status_code in (401, 422)
    token = client.post("/hooks/projects/proj-clearpath", json={"type": "note", "title": "x", "date": "2026-11-13T09:00:00Z", "text": "y"}, headers=IT)
    assert token.json() == {"code": "unauthorized", "message": "X-Canonico-Token non valido."}
    assert client.post("/facts/M-105/retire", content="{not json", headers={**IT, "content-type": "application/json"}).json()["message"] == "Corpo JSON non valido."
    missing = client.post("/facts/M-105/retire", json={"actor": "Giulia"}, headers=IT).json()
    assert missing["code"] == "validation_error" and "campo obbligatorio" in missing["message"]


def test_replay_reports_the_locale_and_the_code(client):
    first = ask(client, Q)
    client.post("/facts/M-105/retire", json=RETIRE)
    diff = assert_contract(client.post(f"/answers/{first['answer_id']}/replay", headers=IT), "POST", "/answers/{answer_id}/replay")
    assert diff["locale"] == "it" and diff["changed_because"] == "Giulia ha ritirato 4 settimane (presentazione finale)"
    assert diff["changed_because_code"] == "fact_retired" and diff["changed_because_params"]["fact_id"] == "M-105"
