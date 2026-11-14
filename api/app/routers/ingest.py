from typing import Literal

from fastapi import APIRouter, Query

from app import ingest, llm
from app.http import ApiError, not_found, out
from app.models import ClassifyRequest, IngestJob, IngestRequest
from app.store import STORE

router = APIRouter()


def require_model(state: dict) -> None:
    if state["config"].get("offline_mode"):
        raise ApiError(422, "Offline mode is on, no model calls are made.", "offline_mode")
    if not llm.available():
        raise ApiError(422, "No model provider is configured on the server.", "llm_unavailable")
    if ingest.remaining_budget(state) <= 0:
        raise ApiError(422, "The cost cap has been reached.", "cost_cap_reached")


@router.get("/ingest/jobs", operation_id="listIngestJobs", status_code=200, response_model=list[IngestJob])
def list_ingest_jobs(status: Literal["queued", "running", "done", "error"] | None = None, limit: int = Query(50, ge=1, le=500)):
    with STORE.read() as state:
        jobs = [ingest.job_view(j) for j in reversed(state["jobs"])]
    if status:
        jobs = [j for j in jobs if j["status"] == status]
    return out(list[IngestJob], jobs[:limit])


@router.post("/ingest", operation_id="startIngest", status_code=202, response_model=IngestJob)
def start_ingest(body: IngestRequest | None = None):
    body = body or IngestRequest()
    with STORE.write() as state:
        if body.corpus and body.corpus != state["config"]["active_corpus"]:
            raise ApiError(422, f"corpus: unknown corpus {body.corpus}")
        if not body.force:
            done = next((j for j in reversed(state["jobs"]) if j["kind"] == "ingest" and j["status"] in ("done", "running", "queued")), None)
            if done is not None:
                return out(IngestJob, ingest.job_view(done), 202)
        require_model(state)
        job = ingest.new_job(state, "ingest")
        view = ingest.job_view(job)
    ingest.start(ingest.run_ingest_job, job["id"])
    return out(IngestJob, view, 202)


@router.get("/ingest/{job_id}", operation_id="getIngestJob", status_code=200, response_model=IngestJob)
def get_ingest_job(job_id: str):
    with STORE.read() as state:
        job = next((j for j in state["jobs"] if j["id"] == job_id), None)
        if job is None:
            raise not_found(f"Job {job_id}")
        return out(IngestJob, ingest.job_view(job))


@router.post("/classify", operation_id="classify", status_code=202, response_model=IngestJob)
def classify(body: ClassifyRequest):
    request = body.root
    with STORE.write() as state:
        if request.doc_id and request.doc_id not in state["documents"]:
            raise not_found(f"Document {request.doc_id}")
        for fact_id in request.fact_ids or []:
            if fact_id not in state["facts"]:
                raise not_found(f"Fact {fact_id}")
        require_model(state)
        job = ingest.new_job(state, "classify")
        view = ingest.job_view(job)
    ingest.start(ingest.run_classify_job, job["id"], request.doc_id, request.fact_ids, bool(request.force))
    return out(IngestJob, view, 202)
