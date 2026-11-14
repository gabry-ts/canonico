"""Scenario 3: paraphrases of the demo question, English and Italian, and questions that must not match it."""

from tests_live.conftest import FORCED, note

EN = [
    "How long does onboarding take?",
    "how long does onboarding take",
    "How long is onboarding?",
    "What's the onboarding time for a new consultant?",
    "How many weeks until a new consultant is onboarded?",
    "how long is onbaording for new hires at ClearPath?",
    "How long does onbording take at ClearPath?",
    "At ClearPath, how long should it take a new consultant to become autonomous?",
    "What is the current target for onboarding duration?",
    "Remind me, what did we finally agree as the onboarding target for new consultants at ClearPath Solutions?",
    "I'm preparing the kickoff deck for the new hires and I need the official figure: how many weeks does onboarding take according to the final recommendation?",
    "onboarding time?",
]
IT = [
    "Quanto dura l'onboarding?",
    "Tempo di onboarding?",
    "Quanto tempo ci vuole per l'onboarding di un nuovo consulente?",
    "Qual è il target di onboarding per ClearPath?",
    "In quante settimane un nuovo consulente diventa autonomo?",
    "quanto dura l'onbording?",
    "Mi ricordi qual è la durata dell'onboarding concordata alla fine con il cliente ClearPath?",
    "Durata onboarding nuovi consulenti?",
]
NEGATIVE = [
    "How long does a report spend in the audit queue?",
    "How far in advance is travel booked?",
    "Which expenses need approval?",
    "Is the Milan office in scope?",
    "What will the weather be like in Turin tomorrow?",
    "zxqv blorp 42 ???",
]
# Known phrasings are answered without a model and must always hit. The others go through the model
# router, which is not deterministic: a typo like "onbording" can land on the current-duration topic
# now and then, so they must hit in at least 90% of the cases.
KNOWN = {"How long does onboarding take?", "how long does onboarding take", "Quanto dura l'onboarding?", "Tempo di onboarding?"}
MIN_RATE = 0.9
# Recorded, not asserted: a nonsense string that contains a typo of "onboarding".
BORDERLINE = ["zxqv blorp onboardz 42 ???"]


def check(body: dict) -> bool:
    binding = body.get("binding") or {}
    return body["status"] == "binding" and binding.get("value") == "3–4 weeks" and binding.get("topic") == "onboarding-target"


def test_paraphrases_resolve_to_the_onboarding_binding(api, request):
    rows, failures = [], []
    for question in EN + IT:
        for attempt in (1, 2, 3) if FORCED else (1, 2):
            body = api.ask(question)
            ok = check(body)
            rows.append({"q": question, "try": attempt, "status": body["status"], "binding": (body["binding"] or {}).get("id"), "topic": (body["binding"] or {}).get("topic"), "ok": ok})
            if not ok:
                failures.append(f"{question!r} try {attempt}: {body['status']} {(body['binding'] or {}).get('id')} {body['answer'][:80]!r}")
    hits = sum(1 for r in rows if r["ok"])
    note(request, "paraphrases_before_retire", {"hit_rate": f"{hits}/{len(rows)}", "failures": failures, "rows": rows})
    assert FORCED or all(r["ok"] for r in rows if r["q"] in KNOWN), failures
    assert hits >= MIN_RATE * len(rows), "\n".join(failures)


def test_after_retiring_m105_paraphrases_still_bind_and_explain(api, request):
    response = api.post("/facts/M-105/retire", json={"reason": "The final report replaced the verbal preview.", "actor": "Giulia"})
    assert response.status_code == 200, response.text
    first = api.ask(EN[0])
    assert first["changed_because"], first
    rows, failures = [], []
    for question in EN + IT:
        body = api.ask(question)
        ok = check(body) and not body["conflicts"]
        rows.append({"q": question, "status": body["status"], "binding": (body["binding"] or {}).get("id"), "changed_because": body["changed_because"], "ok": ok})
        if not ok:
            failures.append(f"{question!r}: {body['status']} {(body['binding'] or {}).get('id')}")
    note(request, "paraphrases_after_retire", {"hit_rate": f"{sum(r['ok'] for r in rows)}/{len(rows)}", "failures": failures, "rows": rows})
    api.post("/facts/M-105/restore", json={"reason": "test cleanup", "actor": "Giulia"})
    assert FORCED or all(r["ok"] for r in rows if r["q"] in KNOWN), failures
    assert sum(r["ok"] for r in rows) >= MIN_RATE * len(rows), "\n".join(failures)


def test_negative_questions_do_not_return_the_onboarding_binding(api, request):
    rows, failures = [], []
    for question in NEGATIVE:
        body = api.ask(question)
        binding = (body["binding"] or {}).get("id")
        rows.append({"q": question, "status": body["status"], "binding": binding, "topic": (body["binding"] or {}).get("topic")})
        if binding == "M-106":
            failures.append(question)
    borderline = [{"q": q, "binding": (api.ask(q)["binding"] or {}).get("id")} for q in BORDERLINE]
    note(request, "negatives", {"rows": rows, "borderline": borderline})
    assert not failures, failures
