from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app import ops, store
from app.http import ApiError, dump, out
from app.models import Topic, TopicChain, TopicCreate, TopicMergeRequest, TopicPatch
from app.store import STORE

router = APIRouter()


@router.get("/topics", operation_id="listTopics", status_code=200, response_model=list[Topic])
def list_topics(project_id: str | None = None):
    with STORE.read() as state:
        ops.scope(state, project_id)
        return out(list[Topic], [ops.topic_view(t, state) for t in state["topics"].values() if store.in_scope(t.get("project_id"), project_id)])


@router.post("/topics", operation_id="createTopic", status_code=201, response_model=Topic)
def create_topic(body: TopicCreate):
    with STORE.write() as state:
        topic_id = store.slugify(body.id or body.label)
        if topic_id in state["topics"]:
            raise ApiError(409, f"Topic {topic_id} already exists.")
        project_id = getattr(body, "project_id", None)
        if project_id is not None:
            ops.require_project(state, project_id)
        state["topics"][topic_id] = {"id": topic_id, "label": body.label, "fact_ids": [], "project_id": project_id or store.DEFAULT_PROJECT, "x": {}}
        return out(Topic, ops.topic_view(state["topics"][topic_id], state), 201)


@router.get("/topics/{topic_id}/chain", operation_id="getTopicChain", status_code=200, response_model=TopicChain)
def get_topic_chain(topic_id: str):
    with STORE.read() as state:
        topic = ops.require_topic(state, topic_id)
        facts = sorted(store.topic_facts(state, topic_id), key=lambda f: (f["date"], f["id"]))
        body = dump(TopicChain, {"topic": ops.topic_view(topic, state), "facts": [store.view(state, f) for f in facts]})
        for row, fact in zip(body["facts"], facts):
            document = state["documents"].get(fact.get("doc_id") or "")
            row["doc_title"] = document["title"] if document else None
        values = [store.value_key(f) for f in facts]
        body["changes"] = sum(1 for before, after in zip(values, values[1:]) if before != after)
        return JSONResponse(body)


@router.patch("/topics/{topic_id}", operation_id="patchTopic", status_code=200, response_model=Topic)
def patch_topic(topic_id: str, body: TopicPatch):
    with STORE.write() as state:
        topic = ops.require_topic(state, topic_id)
        topic["label"] = body.label
        return out(Topic, ops.topic_view(topic, state))


@router.post("/topics/{topic_id}/merge", operation_id="mergeTopic", status_code=200, response_model=Topic)
def merge_topic(topic_id: str, body: TopicMergeRequest):
    with STORE.write() as state:
        source = ops.require_topic(state, topic_id)
        target = ops.require_topic(state, body.into_topic_id)
        if source is target:
            raise ApiError(409, "A topic cannot be merged into itself.")
        if source.get("project_id") != target.get("project_id"):
            raise ApiError(409, "Topics of different projects cannot be merged.")
        moved = list(source["fact_ids"])
        for fact_id in moved:
            fact = state["facts"].get(fact_id)
            if fact is not None:
                store.ensure_history(state, fact)
                fact["topic"] = target["id"]
                if fact_id not in target["fact_ids"]:
                    target["fact_ids"].append(fact_id)
        target["fact_ids"].sort(key=lambda i: (state["facts"][i]["date"], i) if i in state["facts"] else ("", i))
        target.setdefault("x", {}).setdefault("keywords", []).extend(source.get("x", {}).get("keywords", []) + [source["label"]])
        for record in list(state["conflicts"].values()) + list(state["open_questions"].values()):
            if record["topic"] == source["id"]:
                record["topic"] = target["id"]
        del state["topics"][source["id"]]
        store.audit(state, "merge", body.actor, None, f"Merged topic {source['id']} into {target['id']} ({len(moved)} facts).", x={"topic": target["id"]})
        return out(Topic, ops.topic_view(target, state))
