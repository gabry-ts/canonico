from typing import Literal

from fastapi import APIRouter, HTTPException

from app import store
from app.http import out
from app.models import Conflict
from app.store import STORE

router = APIRouter()


@router.get("/conflicts", operation_id="listConflicts", status_code=200, response_model=list[Conflict])
def list_conflicts(status: Literal["open", "resolved"] = "open", topic: str | None = None):
    with STORE.read() as state:
        items = [store.conflict_view(state, c) for c in state["conflicts"].values()]
    items = [c for c in items if c["status"] == status and (not topic or c["topic"] == topic)]
    items.sort(key=lambda c: c["id"])
    return out(list[Conflict], items)


@router.post("/conflicts/{conflict_id}/resolve", operation_id="resolveConflict", status_code=200, response_model=Conflict)
def resolve_conflict() -> None:
    raise HTTPException(501, "not implemented")
