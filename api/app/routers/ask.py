import asyncio
import json
import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from app import engine, store
from app.http import ApiError, dump
from app.models import AskRequest, AskResponse
from app.store import STORE

router = APIRouter()


def run_ask(state: dict, body: AskRequest) -> dict:
    """Answer and store the answer. The stored answer id travels as `answer_id`."""
    project_id = getattr(body, "project_id", None)
    if project_id is not None and project_id not in state["projects"]:
        raise ApiError(422, f"project_id: unknown project {project_id}")
    if body.topic and (body.topic not in state["topics"] or not store.in_scope(state["topics"][body.topic].get("project_id"), project_id)):
        raise ApiError(422, f"topic: unknown topic {body.topic}")
    response, record = engine.ask(state, body.question, body.topic, bool(body.include_plain_retrieval), project_id)
    return {**dump(AskResponse, response), "answer_id": record["id"]}


@router.post("/ask", operation_id="ask", status_code=200, response_model=AskResponse)
def ask(body: AskRequest):
    with STORE.write() as state:
        return JSONResponse(run_ask(state, body))


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/ask/stream", operation_id="askStream", status_code=200, response_model=None)
async def ask_stream(body: AskRequest):
    async def events():
        try:
            with STORE.write() as state:
                response = run_ask(state, body)
        except ApiError as exc:
            yield _event("error", {"code": exc.code, "message": exc.message})
            return
        except Exception:
            yield _event("error", {"code": "internal_error", "message": "Unexpected server error."})
            return
        used = ([response["binding"]] if response["binding"] else []) + response["superseded"] + response["conflicts"]
        yield _event("retrieval", {"fact_ids": [fact["id"] for fact in used]})
        for chunk in re.findall(r"\S+\s*(?:\S+\s*){0,2}", response["answer"]):
            yield _event("token", {"text": chunk})
            await asyncio.sleep(0.03)
        yield _event("final", response)

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(events(), media_type="text/event-stream", headers=headers)
