"""Scenario 2: the 26 ClearPath queries through POST /ask with the model router, and the live benchmark."""

import json
from collections import Counter

from tests_live.conftest import FORCED, ROOT, note

README = {"ndcg_at_10_canonico": 0.744, "binding_accuracy_canonico": 0.60, "gold_accuracy_canonico": 0.423}


def queries() -> list[dict]:
    lines = (ROOT / "data" / "clearpath" / "queries.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def test_all_queries_answer_with_existing_sources_and_verbatim_quotes(api, request):
    statuses, problems, rows = Counter(), [], []
    texts: dict[str, str] = {}
    for query in queries():
        body = api.ask(query["text"])
        statuses[body["status"]] += 1
        binding = body["binding"]
        rows.append({"id": query["_id"], "status": body["status"], "binding": binding and binding["id"], "topic": binding and binding["topic"]})
        if body["status"] == "binding":
            assert binding is not None
            if binding["doc_id"] not in texts:
                response = api.get(f"/documents/{binding['doc_id']}")
                texts[binding["doc_id"]] = response.json()["text"] if response.status_code == 200 else None
            if texts[binding["doc_id"]] is None:
                problems.append(f"{query['_id']}: binding doc {binding['doc_id']} missing")
            elif binding["quote"] not in texts[binding["doc_id"]]:
                problems.append(f"{query['_id']}: quote of {binding['id']} not verbatim")
        for citation in body["citations"]:
            if api.get(f"/documents/{citation['doc_id']}").status_code != 200:
                problems.append(f"{query['_id']}: citation {citation['doc_id']} missing")
    note(request, "status_distribution", dict(statuses))
    note(request, "per_query", rows)
    assert len(rows) == 26
    assert not problems, problems


def test_routing_is_stable_across_repeated_runs(api, request):
    """Without the cache (CANONICO_FORCE_LLM) every run asks the model again: the same question should get the same answer."""
    runs = 3 if FORCED else 1
    seen: dict[str, list] = {}
    for _ in range(runs):
        for query in queries():
            body = api.ask(query["text"])
            seen.setdefault(query["_id"], []).append((body["status"], (body["binding"] or {}).get("id")))
    unstable = {q: answers for q, answers in seen.items() if len(set(answers)) > 1}
    note(request, "stability", {"runs": runs, "stable": f"{len(seen) - len(unstable)}/{len(seen)}", "unstable": unstable})
    assert len(unstable) <= 0.2 * len(seen), unstable


def test_live_benchmark_is_close_to_the_published_numbers(api, request):
    response = api.post("/eval/run")
    assert response.status_code == 202, response.text
    run = api.wait_job(f"/eval/runs/{response.json()['id']}", timeout=600)
    assert run["status"] == "done", run
    result = run["result"]
    metrics = dict(result["metrics"])
    per_query = result.get("per_query") or []
    if per_query:
        metrics["gold_accuracy_canonico"] = round(sum(1 for q in per_query if q.get("pass_canonico")) / len(per_query), 3)
        metrics["gold_accuracy_plain"] = round(sum(1 for q in per_query if q.get("pass_plain")) / len(per_query), 3)
    note(request, "eval", {"router": result.get("router"), "cost_usd": run["cost_usd"], "metrics": metrics, "readme": README})
    assert result.get("router") == "model"
    assert abs(metrics["ndcg_at_10_canonico"] - README["ndcg_at_10_canonico"]) <= 0.08
