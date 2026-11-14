from fastapi import APIRouter, Query

from app import ops, store
from app.http import ApiError, not_found, out
from app.models import (
    Dependents,
    Fact,
    FactCreate,
    FactPage,
    FactPatch,
    FactStatus,
    FactType,
    FactVersion,
    PinRequest,
    RestoreRequest,
    RetireRequest,
    SupersedeRequest,
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
def create_fact(body: FactCreate):
    with STORE.write() as state:
        ops.require_topic(state, body.topic)
        if body.doc_id and body.doc_id not in state["documents"]:
            raise not_found(f"Document {body.doc_id}")
        fact = ops.create_fact(
            state,
            topic=body.topic,
            value=body.value,
            type=body.type.value,
            doc_id=body.doc_id,
            quote=body.quote,
            date=body.date.isoformat(),
            confidence=1.0 if body.confidence is None else body.confidence,
            actor=body.actor,
        )
        return out(Fact, store.view(state, fact), 201)


@router.get("/facts/{fact_id}", operation_id="getFact", status_code=200, response_model=Fact)
def get_fact(fact_id: str):
    with STORE.read() as state:
        return out(Fact, store.view(state, ops.get_fact(state, fact_id)))


@router.patch("/facts/{fact_id}", operation_id="patchFact", status_code=200, response_model=Fact)
def patch_fact(fact_id: str, body: FactPatch):
    with STORE.write() as state:
        fact = ops.get_fact(state, fact_id)
        updates = {}
        if body.value is not None and body.value != fact["value"]:
            updates["value"] = body.value
        if body.type is not None and body.type.value != fact["type"]:
            updates["type"] = body.type.value
        if body.topic is not None and body.topic != fact["topic"]:
            ops.require_topic(state, body.topic)
            updates["topic"] = body.topic
        if body.value is None and body.type is None and body.topic is None:
            raise ApiError(422, "Provide at least one of value, type or topic.")
        if updates:
            x_updates = {"edited": True}
            if "value" in updates:
                x_updates["short"] = None
            store.change_fact(state, fact_id, "patch", body.actor, body.reason, updates, x_updates)
        return out(Fact, store.view(state, fact))


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
def pin_fact(fact_id: str, body: PinRequest):
    with STORE.write() as state:
        fact = ops.get_fact(state, fact_id)
        if fact["status"] == "retired":
            raise ApiError(409, f"Fact {fact_id} is retired and cannot be pinned.")
        ops.pin(state, fact, body.reason, body.actor)
        return out(Fact, store.view(state, fact))


@router.post("/facts/{fact_id}/unpin", operation_id="unpinFact", status_code=200, response_model=Fact)
def unpin_fact(fact_id: str, body: PinRequest):
    with STORE.write() as state:
        fact = ops.get_fact(state, fact_id)
        if fact.get("pinned"):
            store.change_fact(state, fact_id, "unpin", body.actor, body.reason, {"pinned": False})
        return out(Fact, store.view(state, fact))


@router.get("/facts/{fact_id}/history", operation_id="getFactHistory", status_code=200, response_model=list[FactVersion])
def get_fact_history(fact_id: str):
    with STORE.read() as state:
        fact = ops.get_fact(state, fact_id)
        history = state["history"].get(fact_id) or [
            {"at": store.settings.SEED_AT, "actor": "system", "action": "classify", "changes": {}, "snapshot": store.view(state, fact)}
        ]
        versions = [{"version": n, **entry} for n, entry in enumerate(history, start=1)]
    return out(list[FactVersion], list(reversed(versions)))


@router.post("/facts/{fact_id}/supersede", operation_id="supersedeFact", status_code=200, response_model=Fact)
def supersede_fact(fact_id: str, body: SupersedeRequest):
    with STORE.write() as state:
        older = ops.get_fact(state, fact_id)
        newer = ops.get_fact(state, body.by_fact_id)
        ops.supersede(state, older, newer, body.reason, body.actor)
        return out(Fact, store.view(state, older))


@router.delete("/facts/{fact_id}/supersedes", operation_id="deleteSupersedesLink", status_code=200, response_model=Fact)
def delete_supersedes_link(fact_id: str, reason: str = Query(..., min_length=1), actor: str = Query(..., min_length=1)):
    with STORE.write() as state:
        newer = ops.get_fact(state, fact_id)
        if not newer.get("supersedes"):
            raise not_found(f"Supersedes link of fact {fact_id}")
        ops.unlink(state, newer, reason, actor)
        return out(Fact, store.view(state, newer))


@router.get("/facts/{fact_id}/dependents", operation_id="getFactDependents", status_code=200, response_model=Dependents)
def get_fact_dependents(fact_id: str):
    with STORE.read() as state:
        fact = ops.get_fact(state, fact_id)
        linked = {fact.get("supersedes"), fact.get("superseded_by")}
        linked |= {f["id"] for f in state["facts"].values() if fact_id in (f.get("supersedes"), f.get("superseded_by"))}
        conflicts = [c for c in state["conflicts"].values() if fact_id in c["fact_ids"] and store.conflict_status(state, c) == "open"]
        for conflict in conflicts:
            linked |= set(conflict["fact_ids"])
        linked -= {None, fact_id}
        facts = sorted((state["facts"][i] for i in linked if i in state["facts"]), key=lambda f: (f["date"], f["id"]), reverse=True)
        answers = [
            {"id": a["id"], "question": a["request"]["question"], "asked_at": a["asked_at"], "status": a["response"]["status"]}
            for a in reversed(state["answers"])
            if any(s["id"] == fact_id for s in a["fact_snapshot"])
        ]
        return out(
            Dependents,
            {"fact_id": fact_id, "facts": [store.view(state, f) for f in facts], "conflicts": sorted(c["id"] for c in conflicts), "answers": answers},
        )
