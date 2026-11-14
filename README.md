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

## License

MIT
