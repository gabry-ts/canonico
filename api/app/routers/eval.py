from fastapi import APIRouter, HTTPException

from app.models import (
    EvalQuery,
    EvalResult,
    EvalRun,
)

router = APIRouter()


@router.get("/eval/latest", operation_id="getLatestEval", status_code=200, response_model=EvalResult)
def get_latest_eval() -> None:
    raise HTTPException(501, "not implemented")


@router.post("/eval/run", operation_id="runEval", status_code=202, response_model=EvalRun)
def run_eval() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/eval/runs", operation_id="listEvalRuns", status_code=200, response_model=list[EvalRun])
def list_eval_runs() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/eval/runs/{run_id}", operation_id="getEvalRun", status_code=200, response_model=EvalRun)
def get_eval_run() -> None:
    raise HTTPException(501, "not implemented")


@router.get("/eval/queries", operation_id="listEvalQueries", status_code=200, response_model=list[EvalQuery])
def list_eval_queries() -> None:
    raise HTTPException(501, "not implemented")
