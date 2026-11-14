from fastapi import APIRouter, HTTPException

from app import ops, store
from app.http import out
from app.models import Topic, TopicChain
from app.store import STORE

router = APIRouter()


@router.get("/topics", operation_id="listTopics", status_code=200, response_model=list[Topic])
def list_topics():
    with STORE.read() as state:
        return out(list[Topic], [ops.topic_view(t) for t in state["topics"].values()])


@router.post("/topics", operation_id="createTopic", status_code=201, response_model=Topic)
def create_topic() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/topics/{topic_id}/chain", operation_id="getTopicChain", status_code=200, response_model=TopicChain)
def get_topic_chain(topic_id: str):
    with STORE.read() as state:
        topic = ops.require_topic(state, topic_id)
        facts = sorted(store.topic_facts(state, topic_id), key=lambda f: (f["date"], f["id"]))
        return out(TopicChain, {"topic": ops.topic_view(topic), "facts": [store.view(state, f) for f in facts]})


@router.patch("/topics/{topic_id}", operation_id="patchTopic", status_code=200, response_model=Topic)
def patch_topic() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/topics/{topic_id}/merge", operation_id="mergeTopic", status_code=200, response_model=Topic)
def merge_topic() -> None:
    raise HTTPException(501, "not implemented")
