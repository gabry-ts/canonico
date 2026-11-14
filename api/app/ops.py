"""Write operations on memory. Every one of them leaves an audit event."""

from app import store
from app.http import ApiError, not_found


def get_fact(state: dict, fact_id: str) -> dict:
    fact = state["facts"].get(fact_id)
    if fact is None:
        raise not_found(f"Fact {fact_id}")
    return fact


def _label(fact: dict) -> str:
    return fact.get("x", {}).get("label") or fact["id"]


def _short(fact: dict) -> str:
    return fact.get("x", {}).get("short") or fact["value"]


def sync_conflicts(state: dict) -> None:
    """Record a conflict when a topic holds several live binding candidates that nothing links."""
    for record in [c for c in state["conflicts"].values() if c.get("x", {}).get("auto")]:
        if not record.get("resolution") and store.conflict_status(state, record) != "open":
            del state["conflicts"][record["id"]]
    for topic in state["topics"].values():
        live = [
            f
            for f in store.topic_facts(state, topic["id"])
            if f["status"] == "active" and not store.is_superseded(state, f) and store.effective_type(state, f) in store.BINDING_TYPES
        ]
        if len(live) < 2:
            continue
        ids = {f["id"] for f in live}
        open_records = [c for c in state["conflicts"].values() if c["topic"] == topic["id"] and store.conflict_status(state, c) == "open"]
        covered = set().union(*[set(c["fact_ids"]) for c in open_records]) if open_records else set()
        if ids <= covered:
            continue
        auto = next((c for c in open_records if c.get("x", {}).get("auto")), None)
        live.sort(key=lambda f: (f["date"], f["id"]))
        summary = ", ".join(f"{_label(f)} says {_short(f)}" for f in live) + ", and nothing links them."
        summary = summary[:1].upper() + summary[1:]
        if auto:
            auto["fact_ids"] = [f["id"] for f in live]
            auto["summary"] = summary
            continue
        numbers = [int(i.split("-")[1]) for i in state["conflicts"] if i.split("-")[1].isdigit()]
        cid = f"C-{max(numbers + [0]) + 1:03d}"
        state["conflicts"][cid] = {
            "id": cid,
            "topic": topic["id"],
            "fact_ids": [f["id"] for f in live],
            "summary": summary,
            "detected_at": store.now(),
            "resolution": None,
            "x": {"auto": True},
        }


def retire(state: dict, fact: dict, reason: str, actor: str, action: str = "retire", extra: dict | None = None) -> dict | None:
    """Retire a fact. It is kept, but answers stop using it."""
    if fact["status"] == "retired":
        return None
    touched = [c for c in state["conflicts"].values() if fact["id"] in c["fact_ids"] and store.conflict_status(state, c) == "open"]
    updates = {"status": "retired", "retired_reason": reason, "pinned": False}
    x_updates = {}
    if not fact.get("superseded_by"):
        fact["status"] = "retired"
        binding = store.binding_of(state, fact["topic"])
        fact["status"] = "active"
        if binding is not None and binding["id"] != fact["id"] and binding["date"] >= fact["date"]:
            updates["superseded_by"] = binding["id"]
            x_updates["retire_linked"] = True
    event = store.change_fact(state, fact["id"], action, actor, reason, updates, x_updates, extra)
    for record in touched:
        if store.conflict_status(state, record) != "open":
            live = store.conflict_live(state, record)
            winner = live[0]["id"] if live else fact.get("superseded_by")
            if winner:
                record["x"]["auto_resolution"] = {"winning_fact_id": winner, "reason": reason, "actor": actor, "resolved_at": event["at"]}
    sync_conflicts(state)
    return event


def restore(state: dict, fact: dict, reason: str | None, actor: str) -> dict | None:
    if fact["status"] == "active":
        return None
    updates = {"status": "active", "retired_reason": None}
    x_updates = {}
    if fact["x"].get("retire_linked"):
        updates["superseded_by"] = None
        x_updates["retire_linked"] = False
    event = store.change_fact(state, fact["id"], "restore", actor, reason, updates, x_updates)
    sync_conflicts(state)
    return event


def require_topic(state: dict, topic_id: str) -> dict:
    topic = state["topics"].get(topic_id)
    if topic is None:
        raise not_found(f"Topic {topic_id}")
    return topic


def topic_view(topic: dict) -> dict:
    return {"id": topic["id"], "label": topic["label"], "fact_ids": list(topic["fact_ids"])}


def stats(state: dict) -> dict:
    by_type = {t: 0 for t in ("DECISION", "CONSTRAINT", "EVIDENCE", "HYPOTHESIS", "SUPERSEDED", "OPEN")}
    by_status = {"active": 0, "retired": 0}
    for fact in state["facts"].values():
        by_type[store.effective_type(state, fact)] += 1
        by_status[fact["status"]] += 1
    return {
        "documents": len(state["documents"]),
        "topics": len(state["topics"]),
        "facts_total": len(state["facts"]),
        "by_type": by_type,
        "by_status": by_status,
        "open_conflicts": sum(1 for c in state["conflicts"].values() if store.conflict_status(state, c) == "open"),
        "open_questions": sum(1 for q in state["open_questions"].values() if q["status"] == "open"),
        "maintenance_pending": sum(1 for m in state["maintenance"].values() if m["status"] == "pending"),
        "cost": {"spent_usd": round(state.get("cost_spent", 0.0), 4), "cap_usd": state["config"]["cost_cap_usd"]},
        "last_ingest_at": state.get("meta", {}).get("ingested_at"),
    }


__all__ = ["ApiError", "get_fact", "retire", "restore", "sync_conflicts", "require_topic", "topic_view", "stats"]
