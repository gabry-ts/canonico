from fastapi import APIRouter, HTTPException

from app import store
from app.http import not_found, out
from app.models import Document, DocumentCreated, DocumentDeleted, Fact
from app.store import STORE

router = APIRouter()


def doc_view(doc: dict, with_text: bool = False) -> dict:
    keys = ("id", "title", "date", "path") + (("text",) if with_text else ())
    return {k: doc[k] for k in keys}


def require_doc(state: dict, doc_id: str) -> dict:
    doc = state["documents"].get(doc_id)
    if doc is None:
        raise not_found(f"Document {doc_id}")
    return doc


@router.get("/documents", operation_id="listDocuments", status_code=200, response_model=list[Document])
def list_documents():
    with STORE.read() as state:
        return out(list[Document], [doc_view(d) for d in state["documents"].values()])


@router.post("/documents", operation_id="createDocument", status_code=201, response_model=DocumentCreated)
def create_document() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/documents/{doc_id:path}/facts", operation_id="listDocumentFacts", status_code=200, response_model=list[Fact])
def list_document_facts(doc_id: str):
    with STORE.read() as state:
        require_doc(state, doc_id)
        facts = [store.view(state, f) for f in state["facts"].values() if f.get("doc_id") == doc_id]
    facts.sort(key=lambda f: f["id"])
    return out(list[Fact], facts)


@router.get("/documents/{doc_id:path}", operation_id="getDocument", status_code=200, response_model=Document)
def get_document(doc_id: str):
    with STORE.read() as state:
        return out(Document, doc_view(require_doc(state, doc_id), with_text=True))


@router.delete("/documents/{doc_id:path}", operation_id="deleteDocument", status_code=200, response_model=DocumentDeleted)
def delete_document() -> None:
    raise HTTPException(501, "not implemented")
