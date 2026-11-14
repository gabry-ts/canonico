from typing import Literal

from fastapi import APIRouter, Query

from app import engine, ops, store
from app.http import ApiError, out
from app.models import FactStatus, FactType, PlainRetrievalRequest, PlainRetrievalResult, SearchResponse
from app.store import STORE
from app.text import best_passage, tokenize

router = APIRouter()


@router.get("/search", operation_id="search", status_code=200, response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1),
    kind: Literal["fact", "document", "all"] = "all",
    type: list[FactType] | None = Query(None),
    status: FactStatus | None = None,
    topic: str | None = None,
    project_id: str | None = None,
    tag: str | None = None,
    limit: int = Query(50, ge=1, le=500),
):
    tokens = tokenize(q)
    results = []
    with STORE.read() as state:
        ops.scope(state, project_id)
        if kind in ("fact", "all"):
            wanted = {t.value for t in type} if type else None
            ranked = engine.facts_index(state, project_id).rank(tokens)
            top = ranked[0][1] if ranked else 1.0
            for fact_id, score in ranked:
                fact = store.view(state, state["facts"][fact_id])
                if wanted and fact["type"] not in wanted:
                    continue
                if status and fact["status"] != status.value:
                    continue
                if topic and fact["topic"] != topic:
                    continue
                if tag and tag not in fact["tags"]:
                    continue
                results.append(
                    {"kind": "fact", "id": fact_id, "score": round(score / top, 3), "snippet": fact["quote"], "doc_id": fact["doc_id"], "topic": fact["topic"], "type": fact["type"]}
                )
        if kind in ("document", "all") and not type and not status and not topic:
            ranked = engine.docs_index(state, project_id).rank(tokens)
            top = ranked[0][1] if ranked else 1.0
            for doc_id, score in ranked:
                if tag and tag not in (state["documents"][doc_id].get("tags") or []):
                    continue
                snippet = best_passage(state["documents"][doc_id]["text"], tokens)
                results.append({"kind": "document", "id": doc_id, "score": round(score / top * 0.95, 3), "snippet": snippet, "doc_id": doc_id, "topic": None, "type": None})
    results.sort(key=lambda r: (-r["score"], r["kind"] != "fact", r["id"]))
    return out(SearchResponse, {"query": q, "total": len(results), "results": results[:limit]})


@router.post("/retrieve/plain", operation_id="retrievePlain", status_code=200, response_model=PlainRetrievalResult)
def retrieve_plain(body: PlainRetrievalRequest):
    method = body.method.value if body.method else "bm25"
    if method != "bm25":
        raise ApiError(422, "method: embedding retrieval is not configured on this server, use bm25.")
    with STORE.read() as state:
        results = engine.plain_retrieval(state, body.query, top_k=body.top_k or 10)
    return out(PlainRetrievalResult, {"query": body.query, "method": "bm25", "results": results})
