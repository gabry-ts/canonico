from fastapi import APIRouter, HTTPException

from app.models import (
    AnswerRecord,
    AnswerSummary,
    ReplayDiff,
)

router = APIRouter()


@router.get("/ask/history", operation_id="listAskHistory", status_code=200, response_model=list[AnswerSummary])
def list_ask_history() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/answers/{answer_id}", operation_id="getAnswer", status_code=200, response_model=AnswerRecord)
def get_answer() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/answers/{answer_id}/replay", operation_id="replayAnswer", status_code=200, response_model=ReplayDiff)
def replay_answer() -> None:
    raise HTTPException(501, "not implemented")
