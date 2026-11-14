"""Write operations on memory. Every one of them leaves an audit event."""

from app import settings, store
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
        if not topic.get("x", {}).get("curated") and not any(f["x"].get("manual") or f["x"].get("edited") for f in live):
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


def create_fact(state: dict, *, topic: str, value: str, type: str, doc_id: str | None, quote: str, date: str, confidence: float, actor: str, action: str = "create", x: dict | None = None) -> dict:
    fact_id = store.next_fact_id(state)
    fact = {
        "id": fact_id,
        "topic": topic,
        "value": value,
        "type": type,
        "status": "active",
        "doc_id": doc_id,
        "quote": quote,
        "date": date,
        "supersedes": None,
        "superseded_by": None,
        "confidence": confidence,
        "retired_reason": None,
        "pinned": False,
        "x": {"manual": True, **(x or {})},
    }
    state["facts"][fact_id] = fact
    store.move_fact(state, fact, topic)
    event = store.audit(state, action, actor, fact_id, None, x={"undo": {"created": fact_id}})
    state["history"][fact_id] = [{"at": event["at"], "actor": actor, "action": action, "changes": {}, "snapshot": store.view(state, fact)}]
    return fact


def pin(state: dict, fact: dict, reason: str, actor: str) -> None:
    """Pin a fact as binding. Only one fact per topic stays pinned."""
    if fact.get("pinned"):
        return
    previous = [f for f in store.topic_facts(state, fact["topic"]) if f.get("pinned") and f is not fact]
    others = []
    for other in previous:
        store.ensure_history(state, other)
        others.append({"fact": other["id"], "fields": {"pinned": True}})
        other["pinned"] = False
    if previous:
        reason = f"{reason} (pin moved from {', '.join(f['id'] for f in previous)})"
    store.change_fact(state, fact["id"], "pin", actor, reason, {"pinned": True}, extra={"others": others})


def _reaches(state: dict, start: dict, target_id: str) -> bool:
    seen, current = set(), start
    while current is not None and current["id"] not in seen:
        if current["id"] == target_id:
            return True
        seen.add(current["id"])
        current = state["facts"].get(current.get("superseded_by") or "")
    return False


def supersede(state: dict, older: dict, newer: dict, reason: str, actor: str) -> None:
    """Declare that `newer` replaces `older`."""
    if older["id"] == newer["id"]:
        raise ApiError(422, "A fact cannot supersede itself.")
    if older["topic"] != newer["topic"]:
        raise ApiError(422, "Both facts must share the same topic.")
    if newer["date"] < older["date"]:
        raise ApiError(422, f"Fact {newer['id']} is older than {older['id']} and cannot replace it.")
    if _reaches(state, newer, older["id"]):
        raise ApiError(409, "This link would create a cycle.")
    if older.get("superseded_by") == newer["id"] and not older["x"].get("retire_linked"):
        return
    others = []
    previous = state["facts"].get(older.get("superseded_by") or "")
    if previous is not None and previous is not newer and previous.get("supersedes") == older["id"]:
        others.append({"fact": previous["id"], "fields": {"supersedes": previous["supersedes"]}})
        previous["supersedes"] = None
    others.append({"fact": newer["id"], "fields": {"supersedes": newer.get("supersedes")}})
    store.ensure_history(state, newer)
    newer["supersedes"] = older["id"]
    store.change_fact(state, older["id"], "supersede", actor, reason, {"superseded_by": newer["id"]}, {"retire_linked": False}, extra={"others": others})


def unlink(state: dict, newer: dict, reason: str, actor: str) -> None:
    """Remove the edge from a fact to the older fact it replaces."""
    older = state["facts"].get(newer["supersedes"])
    others = []
    if older is not None and older.get("superseded_by") == newer["id"]:
        fields = {"superseded_by": older["superseded_by"], "type": older["type"]}
        others.append({"fact": older["id"], "fields": fields})
        store.ensure_history(state, older)
        older["superseded_by"] = None
        if older["type"] == "SUPERSEDED":
            older["type"] = older["x"].get("base_type") or "DECISION"
    store.change_fact(state, newer["id"], "unlink", actor, reason, {"supersedes": None}, extra={"others": others})


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


def sync_maintenance(state: dict) -> None:
    """Propose facts for retirement: superseded but still retrievable, stale, or low confidence."""
    threshold = state["config"]["low_confidence_threshold"]
    wanted: dict[tuple[str, str], str] = {}
    bindings: dict[str, dict | None] = {}
    for fact in state["facts"].values():
        if fact["status"] != "active" or fact.get("pinned"):
            continue
        topic_id = fact["topic"]
        if topic_id not in bindings:
            bindings[topic_id] = store.binding_of(state, topic_id)
        binding = bindings[topic_id]
        newer = store.successor(state, fact)
        if newer is not None:
            wanted[(fact["id"], "superseded_still_retrievable")] = f"Superseded by {newer['id']} on {newer['date']} but still ranked in plain retrieval."
        elif binding is not None and binding is not fact and store.effective_type(state, fact) in store.BINDING_TYPES and fact["date"] < binding["date"]:
            wanted[(fact["id"], "stale")] = "Older than the latest decision on the same topic and not linked to it."
        elif fact["confidence"] < threshold:
            wanted[(fact["id"], "low_confidence")] = f"Confidence {fact['confidence']:.2f} is below the threshold {threshold:.2f}."
    known = {(m["fact_id"], m["reason"]): m for m in state["maintenance"].values()}
    for key, item in known.items():
        if item["status"] == "pending" and key not in wanted:
            del state["maintenance"][item["id"]]
    fresh = [k for k in wanted if k not in known]
    fresh.sort(key=lambda k: (state["facts"][k[0]]["date"], k[0]), reverse=True)
    for fact_id, reason in fresh:
        state["seq"]["mq"] += 1
        item_id = f"MQ-{state['seq']['mq']:03d}"
        state["maintenance"][item_id] = {
            "id": item_id,
            "fact_id": fact_id,
            "reason": reason,
            "detail": wanted[(fact_id, reason)],
            "proposed_action": "retire",
            "status": "pending",
            "proposed_at": settings.PROPOSED_AT if state["version"] == 0 else store.now(),
        }


def sync(state: dict) -> None:
    """Derived records follow the facts: conflicts, open questions and the maintenance queue."""
    sync_conflicts(state)
    store.sync_open_questions(state)
    sync_maintenance(state)


store.STORE.after_change = sync
