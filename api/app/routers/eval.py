import copy
import secrets
import threading

from fastapi import APIRouter, Query

from app import benchmark, store
from app.http import not_found, out
from app.models import EvalQuery, EvalResult, EvalRun
from app.store import STORE

router = APIRouter()


def run_view(run: dict) -> dict:
    return {k: run[k] for k in ("id", "status", "started_at", "finished_at", "cost_usd", "result")}


def _execute(run_id: str) -> None:
    with STORE.read() as state:
        snapshot = copy.deepcopy(state)
    try:
        result, status = benchmark.evaluate(snapshot), "done"
    except Exception:
        result, status = None, "error"
    with STORE.write() as state:
        run = next((r for r in state["eval_runs"] if r["id"] == run_id), None)
        if run is None:
            return
        run.update(status=status, finished_at=store.now(), result=result)
        if result is not None:
            state["eval_latest"] = result


@router.get("/eval/latest", operation_id="getLatestEval", status_code=200, response_model=EvalResult)
def get_latest_eval():
    with STORE.read() as state:
        if not state.get("eval_latest"):
            raise not_found("Evaluation result")
        return out(EvalResult, state["eval_latest"])


@router.post("/eval/run", operation_id="runEval", status_code=202, response_model=EvalRun)
def run_eval():
    with STORE.write() as state:
        run = {"id": f"eval-{secrets.token_hex(2)}", "status": "queued", "started_at": store.now(), "finished_at": None, "cost_usd": 0.0, "result": None}
        state["eval_runs"].append(run)
        view = run_view(run)
    threading.Thread(target=_execute, args=(run["id"],), daemon=True).start()
    return out(EvalRun, view, 202)


@router.get("/eval/runs", operation_id="listEvalRuns", status_code=200, response_model=list[EvalRun])
def list_eval_runs(limit: int = Query(50, ge=1, le=500)):
    with STORE.read() as state:
        return out(list[EvalRun], [run_view(r) for r in reversed(state["eval_runs"])][:limit])


@router.get("/eval/runs/{run_id}", operation_id="getEvalRun", status_code=200, response_model=EvalRun)
def get_eval_run(run_id: str):
    with STORE.read() as state:
        run = next((r for r in state["eval_runs"] if r["id"] == run_id), None)
        if run is None:
            raise not_found(f"Evaluation run {run_id}")
        return out(EvalRun, run_view(run))


@router.get("/eval/queries", operation_id="listEvalQueries", status_code=200, response_model=list[EvalQuery])
def list_eval_queries():
    qrels = benchmark.load_qrels()
    queries = []
    for query in benchmark.load_queries():
        grades = sorted(qrels.get(query["query_id"], {}).items(), key=lambda item: (-item[1], item[0]))
        queries.append({**query, "gold_docs": [{"doc_id": doc_id, "grade": grade} for doc_id, grade in grades]})
    return out(list[EvalQuery], queries)
