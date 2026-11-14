import copy
from typing import Literal

from fastapi import APIRouter

from app import access, llm, ops, settings, store
from app.http import ApiError, dump, out
from app.models import Config, ConfigPatch, ExportBundle, Stats
from app.routers.answers import record_view
from app.store import STORE

router = APIRouter()


@router.get("/stats", operation_id="getStats", status_code=200, response_model=Stats)
def get_stats(project_id: str | None = None):
    with STORE.read() as state:
        return out(Stats, ops.stats(state, ops.scope(state, project_id)))


@router.get("/config", operation_id="getConfig", status_code=200, response_model=Config)
def get_config():
    with STORE.read() as state:
        return out(Config, state["config"])


@router.patch("/config", operation_id="patchConfig", status_code=200, response_model=Config)
def patch_config(body: ConfigPatch):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        raise ApiError(422, "Provide at least one setting to change.")
    with STORE.write() as state:
        models = changes.pop("models", None)
        if models:
            state["config"]["models"].update(models)
        state["config"].update(changes)
        return out(Config, state["config"])


@router.post("/demo/reset", operation_id="resetDemo", status_code=200, response_model=Stats)
def reset_demo(demo_actor: str | None = access.Actor):
    with STORE.read() as state:
        access.allow(state, demo_actor, "admin_demo")
    state = STORE.reset()
    return out(Stats, ops.stats(state))


@router.get("/export", operation_id="exportMemory", status_code=200, response_model=ExportBundle)
def export_memory():
    with STORE.read() as state:
        bundle = {
            "version": settings.VERSION,
            "exported_at": store.now(),
            "corpus": state["config"]["active_corpus"],
            "documents": [{k: d[k] for k in ("id", "title", "date", "path", "text")} for d in state["documents"].values()],
            "topics": [ops.topic_view(t) for t in state["topics"].values()],
            "facts": [store.view(state, f) for f in state["facts"].values()],
            "audit": [store.public_event(e) for e in state["audit"]],
            "answers": [record_view(a) for a in state["answers"]],
        }
        return out(ExportBundle, bundle)


@router.post("/import", operation_id="importMemory", status_code=200, response_model=dict[str, int])
def import_memory(body: ExportBundle, mode: Literal["replace", "merge"] = "replace"):
    if body.version.split(".")[0] != settings.VERSION.split(".")[0]:
        raise ApiError(422, f"version: bundle version {body.version} is not compatible with {settings.VERSION}.")
    bundle = dump(ExportBundle, body.model_dump(mode="json", by_alias=True))
    with STORE.write() as state:
        old_facts, old_topics = state["facts"], state["topics"]
        if mode == "replace":
            state["documents"], state["facts"], state["topics"] = {}, {}, {}
            state["audit"], state["answers"], state["history"] = [], [], {}
            state["maintenance"], state["open_questions"] = {}, {}
        for doc in bundle["documents"]:
            state["documents"][doc["id"]] = {"text": "", **doc}
        for fact in bundle["facts"]:
            previous = old_facts.get(fact["id"], {})
            internal = copy.deepcopy(previous.get("x", {})) if previous.get("value") == fact["value"] else {}
            base = previous.get("type") if previous.get("type") == "SUPERSEDED" and fact["type"] != "SUPERSEDED" else None
            record = {**fact, "pinned": bool(fact.get("pinned")), "x": internal}
            if record["doc_id"] == "manual":
                record["doc_id"] = None
            if base:
                record["type"] = "SUPERSEDED"
            state["facts"][fact["id"]] = record
        for topic in bundle["topics"]:
            previous = old_topics.get(topic["id"], {})
            state["topics"][topic["id"]] = {**topic, "fact_ids": [i for i in topic["fact_ids"] if i in state["facts"]], "x": copy.deepcopy(previous.get("x", {}))}
        for fact in state["facts"].values():
            store.move_fact(state, fact, fact["topic"])
        known = {e["id"] for e in state["audit"]}
        imported = [e for e in bundle["audit"] if e["id"] not in known]
        for event in imported:
            state["audit"].append({**event, "x": {"version": 0}})
        known_answers = {a["id"] for a in state["answers"]}
        for answer in bundle["answers"]:
            if answer["id"] not in known_answers:
                state["answers"].append({**answer, "x": {"key": answer["request"]["question"], "topic": None}})
        state["conflicts"] = {k: c for k, c in state["conflicts"].items() if sum(1 for i in c["fact_ids"] if i in state["facts"]) >= 2}
        for record in state["conflicts"].values():
            record["fact_ids"] = [i for i in record["fact_ids"] if i in state["facts"]]
        numbers = [int(e["id"].split("-")[1]) for e in state["audit"] if e["id"].split("-")[1].isdigit()]
        state["seq"]["audit"] = max(numbers + [state["seq"]["audit"]])
        numbers = [int(a["id"].split("-")[1]) for a in state["answers"] if a["id"].split("-")[1].isdigit()]
        state["seq"]["answer"] = max(numbers + [state["seq"]["answer"]])
        store.audit(state, "import", "system", None, f"Imported a bundle in {mode} mode.")
        summary = {"documents": len(bundle["documents"]), "topics": len(bundle["topics"]), "facts": len(bundle["facts"]), "audit_events": len(imported)}
    return out(dict[str, int], summary)
