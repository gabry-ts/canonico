import math
import time

from app import benchmark
from tests.conftest import assert_contract


def test_ndcg_matches_the_trec_definition():
    grades = {"a": 3, "b": 2, "c": 1}
    assert benchmark.ndcg_at_k(["a", "b", "c"], grades) == 1.0
    assert benchmark.ndcg_at_k(["x", "y"], grades) == 0.0
    expected = (1 / math.log2(2) + 3 / math.log2(3)) / (3 / math.log2(2) + 2 / math.log2(3) + 1 / math.log2(4))
    assert abs(benchmark.ndcg_at_k(["c", "a"], grades) - expected) < 1e-9
    assert benchmark.gold_document({"old": 3, "new": 3, "other": 2}, {"old": "2025-11-21", "new": "2025-11-28", "other": "2026-01-01"}) == "new"


def test_eval_queries_carry_graded_gold_documents(client):
    queries = assert_contract(client.get("/eval/queries"), "GET", "/eval/queries")
    assert len(queries) == 26 and queries[0]["query_id"] == "q01"
    assert queries[0]["tests"] == "onboarding_target_evolution"
    assert queries[0]["gold_docs"][0]["grade"] == 3 and len(queries[0]["gold_docs"]) == 6


def test_latest_eval_is_served_from_the_seed(client):
    result = assert_contract(client.get("/eval/latest"), "GET", "/eval/latest")
    assert len(result["per_query"]) == 26
    first = result["per_query"][0]
    assert first["gold_doc"] == "07-documents/report-final" and first["canonico_top_doc"] == "07-documents/report-final"
    assert first["pass_canonico"] is True


def test_eval_run_uses_the_current_memory(client):
    run = assert_contract(client.post("/eval/run"), "POST", "/eval/run", 202)
    assert run["status"] in ("queued", "running", "done")
    for _ in range(200):
        done = assert_contract(client.get(f"/eval/runs/{run['id']}"), "GET", "/eval/runs/{run_id}")
        if done["status"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert done["status"] == "done" and done["finished_at"] and done["cost_usd"] == 0
    metrics = done["result"]["metrics"]
    assert 0 < metrics["ndcg_at_10_plain"] <= 1 and 0 < metrics["ndcg_at_10_canonico"] <= 1
    assert metrics["binding_accuracy_canonico"] > metrics["binding_accuracy_plain"]
    assert assert_contract(client.get("/eval/runs"), "GET", "/eval/runs")[0]["id"] == run["id"]
    assert client.get("/eval/latest").json()["measured_at"] == done["result"]["measured_at"]
    assert_contract(client.get("/eval/runs/eval-nope"), "GET", "/eval/runs/{run_id}", 404)
