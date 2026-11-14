import asyncio
import json
import os
import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from app import engine, inbox, llm, store
from app.http import ApiError, dump
from app.models import AskRequest, AskResponse
from app.store import STORE

router = APIRouter()


def router_enabled(state: dict) -> bool:
    """The model router runs only with a provider, outside offline mode and unless CANONICO_ROUTER=lexical."""
    return os.environ.get("CANONICO_ROUTER", "model") != "lexical" and inbox.can_use_model(state)


def plan_route(body: AskRequest) -> list[str] | None:
    """Ask the model which topic a free question is about. None means: use the keyword matcher.

    Skipped when the request names a topic or uses a known phrasing, so the demo question never waits.
    The call runs outside the store lock with a short timeout, any failure falls back to keywords.
    """
    project_id = getattr(body, "project_id", None)
    with STORE.read() as state:
        if body.topic or project_id not in (None, *state["projects"]) or not router_enabled(state):
            return None
        if engine.alias_topic(state, body.question, project_id) is not None:
            return None
        lines = engine.topic_lines(state, project_id)
        model = state["config"]["models"]["extraction"]
        budget = max(0.0, state["config"]["cost_cap_usd"] - state.get("cost_spent", 0.0))
    if not lines:
        return None
    meter = llm.Meter(cap_usd=budget)
    try:
        route = engine.model_route(body.question, lines, model, meter)
    except Exception:
        route = None
    if meter.spent:
        with STORE.write() as state:
            state["cost_spent"] = round(state.get("cost_spent", 0.0) + meter.spent, 6)
    return route or None


def run_ask(state: dict, body: AskRequest, route: list[str] | None = None) -> dict:
    """Answer and store the answer. The stored answer id travels as `answer_id`."""
    project_id = getattr(body, "project_id", None)
    if project_id is not None and project_id not in state["projects"]:
        raise ApiError(422, f"project_id: unknown project {project_id}")
    if body.topic and (body.topic not in state["topics"] or not store.in_scope(state["topics"][body.topic].get("project_id"), project_id)):
        raise ApiError(422, f"topic: unknown topic {body.topic}")
    response, record = engine.ask(state, body.question, body.topic, bool(body.include_plain_retrieval), project_id, route)
    return {**dump(AskResponse, response), "answer_id": record["id"]}


@router.post("/ask", operation_id="ask", status_code=200, response_model=AskResponse)
def ask(body: AskRequest):
    route = plan_route(body)
    with STORE.write() as state:
        return JSONResponse(run_ask(state, body, route))


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/ask/stream", operation_id="askStream", status_code=200, response_model=None)
async def ask_stream(body: AskRequest):
    async def events():
        try:
            route = await asyncio.to_thread(plan_route, body)
            with STORE.write() as state:
                response = run_ask(state, body, route)
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
