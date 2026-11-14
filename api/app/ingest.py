"""Ingestion jobs: run the extraction pipeline and merge its result into memory or into the seed.

Command line, to rebuild the committed seed from the corpus:

    cd api && .venv/bin/python -m app.ingest
"""

import copy
import json
import secrets
import sys
import threading

from app import extract, llm, ops, settings, store
from app.store import STORE


def materialize(result: dict, curated_facts: list[dict], curated_topics: list[dict], curated_conflicts: list[dict], documents: dict) -> dict:
    """Turn a pipeline result into memory records. Curated topics win over extracted ones."""
    reserved = {t["id"] for t in curated_topics}
    by_tid = {f["tid"]: f for f in result["facts"]}
    numbers = [int(f["id"].split("-")[1]) for f in curated_facts if f["id"].split("-")[1].isdigit()]
    counter = max(numbers + [300])
    facts, topics, id_map = [], [], {}
    for topic in sorted(result["topics"], key=lambda t: min((by_tid[i]["date"] for i in t["fact_ids"]), default="9999")):
        if topic["id"] in reserved:
            continue
        members = sorted((by_tid[i] for i in topic["fact_ids"]), key=lambda f: (f["date"], f["tid"]))
        ids = []
        for raw in members:
            counter += 1
            fact_id = f"M-{counter}"
            id_map[raw["tid"]] = fact_id
            ids.append(fact_id)
            title = documents.get(raw["doc_id"], {}).get("title", raw["doc_id"])
            facts.append(
                {
                    "id": fact_id,
                    "topic": topic["id"],
                    "value": raw["value"],
                    "type": raw["type"],
                    "status": "active",
                    "doc_id": raw["doc_id"],
                    "quote": raw["quote"],
                    "date": raw["date"],
                    "supersedes": None,
                    "superseded_by": None,
                    "confidence": raw["confidence"],
                    "retired_reason": None,
                    "pinned": False,
                    "x": {"short": raw.get("short") or "", "label": f"the fact “{raw.get('short') or raw['value'][:60]}” from “{title}”"},
                }
            )
        topics.append(
            {
                "id": topic["id"],
                "label": topic["label"],
                "fact_ids": ids,
                "x": {"keywords": topic.get("keywords", []), "questions": [topic["question"]] if topic.get("question") else []},
            }
        )
    by_id = {f["id"]: f for f in facts}
    for link in result["links"]:
        older, newer = by_id.get(id_map.get(link["older"], "")), by_id.get(id_map.get(link["newer"], ""))
        if not older or not newer:
            continue
        older["superseded_by"] = newer["id"]
        older["x"]["base_type"] = older["type"]
        older["x"]["superseded_reason"] = link.get("reason", "")
        older["type"] = "SUPERSEDED"
        current = by_id.get(newer["supersedes"] or "")
        if current is None or (older["date"], older["id"]) > (current["date"], current["id"]):
            newer["supersedes"] = older["id"]
    conflicts = copy.deepcopy(curated_conflicts)
    taken = [int(c["id"].split("-")[1]) for c in conflicts]
    number = max(taken + [0])
    for raw in result["conflicts"]:
        ids = [id_map[i] for i in raw["fact_ids"] if i in id_map and not by_id[id_map[i]]["superseded_by"]]
        if len(ids) < 2:
            continue
        number += 1
        conflicts.append(
            {"id": f"C-{number:03d}", "topic": raw["topic"], "fact_ids": ids, "summary": raw["summary"], "detected_at": settings.DETECTED_AT, "resolution": None, "x": {}}
        )
    return {"facts": copy.deepcopy(curated_facts) + facts, "topics": copy.deepcopy(curated_topics) + topics, "conflicts": conflicts}


def _curated(items: list[dict]) -> list[dict]:
    return [i for i in items if i.get("x", {}).get("curated")]


def _existing_topics(curated_topics: list[dict]) -> list[dict]:
    return [{"id": t["id"], "description": t.get("x", {}).get("description") or t["label"]} for t in curated_topics]


# ---------------------------------------------------------------- jobs


def new_job(state: dict, kind: str) -> dict:
    job = {"id": f"job-{secrets.token_hex(2)}", "kind": kind, "status": "queued", "docs": 0, "facts": 0, "cost_usd": 0.0}
    state["jobs"].append(job)
    return job


def job_view(job: dict) -> dict:
    return {k: job[k] for k in ("id", "kind", "status", "docs", "facts", "cost_usd")}


def remaining_budget(state: dict) -> float:
    return max(0.0, state["config"]["cost_cap_usd"] - state.get("cost_spent", 0.0))


def _progress(job_id: str, meter: llm.Meter):
    def report(_: str, found: int) -> None:
        with STORE.write() as state:
            job = next(j for j in state["jobs"] if j["id"] == job_id)
            job["docs"] += 1
            job["facts"] += found
            job["cost_usd"] = round(meter.spent, 4)

    return report


def _finish(job_id: str, meter: llm.Meter, status: str) -> None:
    with STORE.write() as state:
        job = next(j for j in state["jobs"] if j["id"] == job_id)
        job["status"] = status
        job["cost_usd"] = round(meter.spent, 4)
        state["cost_spent"] = round(state.get("cost_spent", 0.0) + meter.spent, 6)


def run_ingest_job(job_id: str) -> None:
    """Extract the whole corpus again and replace every non-curated fact."""
    with STORE.write() as state:
        job = next(j for j in state["jobs"] if j["id"] == job_id)
        job["status"] = "running"
        documents = copy.deepcopy(state["documents"])
        models = dict(state["config"]["models"])
        curated_facts = _curated(list(copy.deepcopy(state["facts"]).values()))
        curated_topics = _curated(list(copy.deepcopy(state["topics"]).values()))
        curated_conflicts = _curated(list(copy.deepcopy(state["conflicts"]).values()))
        meter = llm.Meter(cap_usd=remaining_budget(state))
    try:
        result = extract.run_corpus(list(documents.values()), _existing_topics(curated_topics), models, meter, _progress(job_id, meter))
        memory = materialize(result, curated_facts, curated_topics, curated_conflicts, documents)
    except Exception:
        _finish(job_id, meter, "error")
        return
    with STORE.write() as state:
        for fact in memory["facts"]:
            if fact["id"] in state["facts"] and fact["x"].get("curated"):
                continue
            state["facts"][fact["id"]] = fact
        keep = {f["id"] for f in memory["facts"]}
        for fact_id in [i for i in state["facts"] if i not in keep and not state["facts"][i]["x"].get("manual")]:
            del state["facts"][fact_id]
        state["topics"] = {t["id"]: (state["topics"].get(t["id"]) if t["x"].get("curated") and t["id"] in state["topics"] else t) for t in memory["topics"]}
        for fact in state["facts"].values():
            store.move_fact(state, fact, fact["topic"])
        state["conflicts"] = {c["id"]: state["conflicts"].get(c["id"], c) if c["x"].get("curated") else c for c in memory["conflicts"]}
        state["open_questions"] = {k: q for k, q in state["open_questions"].items() if q["fact_id"] in state["facts"]}
        store.sync_open_questions(state)
        ops.sync_conflicts(state)
        state.setdefault("meta", {})["ingested_at"] = store.now()
        job = next(j for j in state["jobs"] if j["id"] == job_id)
        job["facts"] = len(state["facts"])
        store.audit(state, "ingest", "system", None, f"Ingested {len(documents)} documents, {len(state['facts'])} facts in memory.")
    _finish(job_id, meter, "done")


def run_classify_job(job_id: str, doc_id: str | None, fact_ids: list[str] | None, force: bool) -> None:
    """Re-classify the facts of one document or a list of facts. Manual edits and pins survive unless forced."""
    with STORE.write() as state:
        job = next(j for j in state["jobs"] if j["id"] == job_id)
        job["status"] = "running"
        targets = [f for f in state["facts"].values() if (doc_id and f.get("doc_id") == doc_id) or (fact_ids and f["id"] in fact_ids)]
        if not force:
            targets = [f for f in targets if not f.get("pinned") and not f["x"].get("edited")]
        targets = copy.deepcopy(targets)
        model = state["config"]["models"]["classification"]
        meter = llm.Meter(cap_usd=remaining_budget(state))
    try:
        verdicts = extract.retype_facts(targets, model, meter) if targets else {}
    except Exception:
        _finish(job_id, meter, "error")
        return
    with STORE.write() as state:
        changed = 0
        for fact_id, verdict in verdicts.items():
            fact = state["facts"].get(fact_id)
            if fact is None or fact["type"] == "SUPERSEDED":
                continue
            updates = {}
            if fact["type"] != verdict["type"]:
                updates["type"] = verdict["type"]
            if updates:
                updates["confidence"] = round(min(1.0, max(0.0, float(verdict["confidence"]))), 2)
                store.change_fact(state, fact_id, "classify", "system", "Re-classified from its source quote.", updates)
                changed += 1
        store.sync_open_questions(state)
        ops.sync_conflicts(state)
        job = next(j for j in state["jobs"] if j["id"] == job_id)
        job["docs"] = 1 if doc_id else 0
        job["facts"] = len(verdicts)
    _finish(job_id, meter, "done")


def start(target, *args) -> None:
    threading.Thread(target=target, args=args, daemon=True).start()


# ---------------------------------------------------------------- seed builder


def build_seed_files() -> dict:
    """Run the pipeline over the corpus and rewrite data/seed with curated and extracted memory."""
    seed = store.seed_dir()
    curated_facts = _curated(json.loads((seed / "facts.json").read_text(encoding="utf-8")))
    curated_topics = _curated(json.loads((seed / "topics.json").read_text(encoding="utf-8")))
    curated_conflicts = _curated(json.loads((seed / "conflicts.json").read_text(encoding="utf-8")))
    documents = store.load_corpus_documents()
    meter = llm.Meter()
    models = dict(store.DEFAULT_CONFIG["models"])

    def progress(doc_id: str, found: int) -> None:
        print(f"  {doc_id}: {found} facts", flush=True)

    result = extract.run_corpus(list(documents.values()), _existing_topics(curated_topics), models, meter, progress)
    memory = materialize(result, curated_facts, curated_topics, curated_conflicts, documents)
    for name in ("facts", "topics", "conflicts"):
        (seed / f"{name}.json").write_text(json.dumps(memory[name], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    meta = {
        "ingested_at": settings.SEED_AT,
        "corpus": settings.CORPUS,
        "documents": len(documents),
        "facts": len(memory["facts"]),
        "topics": len(memory["topics"]),
        "conflicts": len(memory["conflicts"]),
        "extracted_facts": len(result["facts"]),
        "links": len(result["links"]),
        "models": models,
        "usage": meter.summary(),
    }
    (seed / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


if __name__ == "__main__":
    if not llm.available():
        sys.exit("No model provider configured: set LLM_PROVIDER and its key in api/.env.")
    print(json.dumps(build_seed_files(), indent=2))
