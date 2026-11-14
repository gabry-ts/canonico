from fastapi import APIRouter, HTTPException

from app.models import (
    Topic,
    TopicChain,
)

router = APIRouter()


@router.get("/topics", operation_id="listTopics", status_code=200, response_model=list[Topic])
def list_topics() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/topics", operation_id="createTopic", status_code=201, response_model=Topic)
def create_topic() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/topics/{topic_id}/chain", operation_id="getTopicChain", status_code=200, response_model=TopicChain)
def get_topic_chain() -> None:
    raise HTTPException(501, "not implemented")


@router.patch("/topics/{topic_id}", operation_id="patchTopic", status_code=200, response_model=Topic)
def patch_topic() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/topics/{topic_id}/merge", operation_id="mergeTopic", status_code=200, response_model=Topic)
def merge_topic() -> None:
    raise HTTPException(501, "not implemented")
