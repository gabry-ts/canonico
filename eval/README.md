# Eval

Compares plain retrieval against Canonico on the OIDA ClearPath corpus (`data/clearpath`).
Metrics: nDCG@10 on the provided qrels, and binding-version accuracy (does the answer cite the fact that is binding now).
Plain retrieval is the baseline exposed by `POST /retrieve/plain`; Canonico is `POST /ask`.
It will run through `POST /eval/run`, which scores every query in `GET /eval/queries` with both systems.
Results are read back with `GET /eval/latest`.
