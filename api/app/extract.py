"""Fact extraction: documents to typed facts, facts to topics, topics to supersedes links and conflicts."""

import re
from concurrent.futures import ThreadPoolExecutor

from app import llm
from app.store import slugify
from app.text import BM25, tokenize

FACT_TYPES = ["DECISION", "CONSTRAINT", "EVIDENCE", "HYPOTHESIS", "OPEN"]

EXTRACT_SYSTEM = """You build the canonical memory of a company from its documents.
Read one document and extract the facts a colleague would later need to look up, with their epistemic type.

Types:
- DECISION: a choice, commitment, approved target, recommendation or agreed plan that people are expected to follow.
- CONSTRAINT: a requirement, contractual clause, limit, deadline or condition that restricts what can be done.
- EVIDENCE: something observed, counted or measured, or a finding backed by direct observation or data.
- HYPOTHESIS: an estimate, assumption, suspicion, self-reported or unverified figure, an early impression.
- OPEN: a question explicitly left unanswered, data that is missing, a decision still pending.

Rules:
- Prefer facts that can change over time or be contradicted elsewhere: targets, numbers, counts, durations, scope, owners, dates, estimates, caveats about data quality, things that could not be measured.
- One fact is one claim. Write `value` as a short self-contained sentence that names its subject and includes the number or choice.
- `short` is the bare value only, a few words (for example "3-4 weeks", "9 team leaders", "excluded from scope").
- `topic` is a short noun phrase for the question the fact answers (for example "audit queue target", "Milan office scope"). Reuse the same phrase for facts on the same question.
- `quote` must be copied character by character from the document, one contiguous span of at most 250 characters that supports the fact. Never paraphrase, never join separate spans, keep the original punctuation.
- `date` is the day the fact was stated, format YYYY-MM-DD. Use the document date unless the text gives another one for that statement.
- `confidence` between 0 and 1: how clearly the document states the fact.
- When two people or two passages in the same document give different values for the same thing, extract each as its own fact.
- A sentence that only recalls a value that no longer applies ("4 weeks was the old plan", "we used to", "no longer") is EVIDENCE about the past, never a DECISION or CONSTRAINT.
- Extract between 4 and 14 facts, the most important first. Skip greetings, logistics and boilerplate."""

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "value": {"type": "string"},
                    "short": {"type": "string"},
                    "type": {"type": "string", "enum": FACT_TYPES},
                    "quote": {"type": "string"},
                    "date": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["topic", "value", "short", "type", "quote", "date", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["facts"],
    "additionalProperties": False,
}

GROUP_SYSTEM = """You organise extracted facts into topics for a company memory.
A topic is one specific question whose answer can change over time or be contradicted, for example "audit queue target", "Milan office scope", "number of team leaders". Facts in a topic must answer that same question, so that the latest decision, the earlier versions and any disagreement sit together.

Rules:
- Every fact id goes into exactly one topic.
- Keep topics specific. Do not create catch-all topics. A current-state measurement and a future target for the same process are two topics.
- Some topics already exist and are listed first. Assign a fact to an existing topic only when it answers exactly that question, and reuse its id.
- `id` is a lowercase slug with hyphens. `label` is a short title. `question` is the question the topic answers. `keywords` are 5 to 10 words or short phrases people would use when asking about it, including names and synonyms."""

GROUP_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "question": {"type": "string"},
                    "keywords": {"type": "array", "items": {"type": "string"}},
                    "fact_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["id", "label", "question", "keywords", "fact_ids"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["topics"],
    "additionalProperties": False,
}

LINK_SYSTEM = """You maintain the canonical memory of a company. You receive the facts recorded on one topic, oldest first.
Decide which facts were replaced and which facts contradict each other.

SUPERSEDES links:
- A newer fact supersedes an older one when it gives the updated answer to the same question: a revised target, a changed scope, a corrected number, a final version replacing a draft or a preview, or the same value restated later in a more authoritative document.
- Use dates and explicit language (final, revised, instead, changed to, agreed, confirmed, updated).
- The newer fact must not be older by date. Each older fact has at most one direct successor. Do not link facts that answer different questions, and do not link a piece of supporting evidence to the decision it supports.

Conflicts:
- A conflict is a set of facts that give incompatible answers to the same question while nothing says which one prevails: people who report different numbers, documents that disagree, a requirement that a later decision silently departs from.
- Facts already linked by SUPERSEDES are not in conflict with each other.
- `summary` is one plain sentence naming the competing values.

Return empty lists when nothing was replaced and nothing conflicts."""

LINK_SCHEMA = {
    "type": "object",
    "properties": {
        "links": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"older_id": {"type": "string"}, "newer_id": {"type": "string"}, "reason": {"type": "string"}},
                "required": ["older_id", "newer_id", "reason"],
                "additionalProperties": False,
            },
        },
        "conflicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"fact_ids": {"type": "array", "items": {"type": "string"}}, "summary": {"type": "string"}},
                "required": ["fact_ids", "summary"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["links", "conflicts"],
    "additionalProperties": False,
}

RETYPE_SYSTEM = EXTRACT_SYSTEM.split("Rules:")[0] + "For each fact decide its type again from its statement and source quote, and give your confidence between 0 and 1."
RETYPE_SCHEMA = {
    "type": "object",
    "properties": {
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "type": {"type": "string", "enum": FACT_TYPES}, "confidence": {"type": "number"}},
                "required": ["id", "type", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["facts"],
    "additionalProperties": False,
}

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SPACE = re.compile(r"\s+")


_VARIANTS = ("'’", "-–—", '"“”')


def _flexible(part: str) -> str:
    out = []
    for char in part:
        group = next((g for g in _VARIANTS if char in g), None)
        out.append(f"[{group}]" if group else re.escape(char))
    return "".join(out)


def locate_quote(text: str, quote: str) -> str | None:
    """Return the exact span of the document that matches the quote, or None when it is not there.

    Only whitespace and the typographic variants of apostrophes, dashes and quotes may differ.
    """
    quote = quote.strip().strip('"“”').strip()
    if len(quote) < 8:
        return None
    if quote in text:
        return quote
    match = re.search(r"\s+".join(_flexible(part) for part in quote.split()), text)
    return match.group(0) if match else None


def extract_document(doc: dict, model: str, meter: llm.Meter, **limits) -> list[dict]:
    """Extract typed facts from one document. Facts whose quote is not verbatim are dropped.

    `limits` (timeout, retries) bound the call when a request waits for it."""
    user = f"Document id: {doc['id']}\nTitle: {doc['title']}\nDocument date: {doc['date']}\n\n<document>\n{doc['text']}\n</document>"
    data = llm.complete_json(model, EXTRACT_SYSTEM, user, EXTRACT_SCHEMA, meter, name="facts", max_tokens=8000, **limits)
    facts, seen = [], set()
    for raw in data.get("facts", []):
        quote = locate_quote(doc["text"], str(raw.get("quote", "")))
        value = str(raw.get("value", "")).strip()
        if not quote or not value or raw.get("type") not in FACT_TYPES or quote in seen:
            continue
        seen.add(quote)
        date = raw.get("date") if _DATE.match(str(raw.get("date", ""))) else doc["date"]
        try:
            confidence = min(1.0, max(0.0, float(raw.get("confidence", 0.7))))
        except (TypeError, ValueError):
            confidence = 0.7
        facts.append(
            {
                "topic_hint": str(raw.get("topic", "")).strip() or doc["title"],
                "value": value,
                "short": str(raw.get("short", "")).strip(),
                "type": raw["type"],
                "doc_id": doc["id"],
                "quote": quote,
                "date": date,
                "confidence": round(confidence, 2),
            }
        )
    return facts


def group_topics(facts: list[dict], existing: list[dict], model: str, meter: llm.Meter) -> list[dict]:
    """Assign every fact (by its temporary id) to a topic."""
    lines = [f"{f['tid']} | {f['date']} | {f['type']} | {f['topic_hint']} | {f['value']}" for f in facts]
    known = "\n".join(f"- {t['id']}: {t['description']}" for t in existing) or "(none)"
    user = f"Existing topics:\n{known}\n\nFacts (id | date | type | topic hint | statement):\n" + "\n".join(lines)
    data = llm.complete_json(model, GROUP_SYSTEM, user, GROUP_SCHEMA, meter, name="topics", max_tokens=24000)
    valid = {f["tid"] for f in facts}
    assigned: set[str] = set()
    topics: dict[str, dict] = {}
    for raw in data.get("topics", []):
        topic_id = slugify(str(raw.get("id", "")))
        ids = [i for i in raw.get("fact_ids", []) if i in valid and i not in assigned]
        if not ids:
            continue
        assigned.update(ids)
        topic = topics.setdefault(
            topic_id,
            {"id": topic_id, "label": str(raw.get("label") or topic_id).strip(), "question": str(raw.get("question", "")).strip(), "keywords": [str(k) for k in raw.get("keywords", [])][:12], "fact_ids": []},
        )
        topic["fact_ids"].extend(ids)
    leftovers = [f for f in facts if f["tid"] not in assigned]
    if leftovers and topics:
        index = BM25({t["id"]: tokenize(" ".join([t["label"], t["question"], *t["keywords"]])) for t in topics.values()})
        for fact in leftovers:
            ranked = index.rank(tokenize(fact["topic_hint"] + " " + fact["value"]))
            target = ranked[0][0] if ranked else slugify(fact["topic_hint"])
            topics.setdefault(target, {"id": target, "label": fact["topic_hint"].capitalize(), "question": "", "keywords": [], "fact_ids": []})["fact_ids"].append(fact["tid"])
    return list(topics.values())


def link_topic(topic: dict, facts: list[dict], model: str, meter: llm.Meter, **limits) -> dict:
    """Supersedes links and conflicts among the facts of one topic."""
    ordered = sorted(facts, key=lambda f: (f["date"], f["tid"]))
    lines = [f"{f['tid']} | {f['date']} | {f['doc_id']} | {f['type']} | {f['value']} | quote: {f['quote']}" for f in ordered]
    user = f"Topic: {topic['label']}\nQuestion: {topic.get('question', '')}\n\nFacts (id | date | document | type | statement | quote):\n" + "\n".join(lines)
    data = llm.complete_json(model, LINK_SYSTEM, user, LINK_SCHEMA, meter, name="links", max_tokens=6000, **limits)
    by_id = {f["tid"]: f for f in ordered}
    links, successor = [], {}
    for raw in data.get("links", []):
        older, newer = by_id.get(raw.get("older_id")), by_id.get(raw.get("newer_id"))
        if not older or not newer or older is newer or older["tid"] in successor or newer["date"] < older["date"]:
            continue
        probe, cycle = newer["tid"], False
        while probe in successor:
            probe = successor[probe]
            if probe == older["tid"]:
                cycle = True
                break
        if cycle:
            continue
        successor[older["tid"]] = newer["tid"]
        links.append({"older": older["tid"], "newer": newer["tid"], "reason": str(raw.get("reason", ""))})
    conflicts = []
    for raw in data.get("conflicts", []):
        ids = [i for i in dict.fromkeys(raw.get("fact_ids", [])) if i in by_id and i not in successor]
        if len(ids) >= 2:
            conflicts.append({"fact_ids": ids, "summary": str(raw.get("summary", "")).strip()})
    return {"links": links, "conflicts": conflicts}


def retype_facts(facts: list[dict], model: str, meter: llm.Meter) -> dict[str, dict]:
    lines = [f"{f['id']} | {f['value']} | quote: {f['quote']}" for f in facts]
    data = llm.complete_json(model, RETYPE_SYSTEM, "Facts (id | statement | quote):\n" + "\n".join(lines), RETYPE_SCHEMA, meter, name="types", max_tokens=4000)
    known = {f["id"] for f in facts}
    return {r["id"]: r for r in data.get("facts", []) if r.get("id") in known and r.get("type") in FACT_TYPES}


def run_corpus(documents: list[dict], existing_topics: list[dict], models: dict, meter: llm.Meter, on_progress=None, workers: int = 6) -> dict:
    """Full pipeline over a corpus. Returns facts with temporary ids, topics, links and conflicts."""
    facts: list[dict] = []

    def one(doc: dict) -> list[dict]:
        found = extract_document(doc, models["extraction"], meter)
        if on_progress:
            on_progress(doc["id"], len(found))
        return found

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for found in pool.map(one, documents):
            facts.extend(found)
    facts.sort(key=lambda f: (f["doc_id"], f["date"]))
    for n, fact in enumerate(facts, start=1):
        fact["tid"] = f"F{n:03d}"
    topics = group_topics(facts, existing_topics, models["classification"], meter)
    by_id = {f["tid"]: f for f in facts}
    reserved = {t["id"] for t in existing_topics}
    links, conflicts = [], []

    def link(topic: dict) -> dict:
        members = [by_id[i] for i in topic["fact_ids"]]
        if topic["id"] in reserved or len(members) < 2:
            return {"links": [], "conflicts": []}
        return link_topic(topic, members, models["classification"], meter)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for topic, result in zip(topics, pool.map(link, topics)):
            links.extend(result["links"])
            conflicts.extend({"topic": topic["id"], **c} for c in result["conflicts"])
    return {"facts": facts, "topics": topics, "links": links, "conflicts": conflicts}
