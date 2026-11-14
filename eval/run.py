"""Benchmark on the ClearPath qrels: plain BM25 over documents against Canonico.

Usage, from the repository root:

    api/.venv/bin/python eval/run.py                  # keyword topic matching, no model calls
    api/.venv/bin/python eval/run.py --router model   # topics picked by the model router (needs a provider key)
    api/.venv/bin/python eval/run.py --router model --write   # also store the result in data/seed/eval.json

Definitions are in eval/README.md. With keyword matching the run is deterministic and makes no model
calls. The model router makes one small call per question, cached in api/.cache/.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
os.environ["CANONICO_STATE_FILE"] = ""

from app import benchmark, llm, ops, store  # noqa: E402


def main() -> None:
    use_model = "--router" in sys.argv and sys.argv[sys.argv.index("--router") + 1 : sys.argv.index("--router") + 2] == ["model"]
    state = store.build_seed()
    ops.sync(state)
    meter = llm.Meter()
    if use_model and not llm.available():
        sys.exit("No model provider configured: set LLM_PROVIDER and its key in api/.env.")
    result = benchmark.evaluate(state, benchmark.model_router(state, meter) if use_model else None)
    result["router"] = "model" if use_model else "keywords"
    print(f"{'query':5} {'tests':30} {'plain':34} {'canonico':34} gold")
    for row in result["per_query"]:
        marks = ("P" if row["pass_plain"] else "-") + ("C" if row["pass_canonico"] else "-")
        short = lambda doc: doc.split("/")[-1][:32]  # noqa: E731
        print(f"{row['query_id']:5} {row['tests'][:30]:30} {short(row['plain_top_doc']):34} {short(row['canonico_top_doc']):34} {short(row['gold_doc'])} {marks}")
    print(json.dumps({"router": result["router"], **result["metrics"], **benchmark.extras(result), "model_usage": meter.summary()}, indent=2))
    if "--write" in sys.argv:
        path = store.seed_dir() / "eval.json"
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"written {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
