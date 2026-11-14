from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app import i18n, ops, store
from app.http import ApiError, dump, not_found
from app.models import MaintenanceDecision, MaintenanceItem, MaintenanceReason
from app.store import STORE

router = APIRouter()


def detail(item: dict) -> str:
    params = dict(item.get("params", {}))
    if params.get("date"):
        params["date"] = i18n.short_date(params["date"])
    return i18n.t(f"maintenance.{item['reason']}", **params)


def item_view(state: dict, item: dict) -> dict:
    return {
        "id": item["id"],
        "fact": store.view(state, state["facts"][item["fact_id"]]),
        "reason": item["reason"],
        "detail": detail(item),
        "detail_code": item["reason"],
        "detail_params": item.get("params", {}),
        "proposed_action": item["proposed_action"],
        "status": item["status"],
        "proposed_at": item["proposed_at"],
        "audit_event_id": item.get("event") if item["status"] != "pending" else None,
    }


def respond(view):
    """Validated maintenance items, with the code and parameters of the reason kept next to the sentence."""
    rows = view if isinstance(view, list) else [view]
    body = dump(list[MaintenanceItem], rows)
    for row, source in zip(body, rows):
        row.update(detail_code=source["detail_code"], detail_params=source["detail_params"])
    return JSONResponse(body if isinstance(view, list) else body[0])


def pending_item(state: dict, item_id: str) -> dict:
    item = state["maintenance"].get(item_id)
    if item is None or item["fact_id"] not in state["facts"]:
        raise not_found(f"Maintenance item {item_id}")
    if item["status"] != "pending":
        raise ApiError(409, f"Maintenance item {item_id} is already {item['status']}.")
    return item


@router.get("/maintenance/queue", operation_id="getMaintenanceQueue", status_code=200, response_model=list[MaintenanceItem])
def get_maintenance_queue(
    status: Literal["pending", "approved", "dismissed"] = "pending",
    reason: MaintenanceReason | None = None,
    project_id: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    with STORE.read() as state:
        ops.scope(state, project_id)
        items = [m for m in state["maintenance"].values() if m["status"] == status and m["fact_id"] in state["facts"]]
        items = [m for m in items if store.in_scope(state["facts"][m["fact_id"]].get("project_id"), project_id)]
        if reason:
            items = [m for m in items if m["reason"] == reason.value]
        items.sort(key=lambda m: int(m["id"].split("-")[1]))
        return respond([item_view(state, m) for m in items[offset : offset + limit]])


@router.post("/maintenance/{item_id}/approve", operation_id="approveMaintenanceItem", status_code=200, response_model=MaintenanceItem)
def approve_maintenance_item(item_id: str, body: MaintenanceDecision):
    with STORE.write() as state:
        item = pending_item(state, item_id)
        fact = state["facts"][item["fact_id"]]
        note = body.note or detail(item)
        # One audit event for the decision and the retirement it causes, so one undo reverts both.
        event = ops.retire(state, fact, note, body.actor, action="approve", extra={"item": item_id})
        if event is None:
            event = store.audit(state, "approve", body.actor, fact["id"], note, x={"item": item_id, "undo": {}}, bump=False)
        event["x"]["undo"]["maintenance"] = item_id
        item["status"] = "approved"
        item["event"] = event["id"]
        return respond(item_view(state, item))


@router.post("/maintenance/{item_id}/dismiss", operation_id="dismissMaintenanceItem", status_code=200, response_model=MaintenanceItem)
def dismiss_maintenance_item(item_id: str, body: MaintenanceDecision):
    with STORE.write() as state:
        item = pending_item(state, item_id)
        item["status"] = "dismissed"
        event = store.audit(state, "dismiss", body.actor, item["fact_id"], body.note, x={"item": item_id, "undo": {"maintenance": item_id}}, bump=False)
        item["event"] = event["id"]
        return respond(item_view(state, item))
