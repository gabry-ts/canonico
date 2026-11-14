from typing import Literal

from fastapi import APIRouter

from app import access, ops, store
from app.http import ApiError, not_found, out
from app.models import Conflict, ConflictResolution
from app.store import STORE

router = APIRouter()


@router.get("/conflicts", operation_id="listConflicts", status_code=200, response_model=list[Conflict])
def list_conflicts(status: Literal["open", "resolved"] = "open", topic: str | None = None, project_id: str | None = None):
    with STORE.read() as state:
        ops.scope(state, project_id)
        items = [store.conflict_view(state, c) for c in state["conflicts"].values() if store.in_scope(store.project_of_topic(state, c["topic"]), project_id)]
    items = [c for c in items if c["status"] == status and (not topic or c["topic"] == topic)]
    items.sort(key=lambda c: c["id"])
    return out(list[Conflict], items)


@router.post("/conflicts/{conflict_id}/resolve", operation_id="resolveConflict", status_code=200, response_model=Conflict)
def resolve_conflict(conflict_id: str, body: ConflictResolution, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        record = state["conflicts"].get(conflict_id)
        if record is None:
            raise not_found(f"Conflict {conflict_id}")
        access.allow(state, demo_actor, "resolve_conflict", store.project_of_topic(state, record["topic"]))
        if store.conflict_status(state, record) == "resolved":
            raise ApiError(409, f"Conflict {conflict_id} is already resolved.")
        if body.winning_fact_id not in record["fact_ids"] or body.winning_fact_id not in state["facts"]:
            raise ApiError(422, f"winning_fact_id: fact {body.winning_fact_id} is not part of conflict {conflict_id}.")
        winner = state["facts"][body.winning_fact_id]
        if winner["status"] != "active":
            raise ApiError(422, f"winning_fact_id: fact {winner['id']} is retired.")
        extra = {"conflict": conflict_id}
        for fact_id in record["fact_ids"]:
            fact = state["facts"].get(fact_id)
            if fact is not None and fact is not winner:
                ops.retire(state, fact, body.reason, body.actor, action="resolve", extra=extra)
        if store.binding_of(state, record["topic"]) is not winner:
            ops.pin(state, winner, body.reason, body.actor, action="resolve", extra=extra)
        record["resolution"] = {"winning_fact_id": winner["id"], "reason": body.reason, "actor": body.actor, "resolved_at": store.now()}
        return out(Conflict, store.conflict_view(state, record))
