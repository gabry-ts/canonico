from fastapi import APIRouter, HTTPException

from app.models import (
    PlainRetrievalResult,
    SearchResponse,
)

router = APIRouter()


@router.get("/search", operation_id="search", status_code=200, response_model=SearchResponse)
def search() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/retrieve/plain", operation_id="retrievePlain", status_code=200, response_model=PlainRetrievalResult)
def retrieve_plain() -> None:
    raise HTTPException(501, "not implemented")
