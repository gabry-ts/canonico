# Eval

Compares plain retrieval with Canonico on the OIDA ClearPath corpus (`data/clearpath`: 46 documents, 26 queries, 107 graded judgments, grades 0 to 3). In this benchmark a grade of 3 marks the epistemically primary source, for example the document that holds the binding decision, even when other documents talk about the topic at greater length.

## Run

```
api/.venv/bin/python eval/run.py            # prints the per-query table and the metrics
api/.venv/bin/python eval/run.py --write    # also stores the result in data/seed/eval.json
```

The run is deterministic, takes about a second and makes no model calls. The API serves the stored result at `GET /eval/latest`; `POST /eval/run` runs the same code against the memory as it is at that moment, so retiring or correcting facts changes the next run.

## Systems

**Plain** is Okapi BM25 (k1 1.5, b 0.75) over title and text of the 46 documents, lowercase word tokens, a small stopword list and light suffix stripping. It is the same code as `POST /retrieve/plain`.

**Canonico** starts from the same BM25 scores, divided by the best score so they fall between 0 and 1. It then looks up the memory:

1. The question is matched to topics with BM25 over topic label, keywords, canonical question and the facts of the topic. The two best topics are kept when at least 30% of the IDF weight of the question terms is found in them.
2. Inside a broad topic only the facts the question is about are used: facts whose BM25 score against the question is at least half of the best fact, plus the facts that replace them and the facts in an open conflict with them. Curated topics and topics with four facts or fewer are used whole.
3. Each source document gets the weight of its best fact, by the role of that fact: binding 1.0, part of an open conflict 0.9, superseded by the binding fact 0.7, other decision or constraint 0.6, evidence or open question 0.5, estimate 0.4, superseded elsewhere 0.3, outside the focus 0.15. The weight of the second topic is scaled by its match score relative to the first.
4. Documents are ranked by BM25 score plus that weight.

The memory was extracted once from the corpus by a model (see the main README) and committed in `data/seed/`. Extraction never saw the queries or the qrels. Facts of the two demo topics (`onboarding-target`, `audit-queue-time`) are hand-curated.

## Metrics

**nDCG@10** as computed by trec_eval and BEIR: the gain of a document is its grade, the discount is log2(rank + 1), the ideal ranking sorts the judged documents by grade. Unjudged documents count as grade 0. The value is the mean over the 26 queries.

**Gold document** of a query: the most recent document among those with the highest grade. When two documents share grade 3, the later one is the binding version (for q01 the final report of 28 November, not the preview meeting of 21 November).

**Binding-version accuracy**: share of the evolving-decision queries for which the first ranked document is the gold document. The evolving-decision queries are the five whose `metadata.tests` tag names a value or decision that changed during the engagement:

| query | tests tag |
| --- | --- |
| q01 | `onboarding_target_evolution` |
| q05 | `milan_scope_change` |
| q06 | `intake_worse_than_expected` |
| q07 | `timeline_resequencing` |
| q19 | `audit_queue_target_value` |

`pass_plain` and `pass_canonico` in the per-query output use the same rule (first ranked document equals the gold document) for all 26 queries.

## Result

Measured on 14 November 2026 on the committed seed.

| metric | plain BM25 | Canonico |
| --- | --- | --- |
| nDCG@10, 26 queries | 0.708 | 0.701 |
| binding-version accuracy, 5 evolving-decision queries | 0.00 (0 of 5) | 0.40 (2 of 5) |
| first document is the gold document, 26 queries | 0.385 (10 of 26) | 0.423 (11 of 26) |

How to read it:

- On overall ranking quality the two are level, Canonico is slightly lower. The epistemic weights do not improve nDCG@10 on this corpus.
- Canonico puts the binding version first more often on the questions where a decision changed (q01 and q07 pass, q05, q06 and q19 do not). Plain BM25 passes none of the five: it returns an older or longer document that discusses the topic.
- Five queries are a very small sample, one query moves the accuracy by 20 points.
- The weights in step 3 were set by hand and measured on these same 26 queries. There is no held-out set, so the Canonico numbers are not a clean generalisation estimate.
- Where Canonico fails the cause is mostly topic matching by keywords (q19 is matched to report dates instead of the audit queue target, although the memory holds the right chain: 2 days, then 2 to 3 days, then 3 to 4 days), or facts that the extraction did not capture (q22).

Reference numbers: the corpora repository (`kakashi-ventures/oida-evaluation-corpora`) and the BEIR fork (`kakashi-ventures/beir-oida`) publish the data and the evaluation code but no scores for this corpus in their README files, so there is nothing to compare against here. Their code was read, not executed.
