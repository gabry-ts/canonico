"""Inbound items: meetings, documents, notes and tickets pushed by a webhook or uploaded by a person.

An item is stored as a document, read by the same deterministic rule as email (the model reads it
only when the rule finds nothing, never offline) and goes through the same supersession logic.
"""

import hmac
import re

from app import inbox, statements, store
from app.http import ApiError, not_found

_DATE_WORDS = re.compile(r"\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(19|20)\d{2}\b", re.IGNORECASE)


def token_matches(record: dict | None, token: str | None) -> bool:
    if not record or not token:
        return False
    return hmac.compare_digest(store.secret_hash(token), record["hash"])


def rotate(record_holder: dict, key: str) -> dict:
    """Replace a secret. The new value is returned once, only its hash is kept."""
    secret = store.new_secret()
    rotated_at = store.now()
    previous = record_holder.get(key) or {}
    record_holder[key] = {"hash": store.secret_hash(secret), "last4": secret[-4:], "created_at": previous.get("created_at") or rotated_at, "rotated_at": rotated_at}
    return {"secret": secret, "secret_last4": secret[-4:], "rotated_at": rotated_at}


def webhook_source(state: dict, project_id: str) -> dict | None:
    return next((s for s in state["sources"].values() if s["project_id"] == project_id and s["type"] == "webhook"), None)


def route_by_tags(state: dict, tags: list[str]) -> dict | None:
    """First tag rule, by ascending priority, whose tag is on the item."""
    wanted = {t.strip().lower() for t in tags or []}
    for rule in sorted(state["tag_rules"].values(), key=lambda r: (r["priority"], r["id"])):
        if rule["project_id"] in state["projects"] and rule["tag"].strip().lower() in wanted:
            return rule
    return None


def document_id(state: dict, item: dict) -> str:
    title = _DATE_WORDS.sub(" ", item["title"])
    base = f"hooks/{item['type']}-{str(item['date'])[:10]}-{store.slugify(title)}"
    candidate, n = base, 2
    while candidate in state["documents"]:
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def forced_topic(state: dict, tags: list[str], project_id: str) -> str | None:
    for tag in tags:
        if tag.lower().startswith("topic:"):
            topic = state["topics"].get(tag.split(":", 1)[1].strip())
            if topic is not None and topic.get("project_id") == project_id:
                return topic["id"]
    return None


def item_view(state: dict, item: dict) -> dict:
    return {
        "id": item["id"],
        "project_id": item["project_id"],
        "type": item["type"],
        "title": item["title"],
        "date": item["date"],
        "tags": list(item["tags"]),
        "participants": list(item["participants"]),
        "source_id": item["source_id"] if item["source_id"] in state["sources"] else None,
        "document_id": item["document_id"],
        "facts_count": sum(1 for f in item["fact_ids"] if f in state["facts"]),
        "received_at": item["received_at"],
        "routed_by": item["routed_by"],
    }


def receive(state: dict, project_id: str, item: dict, *, routed_by: str, rule_id: str | None, source: dict | None, actor: str) -> dict:
    """Store one item in a project and update the memory from it. Returns an InboundItemResult."""
    external_id = item.get("external_id")
    if external_id:
        seen = next((i for i in state["items"] if i["project_id"] == project_id and i.get("external_id") == external_id), None)
        if seen is not None:
            return {**seen["result"], "duplicate": True}
    text = (item.get("text") or "").strip()
    if not text:
        raise ApiError(422, "text: the item has no text. Send `text`, a `file_url` or upload the file.")
    tags = list(dict.fromkeys([*(item.get("tags") or []), *((source or {}).get("config", {}).get("default_tags") or [])]))
    date = str(item["date"])[:10]
    name = f"the {item['type']} “{item['title']}”"
    arrival = None
    if item.get("version_of"):
        document = state["documents"].get(item["version_of"])
        if document is None or document.get("project_id") != project_id:
            raise not_found(f"Document {item['version_of']}")
        if text == document["text"].strip():
            raise ApiError(422, "text: identical to the current version of the document.")
        before = {f["id"] for f in state["facts"].values() if f.get("doc_id") == document["id"]}
        outcome = inbox.new_version(state, document, text=text, label=None, title=None, date=date)
        doc_id, created, links = document["id"], outcome["facts_created"], outcome["supersedes_created"]
        document["tags"] = list(dict.fromkeys([*(document.get("tags") or []), *tags]))
        for fact in state["facts"].values():
            if fact.get("doc_id") == doc_id and fact["id"] not in before:
                fact["tags"] = tags
        event_id = next((e["id"] for e in reversed(state["audit"]) if e.get("fact_id") in created), None) or state["audit"][-1]["id"]
    else:
        doc_id = document_id(state, item)
        header = [item["title"], f"Type: {item['type']}", f"Date: {item['date']}"]
        if item.get("participants"):
            header.append("Participants: " + ", ".join(item["participants"]))
        state["documents"][doc_id] = {
            "id": doc_id,
            "title": item["title"],
            "date": date,
            "path": f"{doc_id}.txt",
            "text": "\n".join(header) + "\n\n" + text + "\n",
            "project_id": project_id,
            "source_id": source["id"] if source else None,
            "version": 1,
            "version_of": None,
            "tags": tags,
        }
        arrival = store.audit(state, "ingest", actor, None, f"{item['type'].capitalize()} “{item['title']}” received in {project_id} ({routed_by.replace('_', ' ')}).", x={"project": project_id, "document": doc_id, "info": {"kind": "item", "type": item["type"], "title": item["title"], "project": project_id, "routed_by": routed_by}}, bump=False)
        created, links, event_id = apply_statements(state, statements.find(state, text, project_id, force_topic=forced_topic(state, tags, project_id)), doc_id=doc_id, date=date, name=name, item=item, tags=tags, actor=actor)
        event_id = event_id or arrival["id"]
    if source is not None:
        source.update(status="ok", last_synced_at=store.now())
    state["seq"]["item"] = state["seq"].get("item", 0) + 1
    result = {
        "item_id": f"itm-{state['seq']['item']:04d}",
        "project_id": project_id,
        "routed_by": routed_by,
        "rule_id": rule_id,
        "document_id": doc_id,
        "facts_created": created,
        "supersedes_created": links,
        "audit_event_id": event_id,
        "duplicate": False,
    }
    state["items"].append(
        {
            "id": result["item_id"],
            "project_id": project_id,
            "type": item["type"],
            "title": item["title"],
            "date": str(item["date"]),
            "tags": tags,
            "participants": list(item.get("participants") or []),
            "source_id": source["id"] if source else None,
            "document_id": doc_id,
            "fact_ids": list(created),
            "received_at": store.now(),
            "routed_by": routed_by,
            "external_id": external_id,
            "excerpt": text[:400],
            "result": result,
        }
    )
    return result


def apply_statements(state: dict, found: list[dict], *, doc_id: str, date: str, name: str, item: dict, tags: list[str], actor: str) -> tuple[list[str], list[dict], str | None]:
    """One fact per statement: it replaces the binding fact, or confirms it when the value is the same."""
    created, links, event_id = [], [], None
    for statement in found:
        topic_id = statement["topic"]
        binding = store.binding_of(state, topic_id)
        confirms = binding["id"] if binding is not None and statements.same_value(binding, statement["short"]) else None
        olds = [] if confirms or statement["type"] != "DECISION" else inbox.replaced_by_decision(state, topic_id, statement["short"], date)
        names = ", ".join(f"{o['id']} ({o['x'].get('short') or o['value']})" for o in olds)
        if olds:
            reason = f"{name[:1].upper() + name[1:]}: {statement['short']} supersedes {names}."
        elif confirms:
            reason = f"{name[:1].upper() + name[1:]} confirms {confirms} ({statement['short']})."
        else:
            reason = f"{name[:1].upper() + name[1:]}: {statement['value']}."
        figures = bool(state["topics"][topic_id].get("x", {}).get("what"))
        internal = {"short": statement["short"], "label": name, "source_label": name, "source_short": item["title"], "src": {"kind": "item", "type": item["type"], "title": item["title"]}}
        if confirms:
            internal["confirms"] = confirms
        fact_id = store.next_fact_id(state)
        event = inbox.add_fact(
            state,
            fact_id=fact_id,
            topic_id=topic_id,
            value=statement["short"] if figures else statement["value"],
            kind=statement["type"],
            doc_id=doc_id,
            quote=statement["quote"],
            date=date,
            confidence=0.9,
            internal=internal,
            olds=olds,
            cause=name,
            reason=reason,
            actor=actor,
            tags=tags,
        )
        event_id = event["id"]
        created.append(fact_id)
        links.extend({"fact_id": fact_id, "supersedes": old["id"]} for old in olds)
    return created, links, event_id


def tag_counts(state: dict, project_id: str | None) -> list[dict]:
    counts: dict[str, int] = {}
    rows = list(state["facts"].values()) + list(state["documents"].values())
    for row in rows:
        if store.in_scope(row.get("project_id"), project_id):
            for tag in row.get("tags") or []:
                counts[tag] = counts.get(tag, 0) + 1
    return [{"tag": tag, "count": count} for tag, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
