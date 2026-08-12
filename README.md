# Sodio Enquiry Triage

Internal enquiry triage workbench: ingest unstructured project enquiries,
extract structured data via LLM (Grok primary / Gemini fallback),
compute priority deterministically in application code, and give a human
operator a fast review console.

> **Status:** Phase 0 — Project Foundation (skeleton only).
> See `Docs/Phases.md` for the full roadmap and `Docs/memory.md` for current state.

## Stack

- **Frontend:** React + Vite + JavaScript, Tailwind CSS, Redux Toolkit + `createAsyncThunk`
- **Backend:** Node.js + Express.js + JavaScript
- **Database:** MongoDB + Mongoose
- **LLM:** Grok (primary) / Gemini (fallback) — server-side only, behind an adapter
- **Language:** JavaScript only — no TypeScript

## Project layout

```
.
├── Docs/                  # Source-of-truth documentation (do not modify without approval)
├── backend/               # Express API + Mongoose + LLM adapters
├── frontend/              # Vite + React + Redux Toolkit
├── .env.example           # Environment variable template (no secrets)
└── .gitignore
```

## Quick start (Phase 0)

> Requires Node.js ≥ 18 and a reachable MongoDB instance.

### 1. Backend

```bash
cd backend
cp ../.env.example ../.env       # then edit MONGODB_URI if needed
npm install
npm run dev                      # http://localhost:3001
```

Health check:

```bash
curl http://localhost:3001/api/health
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

The Vite dev server proxies `/api` → `http://localhost:3001`.

## Documentation

- `Docs/PRD.md` — product requirements
- `Docs/Architechure.md` — architecture & folder structure
- `Docs/Rules.md` — implementation rules, scoring, prompt-injection boundary
- `Docs/Phases.md` — phased delivery plan
- `Docs/design.md` — "Signal Desk" UI/UX design system
- `Docs/memory.md` — operational build memory (current phase, decisions, blockers)

## Security notes

- `.env` is git-ignored — never commit secrets.
- API keys are server-side only; React never calls Grok or Gemini directly.
- The LLM provider adapters in Phase 0 are skeletons — no real API calls are made.
