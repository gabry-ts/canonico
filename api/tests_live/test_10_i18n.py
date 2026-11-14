"""Scenario 10: Italian and English generated text."""

from tests_live.conftest import note

IT = {"Accept-Language": "it"}
DEMO_Q = "How long does onboarding take?"
ITALIAN_WORDS = ("settimane", "relazione", "è ", "della", "il ")


def test_ask_in_italian_by_header_and_by_locale(api, request):
    by_header = api.ask(DEMO_Q, headers=IT)
    by_locale = api.ask(DEMO_Q, locale="it")
    english = api.ask(DEMO_Q, locale="en", headers=IT)
    free = api.ask("Quanto dura l'onboarding?", headers=IT)
    note(request, "ask", {"header": by_header["answer"][:120], "locale": by_locale["answer"][:120], "explicit_en": english["answer"][:120], "free_it": [free["status"], (free["binding"] or {}).get("id"), free["answer"][:120]]})
    assert by_header["locale"] == "it" and by_locale["locale"] == "it" and english["locale"] == "en"
    assert any(w in by_header["answer"] for w in ITALIAN_WORDS)
    assert by_header["answer"] == by_locale["answer"] != english["answer"]
    assert by_header["binding"]["quote"] == english["binding"]["quote"]


def test_audit_maintenance_and_errors_in_italian(api, request):
    api.ask(DEMO_Q, locale="it")
    api.post("/facts/M-105/retire", json={"reason": "Sostituito dalla relazione finale.", "actor": "Giulia"})
    audit = api.get("/audit", params={"limit": 5}, headers=IT).json()
    audit_en = api.get("/audit", params={"limit": 5}).json()
    after = api.ask(DEMO_Q, locale="it")
    api.post("/facts/M-105/restore", json={"reason": "test", "actor": "Giulia"})
    queue = api.get("/maintenance/queue", headers=IT).json()
    queue_en = api.get("/maintenance/queue", params={"locale": "en"}, headers=IT).json()
    missing = api.get("/facts/M-99999", headers=IT)
    missing_en = api.get("/facts/M-99999")
    note(request, "i18n", {"audit_it": [e.get("summary") for e in audit[:3]], "audit_en": [e.get("summary") for e in audit_en[:3]], "queue_it": [q["detail"] for q in queue[:2]], "error_it": missing.json(), "error_en": missing_en.json(), "changed_because_it": after["changed_because"]})
    assert audit[0]["summary"] != audit_en[0]["summary"]
    assert queue and queue_en and queue[0]["detail"] != queue_en[0]["detail"]
    assert missing.status_code == 404 and missing.json()["message"] != missing_en.json()["message"]
    assert after["changed_because"] and after["locale"] == "it"
