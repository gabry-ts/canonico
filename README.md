# Canonico

Canonical memory for company brains. Decisions change over time: a target moves from 6 weeks to 3, then 7, then 4. A plain retrieval system answers with whatever document it finds. Canonico tells which decision is binding now, which ones are superseded, which are hypotheses and which questions are still open, always citing the source, and lets people correct or retire a fact by hand.

Built at the KVA hackathon "AI brain for industry" (Turin, 14 November 2026), track: Making memory visible to people.

## Team

Emanuele Beffa, Davide Chiattelli, Gabriele Partiti.

## Data

Evaluation uses the [OIDA Benchmark Corpora](https://github.com/kakashi-ventures/oida-benchmark-corpora) companion data of the paper "Retrieval Is Not Enough: Why Organizational AI Needs Epistemic Infrastructure" (Bottino, Ferrero, Dosio, Beneventano), licensed CC BY 4.0. No real personal data is used.

## Prior work

Before the event a team member built an exploratory prototype in a different domain (decision tables for regulated cases). It was declared to the organisers. No code from it is reused here: this repository starts on the event day.

## Setup

Copy `.env.example` to `.env` and fill in the values. Keys stay server-side.

## Repository layout

```
openapi.yaml   shared API contract
api/           backend, Python FastAPI (models generated from openapi.yaml)
web/           frontend, Vite + React + TypeScript + Tailwind
eval/          benchmark notes, plain retrieval vs Canonico
data/          evaluation corpora
prototypes/    static UI prototypes
```

## Run locally

```
make install   # python venv + npm install
make api       # backend on :8000
make web       # frontend on :5173
make mock      # Prism mock of openapi.yaml on :4010
make types     # regenerate api/app/models.py and web/src/api/schema.ts
```

The frontend talks to `VITE_API_URL` (see `web/.env.example`), by default the mock on `:4010`.

## License

MIT
