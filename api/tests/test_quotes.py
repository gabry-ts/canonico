import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_every_seed_quote_is_verbatim_in_its_source_document():
    corpus = {}
    for line in (ROOT / "data/clearpath/corpus.jsonl").read_text(encoding="utf-8").splitlines():
        doc = json.loads(line)
        corpus[doc["_id"]] = doc["text"]
    facts = json.loads((ROOT / "data/seed/facts.json").read_text(encoding="utf-8"))
    assert facts
    missing = [f["id"] for f in facts if f["doc_id"] not in corpus or f["quote"] not in corpus[f["doc_id"]]]
    assert missing == []


def test_seed_links_point_to_existing_facts_and_dates_match_documents():
    corpus = {}
    for line in (ROOT / "data/clearpath/corpus.jsonl").read_text(encoding="utf-8").splitlines():
        doc = json.loads(line)
        corpus[doc["_id"]] = doc["metadata"]["created"]
    facts = {f["id"]: f for f in json.loads((ROOT / "data/seed/facts.json").read_text(encoding="utf-8"))}
    for fact in facts.values():
        for key in ("supersedes", "superseded_by"):
            assert fact[key] is None or fact[key] in facts, (fact["id"], key)
        if fact["superseded_by"]:
            assert facts[fact["superseded_by"]]["date"] >= fact["date"], fact["id"]
        if fact["x"].get("curated"):
            assert fact["date"] == corpus[fact["doc_id"]], fact["id"]
