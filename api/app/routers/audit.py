from fastapi import APIRouter, HTTPException

from app.models import (
    AuditEvent,
)

router = APIRouter()


@router.get("/audit", operation_id="listAudit", status_code=200, response_model=list[AuditEvent])
def list_audit() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/audit/{event_id}/undo", operation_id="undoAuditEvent", status_code=200, response_model=AuditEvent)
def undo_audit_event() -> None:
    raise HTTPException(501, "not implemented")
