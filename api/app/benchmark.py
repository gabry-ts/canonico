"""Benchmark on the corpus qrels: plain BM25 over documents against Canonico's epistemic ranking."""

import json
import math

from app import engine, store

PROJECT = store.DEFAULT_PROJECT
EVOLVING_TAGS = {
    "onboarding_target_evolution",
    "milan_scope_change",
    "intake_worse_than_expected",
    "timeline_resequencing",
    "audit_queue_target_value",
}


def load_queries() -> list[dict]:
    queries = []
    path = store.corpus_dir() / "queries.jsonl"
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            raw = json.loads(line)
            queries.append({"query_id": raw["_id"], "text": raw["text"], "tests": (raw.get("metadata") or {}).get("tests", "")})
    return queries


def load_qrels() -> dict[str, dict[str, int]]:
    qrels: dict[str, dict[str, int]] = {}
    lines = (store.corpus_dir() / "qrels" / "test.tsv").read_text(encoding="utf-8").splitlines()
    for line in lines[1:]:
        if line.strip():
            query_id, doc_id, grade = line.split("\t")
            qrels.setdefault(query_id, {})[doc_id] = int(grade)
    return qrels


def ndcg_at_k(ranking: list[str], grades: dict[str, int], k: int = 10) -> float:
    """nDCG@k as in trec_eval and BEIR: gain is the grade, discount is log2(rank + 1)."""
    dcg = sum(grades.get(doc_id, 0) / math.log2(rank + 1) for rank, doc_id in enumerate(ranking[:k], start=1))
    ideal = sorted(grades.values(), reverse=True)[:k]
    idcg = sum(grade / math.log2(rank + 1) for rank, grade in enumerate(ideal, start=1))
    return dcg / idcg if idcg else 0.0


def gold_document(grades: dict[str, int], dates: dict[str, str]) -> str:
    """Binding version of the answer: the most recent document among the top-graded ones."""
    top = max(grades.values())
    return max((d for d, g in grades.items() if g == top), key=lambda d: (dates.get(d, ""), d))


def corpus_view(state: dict) -> dict:
    """The memory restricted to the benchmark corpus: its documents and the facts extracted from them."""
    corpus = set(store.load_corpus_documents())
    documents = {i: d for i, d in state["documents"].items() if i in corpus}
    facts = {i: f for i, f in state["facts"].items() if f.get("doc_id") in documents}
    topics = {i: {**t, "fact_ids": [x for x in t["fact_ids"] if x in facts]} for i, t in state["topics"].items() if t.get("project_id") == PROJECT}
    topics = {i: t for i, t in topics.items() if t["fact_ids"]}
    conflicts = {i: {**c, "fact_ids": [x for x in c["fact_ids"] if x in facts]} for i, c in state["conflicts"].items() if c["topic"] in topics}
    return {**state, "documents": documents, "facts": facts, "topics": topics, "conflicts": conflicts}


def answer_document(state: dict, question: str, ranking: list[str]) -> str:
    """Document the answer engine points to: the source of the binding fact, as POST /ask returns it.

    For a contested answer it is the document that holds most of the competing facts. When memory
    has no answer it is the first document of the Canonico ranking.
    """
    from collections import Counter

    from app.text import tokenize

    topic_id = engine.match_topic(state, question, project_id=PROJECT)
    if topic_id is not None:
        answer = engine.answer_topic(state, topic_id, engine.focus_facts(state, topic_id, tokenize(question)))
        if answer["binding"] is not None:
            return answer["binding"]["doc_id"]
        if answer["conflicts"]:
            return Counter(f["doc_id"] for f in answer["conflicts"]).most_common(1)[0][0]
    return ranking[0] if ranking else ""


def evaluate(state: dict) -> dict:
    state = corpus_view(state)
    queries, qrels = load_queries(), load_qrels()
    dates = {i: d["date"] for i, d in state["documents"].items()}
    per_query, ndcg_plain, ndcg_canonico = [], [], []
    for query in queries:
        grades = qrels.get(query["query_id"], {})
        if not grades:
            continue
        plain = [r["doc_id"] for r in engine.plain_retrieval(state, query["text"], top_k=10, project_id=PROJECT)]
        canonico = engine.canonico_ranking(state, query["text"], top_k=10, project_id=PROJECT)
        gold = gold_document(grades, dates)
        answered = answer_document(state, query["text"], canonico)
        ndcg_plain.append(ndcg_at_k(plain, grades))
        ndcg_canonico.append(ndcg_at_k(canonico, grades))
        per_query.append(
            {
                "query_id": query["query_id"],
                "text": query["text"],
                "tests": query["tests"],
                "plain_top_doc": plain[0] if plain else "",
                "canonico_top_doc": answered,
                "gold_doc": gold,
                "pass_plain": bool(plain) and plain[0] == gold,
                "pass_canonico": answered == gold,
            }
        )
    evolving = [q for q in per_query if q["tests"] in EVOLVING_TAGS]
    count = len(per_query) or 1
    return {
        "corpus": state["config"]["active_corpus"],
        "metrics": {
            "ndcg_at_10_plain": round(sum(ndcg_plain) / count, 4),
            "ndcg_at_10_canonico": round(sum(ndcg_canonico) / count, 4),
            "binding_accuracy_plain": round(sum(q["pass_plain"] for q in evolving) / (len(evolving) or 1), 4),
            "binding_accuracy_canonico": round(sum(q["pass_canonico"] for q in evolving) / (len(evolving) or 1), 4),
        },
        "per_query": per_query,
        "measured_at": store.now(),
    }


def extras(result: dict) -> dict:
    """Secondary numbers reported next to the contract metrics."""
    rows = result["per_query"]
    return {
        "queries": len(rows),
        "evolving_queries": sorted(q["query_id"] for q in rows if q["tests"] in EVOLVING_TAGS),
        "top1_gold_plain": round(sum(q["pass_plain"] for q in rows) / (len(rows) or 1), 4),
        "top1_gold_canonico": round(sum(q["pass_canonico"] for q in rows) / (len(rows) or 1), 4),
    }
