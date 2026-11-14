# Canonico

Canonical memory for company brains. Decisions change over time: a target moves from 6 weeks to 3, then 7, then 4. A plain retrieval system answers with whatever document it finds. Canonico tells which decision is binding now, which ones are superseded, which are hypotheses and which questions are still open, always citing the source, and lets people correct or retire a fact by hand.

Built at the KVA hackathon "AI brain for industry" (Turin, 14 November 2026), track: Making memory visible to people.

## Team

Emanuele Beffa, Davide Chiattelli, Gabriele Partiti.

## Data

Evaluation uses the [OIDA Benchmark Corpora](https://github.com/kakashi-ventures/oida-evaluation-corpora) companion data of the paper "Retrieval Is Not Enough: Why Organizational AI Needs Epistemic Infrastructure" (Bottino, Ferrero, Dosio, Beneventano), licensed CC BY 4.0. No real personal data is used.

## Prior work

Before the event a team member built an exploratory prototype in a different domain (decision tables for regulated cases). It was declared to the organisers. No code from it is reused here: this repository starts on the event day.

## Setup

Copy `.env.example` to `api/.env` and fill in the values. Keys stay server-side. The demo path (seeded memory, ask, retire, restore, reset) makes no model calls and works offline.

## Repository layout

```
openapi.yaml   shared API contract
api/           backend, Python FastAPI (models generated from openapi.yaml)
web/           frontend, Vite + React + TypeScript + Tailwind
eval/          benchmark notes, plain retrieval vs Canonico
data/          evaluation corpus and seeded memory
prototypes/    static UI prototypes
```

## Run locally

```
make install   # python venv + npm install
make api       # backend on :8000
make test      # backend tests (contract, demo flow, verbatim quotes)
make web       # frontend on :5173
make mock      # Prism mock of openapi.yaml on :4010
make types     # regenerate api/app/models.py and web/src/api/schema.ts
```

The frontend talks to `VITE_API_URL` (see `web/.env.example`), by default the mock on `:4010`. Point it to `http://localhost:8000` to use the real backend.

Backend notes:

- Memory lives in process and is persisted to `api/.runtime/state.json` (gitignored). It is seeded from `data/seed/*.json` and `data/clearpath/corpus.jsonl`; `POST /demo/reset` restores the seed.
- Run it as a single process: state is not shared between workers or serverless instances.
- Model calls go through `api/app/llm.py`: `LLM_PROVIDER=anthropic` (Messages API, `ANTHROPIC_API_KEY`) or `LLM_PROVIDER=gateway` (Vercel AI Gateway, `AI_GATEWAY_API_KEY`). Output is schema-constrained JSON, responses are cached on disk in `api/.cache/` and every run is capped by `CANONICO_COST_CAP_USD` (default 2.00).
- `cd api && .venv/bin/python -m app.ingest` re-extracts the 46 documents and rewrites `data/seed/` (facts, topics, conflicts, `meta.json` with tokens and cost). A fact is kept only if its quote is a verbatim span of its document. The two demo topics stay hand-curated.
- CORS origins come from `CORS_ORIGINS` (comma-separated) and `CORS_ORIGIN_REGEX` (default allows `*.vercel.app` previews).

## Demo path

The seeded memory answers `POST /ask {"question": "How long does onboarding take?"}` without any model call:

- binding: M-106, 3–4 weeks, final report of 28 November 2025
- `superseded`: the four earlier versions it replaced (M-101 to M-104)
- `conflicts`: M-105, 4 weeks from the final presentation. It was superseded by the final report but is still active, so the answer flags it and `GET /maintenance/queue` proposes it for retirement
- `POST /facts/M-105/retire` with a reason and an actor: the next answer has no conflict and says why it changed (`changed_because`), `GET /facts/M-105` shows who retired it and when
- `POST /demo/reset` restores this state

`GET /topics/{topic_id}/chain` returns the facts of a topic oldest first, each with `doc_title`, plus `changes`: the number of rows whose value differs from the row before it. For the onboarding time the six rows give `changes: 5`.

`GET /me` returns the demo identity (Giulia, owner). The `X-Demo-Actor` header or the `actor` query parameter switch to another member. There is no real authentication.

Other flows that work offline: `POST /demo/send-email` (a client email confirms 5 weeks and supersedes the final report figure), `POST /documents/{doc_id}/versions` (a new version of a library document supersedes what the previous version said on the same topic), `POST /mail/poll` on the mocked inbox in `data/seed/mail/`. Values are found by a deterministic rule (a sentence that states a quantity on a known topic), so these flows need no model. `PATCH /config {"offline_mode": true}` blocks every live model call.

## License

MIT
