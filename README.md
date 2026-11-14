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

## Organisation, projects and sources

One organisation holds several projects. A request with `project_id` (query parameter, or body field on `POST /ask`) sees only that project: its documents, topics, facts, conflicts and audit events. Without it the request has organisation scope and sees everything. The seed has two projects, `proj-clearpath` (the 46 corpus documents, a document library, a mailbox) and `proj-internal` (an internal handbook and a GitHub source).

Sources of a project:

- `documents`: uploaded or ingested documents.
- `document_library` (provider `local_mock`): versioned documents seeded from `data/seed/library/` with a `manifest.json` (document id, version, `version_of`, `uploaded_at`). `POST /documents/{doc_id}/versions` stores a new version; facts of the previous version on the same topic get a SUPERSEDES link to the new fact and one audit event, which can be undone.
- `github`: a public repository, read with the unauthenticated GitHub REST API (README and issues become documents). Responses are cached in `api/.cache/github/` and reused when the rate limit is hit, when GitHub is unreachable and in offline mode.
- `mail`: `imap_mock` polls the seeded inbox in `data/seed/mail/` (`POST /mail/poll`), `webhook` receives `POST /mail/inbound`. Mail settings live on the organisation and are inherited by projects, a project can override them. Routing rules (`sender_domain`, `sender_address`, `recipient`, `subject_contains`) are evaluated by ascending priority, the first match decides the project; `sender_domain` compares the exact domain. An email that no rule matches is stored at organisation scope.

Fact ids tell where a fact came from: `M-1xx` and `M-2xx` curated demo facts, `M-1001` and above extracted from the corpus, `M-301` and above typed in by a person or taken from an uploaded version of a plain document, `E-301` and above from email, `L-4xx` from the document library.

Members and roles are a demo layer without real authentication. `GET /roles` lists what each role may do. Writes check the role of the member named in the `X-Demo-Actor` header and return 403 when the permission is missing; a project role overrides the organisation role inside that project. Without the header the owner acts.

`GET /stats` also returns dashboard figures. `needs_attention.stale_active` counts facts that were superseded but are still active. `time_to_fix_seconds` is measured, not configured: for every retire or resolve of a fact, the seconds between the first answer that showed that fact as a conflict and the moment it was retired; `median` is null until there is a sample.

## License

MIT
