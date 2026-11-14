"""Italian questions on the CANONICO project land on their topics and answer with the binding fact."""

from tests.conftest import assert_contract

CANONICO = "proj-canonico"


def ask(client, question, locale="it"):
    body = {"question": question, "project_id": CANONICO, "locale": locale}
    return assert_contract(client.post("/ask", json=body), "POST", "/ask")


def test_italian_phrasings_are_answered_with_the_binding_fact(client, monkeypatch):
    monkeypatch.setenv("CANONICO_ROUTER", "lexical")
    expected = {
        "abbiamo usato anthropic o vercel": ("model-api-key", "M-2151"),
        "che chiave usiamo per i modelli?": ("model-api-key", "M-2151"),
        "racconta business plan": ("canonico-business-plan", "M-972"),
        "qual è il modello di business?": ("canonico-business-plan", "M-972"),
        "costo team e business plan": ("canonico-pricing", "M-971"),
        "quanto costano i piani?": ("canonico-pricing", "M-971"),
        "che modelli sono stati presi": ("canonico-models", "M-967"),
        "quando arriviamo al break-even?": ("break-even-and-funding", None),
        "che track abbiamo scelto?": ("team-track", "M-2119"),
        "quando scade il pitch?": ("pitch-submission-deadline", None),
    }
    for question, (topic, binding) in expected.items():
        for locale in ("it", "en"):
            body = ask(client, question, locale)
            assert body["topic"] == topic, (question, locale, body["topic"])
            if binding:
                assert body["status"] == "binding" and body["binding"]["id"] == binding, (question, locale)


def test_the_team_gateway_replaced_the_personal_anthropic_key(client):
    body = ask(client, "abbiamo usato anthropic o vercel")
    assert body["binding"]["id"] == "M-2151"
    assert [f["id"] for f in body["superseded"]] == ["M-2150"]


def test_the_business_plan_answer_quotes_the_decision_diary(client):
    body = ask(client, "racconta il business plan")
    assert body["answer"].startswith("Il business plan è un abbonamento annuale per organizzazione")
    assert body["citations"][0]["doc_id"] == "canonico/diario-decisioni"
    assert "break-even intorno al mese 32" in body["citations"][0]["quote"]
