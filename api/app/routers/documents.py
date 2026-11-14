from fastapi import APIRouter, HTTPException

from app.models import (
    Document,
    DocumentCreated,
    DocumentDeleted,
    Fact,
)

router = APIRouter()


@router.get("/documents", operation_id="listDocuments", status_code=200, response_model=list[Document])
def list_documents() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/documents", operation_id="createDocument", status_code=201, response_model=DocumentCreated)
def create_document() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/documents/{doc_id}", operation_id="getDocument", status_code=200, response_model=Document)
def get_document() -> None:
    raise HTTPException(501, "not implemented")


@router.delete("/documents/{doc_id}", operation_id="deleteDocument", status_code=200, response_model=DocumentDeleted)
def delete_document() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/documents/{doc_id}/facts", operation_id="listDocumentFacts", status_code=200, response_model=list[Fact])
def list_document_facts() -> None:
    raise HTTPException(501, "not implemented")
