"""Benchmark on the ClearPath qrels: plain BM25 over documents against Canonico.

Usage, from the repository root:

    api/.venv/bin/python eval/run.py            # print the table
    api/.venv/bin/python eval/run.py --write    # also store the result in data/seed/eval.json

Definitions are in eval/README.md. The run is deterministic and makes no model calls.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
os.environ["CANONICO_STATE_FILE"] = ""

from app import benchmark, ops, store  # noqa: E402


def main() -> None:
    state = store.build_seed()
    ops.sync(state)
    result = benchmark.evaluate(state)
    print(f"{'query':5} {'tests':30} {'plain top-1':34} {'canonico top-1':34} gold")
    for row in result["per_query"]:
        marks = ("P" if row["pass_plain"] else "-") + ("C" if row["pass_canonico"] else "-")
        short = lambda doc: doc.split("/")[-1][:32]  # noqa: E731
        print(f"{row['query_id']:5} {row['tests'][:30]:30} {short(row['plain_top_doc']):34} {short(row['canonico_top_doc']):34} {short(row['gold_doc'])} {marks}")
    print(json.dumps({**result["metrics"], **benchmark.extras(result)}, indent=2))
    if "--write" in sys.argv:
        path = store.seed_dir() / "eval.json"
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"written {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
