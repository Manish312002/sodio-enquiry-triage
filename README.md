# Sodio Enquiry Triage

Internal enquiry triage workbench: ingest unstructured project enquiries,
extract structured data via LLM (Groq primary / Gemini fallback),
compute priority deterministically in application code, and give a human
operator a fast review console.

> **Status:** Phase 3 — LLM Extraction (Groq + Gemini via official SDKs).
> See `Docs/Phases.md` for the full roadmap and `Docs/memory.md` for current state.

## Stack

- **Frontend:** React + Vite + JavaScript, Tailwind CSS, Redux Toolkit + `createAsyncThunk`
- **Backend:** Node.js + Express.js + JavaScript
- **Database:** MongoDB + Mongoose
- **LLM:** Groq (primary, via `openai` SDK) / Gemini (fallback, via `@google/genai` SDK) — server-side only, behind a provider abstraction
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
- API keys are server-side only; React never calls Groq or Gemini directly.
- Phase 3 LLM extraction uses the official `openai` and `@google/genai` SDKs.
  Real API calls are made when `GROQ_API_KEY` / `GEMINI_API_KEY` are set;
  empty values mean "not configured" (the provider is skipped, not treated
  as a hard failure).
- Prompt-injection boundary: every enquiry is treated as untrusted data.
  The trusted system instruction is sent via the SDK's separate
  `instructions` (Groq) / `system_instruction` (Gemini) field, and the
  enquiry is wrapped in a `===ENQUIRY BEGIN/END===` data fence.
- Extraction schema is strict zod — injected fields like `priority` or
  `notes` are rejected (priority is computed by application code, not the LLM).
