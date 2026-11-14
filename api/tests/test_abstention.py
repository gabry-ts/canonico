"""Questions memory cannot answer get no_answer, not the closest topic labelled binding."""

from tests.conftest import assert_contract

IT = {"Accept-Language": "it-IT,it;q=0.9"}
WIFI = "What's the wifi password in Florence?"


def ask(client, question, headers=None, **extra):
    return assert_contract(client.post("/ask", json={"question": question, **extra}, headers=headers or {}), "POST", "/ask")


def fake_router(answer, calls):
    def fake(model, system, user, schema, meter, name="result", max_tokens=8000, effort="low", timeout=240.0, retries=4):
        calls.append(name)
        return answer

    return fake


def test_router_abstention_is_no_answer_not_a_keyword_guess(client, monkeypatch):
    from app import llm

    calls = []
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", fake_router({"topics": [], "confidence": "low"}, calls))
    for question in (WIFI, "What's the wifi password at the Milan office?", "Is the Milan office in scope?"):
        body = ask(client, question)
        assert body["status"] == "no_answer" and body["binding"] is None and body["conflicts"] == []
        assert body["answer"] == "Memory holds nothing relevant to this question."
    assert calls == ["route"] * 3
    assert ask(client, WIFI, IT)["answer"] == "In memoria non c'è nulla di pertinente a questa domanda."


def test_router_low_confidence_is_an_abstention(client, monkeypatch):
    from app import llm

    calls = []
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", fake_router({"topics": ["milan-office-scope"], "confidence": "low"}, calls))
    assert ask(client, WIFI)["status"] == "no_answer"
    monkeypatch.setattr(llm, "complete_json", fake_router({"topics": ["milan-office-scope"], "confidence": "high"}, calls))
    assert ask(client, "Is the Milan office in scope?")["binding"]["topic"] == "milan-office-scope"


def test_router_failure_still_falls_back_to_keywords(client, monkeypatch):
    from app import llm

    def failing(*args, **kwargs):
        raise llm.LLMError("Model provider is unreachable.")

    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", failing)
    assert ask(client, "Is the Milan office in scope?")["binding"]["topic"] == "milan-office-scope"


def test_keyword_fallback_needs_more_than_a_shared_place(client):
    for question in (WIFI, "What's the wifi password at the Milan office?", "Qual è la password del wifi a Firenze?", "What will the weather be like in Turin tomorrow?"):
        assert ask(client, question)["status"] == "no_answer", question
    assert ask(client, "Is the Milan office in scope?")["binding"]["topic"] == "milan-office-scope"
    assert ask(client, "How long does onbording take at ClearPath?")["binding"]["id"] == "M-106"
    assert ask(client, "Florence")["status"] == "binding"


def test_demo_question_never_waits_for_the_router(client, monkeypatch):
    from app import llm

    calls = []
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "complete_json", fake_router({"topics": [], "confidence": "low"}, calls))
    assert ask(client, "How long does onboarding take?")["binding"]["id"] == "M-106"
    assert calls == []
