from fastapi import APIRouter, Query

from app import engine
from app.http import not_found, out
from app.models import AnswerRecord, AnswerSummary, ReplayDiff
from app.store import STORE

router = APIRouter()


def summary(record: dict) -> dict:
    return {"id": record["id"], "question": record["request"]["question"], "asked_at": record["asked_at"], "status": record["response"]["status"]}


def record_view(record: dict) -> dict:
    return {k: record[k] for k in ("id", "asked_at", "memory_version", "request", "response", "fact_snapshot")}


def require_answer(state: dict, answer_id: str) -> dict:
    record = next((a for a in state["answers"] if a["id"] == answer_id), None)
    if record is None:
        raise not_found(f"Answer {answer_id}")
    return record


def _comparable(field: str, value):
    if field == "binding":
        return value["id"] if value else None
    if field in ("superseded", "conflicts"):
        return [fact["id"] for fact in value]
    return value


@router.get("/ask/history", operation_id="listAskHistory", status_code=200, response_model=list[AnswerSummary])
def list_ask_history(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    with STORE.read() as state:
        items = [summary(a) for a in reversed(state["answers"])]
    return out(list[AnswerSummary], items[offset : offset + limit])


@router.get("/answers/{answer_id}", operation_id="getAnswer", status_code=200, response_model=AnswerRecord)
def get_answer(answer_id: str):
    with STORE.read() as state:
        return out(AnswerRecord, record_view(require_answer(state, answer_id)))


@router.post("/answers/{answer_id}/replay", operation_id="replayAnswer", status_code=200, response_model=ReplayDiff)
def replay_answer(answer_id: str):
    with STORE.write() as state:
        original = require_answer(state, answer_id)
        request = original["request"]
        response, record = engine.ask(state, request["question"], request.get("topic"), bool(request.get("include_plain_retrieval")), request.get("project_id"))
        diffs = []
        for field in ("status", "answer", "binding", "superseded", "conflicts", "citations"):
            before, after = _comparable(field, original["response"][field]), _comparable(field, response[field])
            if before != after:
                diffs.append({"field": field, "before": before, "after": after})
        because = engine.explain_change(state, original["memory_version"], record["x"]["topic"]) if diffs else None
        return out(ReplayDiff, {"answer_id": answer_id, "new_answer_id": record["id"], "changed": bool(diffs), "changed_because": because, "diffs": diffs})
