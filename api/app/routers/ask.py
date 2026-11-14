from fastapi import APIRouter, HTTPException

from app.models import (
    AskResponse,
)

router = APIRouter()


@router.post("/ask", operation_id="ask", status_code=200, response_model=AskResponse)
def ask() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/ask/stream", operation_id="askStream", status_code=200, response_model=None)
def ask_stream() -> None:
    raise HTTPException(501, "not implemented")
