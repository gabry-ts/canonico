"""In-memory state with JSON persistence, seeded from data/seed and the corpus."""

import copy
import hashlib
import json
import logging
import os
import re
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app import i18n, llm, settings, wording

LOG = logging.getLogger("uvicorn.error")

PUBLIC_FACT_FIELDS = (
    "id",
    "topic",
    "value",
    "type",
    "status",
    "doc_id",
    "quote",
    "date",
    "supersedes",
    "superseded_by",
    "confidence",
    "retired_reason",
    "pinned",
    "project_id",
    "retired_by",
    "retired_at",
    "tags",
)
DEFAULT_PROJECT = "proj-clearpath"
BINDING_TYPES = ("DECISION", "CONSTRAINT")
DEFAULT_CONFIG = {
    "models": {
        "extraction": "claude-haiku-5-5",
        "classification": "claude-sonnet-5-5",
        "answer": "claude-sonnet-5-5",
    },
    "cost_cap_usd": 2.0,
    "active_corpus": settings.CORPUS,
    "stale_after_days": 90,
    "low_confidence_threshold": 0.5,
    "offline_mode": False,
    "provider": "anthropic",
}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "item"


def seed_dir() -> Path:
    return settings.data_dir() / "seed"


def corpus_dir() -> Path:
    return settings.data_dir() / "clearpath"


def _read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _with_real_mailbox(org: dict) -> dict:
    """When CANONICO_IMAP_HOST is set, the organisation reads that mailbox instead of the mocked inbox."""
    host = os.environ.get("CANONICO_IMAP_HOST")
    config = (org.get("organisation") or {}).get("mail_config")
    if host and config:
        org = copy.deepcopy(org)
        org["organisation"]["mail_config"] = {**config, "mode": "imap", "imap_host": host, "imap_user": os.environ.get("CANONICO_IMAP_USER") or config.get("imap_user")}
    return org


def seed_hash() -> str:
    digest = hashlib.sha256()
    files = sorted(p for p in seed_dir().rglob("*") if p.is_file() and p.suffix in (".json", ".txt")) + [corpus_dir() / "corpus.jsonl"]
    for path in files:
        if path.exists():
            digest.update(path.name.encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def load_corpus_documents() -> dict:
    docs = {}
    path = corpus_dir() / "corpus.jsonl"
    if not path.exists():
        return docs
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        meta = raw.get("metadata") or {}
        source = meta.get("source_path") or f"{raw['_id']}.md"
        docs[raw["_id"]] = {
            "id": raw["_id"],
            "title": raw.get("title") or raw["_id"],
            "date": meta.get("created") or "2025-01-01",
            "path": source.removeprefix("raw/"),
            "text": raw.get("text", ""),
            "project_id": DEFAULT_PROJECT,
            "source_id": "src-clearpath-docs",
            "version": 1,
            "version_of": None,
        }
    return docs


def load_seed_documents() -> dict:
    """Documents that are not part of the corpus: internal documents and the versioned library."""
    docs = {}
    for raw in _read_json(seed_dir() / "internal_documents.json", []):
        docs[raw["id"]] = {"version": 1, "version_of": None, **copy.deepcopy(raw)}
    library = seed_dir() / "library"
    for entry in _read_json(library / "manifest.json", {}).get("documents", []):
        versions = []
        for item in sorted(entry["versions"], key=lambda v: v["version"]):
            text = (library / item["file"]).read_text(encoding="utf-8")
            versions.append(
                {
                    "version": item["version"],
                    "version_label": item.get("version_label"),
                    "uploaded_at": item["uploaded_at"],
                    "title": entry["title"],
                    "date": item["date"],
                    "text": text,
                    "facts_superseded": [],
                }
            )
        latest = versions[-1]
        docs[entry["doc_id"]] = {
            "id": entry["doc_id"],
            "title": entry["title"],
            "date": latest["date"],
            "path": f"{entry['doc_id']}.txt",
            "text": latest["text"],
            "project_id": entry.get("project_id"),
            "source_id": entry.get("source_id"),
            "version": latest["version"],
            "version_of": entry["doc_id"] if latest["version"] > 1 else None,
            "versions": versions,
        }
    return docs


def secret_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def new_secret() -> str:
    import secrets

    return "whsec_" + secrets.token_urlsafe(24)


def _seed_secret(raw: dict) -> dict:
    """Seeded hooks carry a fixed demo secret. Only its hash and last four characters are kept in memory."""
    secret = raw.get("demo_secret") or new_secret()
    return {"hash": secret_hash(secret), "last4": secret[-4:], "created_at": raw.get("created_at") or settings.SEED_AT}


def _seed_source(raw: dict) -> dict:
    source = {"x": {}, **copy.deepcopy(raw)}
    demo = source.pop("demo_secret", None)
    if source["type"] == "webhook":
        source["x"]["secret"] = _seed_secret({"demo_secret": demo, "created_at": source.get("created_at")})
    return source


def build_seed() -> dict:
    facts = {}
    for fact in _read_json(seed_dir() / "facts.json", []):
        fact = copy.deepcopy(fact)
        fact.setdefault("x", {})
        fact.setdefault("pinned", False)
        fact.setdefault("project_id", DEFAULT_PROJECT)
        facts[fact["id"]] = fact
    topics = {}
    for topic in _read_json(seed_dir() / "topics.json", []):
        topic = copy.deepcopy(topic)
        topic.setdefault("x", {})
        topic.setdefault("project_id", DEFAULT_PROJECT)
        topic["fact_ids"] = [i for i in topic.get("fact_ids", []) if i in facts]
        topics[topic["id"]] = topic
    documents = {**load_corpus_documents(), **load_seed_documents()}
    for fact in facts.values():
        document = documents.get(fact.get("doc_id") or "")
        newer = facts.get(fact.get("superseded_by") or "")
        if document and document.get("versions") and newer and newer.get("doc_id") == document["id"]:
            for entry in document["versions"]:
                if entry["version"] == newer.get("x", {}).get("doc_version") and fact["id"] not in entry["facts_superseded"]:
                    entry["facts_superseded"].append(fact["id"])
    for fact in facts.values():
        topic = topics.setdefault(
            fact["topic"],
            {"id": fact["topic"], "label": fact["topic"].replace("-", " ").capitalize(), "fact_ids": [], "project_id": fact["project_id"], "x": {}},
        )
        if fact["id"] not in topic["fact_ids"]:
            topic["fact_ids"].append(fact["id"])
    conflicts = {}
    for conflict in _read_json(seed_dir() / "conflicts.json", []):
        conflict = copy.deepcopy(conflict)
        conflict.setdefault("x", {})
        conflict.setdefault("resolution", None)
        conflict["fact_ids"] = [i for i in conflict["fact_ids"] if i in facts]
        conflicts[conflict["id"]] = conflict
    org = _read_json(seed_dir() / "org.json", {})
    mailbox = []
    org = _with_real_mailbox(org)
    for path in sorted((seed_dir() / "mail").glob("*.json")) if (seed_dir() / "mail").exists() else []:
        mailbox.extend({**copy.deepcopy(item), "fetched": False} for item in _read_json(path, []))
    state = {
        "seed_hash": seed_hash(),
        "version": 0,
        "seq": {"audit": 0, "answer": 0, "oq": 0, "mq": 0, "fact": 300, "sync": 0, "rule": 0, "item": 0, "tag_rule": 0},
        "org": copy.deepcopy(org.get("organisation") or {"id": "org-default", "name": "Organisation", "mail_config": None}),
        "projects": {p["id"]: copy.deepcopy(p) for p in org.get("projects", [{"id": DEFAULT_PROJECT, "name": "ClearPath engagement", "description": None, "created_at": settings.SEED_AT, "mail_config_override": None}])},
        "sources": {x["id"]: _seed_source(x) for x in org.get("sources", [])},
        "hooks": {"org": _seed_secret((org.get("hooks") or {}).get("org") or {})},
        "tag_rules": {r["id"]: copy.deepcopy(r) for r in org.get("tag_rules", [])},
        "items": [],
        "mail_rules": {r["id"]: copy.deepcopy(r) for r in org.get("mail_rules", [])},
        "mailbox": mailbox,
        "messages": [],
        "sync_jobs": [],
        "members": {m["id"]: copy.deepcopy(m) for m in org.get("members", [])},
        "project_members": copy.deepcopy(org.get("project_members", [])),
        "documents": documents,
        "topics": topics,
        "facts": facts,
        "conflicts": conflicts,
        "open_questions": {},
        "maintenance": {},
        "audit": [],
        "answers": [],
        "history": {},
        "jobs": [],
        "eval_runs": [],
        "eval_latest": _read_json(seed_dir() / "eval.json", None),
        "config": copy.deepcopy(DEFAULT_CONFIG),
        "cost_spent": 0.0,
        "meta": _read_json(seed_dir() / "meta.json", {}),
    }
    for rule_id in state["mail_rules"]:
        if rule_id.split("-")[-1].isdigit():
            state["seq"]["rule"] = max(state["seq"]["rule"], int(rule_id.split("-")[-1]))
    for rule_id in state["tag_rules"]:
        if rule_id.split("-")[-1].isdigit():
            state["seq"]["tag_rule"] = max(state["seq"]["tag_rule"], int(rule_id.split("-")[-1]))
    state["config"]["offline_mode"] = os.environ.get("CANONICO_OFFLINE") == "1"
    provider = (os.environ.get("LLM_PROVIDER") or "anthropic").strip().lower()
    state["config"]["provider"] = provider if provider in ("anthropic", "gateway") else "anthropic"
    state["config"]["models"] = llm.default_models()
    cap = os.environ.get("CANONICO_COST_CAP_USD")
    if cap:
        state["config"]["cost_cap_usd"] = float(cap)
    for key, name in (("extraction", "CANONICO_MODEL_EXTRACTION"), ("classification", "CANONICO_MODEL_CLASSIFICATION"), ("answer", "CANONICO_MODEL_ANSWER")):
        if os.environ.get(name):
            state["config"]["models"][key] = os.environ[name]
    meta = state["meta"]
    if meta.get("ingested_at"):
        usage = meta.get("usage", {})
        state["jobs"].append(
            {"id": "job-7f3a", "kind": "ingest", "status": "done", "docs": meta.get("documents", len(state["documents"])), "facts": len(facts), "cost_usd": usage.get("cost_usd", 0.0)}
        )
    for question in _read_json(seed_dir() / "open_questions.json", []):
        state["open_questions"][question["id"]] = copy.deepcopy(question)
        state["seq"]["oq"] = max(state["seq"]["oq"], int(question["id"].split("-")[1]))
    sync_open_questions(state)
    return state


# ---------------------------------------------------------------- fact graph


def successor(state: dict, fact: dict) -> dict | None:
    """First active fact reached by following superseded_by links."""
    seen = {fact["id"]}
    current = fact
    while current.get("superseded_by") and current["superseded_by"] not in seen:
        nxt = state["facts"].get(current["superseded_by"])
        if nxt is None:
            return None
        if nxt["status"] == "active":
            return nxt
        seen.add(nxt["id"])
        current = nxt
    return None


def final_successor(state: dict, fact: dict) -> dict | None:
    """Last fact of the supersedes chain, when every fact on the way is active."""
    seen = {fact["id"]}
    current = fact
    while current.get("superseded_by") and current["superseded_by"] not in seen:
        nxt = state["facts"].get(current["superseded_by"])
        if nxt is None or nxt["status"] != "active":
            return None
        seen.add(nxt["id"])
        current = nxt
    return current if current is not fact else None


def stale_active(state: dict, fact: dict) -> bool:
    """Superseded but still active: a newer fact replaced it, yet it was never reclassified or retired.

    The link came from dates and wording. Until a person retires the fact or confirms the link,
    an agent could still pick it up, so answers flag it and the maintenance queue proposes it.
    """
    if fact["status"] != "active" or fact["type"] == "SUPERSEDED" or fact.get("x", {}).get("acknowledged"):
        return False
    return successor(state, fact) is not None


def is_superseded(state: dict, fact: dict) -> bool:
    if successor(state, fact) is not None:
        return True
    return fact["type"] == "SUPERSEDED" and not fact.get("superseded_by")


def effective_type(state: dict, fact: dict) -> str:
    """A SUPERSEDED fact whose replacement was retired falls back to its original type."""
    if fact["type"] == "SUPERSEDED" and not is_superseded(state, fact):
        return fact.get("x", {}).get("base_type") or "DECISION"
    return fact["type"]


def view(state: dict, fact: dict) -> dict:
    out = {key: fact.get(key) for key in PUBLIC_FACT_FIELDS}
    out["type"] = effective_type(state, fact)
    out["pinned"] = bool(fact.get("pinned"))
    out["doc_id"] = fact.get("doc_id") or "manual"
    out["project_id"] = fact.get("project_id")
    out["retired_by"] = fact.get("retired_by") if fact["status"] == "retired" else None
    out["retired_at"] = fact.get("retired_at") if fact["status"] == "retired" else None
    out["tags"] = list(fact.get("tags") or [])
    return out


def topic_facts(state: dict, topic_id: str) -> list[dict]:
    topic = state["topics"].get(topic_id)
    if not topic:
        return []
    return [state["facts"][i] for i in topic["fact_ids"] if i in state["facts"]]


def binding_of(state: dict, topic_id: str, focus: set[str] | None = None) -> dict | None:
    """Pinned fact, else the latest active DECISION or CONSTRAINT that nothing replaced.

    With a focus, only the facts of the topic that the question is about are candidates.
    """
    active = [f for f in topic_facts(state, topic_id) if f["status"] == "active"]
    pinned = [f for f in active if f.get("pinned")]
    if pinned:
        return pinned[0]
    answered = closed_answer(state, topic_id)
    if answered is not None and (focus is None or answered[0]["id"] in focus):
        return answered[0]
    if focus is not None:
        active = [f for f in active if f["id"] in focus]
    live = [f for f in active if not is_superseded(state, f) and effective_type(state, f) in BINDING_TYPES and confirmed_by(state, f) is None]
    if not live:
        return None
    return max(live, key=lambda f: (f["date"], f.get("x", {}).get("seq", 0), effective_type(state, f) == "DECISION", f["confidence"], f["id"]))


def closed_answer(state: dict, topic_id: str) -> tuple[dict, dict] | None:
    """(fact, question) when a person closed an open question of the topic with an answer fact that still stands.

    That answer is what the topic says from then on: it is binding, whatever its type, and it settles the open
    conflicts of the topic. Reopening the question (undoing the close) takes this back.
    """
    best = None
    for question in state["open_questions"].values():
        if question["topic"] != topic_id or question["status"] != "closed" or not question.get("answer_fact_id"):
            continue
        fact = state["facts"].get(question["answer_fact_id"])
        if fact is None or fact["status"] != "active" or fact["topic"] != topic_id:
            continue
        key = (question.get("closed_at") or "", question["id"])
        if best is None or key > best[0]:
            best = (key, fact, question)
    return (best[1], best[2]) if best else None


def confirmed_by(state: dict, fact: dict) -> dict | None:
    """The live fact this one only confirms. A confirmation never becomes binding while that fact stands."""
    target = state["facts"].get(fact.get("x", {}).get("confirms") or "")
    if target is None or target["status"] != "active" or is_superseded(state, target):
        return None
    return target


def conflict_live(state: dict, conflict: dict) -> list[dict]:
    facts = [state["facts"][i] for i in conflict["fact_ids"] if i in state["facts"]]
    return [f for f in facts if f["status"] == "active" and (not is_superseded(state, f) or stale_active(state, f))]


def conflict_status(state: dict, conflict: dict) -> str:
    if conflict.get("resolution") or closed_answer(state, conflict["topic"]) is not None:
        return "resolved"
    return "open" if len({value_key(f) for f in conflict_live(state, conflict)}) >= 2 else "resolved"


def question_resolution(state: dict, conflict: dict) -> dict | None:
    """Resolution of a conflict settled by closing an open question of its topic."""
    answered = closed_answer(state, conflict["topic"])
    if answered is None:
        return None
    fact, question = answered
    reason = question.get("note") or i18n.t("conflict.answered", question=question.get("question_it") if i18n.current() == "it" and question.get("question_it") else question["question"])
    resolved_at = question.get("closed_ts") or f"{question.get('closed_at') or now()[:10]}T00:00:00Z"
    return {"winning_fact_id": fact["id"], "reason": reason, "actor": question.get("closed_by") or "system", "resolved_at": resolved_at}


def conflict_view(state: dict, conflict: dict) -> dict:
    status = conflict_status(state, conflict)
    resolution = conflict.get("resolution")
    if status == "resolved" and not resolution:
        resolution = question_resolution(state, conflict) or conflict.get("x", {}).get("auto_resolution")
    summary = conflict["summary"]
    if i18n.current() == "it":
        extra = conflict.get("x", {})
        if extra.get("auto"):
            members = [state["facts"][i] for i in conflict["fact_ids"] if i in state["facts"]]
            parts = ", ".join(i18n.t("answer.conflict_part", label=wording.label(f), short=wording.short(f)) for f in members)
            summary = wording.cap(i18n.t("conflict.auto", parts=parts))
        else:
            summary = extra.get("summary_it") or summary
    return {
        "id": conflict["id"],
        "topic": conflict["topic"],
        "project_id": project_of_topic(state, conflict["topic"]),
        "status": status,
        "summary": summary,
        "facts": [view(state, state["facts"][i]) for i in conflict["fact_ids"] if i in state["facts"]],
        "detected_at": conflict["detected_at"],
        "resolution": resolution if status == "resolved" else None,
    }


def sync_open_questions(state: dict) -> None:
    """Every OPEN fact has an open question record."""
    known = {q["fact_id"] for q in state["open_questions"].values()}
    pending = [f for f in state["facts"].values() if f["type"] == "OPEN" and f["id"] not in known]
    for fact in sorted(pending, key=lambda f: (f["date"], f["id"])):
        state["seq"]["oq"] += 1
        qid = f"OQ-{state['seq']['oq']:03d}"
        state["open_questions"][qid] = {
            "id": qid,
            "topic": fact["topic"],
            "question": fact.get("x", {}).get("question") or fact["value"],
            "fact_id": fact["id"],
            "doc_id": fact.get("doc_id") or "manual",
            "status": "open",
            "opened_at": fact["date"],
            "closed_at": None,
            "answer_fact_id": None,
            "note": None,
        }


def next_fact_id(state: dict, prefix: str = "M", start: int = 301) -> str:
    """New facts are numbered from 301 per prefix: M for people and uploads, E for email. Seeded corpus facts start at M-1001."""
    counters = state["seq"].setdefault("facts", {})
    number = max(counters.get(prefix, start - 1) + 1, start)
    while f"{prefix}-{number}" in state["facts"]:
        number += 1
    counters[prefix] = number
    return f"{prefix}-{number}"


def next_library_fact_id(state: dict, doc_id: str) -> str:
    """Facts of a library document are numbered L-4xx, one block of ten per document."""
    numbers = [int(i.split("-")[1]) for i in state["facts"] if i.startswith("L-") and i.split("-")[1].isdigit()]
    own = [int(f["id"].split("-")[1]) for f in state["facts"].values() if f.get("doc_id") == doc_id and f["id"].startswith("L-") and f["id"].split("-")[1].isdigit()]
    number = max(own) + 1 if own else (max(numbers + [390]) // 10 + 1) * 10
    while f"L-{number}" in state["facts"]:
        number += 1
    return f"L-{number}"


def value_key(fact: dict) -> str:
    """Comparable form of what a fact states, used to tell agreement from disagreement."""
    text = fact.get("x", {}).get("short") or fact["value"]
    return re.sub(r"\s+", " ", re.sub(r"[–—]", "-", text.lower())).strip(" .")


def project_of_topic(state: dict, topic_id: str) -> str | None:
    topic = state["topics"].get(topic_id)
    return topic.get("project_id") if topic else None


def in_scope(record_project: str | None, project_id: str | None) -> bool:
    """Organisation scope (no project) sees everything, a project sees only itself."""
    return project_id is None or record_project == project_id


# ---------------------------------------------------------------- audit


def audit(state: dict, action: str, actor: str, fact_id: str | None, reason: str | None, x: dict | None = None, bump: bool = True) -> dict:
    state["seq"]["audit"] += 1
    if bump:
        state["version"] += 1
    fact = state["facts"].get(fact_id or "")
    event = {
        "id": f"a-{state['seq']['audit']:04d}",
        "at": now(),
        "actor": actor,
        "action": action,
        "fact_id": fact_id,
        "reason": reason,
        "project_id": (x or {}).get("project") or (fact.get("project_id") if fact else None),
        "x": {"version": state["version"], **(x or {})},
    }
    state["audit"].append(event)
    return event


def ensure_history(state: dict, fact: dict, at: str | None = None, actor: str = "system", action: str = "classify") -> list:
    history = state["history"].get(fact["id"])
    if history is None:
        history = [{"at": at or settings.SEED_AT, "actor": actor, "action": action, "changes": {}, "snapshot": view(state, fact)}]
        state["history"][fact["id"]] = history
    return history


def change_fact(state: dict, fact_id: str, action: str, actor: str, reason: str | None, updates: dict, x_updates: dict | None = None, extra: dict | None = None) -> dict:
    """Apply field updates to a fact, write the audit event and the history entry."""
    fact = state["facts"][fact_id]
    history = ensure_history(state, fact)
    before = view(state, fact)
    raw_before = {k: copy.deepcopy(fact.get(k)) for k in updates}
    x_before = {k: copy.deepcopy(fact["x"].get(k)) for k in (x_updates or {})}
    old_topic = fact["topic"]
    fact.update(updates)
    fact["x"].update(x_updates or {})
    if fact["topic"] != old_topic:
        move_fact(state, fact, old_topic)
    after = view(state, fact)
    changes = {k: {"from": before[k], "to": after[k]} for k in PUBLIC_FACT_FIELDS if before[k] != after[k]}
    event = audit(state, action, actor, fact_id, reason, x={"undo": {"fact": fact_id, "fields": raw_before, "x": x_before}, **(extra or {})})
    history.append({"at": event["at"], "actor": actor, "action": action, "changes": changes, "snapshot": after})
    return event


def move_fact(state: dict, fact: dict, old_topic: str) -> None:
    if old_topic != fact["topic"] and old_topic in state["topics"] and fact["id"] in state["topics"][old_topic]["fact_ids"]:
        state["topics"][old_topic]["fact_ids"].remove(fact["id"])
    target = state["topics"].setdefault(
        fact["topic"],
        {"id": fact["topic"], "label": fact["topic"].replace("-", " ").capitalize(), "fact_ids": [], "project_id": fact.get("project_id"), "x": {}},
    )
    fact["project_id"] = target.get("project_id")
    if fact["id"] not in target["fact_ids"]:
        target["fact_ids"].append(fact["id"])


def public_event(event: dict) -> dict:
    return {k: event.get(k) for k in ("id", "at", "actor", "action", "fact_id", "reason", "project_id")}


# ---------------------------------------------------------------- store


class Store:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.state: dict | None = None
        self.after_change = None

    def _derive(self) -> None:
        if self.after_change and self.state is not None:
            self.after_change(self.state)

    def _load(self) -> None:
        path = settings.state_file()
        if path and path.exists():
            try:
                state = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                state = None
                LOG.warning("state: %s could not be read, starting from the seed", path)
            if isinstance(state, dict) and state.get("facts") is not None:
                # The saved state wins over a newer seed: a restart or a redeploy never wipes the memory,
                # the audit log or the answers. `POST /demo/reset` is the only way back to the seed.
                current = seed_hash()
                if state.get("seed_hash") != current:
                    LOG.warning("state: kept %s although the seed changed since it was written; POST /demo/reset loads the new seed", path)
                    _complete(state)
                    state["seed_hash"] = current
                self.state = state
                return
        self.state = build_seed()
        audit(self.state, "ingest", "system", None, "Seeded demo memory from the ClearPath corpus.", bump=False)
        self.state["audit"][-1]["at"] = settings.SEED_AT
        self._derive()
        self._save()

    def _save(self) -> None:
        path = settings.state_file()
        if not path or self.state is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
        except OSError:
            pass

    @contextmanager
    def read(self):
        with self.lock:
            if self.state is None:
                self._load()
            yield self.state

    @contextmanager
    def write(self):
        with self.lock:
            if self.state is None:
                self._load()
            yield self.state
            self._derive()
            self._save()

    def reset(self, actor: str = "system") -> dict:
        with self.lock:
            self.state = build_seed()
            audit(self.state, "ingest", "system", None, "Seeded demo memory from the ClearPath corpus.", bump=False)
            self.state["audit"][-1]["at"] = settings.SEED_AT
            self.state["meta"]["last_reset_at"] = now()
            audit(self.state, "reset", actor, None, "Demo state restored from the seed.", bump=False)
            self._derive()
            self._save()
            return self.state


def _complete(state: dict) -> None:
    """Add the top-level records a state written by an older version lacks, taken from a fresh seed."""
    fresh = build_seed()
    for key, value in fresh.items():
        state.setdefault(key, value)
    for key, value in fresh["seq"].items():
        state["seq"].setdefault(key, value)
    for key, value in fresh["config"].items():
        state["config"].setdefault(key, value)


STORE = Store()
