from fastapi import APIRouter, HTTPException

from app import ops
from app.http import out
from app.models import Config, ExportBundle, Stats
from app.store import STORE

router = APIRouter()


@router.get("/stats", operation_id="getStats", status_code=200, response_model=Stats)
def get_stats():
    with STORE.read() as state:
        return out(Stats, ops.stats(state))


@router.get("/config", operation_id="getConfig", status_code=200, response_model=Config)
def get_config() -> None:
    raise HTTPException(501, "not implemented")


@router.patch("/config", operation_id="patchConfig", status_code=200, response_model=Config)
def patch_config() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/demo/reset", operation_id="resetDemo", status_code=200, response_model=Stats)
def reset_demo():
    state = STORE.reset()
    return out(Stats, ops.stats(state))


@router.get("/export", operation_id="exportMemory", status_code=200, response_model=ExportBundle)
def export_memory() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/import", operation_id="importMemory", status_code=200, response_model=dict[str, int])
def import_memory() -> None:
    raise HTTPException(501, "not implemented")
