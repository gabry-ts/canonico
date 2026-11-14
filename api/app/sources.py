"""Sources of a project and their sync jobs."""

import copy
import re
import threading

from app import extract, github, inbox, llm, ops, settings, store
from app.http import ApiError, not_found
from app.store import STORE

# Model calls made while an HTTP request waits (an item, an email, a version) give up early
# instead of holding the request for minutes on a slow or rate-limited provider.
WAITING = {"timeout": 45.0, "retries": 1}
SHORT = {"documents": "docs", "document_library": "library", "github": "gh", "mail": "mail", "webhook": "hook"}


def require(state: dict, source_id: str) -> dict:
    source = state["sources"].get(source_id)
    if source is None:
        raise not_found(f"Source {source_id}")
    return source


def view(state: dict, source: dict) -> dict:
    config = source.get("config") or {}
    if source["type"] == "webhook":
        secret = source.get("x", {}).get("secret") or {}
        config = {"url": f"{settings.public_url()}/hooks/projects/{source['project_id']}", "secret_last4": secret.get("last4", ""), "default_tags": list(config.get("default_tags") or [])}
    return {
        "id": source["id"],
        "project_id": source["project_id"],
        "type": source["type"],
        "label": source["label"],
        "status": source.get("status", "idle"),
        "last_synced_at": source.get("last_synced_at"),
        "items": sum(1 for d in state["documents"].values() if d.get("source_id") == source["id"]),
        "config": config,
    }


def check_config(kind: str, config: dict) -> dict:
    """Validate the settings of a source against its type."""
    config = dict(config or {})
    if kind == "github":
        try:
            github.parse_repo(config.get("repo_url", ""))
        except github.GithubError as exc:
            raise ApiError(422, f"config.repo_url: {exc}") from exc
        config["repo_url"] = str(config["repo_url"]).rstrip("/")
        config.setdefault("include", ["issues", "readme"])
        if "discussions" in config["include"]:
            raise ApiError(422, "config.include: discussions are not available without authentication.")
    elif kind == "document_library":
        if config.get("provider") != "local_mock":
            raise ApiError(422, "config.provider: only local_mock is implemented.")
        if not config.get("root_path"):
            raise ApiError(422, "config.root_path: field required")
    elif kind == "webhook":
        tags = config.get("default_tags") or []
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            raise ApiError(422, "config.default_tags: a list of strings is required")
        config = {"default_tags": tags}
    elif kind == "mail":
        if config.get("mode") not in ("imap_mock", "webhook") or not config.get("mailbox"):
            raise ApiError(422, "config: a mail source needs mode and mailbox.")
        config.setdefault("match_rules", [])
    elif config:
        raise ApiError(422, "config: a documents source has no settings.")
    return config


def new_id(state: dict, project_id: str, kind: str) -> str:
    base = f"src-{re.sub(r'^proj-', '', project_id)}-{SHORT[kind]}"
    candidate, n = base, 2
    while candidate in state["sources"]:
        candidate, n = f"{base}-{n}", n + 1
    return candidate


def job_view(job: dict) -> dict:
    return {k: job[k] for k in ("id", "source_id", "status", "items_added", "facts_created", "cost_usd", "started_at", "finished_at")}


def start_sync(state: dict, source: dict) -> dict:
    if source.get("status") == "syncing":
        raise ApiError(409, f"Source {source['id']} is already syncing.")
    state["seq"]["sync"] = state["seq"].get("sync", 0) + 1
    job = {"id": f"sync-{state['seq']['sync']:04d}", "source_id": source["id"], "status": "queued", "items_added": 0, "facts_created": 0, "cost_usd": 0.0, "started_at": None, "finished_at": None}
    state["sync_jobs"].append(job)
    source["status"] = "syncing"
    return job


def run_sync(job_id: str) -> None:
    with STORE.write() as state:
        job = next(j for j in state["sync_jobs"] if j["id"] == job_id)
        job.update(status="running", started_at=store.now())
        source = copy.deepcopy(state["sources"].get(job["source_id"]))
        offline = bool(state["config"].get("offline_mode"))
    if source is None:
        _finish(job_id, "error")
        return
    try:
        if source["type"] == "mail":
            with STORE.write() as state:
                result = inbox.poll(state, source["project_id"])
                job = next(j for j in state["sync_jobs"] if j["id"] == job_id)
                job["items_added"] = len(result["results"])
                job["facts_created"] = sum(len(r["facts_created"]) for r in result["results"])
        elif source["type"] == "github":
            documents = github.fetch(source["config"]["repo_url"], source["config"].get("include"), offline=offline)
            _add_github_documents(job_id, source, documents)
    except (github.GithubError, llm.LLMError, ApiError):
        _finish(job_id, "error")
        return
    _finish(job_id, "done")


def _add_github_documents(job_id: str, source: dict, documents: list[dict]) -> None:
    added = []
    with STORE.write() as state:
        if source["id"] not in state["sources"]:
            return
        for raw in documents:
            existing = state["documents"].get(raw["id"])
            if existing is not None:
                if existing.get("source_id") == source["id"] and existing["text"] != raw["text"]:
                    existing.update(text=raw["text"], title=raw["title"])
                continue
            state["documents"][raw["id"]] = {**raw, "project_id": source["project_id"], "source_id": source["id"], "version": 1, "version_of": None}
            added.append(raw["id"])
        job = next(j for j in state["sync_jobs"] if j["id"] == job_id)
        job["items_added"] = len(added)
        if added:
            owner, repo = github.parse_repo(source["config"]["repo_url"])
            store.audit(state, "ingest", "system", None, f"{owner}/{repo}: {len(added)} new documents from GitHub.", x={"project": source["project_id"]}, bump=False)
        use_model = inbox.can_use_model(state)
        models = dict(state["config"]["models"])
        budget = max(0.0, state["config"]["cost_cap_usd"] - state.get("cost_spent", 0.0))
        texts = {i: copy.deepcopy(state["documents"][i]) for i in added}
    if not use_model or not added:
        return
    meter = llm.Meter(cap_usd=budget)
    facts = 0
    for doc_id, document in texts.items():
        try:
            found = extract.extract_document(document, models["extraction"], meter)
        except llm.LLMError:
            break
        with STORE.write() as state:
            facts += len(file_extracted_facts(state, document, found))
    with STORE.write() as state:
        job = next(j for j in state["sync_jobs"] if j["id"] == job_id)
        job["facts_created"] = facts
        job["cost_usd"] = round(meter.spent, 4)
        state["cost_spent"] = round(state.get("cost_spent", 0.0) + meter.spent, 6)


def enrich_document(doc_id: str, prefix: str = "M") -> list[str]:
    """Ask the model for the facts of a stored document that the deterministic rule did not find.

    Does nothing in offline mode, without a provider or without budget. Model failures are swallowed:
    the document stays stored and the caller's result is unchanged.
    """
    with STORE.read() as state:
        document = copy.deepcopy(state["documents"].get(doc_id))
        if document is None or document.get("project_id") is None or not inbox.can_use_model(state):
            return []
        model = state["config"]["models"]["extraction"]
        linker = state["config"]["models"]["classification"]
        budget = max(0.0, state["config"]["cost_cap_usd"] - state.get("cost_spent", 0.0))
        from app import engine

        lines = engine.topic_lines(state, document["project_id"]) if llm.forced() else {}
    meter = llm.Meter(cap_usd=budget)
    try:
        found = extract.extract_document(document, model, meter, **WAITING)
    except Exception:
        found = []
    routes = forced_routes(document, found, lines, model, meter) if llm.forced() else None
    with STORE.write() as state:
        state["cost_spent"] = round(state.get("cost_spent", 0.0) + meter.spent, 6)
        if doc_id not in state["documents"]:
            return []
        created = file_extracted_facts(state, state["documents"][doc_id], found, prefix, routes)
        touched: dict[str, list[str]] = {}
        for fact_id in created:
            touched.setdefault(state["facts"][fact_id]["topic"], []).append(fact_id)
        topics = {t: ({"label": state["topics"][t]["label"], "question": ""}, [dict(f, tid=f["id"]) for f in copy.deepcopy(store.topic_facts(state, t))]) for t in touched}
    link_new_facts(topics, touched, linker, meter)
    return created


def link_new_facts(topics: dict, touched: dict, model: str, meter: llm.Meter) -> None:
    """Let the model link the new facts of a document to the facts of their topic: a decision reversed
    later in the same meeting replaces the earlier one. Failures leave the facts unlinked."""
    from concurrent.futures import ThreadPoolExecutor

    def one(topic_id: str) -> list[dict]:
        topic, members = topics[topic_id]
        return [link for link in extract.link_topic(topic, members, model, meter, **WAITING)["links"] if link["newer"] in touched[topic_id]]

    spent = meter.spent
    try:
        with ThreadPoolExecutor(max_workers=6) as pool:
            links = [link for found in pool.map(one, [t for t, (_, members) in topics.items() if len(members) >= 2]) for link in found]
    except Exception:
        links = []
    with STORE.write() as state:
        state["cost_spent"] = round(state.get("cost_spent", 0.0) + meter.spent - spent, 6)
        for link in links:
            older, newer = state["facts"].get(link["older"]), state["facts"].get(link["newer"])
            if older is None or newer is None or older.get("superseded_by"):
                continue
            try:
                ops.supersede(state, older, newer, link.get("reason") or "Replaced later in the same document.", "system")
            except ApiError:
                continue


def forced_routes(document: dict, found: list[dict], lines: dict[str, str], model: str, meter: llm.Meter) -> list[list[str]]:
    """With CANONICO_FORCE_LLM the model also picks the topic of every extracted fact, curated topics included.
    A `topic:<id>` tag of the document still wins."""
    from app import engine

    tagged = [t.split(":", 1)[1].strip() for t in document.get("tags") or [] if t.lower().startswith("topic:")]
    tagged = [t for t in tagged if t in lines]
    routes = []
    for raw in found:
        if tagged:
            routes.append(tagged[:1])
            continue
        try:
            routes.append(engine.model_route(f"{raw['topic_hint']}: {raw['value']}", lines, model, meter)[:1])
        except Exception:
            routes.append([])
    return routes


def file_extracted_facts(state: dict, document: dict, found: list[dict], prefix: str = "M", routes: list[list[str]] | None = None) -> list[str]:
    """File model-extracted facts under topics of the document's project. Curated topics are never touched,
    except when the model picked the topic (`routes`, only with CANONICO_FORCE_LLM)."""
    from app import engine

    project_id = document.get("project_id")
    created = []
    for n, raw in enumerate(found):
        ranked = [t for t in engine.rank_topics(state, raw["topic_hint"] + " " + raw["value"], project_id) if not state["topics"][t[0]].get("x", {}).get("curated")]
        routed = routes[n] if routes is not None and n < len(routes) else None
        if routed and routed[0] in state["topics"] and state["topics"][routed[0]].get("project_id") == project_id:
            topic_id = routed[0]
        elif routed is None and ranked and ranked[0][2] >= 0.5:
            topic_id = ranked[0][0]
        else:
            topic_id = store.slugify(raw["topic_hint"])
            existing = state["topics"].get(topic_id)
            if existing is not None and (existing.get("project_id") != project_id or existing.get("x", {}).get("curated")):
                topic_id = f"{topic_id}-{store.slugify(project_id or 'org')}"
            state["topics"].setdefault(topic_id, {"id": topic_id, "label": raw["topic_hint"].capitalize(), "fact_ids": [], "project_id": project_id, "x": {"keywords": [raw["topic_hint"]]}})
        fact = ops.create_fact(
            state,
            topic=topic_id,
            value=raw["value"],
            type=raw["type"],
            doc_id=document["id"],
            quote=raw["quote"],
            date=raw["date"],
            confidence=raw["confidence"],
            actor="system",
            action="ingest",
            x={"manual": False, "short": raw.get("short") or "", "label": f"the fact “{raw.get('short') or raw['value'][:60]}” from “{document['title']}”"},
            prefix=prefix,
        )
        created.append(fact["id"])
    return created


def _finish(job_id: str, status: str) -> None:
    with STORE.write() as state:
        job = next(j for j in state["sync_jobs"] if j["id"] == job_id)
        job.update(status=status, finished_at=store.now())
        source = state["sources"].get(job["source_id"])
        if source is not None:
            source["status"] = "ok" if status == "done" else "error"
            if status == "done":
                source["last_synced_at"] = job["finished_at"]


def launch(job_id: str) -> None:
    threading.Thread(target=run_sync, args=(job_id,), daemon=True).start()


def delete_project(state: dict, project_id: str) -> None:
    """Remove a project with its sources, documents, facts and the mail rules that point to it."""
    if any(j["status"] in ("queued", "running") and state["sources"].get(j["source_id"], {}).get("project_id") == project_id for j in state["sync_jobs"]):
        raise ApiError(409, f"Project {project_id} has a sync in progress.")
    topics = {i for i, t in state["topics"].items() if t.get("project_id") == project_id}
    facts = {i for i, f in state["facts"].items() if f.get("project_id") == project_id}
    for fact in state["facts"].values():
        for key in ("supersedes", "superseded_by"):
            if fact.get(key) in facts:
                fact[key] = None
    state["facts"] = {i: f for i, f in state["facts"].items() if i not in facts}
    state["topics"] = {i: t for i, t in state["topics"].items() if i not in topics}
    state["documents"] = {i: d for i, d in state["documents"].items() if d.get("project_id") != project_id}
    state["conflicts"] = {i: c for i, c in state["conflicts"].items() if c["topic"] not in topics}
    state["open_questions"] = {i: q for i, q in state["open_questions"].items() if q["fact_id"] not in facts}
    state["maintenance"] = {i: m for i, m in state["maintenance"].items() if m["fact_id"] not in facts}
    state["sources"] = {i: s for i, s in state["sources"].items() if s["project_id"] != project_id}
    state["mail_rules"] = {i: r for i, r in state["mail_rules"].items() if r["project_id"] != project_id}
    state["messages"] = [m for m in state["messages"] if m.get("project_id") != project_id]
    del state["projects"][project_id]
    store.audit(state, "delete_document", "system", None, f"Project {project_id} deleted with {len(facts)} facts.", x={"project": None})
