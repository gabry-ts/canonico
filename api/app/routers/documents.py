import io
import json

from fastapi import APIRouter, Query, Request
from pydantic import ValidationError

from app import inbox, ingest, llm, ops, store
from app.http import ApiError, not_found, out
from app.models import Document, DocumentCreate, DocumentCreated, DocumentDeleted, DocumentVersion, DocumentVersionCreate, DocumentVersionResult, Fact
from app.store import STORE

router = APIRouter()


def doc_view(state: dict, doc: dict, with_text: bool = False) -> dict:
    keys = ("id", "title", "date", "path") + (("text",) if with_text else ())
    view = {k: doc[k] for k in keys}
    source = state["sources"].get(doc.get("source_id") or "")
    view.update(
        project_id=doc.get("project_id"),
        source_id=doc.get("source_id"),
        source_type=source["type"] if source else None,
        version=doc.get("version", 1),
        version_of=doc.get("version_of"),
        current_version=doc.get("version", 1),
        tags=list(doc.get("tags") or []),
    )
    return view


def require_doc(state: dict, doc_id: str) -> dict:
    doc = state["documents"].get(doc_id)
    if doc is None:
        raise not_found(f"Document {doc_id}")
    return doc


def _pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader

        return "\n\n".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(data)).pages).strip()
    except Exception as exc:
        raise ApiError(422, "file: the PDF could not be read.") from exc


async def _parse(request: Request) -> DocumentCreate:
    content_type = request.headers.get("content-type", "")
    try:
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file")
            if upload is None or not hasattr(upload, "read"):
                raise ApiError(422, "file: field required")
            data = await upload.read()
            name = (getattr(upload, "filename", "") or "").lower()
            is_pdf = name.endswith(".pdf") or data[:5] == b"%PDF-"
            text = _pdf_text(data) if is_pdf else data.decode("utf-8", errors="replace")
            fields = {"title": form.get("title"), "date": form.get("date"), "text": text, "format": "text" if is_pdf or name.endswith(".txt") else "markdown"}
            if form.get("id"):
                fields["id"] = form.get("id")
            if form.get("ingest") is not None:
                fields["ingest"] = str(form.get("ingest")).lower() not in ("false", "0", "no")
            return DocumentCreate.model_validate(fields)
        try:
            payload = json.loads(await request.body() or b"")
        except ValueError as exc:
            raise ApiError(400, "Malformed JSON body.") from exc
        return DocumentCreate.model_validate(payload)
    except ValidationError as exc:
        parts = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        raise ApiError(422, "; ".join(parts)) from exc


@router.get("/documents", operation_id="listDocuments", status_code=200, response_model=list[Document])
def list_documents(project_id: str | None = None, source_id: str | None = None, source_type: str | None = None, tag: str | None = None):
    with STORE.read() as state:
        ops.scope(state, project_id)
        rows = [doc_view(state, d) for d in state["documents"].values() if store.in_scope(d.get("project_id"), project_id)]
    if source_id:
        rows = [d for d in rows if d["source_id"] == source_id]
    if source_type:
        rows = [d for d in rows if d["source_type"] == source_type]
    if tag:
        rows = [d for d in rows if tag in d["tags"]]
    return out(list[Document], rows)


@router.post("/documents", operation_id="createDocument", status_code=201, response_model=DocumentCreated)
async def create_document(request: Request):
    body = await _parse(request)
    if not body.text.strip():
        raise ApiError(422, "text: the document is empty.")
    with STORE.write() as state:
        doc_id = (body.id or store.slugify(body.title)).strip("/")
        if doc_id in state["documents"]:
            raise ApiError(409, f"Document {doc_id} already exists.")
        extension = "txt" if body.format and body.format.value == "text" else "md"
        project_id = getattr(body, "project_id", None) or store.DEFAULT_PROJECT
        ops.require_project(state, project_id)
        source = next((x["id"] for x in state["sources"].values() if x["project_id"] == project_id and x["type"] == "documents"), None)
        document = {"id": doc_id, "title": body.title, "date": body.date.isoformat(), "path": f"{doc_id}.{extension}", "text": body.text,
                    "project_id": project_id, "source_id": source, "version": 1, "version_of": None}
        state["documents"][doc_id] = document
        job = None
        if body.ingest is not False:
            job = ingest.new_job(state, "ingest")
            if not inbox.can_use_model(state):
                job["status"] = "error"
        view = {"document": doc_view(state, document), "ingest_job": ingest.job_view(job) if job else None}
    if job and job["status"] == "queued":
        ingest.start(ingest.run_document_job, job["id"], doc_id)
    return out(DocumentCreated, view, 201)


@router.get("/documents/{doc_id:path}/versions", operation_id="listDocumentVersions", status_code=200, response_model=list[DocumentVersion])
def list_document_versions(doc_id: str):
    with STORE.read() as state:
        return out(list[DocumentVersion], inbox.versions_view(require_doc(state, doc_id)))


@router.post("/documents/{doc_id:path}/versions", operation_id="uploadDocumentVersion", status_code=201, response_model=DocumentVersionResult)
def upload_document_version(doc_id: str, body: DocumentVersionCreate):
    if not body.text.strip():
        raise ApiError(422, "text: the new version is empty.")
    with STORE.write() as state:
        document = require_doc(state, doc_id)
        if body.text.strip() == document["text"].strip():
            raise ApiError(409, "This text is identical to the current version.")
        labels = {v.get("version_label") for v in inbox.ensure_versions(document)}
        if body.version_label and body.version_label in labels:
            raise ApiError(409, f"Version {body.version_label} already exists.")
        date = body.date.isoformat() if body.date else store.now()[:10]
        result = inbox.new_version(state, document, text=body.text, label=body.version_label, title=body.title, date=date)
    if not result["facts_created"]:
        from app import sources

        result["facts_created"] = sources.enrich_document(doc_id)
    return out(DocumentVersionResult, result, 201)


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
        return out(Document, doc_view(state, require_doc(state, doc_id), with_text=True))


@router.delete("/documents/{doc_id:path}", operation_id="deleteDocument", status_code=200, response_model=DocumentDeleted)
def delete_document(doc_id: str, actor: str = Query(..., min_length=1)):
    with STORE.write() as state:
        require_doc(state, doc_id)
        return out(DocumentDeleted, ops.delete_document(state, doc_id, actor))
