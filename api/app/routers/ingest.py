from fastapi import APIRouter, HTTPException

from app.models import (
    IngestJob,
)

router = APIRouter()


@router.get("/ingest/jobs", operation_id="listIngestJobs", status_code=200, response_model=list[IngestJob])
def list_ingest_jobs() -> None:
    raise HTTPException(501, "not implemented")



@router.post("/ingest", operation_id="startIngest", status_code=202, response_model=IngestJob)
def start_ingest() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/ingest/{job_id}", operation_id="getIngestJob", status_code=200, response_model=IngestJob)
def get_ingest_job() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/classify", operation_id="classify", status_code=202, response_model=IngestJob)
def classify() -> None:
    raise HTTPException(501, "not implemented")