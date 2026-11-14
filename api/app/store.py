"""In-memory state with JSON persistence, seeded from data/seed and the corpus."""

import copy
import hashlib
import json
import os
import re
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app import settings

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
)
BINDING_TYPES = ("DECISION", "CONSTRAINT")
DEFAULT_CONFIG = {
    "models": {
        "extraction": "claude-haiku-4-5",
        "classification": "claude-haiku-4-5",
        "answer": "claude-sonnet-4-5",
    },
    "cost_cap_usd": 2.0,
    "active_corpus": settings.CORPUS,
    "stale_after_days": 90,
    "low_confidence_threshold": 0.5,
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


def seed_hash() -> str:
    digest = hashlib.sha256()
    files = sorted(seed_dir().glob("*.json")) + [corpus_dir() / "corpus.jsonl"]
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
        }
    return docs


def build_seed() -> dict:
    facts = {}
    for fact in _read_json(seed_dir() / "facts.json", []):
        fact = copy.deepcopy(fact)
        fact.setdefault("x", {})
        fact.setdefault("pinned", False)
        facts[fact["id"]] = fact
    topics = {}
    for topic in _read_json(seed_dir() / "topics.json", []):
        topic = copy.deepcopy(topic)
        topic.setdefault("x", {})
        topic["fact_ids"] = [i for i in topic.get("fact_ids", []) if i in facts]
        topics[topic["id"]] = topic
    for fact in facts.values():
        topic = topics.setdefault(
            fact["topic"],
            {"id": fact["topic"], "label": fact["topic"].replace("-", " ").capitalize(), "fact_ids": [], "x": {}},
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
    state = {
        "seed_hash": seed_hash(),
        "version": 0,
        "seq": {"audit": 0, "answer": 0, "oq": 0, "mq": 0},
        "documents": load_corpus_documents(),
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
    cap = os.environ.get("CANONICO_COST_CAP_USD")
    if cap:
        state["config"]["cost_cap_usd"] = float(cap)
    for key, name in (("extraction", "CANONICO_MODEL_EXTRACTION"), ("classification", "CANONICO_MODEL_CLASSIFICATION"), ("answer", "CANONICO_MODEL_ANSWER")):
        if os.environ.get(name):
            state["config"]["models"][key] = os.environ[name]
    for question in _read_json(seed_dir() / "open_questions.json", []):
        state["open_questions"][question["id"]] = copy.deepcopy(question)
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
    return out


def topic_facts(state: dict, topic_id: str) -> list[dict]:
    topic = state["topics"].get(topic_id)
    if not topic:
        return []
    return [state["facts"][i] for i in topic["fact_ids"] if i in state["facts"]]


def binding_of(state: dict, topic_id: str) -> dict | None:
    """Pinned fact, else the latest active DECISION or CONSTRAINT that nothing replaced."""
    active = [f for f in topic_facts(state, topic_id) if f["status"] == "active"]
    pinned = [f for f in active if f.get("pinned")]
    if pinned:
        return pinned[0]
    live = [f for f in active if not is_superseded(state, f) and effective_type(state, f) in BINDING_TYPES]
    if not live:
        return None
    return max(live, key=lambda f: (f["date"], effective_type(state, f) == "DECISION", f["confidence"], f["id"]))


def conflict_live(state: dict, conflict: dict) -> list[dict]:
    facts = [state["facts"][i] for i in conflict["fact_ids"] if i in state["facts"]]
    return [f for f in facts if f["status"] == "active" and not is_superseded(state, f)]


def conflict_status(state: dict, conflict: dict) -> str:
    if conflict.get("resolution"):
        return "resolved"
    return "open" if len(conflict_live(state, conflict)) >= 2 else "resolved"


def conflict_view(state: dict, conflict: dict) -> dict:
    status = conflict_status(state, conflict)
    resolution = conflict.get("resolution")
    if status == "resolved" and not resolution:
        resolution = conflict.get("x", {}).get("auto_resolution")
    return {
        "id": conflict["id"],
        "topic": conflict["topic"],
        "status": status,
        "summary": conflict["summary"],
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


def next_fact_id(state: dict) -> str:
    numbers = [int(m.group(1)) for m in (re.match(r"M-(\d+)$", i) for i in state["facts"]) if m]
    return f"M-{max(numbers + [300]) + 1}"


# ---------------------------------------------------------------- audit


def audit(state: dict, action: str, actor: str, fact_id: str | None, reason: str | None, x: dict | None = None, bump: bool = True) -> dict:
    state["seq"]["audit"] += 1
    if bump:
        state["version"] += 1
    event = {
        "id": f"a-{state['seq']['audit']:04d}",
        "at": now(),
        "actor": actor,
        "action": action,
        "fact_id": fact_id,
        "reason": reason,
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
    if old_topic in state["topics"] and fact["id"] in state["topics"][old_topic]["fact_ids"]:
        state["topics"][old_topic]["fact_ids"].remove(fact["id"])
    target = state["topics"].setdefault(
        fact["topic"], {"id": fact["topic"], "label": fact["topic"].replace("-", " ").capitalize(), "fact_ids": [], "x": {}}
    )
    if fact["id"] not in target["fact_ids"]:
        target["fact_ids"].append(fact["id"])


def public_event(event: dict) -> dict:
    return {k: event[k] for k in ("id", "at", "actor", "action", "fact_id", "reason")}


# ---------------------------------------------------------------- store


class Store:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.state: dict | None = None

    def _load(self) -> None:
        path = settings.state_file()
        if path and path.exists():
            try:
                state = json.loads(path.read_text(encoding="utf-8"))
                if state.get("seed_hash") == seed_hash():
                    self.state = state
                    return
            except (OSError, ValueError):
                pass
        self.state = build_seed()
        audit(self.state, "ingest", "system", None, "Seeded demo memory from the ClearPath corpus.", bump=False)
        self.state["audit"][-1]["at"] = settings.SEED_AT
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
            self._save()

    def reset(self, actor: str = "system") -> dict:
        with self.lock:
            self.state = build_seed()
            audit(self.state, "ingest", "system", None, "Seeded demo memory from the ClearPath corpus.", bump=False)
            self.state["audit"][-1]["at"] = settings.SEED_AT
            audit(self.state, "reset", actor, None, "Demo state restored from the seed.", bump=False)
            self._save()
            return self.state


STORE = Store()
