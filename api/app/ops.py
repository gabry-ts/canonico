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
        if len({store.value_key(f) for f in live}) < 2:
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
    updates = {"status": "retired", "retired_reason": reason, "pinned": False, "retired_by": actor, "retired_at": store.now()}
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
    updates = {"status": "active", "retired_reason": None, "retired_by": None, "retired_at": None}
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
        "project_id": store.project_of_topic(state, topic),
        "x": {"manual": True, **(x or {})},
    }
    state["facts"][fact_id] = fact
    store.move_fact(state, fact, topic)
    event = store.audit(state, action, actor, fact_id, None, x={"undo": {"created": fact_id}})
    state["history"][fact_id] = [{"at": event["at"], "actor": actor, "action": action, "changes": {}, "snapshot": store.view(state, fact)}]
    return fact


def pin(state: dict, fact: dict, reason: str, actor: str, action: str = "pin", extra: dict | None = None) -> None:
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
    store.change_fact(state, fact["id"], action, actor, reason, {"pinned": True}, extra={"others": others, **(extra or {})})


def _reaches(state: dict, start: dict, target_id: str) -> bool:
    seen, current = set(), start
    while current is not None and current["id"] not in seen:
        if current["id"] == target_id:
            return True
        seen.add(current["id"])
        current = state["facts"].get(current.get("superseded_by") or "")
    return False


def supersede(state: dict, older: dict, newer: dict, reason: str, actor: str, extra: dict | None = None, retype: bool = False) -> dict | None:
    """Declare that `newer` replaces `older`. With `retype` the older fact is classified SUPERSEDED."""
    if older["id"] == newer["id"]:
        raise ApiError(422, "A fact cannot supersede itself.")
    if older["topic"] != newer["topic"]:
        raise ApiError(422, "Both facts must share the same topic.")
    if newer["date"] < older["date"]:
        raise ApiError(422, f"Fact {newer['id']} is older than {older['id']} and cannot replace it.")
    if _reaches(state, newer, older["id"]):
        raise ApiError(409, "This link would create a cycle.")
    if older.get("superseded_by") == newer["id"] and not older["x"].get("retire_linked"):
        return None
    others = []
    previous = state["facts"].get(older.get("superseded_by") or "")
    if previous is not None and previous is not newer and previous.get("supersedes") == older["id"]:
        others.append({"fact": previous["id"], "fields": {"supersedes": previous["supersedes"]}})
        previous["supersedes"] = None
    others.append({"fact": newer["id"], "fields": {"supersedes": newer.get("supersedes")}})
    store.ensure_history(state, newer)
    newer["supersedes"] = older["id"]
    updates, x_updates = {"superseded_by": newer["id"]}, {"retire_linked": False, "acknowledged": actor != "system"}
    if retype and older["type"] != "SUPERSEDED":
        x_updates["base_type"] = older["type"]
        updates["type"] = "SUPERSEDED"
    return store.change_fact(state, older["id"], "supersede", actor, reason, updates, x_updates, extra={"others": others, **(extra or {})})


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
    return {"id": topic["id"], "label": topic["label"], "fact_ids": list(topic["fact_ids"]), "project_id": topic.get("project_id")}


def require_project(state: dict, project_id: str) -> dict:
    project = state["projects"].get(project_id)
    if project is None:
        raise not_found(f"Project {project_id}")
    return project


def scope(state: dict, project_id: str | None) -> str | None:
    """Validate the optional project filter of a list request."""
    if project_id is not None and project_id not in state["projects"]:
        raise ApiError(422, f"project_id: unknown project {project_id}")
    return project_id


def stats(state: dict, project_id: str | None = None) -> dict:
    by_type = {t: 0 for t in ("DECISION", "CONSTRAINT", "EVIDENCE", "HYPOTHESIS", "SUPERSEDED", "OPEN")}
    by_status = {"active": 0, "retired": 0}
    facts = [f for f in state["facts"].values() if store.in_scope(f.get("project_id"), project_id)]
    for fact in facts:
        by_type[store.effective_type(state, fact)] += 1
        by_status[fact["status"]] += 1
    ids = {f["id"] for f in facts}
    topics = {t["id"] for t in state["topics"].values() if store.in_scope(t.get("project_id"), project_id)}
    return {
        "documents": sum(1 for d in state["documents"].values() if store.in_scope(d.get("project_id"), project_id)),
        "topics": len(topics),
        "facts_total": len(facts),
        "by_type": by_type,
        "by_status": by_status,
        "open_conflicts": sum(1 for c in state["conflicts"].values() if c["topic"] in topics and store.conflict_status(state, c) == "open"),
        "open_questions": sum(1 for q in state["open_questions"].values() if q["status"] == "open" and q["fact_id"] in ids),
        "maintenance_pending": sum(1 for m in state["maintenance"].values() if m["status"] == "pending" and m["fact_id"] in ids),
        "cost": {"spent_usd": round(state.get("cost_spent", 0.0), 4), "cap_usd": state["config"]["cost_cap_usd"]},
        "last_ingest_at": state.get("meta", {}).get("ingested_at"),
    }


def undo_targets(undo: dict) -> set[str]:
    targets = {undo.get("fact"), undo.get("created")}
    targets |= {fact["id"] for fact in undo.get("facts", [])}
    targets |= {item["fact"] for item in undo.get("restore", [])}
    return targets - {None}


def apply_undo(state: dict, event: dict) -> None:
    """Revert what an audit event did, using the before-values stored with it."""
    undo = event["x"]["undo"]
    if "created" in undo:
        fact = state["facts"].pop(undo["created"], None)
        if fact is not None:
            topic = state["topics"].get(fact["topic"])
            if topic and fact["id"] in topic["fact_ids"]:
                topic["fact_ids"].remove(fact["id"])
            for other in state["facts"].values():
                for key in ("supersedes", "superseded_by"):
                    if other.get(key) == fact["id"]:
                        other[key] = None
            state["open_questions"] = {k: q for k, q in state["open_questions"].items() if q["fact_id"] != fact["id"]}
    for item in undo.get("restore", []):
        fact = state["facts"].get(item["fact"])
        if fact is None:
            continue
        before = store.view(state, fact)
        fact.update(item.get("fields", {}))
        fact["x"].update(item.get("x", {}))
        after = store.view(state, fact)
        changes = {k: {"from": before[k], "to": after[k]} for k in store.PUBLIC_FACT_FIELDS if before[k] != after[k]}
        store.ensure_history(state, fact).append({"at": store.now(), "actor": "system", "action": "undo", "changes": changes, "snapshot": after})
    for doc_id, snapshot in (undo.get("document_version") or {}).items():
        if doc_id in state["documents"]:
            state["documents"][doc_id] = snapshot
    if "fact" in undo and undo["fact"] in state["facts"]:
        fact = state["facts"][undo["fact"]]
        before = store.view(state, fact)
        old_topic = fact["topic"]
        fact.update(undo.get("fields", {}))
        fact["x"].update(undo.get("x", {}))
        if fact["topic"] != old_topic:
            store.move_fact(state, fact, old_topic)
        for other in event["x"].get("others", []):
            if other["fact"] in state["facts"]:
                state["facts"][other["fact"]].update(other["fields"])
        after = store.view(state, fact)
        changes = {k: {"from": before[k], "to": after[k]} for k in store.PUBLIC_FACT_FIELDS if before[k] != after[k]}
        store.ensure_history(state, fact).append({"at": store.now(), "actor": "system", "action": "undo", "changes": changes, "snapshot": after})
    if "document" in undo:
        state["documents"][undo["document"]["id"]] = undo["document"]
        for fact in undo.get("facts", []):
            state["facts"][fact["id"]] = fact
            store.move_fact(state, fact, fact["topic"])
        for link in undo.get("links", []):
            if link["fact"] in state["facts"]:
                state["facts"][link["fact"]].update(link["fields"])
    if "question" in undo:
        state["open_questions"][undo["question"]["id"]] = undo["question"]
    if "maintenance" in undo and undo["maintenance"] in state["maintenance"]:
        state["maintenance"][undo["maintenance"]]["status"] = "pending"
    conflict = state["conflicts"].get(event["x"].get("conflict") or "")
    if conflict is not None:
        conflict["resolution"] = None


def delete_document(state: dict, doc_id: str, actor: str) -> dict:
    """Remove a document with every fact extracted from it and the links that pointed to them."""
    document = state["documents"].pop(doc_id)
    removed = [f for f in state["facts"].values() if f.get("doc_id") == doc_id]
    ids = {f["id"] for f in removed}
    links = []
    for fact in state["facts"].values():
        if fact["id"] in ids:
            continue
        fields = {key: fact[key] for key in ("supersedes", "superseded_by") if fact.get(key) in ids}
        if fields:
            if fact["type"] == "SUPERSEDED" and "superseded_by" in fields:
                fields["type"] = fact["type"]
                fact["type"] = fact["x"].get("base_type") or "DECISION"
            links.append({"fact": fact["id"], "fields": dict(fields)})
            for key in ("supersedes", "superseded_by"):
                if key in fields:
                    fact[key] = None
    for fact in removed:
        del state["facts"][fact["id"]]
        topic = state["topics"].get(fact["topic"])
        if topic and fact["id"] in topic["fact_ids"]:
            topic["fact_ids"].remove(fact["id"])
    state["open_questions"] = {k: q for k, q in state["open_questions"].items() if q["fact_id"] not in ids}
    state["maintenance"] = {k: m for k, m in state["maintenance"].items() if m["fact_id"] not in ids}
    event = store.audit(
        state,
        "delete_document",
        actor,
        None,
        f"Deleted document {doc_id} and {len(removed)} facts.",
        x={"undo": {"document": document, "facts": removed, "links": links}, "topics": sorted({f["topic"] for f in removed})},
    )
    return {"doc_id": doc_id, "deleted_fact_ids": sorted(ids), "audit_event_id": event["id"]}


def _days_between(older: str, newer: str) -> int:
    from datetime import date

    return (date.fromisoformat(newer) - date.fromisoformat(older)).days


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
            if store.stale_active(state, fact):
                wanted[(fact["id"], "superseded_still_retrievable")] = f"Superseded by {newer['id']} on {newer['date']} but still ranked in plain retrieval."
        elif binding is not None and binding is not fact and store.effective_type(state, fact) in store.BINDING_TYPES and _days_between(fact["date"], binding["date"]) > state["config"]["stale_after_days"]:
            wanted[(fact["id"], "stale")] = f"More than {state['config']['stale_after_days']} days older than the latest decision on the same topic and not linked to it."
        elif fact["confidence"] < threshold:
            wanted[(fact["id"], "low_confidence")] = f"Confidence {fact['confidence']:.2f} is below the threshold {threshold:.2f}."
    known = {(m["fact_id"], m["reason"]): m for m in state["maintenance"].values()}
    for key, item in known.items():
        if item["status"] == "pending" and key not in wanted:
            del state["maintenance"][item["id"]]
    fresh = [k for k in wanted if k not in known]
    fresh.sort(key=lambda k: (bool(state["facts"][k[0]]["x"].get("curated")), state["facts"][k[0]]["date"], k[0]), reverse=True)
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
