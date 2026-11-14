from fastapi import APIRouter, HTTPException

from app.models import (
    MaintenanceItem,
)

router = APIRouter()


@router.get("/maintenance/queue", operation_id="getMaintenanceQueue", status_code=200, response_model=list[MaintenanceItem])
def get_maintenance_queue() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/maintenance/{item_id}/approve", operation_id="approveMaintenanceItem", status_code=200, response_model=MaintenanceItem)
def approve_maintenance_item() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/maintenance/{item_id}/dismiss", operation_id="dismissMaintenanceItem", status_code=200, response_model=MaintenanceItem)
def dismiss_maintenance_item() -> None:
    raise HTTPException(501, "not implemented")
