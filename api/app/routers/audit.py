from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app import store
from app.http import out
from app.models import AuditAction, AuditEvent
from app.store import STORE

router = APIRouter()


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
        floor = since.timestamp() if since.tzinfo else since.replace(tzinfo=datetime.now().astimezone().tzinfo).timestamp()
        events = [e for e in events if datetime.fromisoformat(e["at"].replace("Z", "+00:00")).timestamp() >= floor]
    return out(list[AuditEvent], events[:limit])


@router.post("/audit/{event_id}/undo", operation_id="undoAuditEvent", status_code=200, response_model=AuditEvent)
def undo_audit_event() -> None:
    raise HTTPException(501, "not implemented")
