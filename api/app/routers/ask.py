from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import engine
from app.http import ApiError, dump
from app.models import AskRequest, AskResponse
from app.store import STORE

router = APIRouter()


def run_ask(state: dict, body: AskRequest) -> dict:
    """Answer and store the answer. The stored answer id travels as `answer_id`."""
    if body.topic and body.topic not in state["topics"]:
        raise ApiError(422, f"topic: unknown topic {body.topic}")
    response, record = engine.ask(state, body.question, body.topic, bool(body.include_plain_retrieval))
    return {**dump(AskResponse, response), "answer_id": record["id"]}


@router.post("/ask", operation_id="ask", status_code=200, response_model=AskResponse)
def ask(body: AskRequest):
    with STORE.write() as state:
        return JSONResponse(run_ask(state, body))


@router.post("/ask/stream", operation_id="askStream", status_code=200, response_model=None)
def ask_stream() -> None:
    raise HTTPException(501, "not implemented")
