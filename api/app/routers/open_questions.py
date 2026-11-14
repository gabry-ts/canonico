from fastapi import APIRouter, HTTPException

from app.models import (
    OpenQuestion,
)

router = APIRouter()


@router.get("/open-questions", operation_id="listOpenQuestions", status_code=200, response_model=list[OpenQuestion])
def list_open_questions() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/open-questions/{question_id}/close", operation_id="closeOpenQuestion", status_code=200, response_model=OpenQuestion)
def close_open_question() -> None:
    raise HTTPException(501, "not implemented")
