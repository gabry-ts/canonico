from datetime import datetime, timezone

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app import access, engine, ops, store
from app.http import ApiError, dump, not_found, out
from app.models import AuditAction, AuditEvent, UndoRequest
from app.store import STORE

router = APIRouter()


def event_view(state: dict, event: dict) -> dict:
    """Public audit event with a generated summary in the locale of the request."""
    member = access.find_member(state, event.get("actor")) if event.get("actor") not in (None, "system", "mail", "webhook") else None
    return {**store.public_event(event), **engine.event_summary(state, event), "actor_role": member["org_role"] if member else None}


def _timestamp(value: str) -> float:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


@router.get("/audit", operation_id="listAudit", status_code=200, response_model=list[AuditEvent])
def list_audit(
    limit: int = Query(50, ge=1, le=500),
    actor: str | None = None,
    action: AuditAction | None = None,
    fact_id: str | None = None,
    since: datetime | None = None,
    project_id: str | None = None,
):
    with STORE.read() as state:
        ops.scope(state, project_id)
        events = [event_view(state, e) for e in reversed(state["audit"]) if store.in_scope(e.get("project_id"), project_id)]
    if actor:
        events = [e for e in events if e["actor"] == actor]
    if action:
        events = [e for e in events if e["action"] == action.value]
    if fact_id:
        events = [e for e in events if e["fact_id"] == fact_id]
    if since:
        floor = (since if since.tzinfo else since.replace(tzinfo=timezone.utc)).timestamp()
        events = [e for e in events if _timestamp(e["at"]) >= floor]
    summaries = {e["id"]: e for e in events[:limit]}
    body = dump(list[AuditEvent], events[:limit])
    for row in body:
        row.update({k: summaries[row["id"]][k] for k in ("summary", "summary_code", "summary_params", "actor_role")})
    return JSONResponse(body)


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
        view = event_view(state, created)
        return JSONResponse({**dump(AuditEvent, view), **{k: view[k] for k in ("summary", "summary_code", "summary_params", "actor_role")}})
