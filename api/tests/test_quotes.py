import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def seed_texts() -> dict[str, list[tuple[str, str]]]:
    """Every seeded document as (date, text) per version."""
    texts: dict[str, list[tuple[str, str]]] = {}
    for line in (ROOT / "data/clearpath/corpus.jsonl").read_text(encoding="utf-8").splitlines():
        doc = json.loads(line)
        texts[doc["_id"]] = [(doc["metadata"]["created"], doc["text"])]
    for doc in json.loads((ROOT / "data/seed/internal_documents.json").read_text(encoding="utf-8")):
        texts[doc["id"]] = [(doc["date"], doc["text"])]
    library = ROOT / "data/seed/library"
    for entry in json.loads((library / "manifest.json").read_text(encoding="utf-8"))["documents"]:
        texts[entry["doc_id"]] = [(v["date"], (library / v["file"]).read_text(encoding="utf-8")) for v in entry["versions"]]
    return texts


def test_every_seed_quote_is_verbatim_in_its_source_document():
    texts = seed_texts()
    facts = json.loads((ROOT / "data/seed/facts.json").read_text(encoding="utf-8"))
    assert facts
    missing = [f["id"] for f in facts if not any(f["quote"] in text for _, text in texts.get(f["doc_id"], []))]
    assert missing == []


def test_library_manifest_describes_every_version():
    library = ROOT / "data/seed/library"
    manifest = json.loads((library / "manifest.json").read_text(encoding="utf-8"))
    standard = next(d for d in manifest["documents"] if d["doc_id"] == "library/onboarding-standard")
    assert [v["version"] for v in standard["versions"]] == [1, 2]
    assert standard["versions"][0]["version_of"] is None and standard["versions"][1]["version_of"] == "library/onboarding-standard"
    assert all(v["uploaded_at"] and (library / v["file"]).suffix == ".txt" for v in standard["versions"])
    assert "4 weeks" in (library / standard["versions"][0]["file"]).read_text(encoding="utf-8")
    assert "3–4 weeks" in (library / standard["versions"][1]["file"]).read_text(encoding="utf-8")


def test_seed_links_point_to_existing_facts_and_dates_match_documents():
    dates = {doc_id: {date for date, _ in versions} for doc_id, versions in seed_texts().items()}
    facts = {f["id"]: f for f in json.loads((ROOT / "data/seed/facts.json").read_text(encoding="utf-8"))}
    for fact in facts.values():
        for key in ("supersedes", "superseded_by"):
            assert fact[key] is None or fact[key] in facts, (fact["id"], key)
        if fact["superseded_by"]:
            assert facts[fact["superseded_by"]]["date"] >= fact["date"], fact["id"]
        if fact["x"].get("curated"):
            assert fact["date"] in dates[fact["doc_id"]], fact["id"]
