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
- `cd api && .venv/bin/python -m app.ingest` re-extracts the 46 documents and rewrites `data/seed/` (facts, topics, conflicts, `meta.json` with tokens and cost). A fact is kept only if its quote is a verbatim span of its document. Hand-curated facts and topics are kept as they are.
- `POST /ask` finds the topic of a question in three steps: a known phrasing of a topic (the demo questions), then the model router (one small cached call that picks a topic from the list of topics, 8 second timeout), then keyword matching. The model router is skipped without a provider, in offline mode and with `CANONICO_ROUTER=lexical`; any failure falls back to keywords. The answer itself is always composed from the facts without a model.
- CORS origins come from `CORS_ORIGINS` (comma-separated) and `CORS_ORIGIN_REGEX` (default allows `*.vercel.app` previews).
- State survives a restart. Call `POST /demo/reset` before a demo to start from the seed.
- `render.yaml` describes a single-instance web service for Render (build `pip install ./api`, start `uvicorn` from `api/`). It has not been deployed from this repository yet. The supported deployment is Docker on your own server, see below.

## Deploy with Docker

Two containers on one server. `web` is a Caddy server with the built site; it forwards everything under `/api/` to `api`, so site and API share one origin and the browser needs no CORS. `api` is the FastAPI process, not published to the host.

```
cp .env.example api/.env   # then put the key in api/.env, see below
make docker-up             # docker compose up -d --build
make docker-logs           # follow the logs
make docker-down           # stop, the volume keeps the state
```

Open `http://localhost:8080`. The API answers under the same address, for example `http://localhost:8080/api/health`. Set `WEB_PORT` to publish another port (`WEB_PORT=80 make docker-up`) and `PUBLIC_URL` to the address people use, it is shown in webhook URLs (`PUBLIC_URL=https://brain.example.org make docker-up`).

- Key: `api/.env` is read by compose at start and never copied into an image. For the live demo set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`, or `LLM_PROVIDER=gateway` and `AI_GATEWAY_API_KEY`. Without `api/.env` the stack still starts: the seeded memory and every demo flow work without a model.
- State: the named volume `canonico-runtime` holds the memory, the audit log, stored answers and the caches of model and GitHub responses. `docker compose down -v` deletes it.
- Reset the demo: `curl -X POST http://localhost:8080/api/demo/reset`.
- Offline mode: `curl -X PATCH http://localhost:8080/api/config -H 'content-type: application/json' -d '{"offline_mode": true}'`, or `CANONICO_OFFLINE=1` in `api/.env` to start that way. A reset goes back to the value of `CANONICO_OFFLINE`.
- One replica only: memory lives in the `api` process. Do not scale the service.
- To reach the server from outside without opening ports, point a Cloudflare Tunnel or a Tailscale Funnel at `http://localhost:8080`; both give an HTTPS address, which then goes into `PUBLIC_URL`. There is no authentication in this demo, so share that address only with the people who need it.

## Demo path

The seeded memory answers `POST /ask {"question": "How long does onboarding take?"}` without any model call:

- binding: M-106, 3–4 weeks, final report of 28 November 2025
- `superseded`: the four earlier versions it replaced (M-101 to M-104)
- `conflicts`: M-105, 4 weeks from the final presentation. It was superseded by the final report but is still active, so the answer flags it and `GET /maintenance/queue` proposes it for retirement
- `POST /facts/M-105/retire` with a reason and an actor: the next answer has no conflict and says why it changed (`changed_because`), `GET /facts/M-105` shows who retired it and when
- `POST /demo/reset` restores this state

`GET /topics/{topic_id}/chain` returns the facts of a topic oldest first, each with `doc_title`, plus `changes`: the number of rows whose value differs from the row before it. For the onboarding time the six rows give `changes: 5`.

`GET /me` returns the demo identity (Giulia, owner). The `X-Demo-Actor` header or the `actor` query parameter switch to another member. There is no real authentication.

Other flows that work offline: `POST /demo/send-email` (a client email confirms 5 weeks and supersedes the final report figure), `POST /documents/{doc_id}/versions` (a new version of a library document supersedes what the previous version said on the same topic), `POST /mail/poll` on the mocked inbox in `data/seed/mail/`. Values are found by a deterministic rule first (a sentence that states a quantity on a known topic), so these flows need no model. Only when the rule finds nothing, a provider is configured and offline mode is off, the model reads the email or the new version; facts it extracts are filed outside the hand-curated topics. `PATCH /config {"offline_mode": true}` blocks every live model call.

## Language of generated text

Text the backend writes is in English by default and in Italian on request: the answer of `POST /ask`, `changed_because`, the `summary` of audit events and of `recent_changes` in `GET /stats`, the `detail` of maintenance items, the summaries of curated and automatically detected conflicts, curated open questions and error messages. The locale is the `locale` field of the ask request or the `locale` query parameter (`en` or `it`), else the `Accept-Language` header, else English. Responses with generated text say which locale they used.

Values and verbatim quotes of facts are never translated, they stay in the language of their source; only the sentence around them changes ("Giulia retired 4 weeks (final presentation)" becomes "Giulia ha ritirato 4 settimane (presentazione finale)"). Summaries that the model wrote during extraction and reasons typed by people are returned as they are.

Every generated sentence has a structured companion so a client can compose its own text: `changed_because_code` and `changed_because_params` on answers and replays, `summary_code` and `summary_params` on audit events, `detail_code` and `detail_params` on maintenance items. Parameters are language neutral (actor, fact id, value, source).

## Organisation, projects and sources

One organisation holds several projects. A request with `project_id` (query parameter, or body field on `POST /ask`) sees only that project: its documents, topics, facts, conflicts and audit events. Without it the request has organisation scope and sees everything. The seed has two projects, `proj-clearpath` (the 46 corpus documents, a document library, a mailbox) and `proj-internal` (an internal handbook and a GitHub source).

Sources of a project:

- `documents`: uploaded or ingested documents.
- `document_library` (provider `local_mock`): versioned documents seeded from `data/seed/library/` with a `manifest.json` (document id, version, `version_of`, `uploaded_at`). `POST /documents/{doc_id}/versions` stores a new version; facts of the previous version on the same topic get a SUPERSEDES link to the new fact and one audit event, which can be undone. A topic can name the topic it governs (`feeds` in `data/seed/topics.json`): the onboarding standard governs the onboarding time, so a new version of the standard is filed in that topic, replaces its binding fact when the value differs and makes the chain one row longer.
- When two sources state the same value (the client email and version 3 of the standard both say 5 weeks) there is no conflict: the fact with the later date is binding, on the same date the one that arrived last, and the answer says that the other one confirms it. This holds in both orders, email then version or version then email.
- `github`: a public repository, read with the unauthenticated GitHub REST API (README and issues become documents). Responses are cached in `api/.cache/github/` and reused when the rate limit is hit, when GitHub is unreachable and in offline mode.
- `mail`: `imap_mock` polls the seeded inbox in `data/seed/mail/` (`POST /mail/poll`), `webhook` receives `POST /mail/inbound`. Mail settings live on the organisation and are inherited by projects, a project can override them. Routing rules (`sender_domain`, `sender_address`, `recipient`, `subject_contains`) are evaluated by ascending priority, the first match decides the project; `sender_domain` compares the exact domain. An email that no rule matches is stored at organisation scope.

- `webhook`: a per-project inbound URL, `POST /hooks/projects/{project_id}`, authenticated with the secret of the source in `X-Canonico-Token`. The organisation has its own hook, `POST /hooks/org`, which routes an item by its `project_id`, else by the tag rules in ascending priority, else answers 422 with code `unroutable`. A secret is shown once, when the source is created or the secret is rotated; only its hash and its last four characters are stored.

Items (`meeting`, `document`, `note`, `ticket`) arrive through a hook or through `POST /projects/{project_id}/items` (JSON, or multipart with a `file` and a `metadata` JSON part; `.txt`, `.md` and `.pdf` are read, other formats get 415). An item is stored as a document and read like an email: the deterministic rule first, the model only when the rule finds nothing and offline mode is off. A tag `topic:<topic-id>` files the item under that topic. `version_of` turns it into a new version of a library document. `external_id` makes a delivery idempotent: the second one returns the first result with `duplicate: true`. A decision with a new value replaces the binding fact; a statement with the same value is stored as a confirmation, the binding fact stays and the answer names what confirms it. `file_url` is not fetched by the server, send the text or upload the file.

Tags of an item are copied to its document and its facts; `GET /facts`, `GET /documents` and `GET /search` accept `tag`, `GET /tags` counts them.

Demo-only secrets, fixed in `data/seed/org.json` so the demo can be scripted (never use them outside the demo, rotate to get random ones):

| hook | `X-Canonico-Token` |
| --- | --- |
| `POST /hooks/org` | `whsec_x7Kq2demo9f2a` |
| `POST /hooks/projects/proj-clearpath` | `whsec_clearpathdemo51c7` |

Demo item: a meeting "Steering committee 12 Nov" with text "We agreed the onboarding target stays at 3–4 weeks." and tags `clearpath`, `topic:onboarding-target`, sent to `/hooks/org`, is routed to `proj-clearpath` by the seeded tag rule `tr-001` and confirms M-106 without replacing it.

Fact ids tell where a fact came from: `M-1xx` and `M-2xx` curated demo facts, `M-1001` and above extracted from the corpus, `M-301` and above typed in by a person, taken from an item (hook or upload) or from an uploaded version of a plain document, `E-301` and above from email, `L-4xx` from the document library.

Members and roles are a demo layer without real authentication. `GET /roles` lists what each role may do. Writes check the role of the member named in the `X-Demo-Actor` header and return 403 when the permission is missing; a project role overrides the organisation role inside that project. Without the header the owner acts.

`GET /stats` also returns dashboard figures. `needs_attention.stale_active` counts facts that were superseded but are still active. `time_to_fix_seconds` is measured, not configured: for every retire or resolve of a fact, the seconds between the first answer that showed that fact as a conflict and the moment it was retired; `median` is null until there is a sample.

## License

MIT
