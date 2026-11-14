"""Answer selection: which fact is binding, what it replaced, what still conflicts."""

import copy

from app import i18n, store, wording
from app.text import BM25, best_passage, tokenize

CHANGE_CODES = {
    "retire": "fact_retired",
    "restore": "fact_restored",
    "patch": "fact_corrected",
    "pin": "fact_pinned",
    "unpin": "fact_unpinned",
    "supersede": "fact_linked",
    "unlink": "fact_unlinked",
    "resolve": "conflict_resolved",
    "create": "fact_added",
    "approve": "fact_retired",
    "undo": "change_undone",
    "delete_document": "document_deleted",
    "merge": "topic_merged",
    "classify": "fact_reclassified",
    "ingest": "fact_added",
    "close": "question_closed",
}


# ---------------------------------------------------------------- matching


def topic_index(state: dict, project_id: str | None = None) -> BM25:
    docs = {}
    for topic in state["topics"].values():
        if not store.in_scope(topic.get("project_id"), project_id):
            continue
        extra = topic.get("x", {})
        tokens = tokenize(topic["label"]) * 3
        tokens += tokenize(" ".join(extra.get("keywords", []))) * 2
        tokens += tokenize(" ".join(extra.get("questions", [])))
        for fact in store.topic_facts(state, topic["id"]):
            tokens += tokenize(fact["value"]) + tokenize(fact["quote"])
        if tokens:
            docs[topic["id"]] = tokens
    return BM25(docs, k1=1.2, b=0.5)


def rank_topics(state: dict, question: str, project_id: str | None = None) -> list[tuple[str, float, float]]:
    """Topics ranked for a question as (topic_id, score, coverage of the question terms)."""
    index = topic_index(state, project_id)
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


def alias_topic(state: dict, question: str, project_id: str | None = None) -> str | None:
    """Topic that lists this question among its known phrasings. Curated topics come first."""
    from app import llm

    wanted = frozenset(tokenize(question))
    if not wanted or llm.forced():
        return None
    topics = [t for t in state["topics"].values() if store.in_scope(t.get("project_id"), project_id)]
    topics.sort(key=lambda t: (not t.get("x", {}).get("curated"), t.get("project_id") != store.DEFAULT_PROJECT))
    for topic in topics:
        if any(frozenset(tokenize(q)) == wanted for q in topic.get("x", {}).get("questions", [])):
            return topic["id"]
    return None


ROUTE_SYSTEM = """You route a question to the topics of a company memory.
Each topic is one question the memory can answer. Pick the topics whose facts answer the user's question: at most two, the best one first.
The question can be in any language, have typos or name the client. Match it by meaning.
When a question asks how long something takes or what a value is, and says nothing about the current, measured or observed situation, put the topic of the agreed target or decision first and the topic of the measured current state second.
Return an empty list when no topic fits. Use only ids from the list."""
ROUTE_SCHEMA = {"type": "object", "properties": {"topics": {"type": "array", "items": {"type": "string"}}}, "required": ["topics"], "additionalProperties": False}


def topic_lines(state: dict, project_id: str | None = None) -> dict[str, str]:
    """One line per topic in scope, as shown to the model router."""
    lines = {}
    for topic in state["topics"].values():
        if store.in_scope(topic.get("project_id"), project_id):
            questions = topic.get("x", {}).get("questions") or [""]
            lines[topic["id"]] = f"{topic['id']} | {topic['label']} | {questions[0]}"
    return lines


def model_route(question: str, lines: dict[str, str], model: str, meter) -> list[str]:
    """Topics a small model picks for a question, best first. One cached call, a few seconds at most."""
    from app import llm

    user = "Topics (id | label | question):\n" + "\n".join(lines.values()) + f"\n\nQuestion: {question}"
    data = llm.complete_json(model, ROUTE_SYSTEM, user, ROUTE_SCHEMA, meter, name="route", max_tokens=2000, timeout=8.0, retries=1)
    return [t for t in dict.fromkeys(data.get("topics", [])) if t in lines][:2]


def moved_topic(state: dict, topic_id: str | None) -> str | None:
    """Follow a topic whose facts were all replaced by facts of one other topic.

    A library standard feeds the topic it governs: once a new version is filed there,
    questions about the standard are answered from that topic.
    """
    if topic_id is None:
        return None
    facts = [f for f in store.topic_facts(state, topic_id) if f["status"] == "active"]
    if not facts or any(not store.is_superseded(state, f) for f in facts):
        return topic_id
    targets = {end["topic"] for end in (store.final_successor(state, f) for f in facts) if end is not None}
    targets.discard(topic_id)
    return targets.pop() if len(targets) == 1 else topic_id


def match_topic(state: dict, question: str, min_coverage: float = 0.34, project_id: str | None = None) -> str | None:
    """Keyword fallback. A question of several terms needs at least two of them on the topic: a single shared
    word ("France" in "What is the capital of France?") is a coincidence, not a match, and gets no answer."""
    alias = alias_topic(state, question, project_id)
    if alias is not None:
        return alias
    ranked = rank_topics(state, question, project_id)
    if not ranked:
        return None
    topic_id, _, coverage = ranked[0]
    if coverage < min_coverage:
        return None
    terms = list(dict.fromkeys(tokenize(question)))
    index = topic_index(state, project_id)
    hits = sum(1 for t in terms if t in index.tf[topic_id])
    return topic_id if hits >= 2 or len(terms) == 1 else None


_DOCS_CACHE: dict = {}


def docs_index(state: dict, project_id: str | None = None) -> BM25:
    docs = {i: d for i, d in state["documents"].items() if store.in_scope(d.get("project_id"), project_id)}
    key = (project_id, tuple(sorted((i, len(d["text"])) for i, d in docs.items())))
    if _DOCS_CACHE.get(project_id, (None, None))[0] != key:
        _DOCS_CACHE[project_id] = (key, BM25({i: tokenize(d["title"] + "\n" + d["text"]) for i, d in docs.items()}))
    return _DOCS_CACHE[project_id][1]


def plain_retrieval(state: dict, query: str, top_k: int = 10, project_id: str | None = None) -> list[dict]:
    """BM25 over whole documents: no facts, no supersedes, no conflicts."""
    tokens = tokenize(query)
    ranked = docs_index(state, project_id).rank(tokens)[:top_k]
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


def facts_index(state: dict, project_id: str | None = None) -> BM25:
    docs = {}
    for fact in state["facts"].values():
        if not store.in_scope(fact.get("project_id"), project_id):
            continue
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
        elif fact in ts["stale"]:
            weight = ROLE_WEIGHT["superseded"]
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


def canonico_ranking(state: dict, query: str, top_k: int = 10, topics: int = 2, min_coverage: float = 0.3, project_id: str | None = None, route: list[str] | None = None) -> list[str]:
    """Documents ranked by text match plus the epistemic role of the facts they are the source of.

    Start from the normalised BM25 score of each document. For the topics that match the question,
    add to each source document the weight of its best fact: binding first, then facts in an open
    conflict, then the superseded chain, then evidence, open questions and estimates.
    The topics come from the keyword matcher, or from `route` when a model picked them
    (first topic at full weight, second at 0.6).
    """
    tokens = tokenize(query)
    plain = docs_index(state, project_id).rank(tokens)
    top_plain = plain[0][1] if plain else 1.0
    scores = {doc_id: score / top_plain for doc_id, score in plain}
    if route is not None:
        matched = [(topic_id, 1.0 if n == 0 else 0.6, 1.0) for n, topic_id in enumerate(route[:topics]) if topic_id in state["topics"]]
    else:
        matched = [t for t in rank_topics(state, query, project_id) if t[2] >= min_coverage][:topics]
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


_x = wording.extra
_label = wording.label
_short = wording.short
_source = wording.source
_cap = wording.cap
_target = wording.target


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
    confirming: list[dict] = []
    if binding is not None:
        confirming = [
            f
            for f in active
            if f is not binding and not store.is_superseded(state, f) and store.effective_type(state, f) in store.BINDING_TYPES and store.value_key(f) == store.value_key(binding)
        ]
    for record in open_records:
        for fact in store.conflict_live(state, record):
            if fact not in contested and fact not in confirming and fact is not binding:
                contested.append(fact)
    superseded, dropped, stale = [], [], []
    if binding is not None:
        ends = [binding] + confirming
        replaced = [f for f in state["facts"].values() if f["status"] == "active" and f not in ends and any(store.final_successor(state, f) is end for end in ends)]
        stale = [f for f in replaced if store.stale_active(state, f)]
        superseded = sorted((f for f in replaced if f not in stale), key=lambda f: (f["date"], f["id"]))
        for fact in stale:
            if fact not in contested:
                contested.append(fact)
        peers = {i for c in records if binding["id"] in c["fact_ids"] for i in c["fact_ids"]}
        dropped = [
            f
            for f in facts
            if f["status"] == "retired" and (f["id"] in peers or f.get("superseded_by") in {e["id"] for e in ends}) and f["type"] in store.BINDING_TYPES
        ]
    return {
        "facts": facts,
        "active": in_focus,
        "binding": binding,
        "superseded": superseded,
        "conflicts": contested,
        "stale": stale,
        "confirming": confirming,
        "dropped": dropped,
        "open_records": open_records,
    }


def answer_topic(state: dict, topic_id: str, focus: set[str] | None = None) -> dict:
    """Deterministic answer for a topic from the current memory, worded in the locale of the request."""
    topic = state["topics"][topic_id]
    ts = topic_state(state, topic_id, focus)
    binding, conflicts, superseded = ts["binding"], ts["conflicts"], ts["superseded"]
    italian = i18n.current() == "it"
    sig = [[f["id"] for f in ts["confirming"]], [f["id"] for f in ts["dropped"]], bool(binding and binding.get("pinned"))]

    if binding is not None:
        extra = topic.get("x", {})
        local = (extra.get("it") or {}) if italian else {}
        stale = ts["stale"]
        disputed = [f for f in conflicts if f not in stale]
        where = {"source": _source(state, binding), "source_in": wording.source_in(state, binding) if italian else ""}
        if extra.get("what") and _x(binding).get("short"):
            spoken = wording.italian(binding).get("spoken") if italian else _x(binding).get("spoken")
            text = i18n.t("answer.figure", lead=spoken or _cap(_short(binding)), what=local.get("what") or extra["what"], date=i18n.long_date(binding["date"]), **where)
            if superseded:
                text += i18n.t("answer.replaced_one") if len(superseded) == 1 else i18n.t("answer.replaced_many", n=len(superseded))
        elif extra.get("subject") and _x(binding).get("short"):
            text = i18n.t("answer.subject", subject=local.get("subject") or extra["subject"], short=_short(binding), **where)
        else:
            text = i18n.t("answer.generic", value=binding["value"].rstrip("."), source=where["source"], date=binding["date"])
        if binding.get("pinned"):
            text += i18n.t("answer.pinned")
        answered = store.closed_answer(state, topic_id)
        if answered is not None and answered[0] is binding and not binding.get("pinned"):
            question = answered[1]
            text += i18n.t("answer.closed_question", question=(question.get("question_it") if italian else None) or question["question"])
        if len(stale) == 1:
            text += i18n.t("answer.stale_one", target=_target(stale[0]))
        elif stale:
            text += i18n.t("answer.stale_many", n=len(stale), targets=", ".join(_target(f) for f in stale))
        if len(disputed) == 1:
            text += i18n.t("answer.conflict_one", label=_label(disputed[0]), short=_short(disputed[0]))
        elif disputed:
            parts = "; ".join(i18n.t("answer.conflict_part", label=_label(c), short=_short(c)) for c in disputed)
            text += i18n.t("answer.conflict_many", n=len(disputed), parts=parts)
        for fact in ts["dropped"]:
            if _x(fact).get("source_short"):
                key = "answer.retired_by" if fact.get("retired_by") else "answer.retired"
                text += i18n.t(key, target=_cap(_target(fact)), actor=fact.get("retired_by") or "")
            else:
                text += i18n.t("answer.dropped", label=_cap(_label(fact)), short=_short(fact))
        for fact in ts["confirming"]:
            text += i18n.t("answer.confirms", label=_cap(_label(fact)))
        cited = [binding] + superseded + conflicts + ts["confirming"]
        return _result("binding", text, binding, superseded, conflicts, cited, state, sig)

    if conflicts:
        record = ts["open_records"][0]
        extra = record.get("x", {})
        live_ids = {f["id"] for f in conflicts}
        if len(ts["open_records"]) == 1 and extra.get("answer") and live_ids == set(record["fact_ids"]):
            text = (extra.get("answer_it") if italian else None) or extra["answer"]
        else:
            text = i18n.t("answer.contested", n=len(conflicts), values=", ".join(_short(f) for f in conflicts))
        cited = [state["facts"][i] for i in extra.get("explained_by", []) if i in state["facts"] and state["facts"][i]["status"] == "active"]
        return _result("contested", text, None, [], conflicts, cited or conflicts, state, sig)

    live = [f for f in ts["active"] if not store.is_superseded(state, f)]
    for kind, key in (("EVIDENCE", "answer.evidence"), ("HYPOTHESIS", "answer.hypothesis")):
        pool = [f for f in live if store.effective_type(state, f) == kind]
        if pool:
            # Nothing was decided: the answer reports the best evidence or estimate, cites it, and is not binding.
            best = max(pool, key=lambda f: (f["confidence"], f["date"], f["id"]))
            text = i18n.t(key, value=best["value"].rstrip("."), source=_source(state, best), date=best["date"])
            return {**_result("no_answer", text, None, [], [], [best], state, sig), "_basis": store.view(state, best)}

    opened = [f for f in live if f["type"] == "OPEN"]
    if opened:
        text = i18n.t("answer.open", value=opened[0]["value"].rstrip("."))
        return _result("no_answer", text, None, [], [], opened[:1], state, sig)
    return _result("no_answer", i18n.t("answer.none"), None, [], [], [], state, sig)


def _result(status: str, text: str, binding, superseded, conflicts, cited, state: dict, sig: list | None = None) -> dict:
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
        "_sig": sig or [],
    }


def _signature(response: dict) -> list:
    """What an answer says, independent of the language it is worded in."""
    binding = response.get("binding")
    return [
        response["status"],
        binding["id"] if binding else None,
        binding["value"] if binding else None,
        [f["id"] for f in response["superseded"]],
        [f["id"] for f in response["conflicts"]],
        response.get("_sig") or [],
    ]


def describe_changes(state: dict, events: list[dict]) -> list[dict]:
    """The changes behind a list of audit events, each as a code with parameters and a sentence.

    Changes made by a person name that person: "Giulia retired 4 weeks (final presentation)".
    Changes that came in from a source (an email, a new document version) name the source.
    """
    by_actor: dict[str, list[dict]] = {}
    arrived: list[dict] = []
    replaced = {e["x"]["cause"] for e in events if e["x"].get("cause") and e["action"] == "supersede"}
    for event in events:
        fact = state["facts"].get(event.get("fact_id") or "")
        target = _target(fact) if fact else i18n.t("label.memory")
        params = {"actor": event.get("actor"), "fact_id": event.get("fact_id"), "value": (_x(fact).get("short") or fact["value"]) if fact else None, "source": _x(fact).get("source_short") if fact else None}
        cause = event["x"].get("cause")
        if cause:
            src = event["x"].get("src")
            params = {**params, "source_kind": (src or {}).get("kind"), "source": cause}
            subject = i18n.cause(src, cause)
            old = state["facts"].get((event["x"].get("replaced") or [None])[0] or "")
            if event["action"] == "supersede":
                change = {"code": "source_replaced", "params": {**params, "replaced_fact_id": old["id"] if old else None, "replaced_value": (_x(old).get("short") or old["value"]) if old else None}, "text": i18n.t("change.replaced", cause=subject, target=_target(old) if old else target)}
            elif cause not in replaced:
                change = {"code": "source_stated", "params": params, "text": i18n.t("change.stated", cause=subject, short=_short(fact) if fact else target)}
            else:
                continue
            if change["text"] not in [c["text"] for c in arrived]:
                arrived.append(change)
            continue
        if event["action"] not in CHANGE_CODES:
            continue
        phrase = f"{i18n.t('verb.' + event['action'])} {target}"
        changes = by_actor.setdefault(event.get("actor") or "someone", [])
        if phrase not in [c["phrase"] for c in changes]:
            changes.append({"code": CHANGE_CODES[event["action"]], "params": params, "phrase": phrase})
    out = []
    for actor, changes in by_actor.items():
        text = i18n.t("change.person", actor=actor, phrases=i18n.join([c["phrase"] for c in changes]))
        out.append({"code": changes[0]["code"], "params": {**changes[0]["params"], "count": len(changes)}, "text": text})
    return out + arrived


def _describe(state: dict, events: list[dict]) -> str | None:
    """Plain sentence for the changes that happened between two answers."""
    changes = describe_changes(state, events)
    return i18n.join([c["text"] for c in changes]) if changes else None


def event_summary(state: dict, event: dict) -> dict:
    """One audit event in plain words, with a code and parameters for clients that compose their own text."""
    changes = describe_changes(state, [event]) if event.get("fact_id") in state["facts"] else []
    if changes:
        return {"summary": changes[0]["text"], "summary_code": changes[0]["code"], "summary_params": changes[0]["params"]}
    info = event["x"].get("info") or {}
    params = {"actor": event.get("actor"), "fact_id": event.get("fact_id"), **info}
    if info.get("kind") == "email":
        key = "audit.email" if info.get("project") else "audit.email_unrouted"
        return {"summary": i18n.t(key, subject=info["subject"], sender=info["sender"], project=info.get("project"), rule=info.get("rule")), "summary_code": "email_received", "summary_params": params}
    if info.get("kind") == "item":
        return {"summary": i18n.t("audit.item", type=info["type"].capitalize(), title=info["title"], project=info["project"]), "summary_code": "item_received", "summary_params": params}
    if info.get("kind") == "version":
        return {"summary": i18n.t("audit.version", label=info["label"], title=info["title"]), "summary_code": "version_uploaded", "summary_params": params}
    if event["action"] == "reset":
        return {"summary": i18n.t("audit.reset"), "summary_code": "demo_reset", "summary_params": params}
    if event["action"] == "ingest" and event.get("at") == store.settings.SEED_AT:
        return {"summary": i18n.t("audit.seed"), "summary_code": "memory_seeded", "summary_params": params}
    return {"summary": event.get("reason") or event["action"], "summary_code": CHANGE_CODES.get(event["action"], event["action"]), "summary_params": params}


def _net_events(events: list[dict]) -> list[dict]:
    """Drop retire (or approved retirement) and restore pairs on the same fact that cancel each other out."""
    out: list[dict] = []
    for event in events:
        last = next((e for e in reversed(out) if e.get("fact_id") == event.get("fact_id")), None)
        if last and {last["action"], event["action"]} in ({"retire", "restore"}, {"approve", "restore"}):
            out.remove(last)
            continue
        out.append(event)
    return out


def explain_change(state: dict, since_version: int, topic_id: str | None) -> dict:
    """Why an answer on a topic differs from the one given at an earlier memory version."""
    fact_ids = set(state["topics"][topic_id]["fact_ids"]) if topic_id in state["topics"] else set()
    events = [e for e in state["audit"] if e["x"].get("version", 0) > since_version and not e["x"].get("undone") and (e.get("fact_id") in fact_ids or (topic_id and e["x"].get("topic") == topic_id))]
    changes = describe_changes(state, _net_events(events))
    if not changes:
        return {"text": i18n.t("change.fallback"), "code": "memory_changed", "params": {}}
    return {"text": i18n.join([c["text"] for c in changes]), "code": changes[0]["code"], "params": {**changes[0]["params"], "changes": len(changes)}}


def ask(state: dict, question: str, topic_id: str | None = None, include_plain: bool = False, project_id: str | None = None, route: list[str] | None = None) -> tuple[dict, dict]:
    """Answer a question, store the answer and return (response, record).

    With a project the answer only uses that project's memory. Without one it has organisation scope.
    The topic is the one given, else a known phrasing of the question, else the first topic of
    `route` (picked by the model router), else the keyword match.
    """
    routed = next((t for t in route or [] if t in state["topics"] and store.in_scope(state["topics"][t].get("project_id"), project_id)), None)
    matched = topic_id or alias_topic(state, question, project_id) or routed or match_topic(state, question, project_id=project_id)
    matched = moved_topic(state, matched)
    focus = None
    if matched is None:
        response = _result("no_answer", i18n.t("answer.none"), None, [], [], [], state)
    else:
        focus = focus_facts(state, matched, tokenize(question))
        response = answer_topic(state, matched, focus)
    signature = _signature(response) + ([response["_basis"]["id"]] if response.get("_basis") else [])
    response.pop("_sig", None)
    response.pop("_basis", None)
    response = {"question": question, **response, "topic": matched, "changed_because": None, "changed_because_code": None, "changed_because_params": None, "locale": i18n.current()}
    key = f"{project_id}|" + " ".join(tokenize(question)) if matched is None else matched + ("|" + ",".join(sorted(focus)) if focus else "")

    previous = next((a for a in reversed(state["answers"]) if a["x"]["key"] == key), None)
    baseline = None
    if previous is not None:
        if previous["memory_version"] == state["version"]:
            baseline = previous["x"].get("baseline")
        elif previous["x"].get("sig") != signature:
            baseline = previous["memory_version"]
    if baseline is not None:
        why = explain_change(state, baseline, matched)
        response.update(changed_because=why["text"], changed_because_code=why["code"], changed_because_params=why["params"])

    if include_plain:
        ranked = plain_retrieval(state, question, top_k=1, project_id=project_id)
        if ranked:
            response["plain_retrieval"] = {"doc_id": ranked[0]["doc_id"], "quote": ranked[0]["quote"], "rank": 1}

    state["seq"]["answer"] += 1
    used = ([response["binding"]] if response["binding"] else []) + response["superseded"] + response["conflicts"]
    record = {
        "id": f"ans-{state['seq']['answer']:04d}",
        "asked_at": store.now(),
        "memory_version": state["version"],
        "request": {"question": question, **({"topic": topic_id} if topic_id else {}), **({"project_id": project_id} if project_id else {}), "include_plain_retrieval": include_plain},
        "response": copy.deepcopy(response),
        "fact_snapshot": copy.deepcopy(used),
        "x": {"key": key, "topic": matched, "project": project_id, "sig": signature, "baseline": baseline, "locale": i18n.current()},
    }
    state["answers"].append(record)
    return response, record
