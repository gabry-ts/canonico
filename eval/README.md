# Eval

Compares plain retrieval with Canonico on the OIDA ClearPath corpus (`data/clearpath`: 46 documents, 26 queries, 107 graded judgments, grades 0 to 3). In this benchmark a grade of 3 marks the epistemically primary source, for example the document that holds the binding decision, even when other documents talk about the topic at greater length.

## Run

```
api/.venv/bin/python eval/run.py                          # keyword topic matching, no model calls
api/.venv/bin/python eval/run.py --router model           # topics picked by the model router
api/.venv/bin/python eval/run.py --router model --write   # also stores the result in data/seed/eval.json
```

With keyword matching the run is deterministic, takes about a second and makes no model calls. The model router makes one small call per question (26 calls, about 60,000 input tokens, $0.0064 with the extraction model) and caches the answers in `api/.cache/`.

The API serves the stored result at `GET /eval/latest`, with a `router` field that says which variant it is. `POST /eval/run` runs the same code against the memory as it is at that moment, so retiring or correcting facts changes the next run; it uses the model router when a provider is configured and offline mode is off, keywords otherwise.

## Systems

**Plain** is Okapi BM25 (k1 1.5, b 0.75) over title and text of the 46 documents, lowercase word tokens, a small stopword list and light suffix stripping. It is the same code as `POST /retrieve/plain`.

**Canonico** starts from the same BM25 scores, divided by the best score so they fall between 0 and 1. It then looks up the memory:

1. The question is matched to topics. Two variants are measured:
   - **keywords**: BM25 over topic label, keywords, canonical question and the facts of the topic. The two best topics are kept when at least 30% of the IDF weight of the question terms is found in them. This is what runs offline.
   - **model router**: a small model reads the question and the list of topics (id, label, canonical question) and returns at most two topic ids, best first. It sees no documents, no facts and no relevance judgments. The first topic counts fully, the second at 0.6. This is what `POST /ask` uses for a free question when a provider is configured; known phrasings of the demo questions skip it.
2. Inside a broad topic only the facts the question is about are used: facts whose BM25 score against the question is at least half of the best fact, plus the facts that replace them and the facts in an open conflict with them. Curated topics and topics with four facts or fewer are used whole.
3. Each source document gets the weight of its best fact, by the role of that fact: binding 1.0, part of an open conflict 0.9, superseded by the binding fact 0.7 (also when it is still active and flagged as stale), other decision or constraint 0.6, evidence or open question 0.5, estimate 0.4, superseded elsewhere 0.3, outside the focus 0.15. With keywords the weight of the second topic is scaled by its match score relative to the first.
4. Documents are ranked by BM25 score plus that weight.

The memory was extracted once from the corpus by a model (see the main README) and committed in `data/seed/`. Extraction never saw the queries or the qrels. Facts of the two demo topics (`onboarding-target`, `audit-queue-time`) are hand-curated.

## Metrics

**nDCG@10** as computed by trec_eval and BEIR: the gain of a document is its grade, the discount is log2(rank + 1), the ideal ranking sorts the judged documents by grade. Unjudged documents count as grade 0. The value is the mean over the 26 queries.

**Gold document** of a query: the most recent document among those with the highest grade. When two documents share grade 3, the later one is the binding version (for q01 the final report of 28 November, not the preview meeting of 21 November).

**Answer document** of a system for a query: for plain retrieval the first ranked document. For Canonico the document that `POST /ask` points to: the source of the fact it returns as binding. When the answer is contested it is the document that holds most of the competing facts, and when memory has no answer it is the first document of the Canonico ranking.

**Binding-version accuracy**: share of the evolving-decision queries for which the answer document is the gold document. The evolving-decision queries are the five whose `metadata.tests` tag names a value or decision that changed during the engagement:

| query | tests tag |
| --- | --- |
| q01 | `onboarding_target_evolution` |
| q05 | `milan_scope_change` |
| q06 | `intake_worse_than_expected` |
| q07 | `timeline_resequencing` |
| q19 | `audit_queue_target_value` |

`pass_plain` and `pass_canonico` in the per-query output use the same rule (answer document equals the gold document) for all 26 queries, and `plain_top_doc` and `canonico_top_doc` are the answer documents.

The benchmark only uses the 46 corpus documents and the facts extracted from them. Documents added by other sources (document library, mail, GitHub) are left out.

## Result

Measured on 14 November 2026 on the committed seed.

| metric | plain BM25 | Canonico, keywords | Canonico, model router |
| --- | --- | --- | --- |
| nDCG@10, 26 queries | 0.708 | 0.693 | 0.744 |
| binding-version accuracy, 5 evolving-decision queries | 0.00 (0 of 5) | 0.40 (2 of 5) | 0.60 (3 of 5) |
| answer document is the gold document, 26 queries | 0.385 (10 of 26) | 0.346 (9 of 26) | 0.423 (11 of 26) |

`data/seed/eval.json` holds the model router run.

How to read it:

- With keyword matching Canonico is slightly below plain BM25 on nDCG@10 and on the 26-query accuracy. The weak step is finding the topic by keywords: q19 is matched to report dates instead of the audit queue target, although the memory holds the right chain (2 days, then 2 to 3 days, then 3 to 4 days).
- With the model router picking the topic, Canonico is above plain BM25 on all three numbers: +0.036 nDCG@10, and it answers from the binding version on three of the five questions where a decision changed (q01, q07, q19), where plain BM25 gets none.
- q05 and q06 still fail in both variants: the answer engine returns the latest decision of a broad extracted topic, which is a later email than the one that holds the decision.
- Five queries are a very small sample, one query moves the accuracy by 20 points. On 26 queries the difference in nDCG@10 between the systems is also within what a few queries can move.
- The weights in step 3 were set by hand and measured on these same 26 queries. There is no held-out set, so the Canonico numbers are not a clean generalisation estimate.
- Some facts were never extracted (q22, a personal remark at the kickoff), no ranking can fix that.

Reference numbers: the corpora repository (`kakashi-ventures/oida-evaluation-corpora`) and the BEIR fork (`kakashi-ventures/beir-oida`) publish the data and the evaluation code but no scores for this corpus in their README files, so there is nothing to compare against here. Their code was read, not executed.
