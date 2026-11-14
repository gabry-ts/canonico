"""Answer selection: which fact is binding, what it replaced, what still conflicts."""

import copy

from app import store
from app.text import BM25, best_passage, tokenize

NO_ANSWER = "Memory holds nothing relevant to this question."
VERBS = {
    "retire": "retired",
    "restore": "restored",
    "patch": "corrected",
    "pin": "marked as binding",
    "unpin": "unpinned",
    "supersede": "linked as superseded",
    "unlink": "unlinked",
    "resolve": "resolved the conflict on",
    "create": "added",
    "approve": "retired",
    "undo": "undid a change to",
    "delete_document": "deleted the source of",
    "merge": "merged the topic of",
    "classify": "re-classified",
}


# ---------------------------------------------------------------- matching


def topic_index(state: dict) -> BM25:
    docs = {}
    for topic in state["topics"].values():
        extra = topic.get("x", {})
        tokens = tokenize(topic["label"]) * 3
        tokens += tokenize(" ".join(extra.get("keywords", []))) * 2
        tokens += tokenize(" ".join(extra.get("questions", [])))
        for fact in store.topic_facts(state, topic["id"]):
            tokens += tokenize(fact["value"]) + tokenize(fact["quote"])
        if tokens:
            docs[topic["id"]] = tokens
    return BM25(docs, k1=1.2, b=0.5)


def rank_topics(state: dict, question: str) -> list[tuple[str, float, float]]:
    """Topics ranked for a question as (topic_id, score, coverage of the question terms)."""
    index = topic_index(state)
    query = list(dict.fromkeys(tokenize(question)))
    if not query:
        return []
    top_idf = max(index.idf.values(), default=1.0)
    total = sum(index.idf.get(t, top_idf) for t in query)
    ranked = []
    for topic_id, score in index.rank(query):
        hit = sum(index.idf[t] for t in query if t in index.tf[topic_id])
        ranked.append((topic_id, score, hit / total if total else 0.0))
    return ranked


def match_topic(state: dict, question: str, min_coverage: float = 0.34) -> str | None:
    ranked = rank_topics(state, question)
    if not ranked:
        return None
    topic_id, _, coverage = ranked[0]
    return topic_id if coverage >= min_coverage else None


_DOCS_CACHE: dict = {}


def docs_index(state: dict) -> BM25:
    key = tuple(sorted((i, len(d["text"])) for i, d in state["documents"].items()))
    if _DOCS_CACHE.get("key") != key:
        _DOCS_CACHE["key"] = key
        _DOCS_CACHE["index"] = BM25({i: tokenize(d["title"] + "\n" + d["text"]) for i, d in state["documents"].items()})
    return _DOCS_CACHE["index"]


def plain_retrieval(state: dict, query: str, top_k: int = 10) -> list[dict]:
    """BM25 over whole documents: no facts, no supersedes, no conflicts."""
    tokens = tokenize(query)
    ranked = docs_index(state).rank(tokens)[:top_k]
    return [
        {
            "rank": n,
            "doc_id": doc_id,
            "score": round(score, 3),
            "quote": best_passage(state["documents"][doc_id]["text"], tokens),
        }
        for n, (doc_id, score) in enumerate(ranked, start=1)
    ]


ROLE_WEIGHT = {"binding": 1.0, "conflict": 0.9, "superseded": 0.7, "DECISION": 0.6, "CONSTRAINT": 0.6, "EVIDENCE": 0.5, "OPEN": 0.5, "HYPOTHESIS": 0.4, "SUPERSEDED": 0.3}
OFF_FOCUS_WEIGHT = 0.15


def facts_index(state: dict) -> BM25:
    docs = {}
    for fact in state["facts"].values():
        topic = state["topics"].get(fact["topic"], {})
        docs[fact["id"]] = tokenize(" ".join([fact["value"], fact["quote"], topic.get("label", "")]))
    return BM25(docs, k1=1.2, b=0.5)


def fact_roles(state: dict, topic_id: str, focus: set[str] | None) -> dict[str, float]:
    """Weight of every usable fact of a topic by its epistemic role for the question."""
    ts = topic_state(state, topic_id, focus)
    weights: dict[str, float] = {}
    for fact in ts["facts"]:
        if fact["status"] != "active":
            continue
        if fact is ts["binding"]:
            weight = ROLE_WEIGHT["binding"]
        elif fact in ts["conflicts"]:
            weight = ROLE_WEIGHT["conflict"]
        elif fact in ts["superseded"]:
            weight = ROLE_WEIGHT["superseded"]
        elif focus is not None and fact["id"] not in focus:
            weight = OFF_FOCUS_WEIGHT
        else:
            weight = ROLE_WEIGHT[store.effective_type(state, fact)] if not store.is_superseded(state, fact) else ROLE_WEIGHT["SUPERSEDED"]
        weights[fact["id"]] = weight
    return weights


def canonico_ranking(state: dict, query: str, top_k: int = 10, topics: int = 2, min_coverage: float = 0.3) -> list[str]:
    """Documents ranked by text match plus the epistemic role of the facts they are the source of.

    Start from the normalised BM25 score of each document. For the topics that match the question,
    add to each source document the weight of its best fact: binding first, then facts in an open
    conflict, then the superseded chain, then evidence, open questions and estimates.
    """
    tokens = tokenize(query)
    plain = docs_index(state).rank(tokens)
    top_plain = plain[0][1] if plain else 1.0
    scores = {doc_id: score / top_plain for doc_id, score in plain}
    matched = [t for t in rank_topics(state, query) if t[2] >= min_coverage][:topics]
    for topic_id, topic_score, _ in matched:
        share = topic_score / matched[0][1]
        gains: dict[str, float] = {}
        for fact_id, weight in fact_roles(state, topic_id, focus_facts(state, topic_id, tokens)).items():
            doc_id = state["facts"][fact_id].get("doc_id")
            if doc_id in state["documents"]:
                gains[doc_id] = max(gains.get(doc_id, 0.0), weight)
        for doc_id, gain in gains.items():
            scores[doc_id] = scores.get(doc_id, 0.0) + share * gain
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return [doc_id for doc_id, _ in ranked[:top_k]]


# ---------------------------------------------------------------- answer


def _x(fact: dict) -> dict:
    return fact.get("x", {})


def _label(fact: dict) -> str:
    return _x(fact).get("label") or f"fact {fact['id']}"


def _short(fact: dict) -> str:
    return _x(fact).get("short") or fact["value"].rstrip(".")


def _source(state: dict, fact: dict) -> str:
    if _x(fact).get("source_label"):
        return _x(fact)["source_label"]
    doc = state["documents"].get(fact.get("doc_id") or "")
    return f"“{doc['title']}”" if doc else "a manual entry"


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def focus_facts(state: dict, topic_id: str, tokens: list[str], threshold: float = 0.5) -> set[str] | None:
    """Facts of a broad topic that the question is actually about, closed over links and conflicts.

    Curated topics and small topics are always used whole (None).
    """
    topic = state["topics"][topic_id]
    facts = store.topic_facts(state, topic_id)
    if topic.get("x", {}).get("curated") or len(facts) <= 4:
        return None
    index = BM25({f["id"]: tokenize(f["value"] + " " + f["quote"]) for f in facts}, k1=1.2, b=0.5)
    ranked = index.rank(tokens)
    if not ranked:
        return None
    focus = {fact_id for fact_id, score in ranked if score >= threshold * ranked[0][1]}
    by_id = {f["id"]: f for f in facts}
    for fact_id in list(focus):
        current = by_id[fact_id]
        while current.get("superseded_by") in by_id and current["superseded_by"] not in focus:
            focus.add(current["superseded_by"])
            current = by_id[current["superseded_by"]]
    for record in state["conflicts"].values():
        if record["topic"] == topic_id and focus & set(record["fact_ids"]) and store.conflict_status(state, record) == "open":
            focus |= set(record["fact_ids"])
    return focus


def topic_state(state: dict, topic_id: str, focus: set[str] | None = None) -> dict:
    facts = store.topic_facts(state, topic_id)
    active = [f for f in facts if f["status"] == "active"]
    in_focus = [f for f in active if focus is None or f["id"] in focus]
    records = [c for c in state["conflicts"].values() if c["topic"] == topic_id]
    open_records = [c for c in records if store.conflict_status(state, c) == "open" and (focus is None or focus & set(c["fact_ids"]))]
    binding = store.binding_of(state, topic_id, focus)
    contested: list[dict] = []
    for record in open_records:
        for fact in store.conflict_live(state, record):
            if fact not in contested and fact is not binding:
                contested.append(fact)
    superseded, dropped = [], []
    if binding is not None:
        superseded = [f for f in active if f is not binding and store.successor(state, f) is binding and _chain_is_active(state, f, binding)]
        superseded.sort(key=lambda f: (f["date"], f["id"]), reverse=True)
        peers = {i for c in records if binding["id"] in c["fact_ids"] for i in c["fact_ids"]}
        dropped = [
            f
            for f in facts
            if f["status"] == "retired" and (f["id"] in peers or f.get("superseded_by") == binding["id"]) and f["type"] in store.BINDING_TYPES
        ]
    return {
        "facts": facts,
        "active": in_focus,
        "binding": binding,
        "superseded": superseded,
        "conflicts": contested,
        "dropped": dropped,
        "open_records": open_records,
    }


def _chain_is_active(state: dict, fact: dict, binding: dict) -> bool:
    """True when every hop from the fact to the binding fact is an active fact."""
    current = fact
    seen = set()
    while current is not binding and current["id"] not in seen:
        seen.add(current["id"])
        nxt = state["facts"].get(current.get("superseded_by") or "")
        if nxt is None or nxt["status"] != "active":
            return False
        current = nxt
    return current is binding


def answer_topic(state: dict, topic_id: str, focus: set[str] | None = None) -> dict:
    """Deterministic answer for a topic from the current memory."""
    topic = state["topics"][topic_id]
    ts = topic_state(state, topic_id, focus)
    binding, conflicts, superseded = ts["binding"], ts["conflicts"], ts["superseded"]

    if binding is not None:
        subject = topic.get("x", {}).get("subject")
        if subject and _x(binding).get("short"):
            text = f"{subject} is {_short(binding)}, set in {_source(state, binding)}."
        else:
            text = f"{binding['value'].rstrip('.')}, according to {_source(state, binding)} ({binding['date']})."
        if binding.get("pinned"):
            text += " A person marked it as binding."
        if len(conflicts) == 1:
            text += f" One conflict remains, {_label(conflicts[0])} still says {_short(conflicts[0])}."
        elif conflicts:
            parts = "; ".join(f"{_label(c)} says {_short(c)}" for c in conflicts)
            text += f" {len(conflicts)} conflicts remain: {parts}."
        for fact in ts["dropped"]:
            text += f" {_cap(_label(fact))} ({_short(fact)}) is no longer binding."
        cited = [binding] + superseded + conflicts
        return _result("binding", text, binding, superseded, conflicts, cited, state)

    if conflicts:
        record = ts["open_records"][0]
        extra = record.get("x", {})
        live_ids = {f["id"] for f in conflicts}
        if len(ts["open_records"]) == 1 and extra.get("answer") and live_ids == set(record["fact_ids"]):
            text = extra["answer"]
        else:
            values = ", ".join(_short(f) for f in conflicts)
            text = f"{len(conflicts)} sources give different values ({values}) and nothing in memory says which one is binding."
        cited = [state["facts"][i] for i in extra.get("explained_by", []) if i in state["facts"] and state["facts"][i]["status"] == "active"]
        return _result("contested", text, None, [], conflicts, cited or conflicts, state)

    live = [f for f in ts["active"] if not store.is_superseded(state, f)]
    for kind, lead in (("EVIDENCE", "No decision is recorded on this. The best supported fact"), ("HYPOTHESIS", "No decision is recorded on this, only an estimate")):
        pool = [f for f in live if store.effective_type(state, f) == kind]
        if pool:
            best = max(pool, key=lambda f: (f["confidence"], f["date"], f["id"]))
            text = f"{lead}: {best['value'].rstrip('.')}, from {_source(state, best)} ({best['date']})."
            return _result("binding", text, best, [], [], [best], state)

    opened = [f for f in live if f["type"] == "OPEN"]
    if opened:
        text = f"This is still an open question: {opened[0]['value'].rstrip('.')}. Nothing binding is recorded."
        return _result("no_answer", text, None, [], [], opened[:1], state)
    return _result("no_answer", NO_ANSWER, None, [], [], [], state)


def _result(status: str, text: str, binding, superseded, conflicts, cited, state: dict) -> dict:
    citations, seen = [], set()
    for fact in cited:
        key = (fact.get("doc_id") or "manual", fact["quote"])
        if key not in seen:
            seen.add(key)
            citations.append({"doc_id": key[0], "quote": key[1]})
    return {
        "status": status,
        "answer": text,
        "binding": store.view(state, binding) if binding else None,
        "superseded": [store.view(state, f) for f in superseded],
        "conflicts": [store.view(state, f) for f in conflicts],
        "citations": citations,
    }


def _signature(response: dict) -> tuple:
    binding = response.get("binding")
    return (
        response["status"],
        binding["id"] if binding else None,
        binding["value"] if binding else None,
        tuple(f["id"] for f in response["superseded"]),
        tuple(f["id"] for f in response["conflicts"]),
        response["answer"],
    )


def _describe(state: dict, events: list[dict]) -> str | None:
    """Plain sentence for the changes that happened between two answers."""
    parts, seen = [], set()
    for event in events:
        fact = state["facts"].get(event.get("fact_id") or "")
        verb = VERBS.get(event["action"])
        if verb is None:
            continue
        target = _label(fact) if fact else "the memory"
        phrase = f"{verb} {target}"
        if phrase not in seen:
            seen.add(phrase)
            parts.append(phrase)
    if not parts:
        return None
    if len(parts) > 1:
        return "you " + ", ".join(parts[:-1]) + " and " + parts[-1]
    return "you " + parts[0]


def _net_events(events: list[dict]) -> list[dict]:
    """Drop retire and restore pairs on the same fact that cancel each other out."""
    out: list[dict] = []
    for event in events:
        last = next((e for e in reversed(out) if e.get("fact_id") == event.get("fact_id")), None)
        if last and {last["action"], event["action"]} == {"retire", "restore"}:
            out.remove(last)
            continue
        out.append(event)
    return out


def explain_change(state: dict, since_version: int, topic_id: str | None) -> str:
    """Why an answer on a topic differs from the one given at an earlier memory version."""
    fact_ids = set(state["topics"][topic_id]["fact_ids"]) if topic_id in state["topics"] else set()
    events = [e for e in state["audit"] if e["x"].get("version", 0) > since_version and (e.get("fact_id") in fact_ids or (topic_id and e["x"].get("topic") == topic_id))]
    return _describe(state, _net_events(events)) or "memory changed since the previous answer"


def ask(state: dict, question: str, topic_id: str | None = None, include_plain: bool = False) -> tuple[dict, dict]:
    """Answer a question, store the answer and return (response, record)."""
    matched = topic_id or match_topic(state, question)
    focus = None
    if matched is None:
        response = _result("no_answer", NO_ANSWER, None, [], [], [], state)
    else:
        focus = focus_facts(state, matched, tokenize(question))
        response = answer_topic(state, matched, focus)
    response = {"question": question, **response, "changed_because": None}
    key = " ".join(tokenize(question)) if matched is None else matched + ("|" + ",".join(sorted(focus)) if focus else "")

    previous = next((a for a in reversed(state["answers"]) if a["x"]["key"] == key), None)
    if previous is not None:
        if previous["memory_version"] == state["version"]:
            response["changed_because"] = previous["response"].get("changed_because")
        elif _signature(previous["response"]) != _signature(response):
            response["changed_because"] = explain_change(state, previous["memory_version"], matched)

    if include_plain:
        ranked = plain_retrieval(state, question, top_k=1)
        if ranked:
            response["plain_retrieval"] = {"doc_id": ranked[0]["doc_id"], "quote": ranked[0]["quote"], "rank": 1}

    state["seq"]["answer"] += 1
    used = ([response["binding"]] if response["binding"] else []) + response["superseded"] + response["conflicts"]
    record = {
        "id": f"ans-{state['seq']['answer']:04d}",
        "asked_at": store.now(),
        "memory_version": state["version"],
        "request": {"question": question, **({"topic": topic_id} if topic_id else {}), "include_plain_retrieval": include_plain},
        "response": copy.deepcopy(response),
        "fact_snapshot": copy.deepcopy(used),
        "x": {"key": key, "topic": matched},
    }
    state["answers"].append(record)
    return response, record
