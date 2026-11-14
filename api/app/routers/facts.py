from fastapi import APIRouter, HTTPException, Query

from app import ops, store
from app.http import out
from app.models import (
    Dependents,
    Fact,
    FactPage,
    FactStatus,
    FactType,
    FactVersion,
    RestoreRequest,
    RetireRequest,
)
from app.store import STORE

router = APIRouter()


@router.get("/facts", operation_id="listFacts", status_code=200, response_model=FactPage)
def list_facts(
    topic: str | None = None,
    type: FactType | None = None,
    status: FactStatus | None = None,
    doc_id: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    with STORE.read() as state:
        items = [store.view(state, f) for f in state["facts"].values()]
    if topic:
        items = [f for f in items if f["topic"] == topic]
    if type:
        items = [f for f in items if f["type"] == type.value]
    if status:
        items = [f for f in items if f["status"] == status.value]
    if doc_id:
        items = [f for f in items if f["doc_id"] == doc_id]
    items.sort(key=lambda f: (f["date"], f["id"]), reverse=True)
    return out(FactPage, {"items": items[offset : offset + limit], "total": len(items), "limit": limit, "offset": offset})


@router.post("/facts", operation_id="createFact", status_code=201, response_model=Fact)
def create_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/facts/{fact_id}", operation_id="getFact", status_code=200, response_model=Fact)
def get_fact(fact_id: str):
    with STORE.read() as state:
        return out(Fact, store.view(state, ops.get_fact(state, fact_id)))


@router.patch("/facts/{fact_id}", operation_id="patchFact", status_code=200, response_model=Fact)
def patch_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/facts/{fact_id}/retire", operation_id="retireFact", status_code=200, response_model=Fact)
def retire_fact(fact_id: str, body: RetireRequest):
    with STORE.write() as state:
        fact = ops.get_fact(state, fact_id)
        ops.retire(state, fact, body.reason, body.actor)
        return out(Fact, store.view(state, fact))


@router.post("/facts/{fact_id}/restore", operation_id="restoreFact", status_code=200, response_model=Fact)
def restore_fact(fact_id: str, body: RestoreRequest | None = None):
    body = body or RestoreRequest()
    with STORE.write() as state:
        fact = ops.get_fact(state, fact_id)
        ops.restore(state, fact, body.reason, body.actor or "anonymous")
        return out(Fact, store.view(state, fact))


@router.post("/facts/{fact_id}/pin", operation_id="pinFact", status_code=200, response_model=Fact)
def pin_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/facts/{fact_id}/unpin", operation_id="unpinFact", status_code=200, response_model=Fact)
def unpin_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/facts/{fact_id}/history", operation_id="getFactHistory", status_code=200, response_model=list[FactVersion])
def get_fact_history() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/facts/{fact_id}/supersede", operation_id="supersedeFact", status_code=200, response_model=Fact)
def supersede_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.delete("/facts/{fact_id}/supersedes", operation_id="deleteSupersedesLink", status_code=200, response_model=Fact)
def delete_supersedes_link() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/facts/{fact_id}/dependents", operation_id="getFactDependents", status_code=200, response_model=Dependents)
def get_fact_dependents() -> None:
    raise HTTPException(501, "not implemented")
