"""Scenario 12: parallel questions and parallel retire/restore."""

import json
from concurrent.futures import ThreadPoolExecutor

import httpx

from tests_live.conftest import check_invariants, note

QUESTIONS = [
    "How long does onboarding take?",
    "How long does a report spend in the audit queue?",
    "Is the Milan office in scope?",
    "How many team leaders are there?",
    "What did the intake observation find?",
    "Quanto dura l'onboarding?",
    "What is the timeline of the engagement?",
    "Who owns the data migration?",
    "How many active clients does a coordinator manage?",
    "What was decided about the reporting cadence?",
]


def test_parallel_asks_and_edits(api, request):
    candidates = [f for f in api.all_facts(project_id="proj-clearpath", status="active") if f["id"].startswith("M-1") and len(f["id"]) == 6 and not f["pinned"]]
    targets = ["M-105"] + [f["id"] for f in candidates[:4]]
    base = api.base

    def ask(question):
        with httpx.Client(base_url=base, timeout=120) as client:
            return client.post("/ask", json={"question": question}).status_code

    def flip(fact_id):
        with httpx.Client(base_url=base, timeout=120) as client:
            codes = [client.post(f"/facts/{fact_id}/retire", json={"reason": "load test", "actor": "Giulia"}).status_code]
            codes.append(client.post(f"/facts/{fact_id}/restore", json={"reason": "load test", "actor": "Giulia"}).status_code)
            return codes

    with ThreadPoolExecutor(max_workers=25) as pool:
        asks = [pool.submit(ask, QUESTIONS[n % len(QUESTIONS)]) for n in range(20)]
        flips = [pool.submit(flip, fact_id) for fact_id in targets]
        ask_codes = [f.result() for f in asks]
        flip_codes = [f.result() for f in flips]
    note(request, "concurrency", {"ask_codes": ask_codes, "flip_codes": dict(zip(targets, flip_codes))})
    assert all(code == 200 for code in ask_codes), ask_codes
    assert all(codes == [200, 200] for codes in flip_codes), flip_codes
    assert all(api.get(f"/facts/{i}").json()["status"] == "active" for i in targets)
    assert api.stats()["facts_total"] > 0
    assert not check_invariants(api)
    if api.local:
        json.loads((api.workdir / "state.json").read_text(encoding="utf-8"))
