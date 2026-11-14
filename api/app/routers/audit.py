from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app import ops, store
from app.http import ApiError, not_found, out
from app.models import AuditAction, AuditEvent, UndoRequest
from app.store import STORE

router = APIRouter()


def _timestamp(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


@router.get("/audit", operation_id="listAudit", status_code=200, response_model=list[AuditEvent])
def list_audit(
    limit: int = Query(50, ge=1, le=500),
    actor: str | None = None,
    action: AuditAction | None = None,
    fact_id: str | None = None,
    since: datetime | None = None,
):
    with STORE.read() as state:
        events = [store.public_event(e) for e in reversed(state["audit"])]
    if actor:
        events = [e for e in events if e["actor"] == actor]
    if action:
        events = [e for e in events if e["action"] == action.value]
    if fact_id:
        events = [e for e in events if e["fact_id"] == fact_id]
    if since:
        floor = (since if since.tzinfo else since.replace(tzinfo=timezone.utc)).timestamp()
        events = [e for e in events if _timestamp(e["at"]) >= floor]
    return out(list[AuditEvent], events[:limit])


@router.post("/audit/{event_id}/undo", operation_id="undoAuditEvent", status_code=200, response_model=AuditEvent)
def undo_audit_event(event_id: str, body: UndoRequest):
    with STORE.write() as state:
        index = next((n for n, e in enumerate(state["audit"]) if e["id"] == event_id), None)
        if index is None:
            raise not_found(f"Audit event {event_id}")
        event = state["audit"][index]
        undo = event["x"].get("undo")
        if undo is None:
            raise ApiError(409, f"Event {event_id} ({event['action']}) cannot be undone.")
        if event["x"].get("undone"):
            raise ApiError(409, f"Event {event_id} was already undone.")
        touched = ops.undo_targets(undo)
        for later in state["audit"][index + 1 :]:
            if later.get("fact_id") in touched and later["action"] != "approve" and not later["x"].get("undone") and later["action"] != "undo":
                raise ApiError(409, f"Event {later['id']} changed the same fact later, undo that one first.")
        ops.apply_undo(state, event)
        event["x"]["undone"] = True
        created = store.audit(state, "undo", body.actor, event.get("fact_id"), body.reason, x={"ref": event_id, "topic": event["x"].get("topic")})
        return out(AuditEvent, store.public_event(created))
