from fastapi import APIRouter, HTTPException

from app.models import (
    Dependents,
    Fact,
    FactPage,
    FactVersion,
)

router = APIRouter()


@router.get("/facts", operation_id="listFacts", status_code=200, response_model=FactPage)
def list_facts() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/facts", operation_id="createFact", status_code=201, response_model=Fact)
def create_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/facts/{fact_id}", operation_id="getFact", status_code=200, response_model=Fact)
def get_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.patch("/facts/{fact_id}", operation_id="patchFact", status_code=200, response_model=Fact)
def patch_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/facts/{fact_id}/retire", operation_id="retireFact", status_code=200, response_model=Fact)
def retire_fact() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/facts/{fact_id}/restore", operation_id="restoreFact", status_code=200, response_model=Fact)
def restore_fact() -> None:
    raise HTTPException(501, "not implemented")


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
