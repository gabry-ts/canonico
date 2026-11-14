from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter

from app import i18n, ops, store
from app.http import ApiError, not_found, out
from app.models import OpenQuestion, OpenQuestionClose
from app.store import STORE

router = APIRouter()


def question_view(question: dict) -> dict:
    view = dict(question)
    if i18n.current() == "it" and question.get("question_it"):
        view["question"] = question["question_it"]
    return view


@router.get("/open-questions", operation_id="listOpenQuestions", status_code=200, response_model=list[OpenQuestion])
def list_open_questions(status: Literal["open", "closed"] = "open", topic: str | None = None, project_id: str | None = None):
    with STORE.read() as state:
        ops.scope(state, project_id)
        items = [question_view(q) for q in state["open_questions"].values() if store.in_scope(store.project_of_topic(state, q["topic"]), project_id)]
    items = [q for q in items if q["status"] == status and (not topic or q["topic"] == topic)]
    return out(list[OpenQuestion], items)


@router.post("/open-questions/{question_id}/close", operation_id="closeOpenQuestion", status_code=200, response_model=OpenQuestion)
def close_open_question(question_id: str, body: OpenQuestionClose):
    request = body.root
    with STORE.write() as state:
        question = state["open_questions"].get(question_id)
        if question is None:
            raise not_found(f"Open question {question_id}")
        if question["status"] == "closed":
            raise ApiError(409, f"Open question {question_id} is already closed.")
        if request.answer_fact_id and request.answer_fact_id not in state["facts"]:
            raise not_found(f"Fact {request.answer_fact_id}")
        before = dict(question)
        question.update(
            status="closed",
            closed_at=datetime.now(timezone.utc).date().isoformat(),
            answer_fact_id=request.answer_fact_id,
            note=request.note,
        )
        store.audit(state, "close", request.actor, question["fact_id"], request.note or f"Answered by {request.answer_fact_id}.", x={"undo": {"question": before}})
        return out(OpenQuestion, question_view(question))
