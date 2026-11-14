"""Scenario 9: proj-internal never sees proj-clearpath memory."""

import json

from tests_live.conftest import ROOT, note

INTERNAL = "proj-internal"


def clearpath_doc_ids() -> set[str]:
    lines = (ROOT / "data" / "clearpath" / "corpus.jsonl").read_text(encoding="utf-8").splitlines()
    return {json.loads(line)["_id"] for line in lines if line.strip()}


def leaks(body: dict, corpus: set[str]) -> list[str]:
    found = []
    facts = ([body["binding"]] if body.get("binding") else []) + body.get("superseded", []) + body.get("conflicts", [])
    for fact in facts:
        if fact.get("project_id") != INTERNAL or fact["doc_id"] in corpus:
            found.append(fact["id"])
    found += [c["doc_id"] for c in body.get("citations", []) if c["doc_id"] in corpus]
    return found


def test_internal_project_sees_only_itself(api, request):
    corpus = clearpath_doc_ids()
    questions = ["How long does onboarding take?", "When do new analysts start working on their own?", "What is the rule for booking a flight for a client visit?", "How long does ClearPath onboarding take for new consultants?"]
    rows, problems = [], []
    for question in questions:
        body = api.ask(question, project_id=INTERNAL)
        bad = leaks(body, corpus)
        rows.append({"q": question, "status": body["status"], "binding": (body["binding"] or {}).get("id"), "leaks": bad})
        problems += bad
    search = api.get("/search", params={"q": "onboarding", "project_id": INTERNAL}).json()
    rows_search = search.get("results") or search.get("items") or []
    problems += [str(r.get("id")) for r in rows_search if r.get("project_id") not in (None, INTERNAL) or r.get("doc_id") in corpus or r.get("id") in corpus]
    facts = api.all_facts(project_id=INTERNAL)
    problems += [f["id"] for f in facts if f["project_id"] != INTERNAL]
    stats = api.stats(project_id=INTERNAL)
    total = api.stats()
    note(request, "isolation", {"asks": rows, "search_hits": len(rows_search), "internal_facts": len(facts), "internal_stats_facts": stats["facts_total"], "org_facts": total["facts_total"]})
    assert stats["facts_total"] == len(facts) < total["facts_total"]
    assert not problems, problems
