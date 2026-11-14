from fastapi import APIRouter, HTTPException

from app.models import (
    Conflict,
)

router = APIRouter()


@router.get("/conflicts", operation_id="listConflicts", status_code=200, response_model=list[Conflict])
def list_conflicts() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/conflicts/{conflict_id}/resolve", operation_id="resolveConflict", status_code=200, response_model=Conflict)
def resolve_conflict() -> None:
    raise HTTPException(501, "not implemented")
