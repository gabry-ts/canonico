"""Inbound mail: routing rules, storage as documents, facts and supersedes links."""

import re
from email.utils import parseaddr

from app import llm, ops, statements, store
from app.http import ApiError


def address(value: str) -> str:
    return (parseaddr(value or "")[1] or (value or "")).strip().lower()


def route(state: dict, email: dict) -> tuple[dict | None, str]:
    """First matching rule by ascending priority, with the reason in plain words."""
    sender = address(email.get("from", ""))
    recipients = {address(r) for r in (email.get("to") or []) + (email.get("cc") or [])}
    subject = (email.get("subject") or "").lower()
    for rule in sorted(state["mail_rules"].values(), key=lambda r: (r["priority"], r["id"])):
        if rule["project_id"] not in state["projects"]:
            continue
        value = rule["value"].strip().lower()
        kind = rule["match_type"]
        if kind == "sender_domain":
            domain, wanted = sender.rsplit("@", 1)[-1], value.lstrip("@")
            hit = domain == wanted
        elif kind == "sender_address":
            hit = sender == address(value)
        elif kind == "recipient":
            hit = address(value) in recipients
        else:
            hit = bool(value) and value in subject
        if hit:
            return rule, f"{kind} {rule['value']}"
    return None, "no rule matched"


def effective_mail_config(state: dict, project: dict) -> dict | None:
    return project.get("mail_config_override") or state["org"].get("mail_config")


def document_id(state: dict, message_id: str) -> str:
    local = message_id.strip().strip("<>").split("@")[0]
    base = "mail/" + (re.sub(r"[^a-z0-9]+", "-", local.lower()).strip("-") or "message")
    candidate, n = base, 2
    while candidate in state["documents"]:
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def mail_source(state: dict, project_id: str | None) -> dict | None:
    return next((s for s in state["sources"].values() if s["project_id"] == project_id and s["type"] == "mail"), None)


def receive(state: dict, email: dict) -> dict:
    """Store an email as a document of the routed project and update the memory from it."""
    message_id = email["message_id"]
    if any(m["message_id"] == message_id for m in state["messages"]):
        raise ApiError(409, f"Message {message_id} was already received.")
    rule, reason = route(state, email)
    project_id = rule["project_id"] if rule else None
    sender = address(email["from"])
    date = str(email["date"])[:10]
    doc_id = document_id(state, message_id)
    source = mail_source(state, project_id)
    lines = [f"From: {email['from']}", f"To: {', '.join(email.get('to') or [])}", f"Subject: {email['subject']}", f"Date: {email['date']}", "", email["text"]]
    for attachment in email.get("attachments") or []:
        lines += ["", f"Attachment: {attachment['filename']}", attachment["text"]]
    state["documents"][doc_id] = {
        "id": doc_id,
        "title": f"Email: {email['subject']}",
        "date": date,
        "path": f"{doc_id}.eml",
        "text": "\n".join(lines),
        "project_id": project_id,
        "source_id": source["id"] if source else None,
        "version": 1,
        "version_of": None,
    }
    where = f"routed to {project_id} by {rule['id']} ({reason})" if rule else "kept at organisation scope, no rule matched"
    event = store.audit(state, "ingest", "mail", None, f"Email “{email['subject']}” from {sender} {where}.", x={"project": project_id, "document": doc_id}, bump=False)
    body = "\n".join([email["text"]] + [a["text"] for a in email.get("attachments") or []])
    found = statements.find(state, body, project_id) if project_id else []
    created, links, change_id = apply_email_statements(state, found, doc_id=doc_id, date=date, sender=sender, subject=email["subject"])
    if source is not None:
        source.update(status="ok", last_synced_at=store.now())
    state["messages"].append(
        {"message_id": message_id, "project_id": project_id, "from": email["from"], "subject": email["subject"], "date": str(email["date"]), "rule_id": rule["id"] if rule else None, "document_id": doc_id}
    )
    return {
        "message_id": message_id,
        "routed_project_id": project_id,
        "rule_id": rule["id"] if rule else None,
        "document_id": doc_id,
        "facts_created": created,
        "supersedes_created": links,
        "audit_event_id": change_id or event["id"],
    }


def add_fact(state: dict, *, fact_id: str, topic_id: str, value: str, kind: str, doc_id: str, quote: str, date: str, confidence: float, internal: dict, olds: list[dict], cause: str, reason: str) -> dict:
    """Add one fact that arrived from a source and link the facts it replaces, as a single audit event.

    Undoing that event removes the new fact and puts the replaced ones back as they were.
    """
    fact = {
        "id": fact_id,
        "topic": topic_id,
        "value": value,
        "type": kind,
        "status": "active",
        "doc_id": doc_id,
        "quote": quote,
        "date": date,
        "supersedes": olds[0]["id"] if olds else None,
        "superseded_by": None,
        "confidence": confidence,
        "retired_reason": None,
        "pinned": False,
        "project_id": store.project_of_topic(state, topic_id),
        "x": {"manual": False, **internal},
    }
    restore, befores = [], {}
    for old in olds:
        store.ensure_history(state, old)
        befores[old["id"]] = store.view(state, old)
        previous = state["facts"].get(old.get("superseded_by") or "")
        if previous is not None and previous.get("supersedes") == old["id"]:
            restore.append({"fact": previous["id"], "fields": {"supersedes": old["id"]}, "x": {}})
            previous["supersedes"] = None
        restore.append(
            {
                "fact": old["id"],
                "fields": {"superseded_by": old.get("superseded_by"), "type": old["type"]},
                "x": {"base_type": old["x"].get("base_type"), "retire_linked": old["x"].get("retire_linked")},
            }
        )
        if old["type"] != "SUPERSEDED":
            old["x"]["base_type"] = old["type"]
            old["type"] = "SUPERSEDED"
        old["superseded_by"] = fact_id
        old["x"]["retire_linked"] = False
    state["facts"][fact_id] = fact
    store.move_fact(state, fact, topic_id)
    event = store.audit(
        state,
        "supersede" if olds else "ingest",
        "system",
        fact_id,
        reason,
        x={"undo": {"created": fact_id, "restore": restore}, "cause": cause, "replaced": [o["id"] for o in olds], "topic": topic_id},
    )
    state["history"][fact_id] = [{"at": event["at"], "actor": "system", "action": "ingest", "changes": {}, "snapshot": store.view(state, fact)}]
    for old in olds:
        after = store.view(state, old)
        changes = {k: {"from": befores[old["id"]][k], "to": after[k]} for k in store.PUBLIC_FACT_FIELDS if befores[old["id"]][k] != after[k]}
        state["history"][old["id"]].append({"at": event["at"], "actor": "system", "action": "supersede", "changes": changes, "snapshot": after})
    return event


def replaced_by_decision(state: dict, topic_id: str, short: str, date: str) -> list[dict]:
    """What a new decision on a topic replaces: the binding fact, and the library versions that still carry its value."""
    binding = store.binding_of(state, topic_id)
    if binding is None or not statements.restates(binding, short) or statements.same_value(binding, short) or binding["date"] > date:
        return []
    olds = [binding]
    library = {s["id"] for s in state["sources"].values() if s["type"] == "document_library"}
    for fact in store.topic_facts(state, topic_id):
        document = state["documents"].get(fact.get("doc_id") or "")
        if fact is binding or document is None or document.get("source_id") not in library:
            continue
        if statements.live(state, fact) and store.value_key(fact) == store.value_key(binding) and fact["date"] <= date:
            olds.append(fact)
    return olds


def apply_email_statements(state: dict, found: list[dict], *, doc_id: str, date: str, sender: str, subject: str) -> tuple[list[str], list[dict], str | None]:
    created, links, event_id = [], [], None
    for item in found:
        olds = replaced_by_decision(state, item["topic"], item["short"], date) if item["type"] == "DECISION" else []
        binding = store.binding_of(state, item["topic"])
        if not olds and binding is not None and statements.same_value(binding, item["short"]) and item["type"] != "DECISION":
            continue
        fact_id = store.next_fact_id(state, "E")
        names = ", ".join(f"{o['id']} ({o['x'].get('short') or o['value']})" for o in olds)
        reason = f"Email from {sender}: {item['short']} supersedes {names}." if olds else f"Email from {sender}: {item['value']}."
        event = add_fact(
            state,
            fact_id=fact_id,
            topic_id=item["topic"],
            value=item["value"],
            kind=item["type"],
            doc_id=doc_id,
            quote=item["quote"],
            date=date,
            confidence=0.9,
            internal={"short": item["short"], "label": f"the email from {sender}", "source_label": f"the email from {sender}"},
            olds=olds,
            cause=f"an email from {sender}",
            reason=reason,
        )
        event_id = event["id"]
        created.append(fact_id)
        links.extend({"fact_id": fact_id, "supersedes": old["id"]} for old in olds)
    return created, links, event_id


def can_use_model(state: dict) -> bool:
    """Model calls are allowed only outside offline mode, with a provider configured and budget left."""
    if state["config"].get("offline_mode"):
        return False
    return llm.available() and state["config"]["cost_cap_usd"] - state.get("cost_spent", 0.0) > 0


DEMO_EMAIL = {
    "message_id": "<demo-0001@meridianlabs.org>",
    "from": "client@meridianlabs.org",
    "to": ["brain@inbound.meridianlabs.org"],
    "cc": [],
    "subject": "Onboarding target confirmed",
    "date": "2026-11-14T14:30:00Z",
    "text": "Following our call, we confirm the onboarding target at 5 weeks.",
    "attachments": [],
}


def poll(state: dict, project_id: str | None) -> dict:
    """Fetch the mocked inbox of the organisation, or the messages of it that belong to one project."""
    if project_id is None:
        config = state["org"].get("mail_config")
    else:
        config = effective_mail_config(state, state["projects"][project_id])
    if not config or config.get("mode") != "imap_mock":
        return {"polled": 0, "results": []}
    overridden = project_id is not None and bool(state["projects"][project_id].get("mail_config_override"))
    results, polled = [], 0
    for entry in state["mailbox"]:
        if entry.get("fetched") or entry.get("mailbox") != config.get("imap_user"):
            continue
        if project_id is not None and not overridden:
            rule, _ = route(state, entry["email"])
            if (rule or {}).get("project_id") != project_id:
                continue
        entry["fetched"] = True
        polled += 1
        try:
            results.append(receive(state, entry["email"]))
        except ApiError:
            continue
    return {"polled": polled, "results": results}


def new_version(state: dict, document: dict, *, text: str, label: str | None, title: str | None, date: str) -> dict:
    """Store a new version of a document and supersede what the previous version said on the same topics."""
    ensure_versions(document)
    number = document["versions"][-1]["version"] + 1
    label = label or f"v{number}"
    previous_facts = [f for f in state["facts"].values() if f.get("doc_id") == document["id"] and f["status"] == "active"]
    internal_successors = {f["supersedes"] for f in previous_facts if f.get("supersedes")}
    current = [f for f in previous_facts if not (f.get("superseded_by") and state["facts"].get(f["superseded_by"], {}).get("doc_id") == document["id"])]
    current = [f for f in current if f["id"] not in internal_successors or not f.get("superseded_by") or state["facts"][f["superseded_by"]].get("doc_id") != document["id"]]
    snapshot = {k: (list(v) if isinstance(v, list) else v) for k, v in document.items()}
    snapshot["versions"] = [dict(v) for v in document["versions"]]
    entry = {"version": number, "version_label": label, "uploaded_at": store.now(), "title": title or document["title"], "date": date, "text": text, "facts_superseded": []}
    document["versions"].append(entry)
    document.update(text=text, title=entry["title"], date=date, version=number, version_of=document["id"])
    name = f"version {number} of “{document['title']}”"
    store.audit(state, "ingest", "system", None, f"{label} of “{document['title']}” uploaded to the document library.", x={"project": document.get("project_id"), "document": document["id"], "undo": {"document_version": {document["id"]: snapshot}}}, bump=False)
    library = any(f["id"].startswith("L-") for f in previous_facts) or (state["sources"].get(document.get("source_id") or "", {}).get("type") == "document_library")
    found = statements.find(state, text, document.get("project_id"), prefer_topics={f["topic"] for f in current})
    created, links = [], []
    for item in found:
        same_topic = [f for f in current if f["topic"] == item["topic"] and statements.restates(f, item["short"])]
        if same_topic and all(statements.same_value(f, item["short"]) for f in same_topic):
            continue
        olds = sorted((f for f in same_topic if not statements.same_value(f, item["short"])), key=lambda f: (f["date"], f["id"]), reverse=True)
        if not olds and not any(f["topic"] == item["topic"] for f in current) and current:
            continue
        fact_id = store.next_library_fact_id(state, document["id"]) if library else store.next_fact_id(state)
        names = ", ".join(f"{o['id']} ({o['x'].get('short') or o['value']})" for o in olds)
        reason = f"{document['title']} {label} supersedes {names}." if olds else f"{document['title']} {label}: {item['short']}."
        add_fact(
            state,
            fact_id=fact_id,
            topic_id=item["topic"],
            value=f"{document['title']} {label}: {item['short']}",
            kind=item["type"],
            doc_id=document["id"],
            quote=item["quote"],
            date=date,
            confidence=0.95,
            internal={"short": item["short"], "label": name, "source_label": name, "doc_version": number},
            olds=olds,
            cause=name,
            reason=reason,
        )
        created.append(fact_id)
        links.extend({"fact_id": fact_id, "supersedes": old["id"]} for old in olds)
        entry["facts_superseded"].extend(old["id"] for old in olds)
    source = state["sources"].get(document.get("source_id") or "")
    if source is not None:
        source.update(status="ok", last_synced_at=store.now())
    return {"version": version_view(document, entry), "facts_created": created, "supersedes_created": links}


def ensure_versions(document: dict) -> list[dict]:
    if not document.get("versions"):
        document["versions"] = [
            {"version": 1, "version_label": "v1", "uploaded_at": f"{document['date']}T00:00:00Z", "title": document["title"], "date": document["date"], "text": document["text"], "facts_superseded": []}
        ]
    return document["versions"]


def version_view(document: dict, entry: dict) -> dict:
    return {
        "document_id": document["id"],
        "version": entry["version"],
        "version_label": entry.get("version_label"),
        "uploaded_at": entry.get("uploaded_at"),
        "supersedes_document_id": document["id"] if entry["version"] > 1 else None,
        "facts_superseded": list(entry.get("facts_superseded", [])),
    }


def versions_view(document: dict) -> list[dict]:
    entries = document.get("versions") or [
        {"version": 1, "version_label": "v1", "uploaded_at": f"{document['date']}T00:00:00Z", "facts_superseded": []}
    ]
    return [version_view(document, entry) for entry in entries]
