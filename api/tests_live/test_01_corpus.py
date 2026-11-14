"""Scenario 1: full re-extraction of the ClearPath corpus with the live model."""

import json

from tests_live.conftest import FORCED, ROOT, note

DEMO_Q = "How long does onboarding take?"


def corpus_ids() -> set[str]:
    lines = (ROOT / "data" / "clearpath" / "corpus.jsonl").read_text(encoding="utf-8").splitlines()
    return {json.loads(line)["_id"] for line in lines if line.strip()}


def raw_extraction_outputs(api) -> int:
    """Facts the model returned before the verbatim filter, read from the local response cache."""
    total = 0
    for path in api.cache_dir.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8")).get("data") or {}
        facts = data.get("facts") if isinstance(data, dict) else None
        if facts and isinstance(facts[0], dict) and "quote" in facts[0]:
            total += len(facts)
    return total


def test_full_reextraction_keeps_verbatim_quotes_and_demo_topics(api, request):
    before = api.stats()
    start = api.spend()
    response = api.post("/ingest", json={"force": True})
    assert response.status_code == 202, response.text
    job = api.wait_job(f"/ingest/{response.json()['id']}", timeout=900)
    assert job["status"] == "done", job
    cost = api.spend() - start
    after = api.stats()
    corpus = corpus_ids()
    facts = api.all_facts()
    extracted = [f for f in facts if f["doc_id"] in corpus]
    links = sum(1 for f in facts if f["superseded_by"])
    texts = {doc_id: api.document(doc_id)["text"] for doc_id in {f["doc_id"] for f in extracted}}
    bad = [f["id"] for f in extracted if f["quote"] not in texts[f["doc_id"]]]
    note(request, "ingest", {"job": job, "cost_usd": round(cost, 4), "facts_before": before["facts_total"], "facts_after": after["facts_total"], "topics_after": after["topics"], "supersedes_links": links, "corpus_facts": len(extracted), "non_verbatim": bad, "open_conflicts": after["open_conflicts"]})
    assert not bad, f"quotes not verbatim: {bad[:10]}"
    assert len(extracted) > 100 and after["topics"] > 20

    answer = api.ask(DEMO_Q)
    assert answer["status"] == "binding" and answer["binding"]["id"] == "M-106" and answer["binding"]["value"] == "3–4 weeks"
    assert "M-105" in [f["id"] for f in answer["conflicts"]]


def test_drop_rate_is_reasonable(api, request):
    if not api.local:
        import pytest

        pytest.skip("needs the local model cache to count raw model output")
    raw = raw_extraction_outputs(api)
    corpus = corpus_ids()
    kept = sum(1 for f in api.all_facts() if f["doc_id"] in corpus and f["id"].startswith("M-") and int(f["id"][2:]) >= 1000)
    rate = 1 - kept / raw if raw else 0.0
    note(request, "drop_rate", {"raw_model_facts": raw, "kept_extracted_facts": kept, "rate": round(rate, 3), "includes": "non-verbatim quotes, duplicate quotes, facts grouped into curated topics"})
    assert raw > 0 and rate <= 0.5


def test_second_ingest_uses_the_cache(api, request):
    start = api.spend()
    response = api.post("/ingest", json={"force": True})
    assert response.status_code == 202, response.text
    job = api.wait_job(f"/ingest/{response.json()['id']}", timeout=600)
    spent = api.spend() - start
    note(request, "rerun", {"job": job, "cost_usd": round(spent, 6)})
    assert job["status"] == "done"
    if FORCED:
        assert spent > 0, "with CANONICO_FORCE_LLM the second ingest must call the model again"
    else:
        assert spent == 0, f"re-run spent ${spent}"
    answer = api.ask(DEMO_Q)
    assert answer["binding"]["id"] == "M-106"
