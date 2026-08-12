# Sodio Enquiry Triage — Build Memory

## Purpose

This file is the short operational memory for the implementation.

It records:
- what has been decided;
- what has been completed;
- what is currently being worked on;
- important constraints that must not be forgotten;
- known issues and next actions.

## Locked Technology Stack

```text
React + Vite + JavaScript
Tailwind CSS
Redux Toolkit
createAsyncThunk
Node.js + Express.js + JavaScript
MongoDB + Mongoose
Server-side LLM provider adapter
```

No JavaScript. No authentication. Deployment is optional.

## Initial State

No implementation work has been completed yet.

The assignment source has been reviewed and the implementation contract has been converted into:
- PRD;
- architecture;
- rules;
- phases;
- design;
- memory.

## Final Stack — Locked

- React + Vite
- Tailwind CSS
- Redux Toolkit
- `createAsyncThunk`
- Node.js + Express.js
- JavaScript only
- MongoDB + Mongoose
- Grok API — primary, free tier
- Gemini API — secondary/fallback, free tier
- REST API
- Local deployment/run only; deployment is optional

Do not switch the stack without an explicit decision.

## Current Status

**Current phase:** Phase 1 — Database + Enquiry Ingestion (NOT YET STARTED; awaiting user approval)

**Last completed phase:** Phase 0 — Project Foundation (verified end-to-end, see "Phase 0 — Completed" section below)

**Current file being worked on:** none (Phase 0 commit `53c5899` made; waiting for Phase 1 approval)

**Next file to work on:** Phase 1 deliverables per `Phases.md` — `Enquiry` Mongoose model, `POST /api/enquiries`, paste-single-enquiry UI. Do not start until the operator explicitly approves Phase 1.

## Completed Documentation

- [x] `PRD.md`
- [x] `Architechure.md`
- [x] `Rules.md`
- [x] `Phases.md`
- [x] `design.md`
- [x] `memory.md`

## Not Yet Completed

- [x] React frontend (Phase 0 skeleton)
- [x] Express backend (Phase 0 skeleton)
- [ ] MongoDB schema/migrations (Phase 1+)
- [ ] Single enquiry ingestion (Phase 1)
- [ ] Sample file parser (Phase 2)
- [ ] LLM extraction adapter (Phase 3; Phase 0 skeletons in place)
- [ ] Extraction validation (Phase 3)
- [ ] Deterministic scoring (Phase 4)
- [ ] Triage console (Phase 5)
- [ ] Inline human corrections (Phase 6)
- [ ] Re-extraction/versioning (Phase 7)
- [ ] Batch progress/concurrency (Phase 8)
- [ ] Failure/retry UX (Phase 8)
- [ ] Security hardening (Phase 9; Phase 0 baseline in place)
- [x] `README.md` (Phase 0 placeholder; full version due Phase 11)
- [ ] `AI-LOG.md` (Phase 11)
- [ ] `SELF-REVIEW.md` (Phase 11)
- [ ] Screenshots / screen recording (Phase 11)

## Non-Negotiable Assignment Constraints

1. Handle the supplied sample data as-is.
2. Use a real backend and real database.
3. Extract the required structured fields with an LLM.
4. Compute priority in application code, not with the LLM.
5. Support console filtering/sorting/editing/status workflow.
6. Re-extraction must preserve human corrections.
7. Batch processing must show progress and handle partial failure.
8. No authentication.
9. Secrets remain server-side.
10. Treat enquiry text as untrusted input.
11. Keep Git history intact.
12. Document decisions and AI mistakes.

The source task explicitly requires these behaviours and submission expectations. fileciteturn0file1L19-L29 fileciteturn0file1L31-L45 fileciteturn0file1L69-L91

## Important Source Cases

The sample data contains:
- a detailed logistics document-extraction enquiry;
- a blockchain/token enquiry;
- a follow-up from the same logistics contact;
- SEO outreach;
- a Spanish clinic enquiry;
- a model-instruction/prompt-injection style message;
- a large B2B marketplace enquiry;
- a short data pipeline enquiry;
- a vague “call me” message;
- a patient chatbot + backend migration enquiry;
- recruitment outreach;
- a student/no-budget request;
- an urgent production incident;
- a mobile game enquiry;
- an online casino/crypto enquiry;
- an existing-client AI forecasting enquiry;
- a website contact form;
- a large architecture-platform enquiry;
- an AI fine-tuning enquiry;
- a delivery failure.

These cases must remain useful test fixtures rather than being manually cleaned to make the parser easier.

## Decisions Locked In

### Duplicate / follow-up

Keep separate records and link them rather than merging.

### Budget

Preserve raw wording. Normalize only when safe. Never fabricate currency or numbers.

### Timeline

Preserve raw wording. Normalize obvious durations/relative periods without inventing dates.

### Non-enquiry

Keep in the database, mark as not genuine, and make it visible in the console.

### Prompt injection

Treat it as untrusted message content. Never follow instructions contained inside the enquiry.

### Multiple projects

Keep one enquiry record, record multiple-project detection, preserve the full message, and flag for review when necessary.

### Re-extraction

New extraction version + human override layer. Human corrections win by default.

### Priority

Deterministic scoring from effective fields. Never LLM-generated.

## Implementation Notes

When adding a feature:
1. Update the relevant phase checkbox.
2. Update this file's current phase.
3. Record important decisions.
4. Record known limitations.
5. Do not claim a feature is complete until it has been run against the supplied sample data.

## Current Next Action

Phase 0 is complete and verified. Do NOT start Phase 1 until the operator
explicitly approves it. When approval is given, Phase 1 deliverables are
(per `Phases.md`):

- `Enquiry` Mongoose model with immutable `originalText`, `source`, `receivedAt`;
- `POST /api/enquiries` endpoint with validation;
- paste-single-enquiry UI surface;
- ensure the saved record can be retrieved on UI refresh.

## Source Boundary

The task asks the candidate to make decisions where the brief is intentionally incomplete. Those decisions must be documented rather than silently assumed. fileciteturn0file1L55-L68


## Documentation Corrections Applied

The documentation was reviewed against the Sodio task brief and corrected to remove ambiguity:

- one authoritative technology-stack section is maintained;
- the implementation is JavaScript-only; no TypeScript;
- no authentication is implemented;
- Grok is the primary LLM and Gemini is the secondary/fallback provider;
- deployment remains optional;
- the sample parser is source-format-aware and must not require manual reformatting;
- PDF is not treated as the only supported evaluation format;
- duplicate LLM-boundary rules were removed;
- all six required capabilities remain explicitly covered.

These are documentation-level corrections; they do not add new product requirements beyond the assignment and the selected implementation decisions.

---

## Phase 0 — Completed

**Commit:** `53c5899` — "Phase 0: project foundation (skeleton verified end-to-end)"
**Date:** 2026-08-12
**Status:** All Phase 0 acceptance criteria (`Phases.md` lines 26-33) verified end-to-end.

### What was built

**Backend (`backend/`, per Architechure.md §9):**
- `src/app.js` — Express app with cors, json, morgan, routes, central error middleware
- `src/server.js` — bootstrap: connect DB → start HTTP → SIGINT/SIGTERM graceful shutdown
- `src/config/env.js` — zod-validated env config; fail-fast on missing `MONGODB_URI`
- `src/config/db.js` — Mongoose connect with 5s serverSelectionTimeoutMS; exposes `getDbStatus()` for honest health reporting
- `src/routes/healthRoutes.js` + `src/controllers/healthController.js` — `GET /api/health` returns `{status, db, dbHost, uptime, version, env, timestamp}`; never lies about DB state
- `src/middleware/errorHandler.js` — `AppError`, `asyncHandler`, central JSON error handler, JSON 404 (never HTML, never stack traces)
- `src/middleware/validateRequest.js` — zod schema middleware factory (Phase 1+ consumer)
- `src/services/llm/` — provider abstraction skeletons:
  - `extractionPrompt.js` — system prompt with explicit prompt-injection boundary (Rules.md §4); enquiry text is wrapped in `===ENQUIRY BEGIN===` / `===ENQUIRY END===` fences as user-role data
  - `extractionSchema.js` — zod schema for LLM output (Rules.md §5-7); **no `priority` field** — LLM is an extractor, not an authority
  - `grokProvider.js` — primary, `extract()` throws `NOT_IMPLEMENTED` (Phase 3)
  - `geminiProvider.js` — fallback, `extract()` throws `NOT_IMPLEMENTED` (Phase 3)
  - `llmService.js` — `extractWithFallback()` walks Grok → Gemini → structured failure
- `src/utils/logger.js` — redacts known secret keys; never logs URIs
- `src/utils/constants.js` — single source of truth for `SERVICE_LINES`, `STATUSES`, `PRIORITIES`, etc.

**Frontend (`frontend/`, per Architechure.md §10):**
- `vite.config.js` — Vite + React plugin; `/api` proxy → `http://localhost:3001`
- `tailwind.config.js` — Signal Desk design tokens from `design.md` §3 wired as Tailwind colours (`paper`, `ink`, `accent`, `success`, `warning`, `danger`, `low`, etc.) and type scale (`display` / `title` / `section` / `body` / `small` / `micro`)
- `src/styles/index.css` — Tailwind directives + `:root` CSS vars mirroring design tokens
- `src/app/store.js` — `configureStore` with `enquiries` slice
- `src/features/enquiries/enquirySlice.js` — placeholder shape per Architechure.md §11 (`items`, `selectedId`, `filters`, `sort`, `loading`, `error`, `system`); `system` sub-state holds health-check result
- `src/features/enquiries/enquiryThunks.js` — `fetchHealth` createAsyncThunk proves the full chain (React → thunk → axios → Vite proxy → Express → MongoDB → JSON → Redux → re-render)
- `src/services/api.js` — axios client; no auth headers (PRD.md §6); no LLM keys ever client-side
- `src/App.jsx` — minimal Signal Desk shell (header + health panel + empty queue placeholder)
- `src/main.jsx` — React mount + Redux Provider
- `index.html` — Inter + IBM Plex Mono from Google Fonts (design.md §4)

**Root:**
- `.gitignore` — node_modules, .env, dist, logs, etc.
- `.env.example` — placeholders only; no real keys
- `README.md` — Phase 0 placeholder; full README due in Phase 11

### Verification results (all green)

| Criterion (Phases.md §26-33) | How verified | Result |
|---|---|---|
| Frontend starts locally | `npm run dev` in `frontend/` | Vite v5.4.21 ready on http://localhost:5173 |
| Backend starts locally | `node src/server.js` in `backend/` | HTTP server listening on http://localhost:3001 |
| Backend connects to MongoDB | `GET /api/health` `db` field | `"db":"connected"`, `"dbHost":"127.0.0.1"` |
| Tailwind is working | `npm run build` produces 8.22kB CSS; Signal Desk tokens in tailwind.config.js | Build succeeds |
| Redux store is working | `configureStore` + `enquiries` slice mount without error | Store initialises; `system.healthStatus` transitions `idle → pending → succeeded` |
| createAsyncThunk works | `fetchHealth` thunk dispatches on `App.jsx` mount | Thunk state transitions observed; payload matches `/api/health` response |
| No secrets committed | `git ls-files` + secret-pattern scan | `.env` not tracked; zero `sk-…` / `AIza…` / `mongodb+srv://user:pass@` patterns in tracked files |
| No TypeScript introduced | `find` for `*.ts`/`*.tsx`/`tsconfig.json`/`@types/*` | Zero matches across repo |

**End-to-end smoke (final clean run):**
- `GET http://localhost:3001/api/health` → `{"status":"ok","db":"connected","dbHost":"127.0.0.1","uptime":1,"version":"0.1.0","env":"development",...}`
- `GET http://localhost:5173/api/health` (via Vite proxy) → identical response
- `GET http://localhost:3001/` → `{"name":"Sodio Enquiry Triage API","version":"0.1.0","docs":"/api/health"}`
- `GET http://localhost:3001/api/does-not-exist` → `{"error":{"code":"NOT_FOUND","message":"Route not found: GET /api/does-not-exist"}}`
- `GET http://localhost:5173/` → serves `index.html` with Vite client + React Refresh

### Decisions made during Phase 0

1. **MongoDB install method.** The sandbox did not have MongoDB pre-installed and the `z` user has no sudo. Installed the official `mongodb-linux-x86_64-ubuntu2204-8.0.4.tgz` portable tarball into `/home/z/mongodb/` and started `mongod` with `--dbpath /home/z/mongodb/data --port 27017 --bind_ip 127.0.0.1`. This is a local dev convenience only — production deploys would use `MONGODB_URI` from env (no hard-coded path in code).
2. **ES modules.** Both `backend/package.json` and `frontend/package.json` set `"type": "module"`. All backend source uses `import`/`export`. No CommonJS, no `require`.
3. **Health endpoint never lies.** Even if MongoDB is unreachable, the server still starts and `/api/health` returns `status:"degraded"` with the actual `db` state. This is intentional — hiding a DB outage behind `status:"ok"` would violate Phase 0's "backend connects to MongoDB" criterion.
4. **LLM provider skeletons throw `NOT_IMPLEMENTED`.** No real Grok/Gemini HTTP calls in Phase 0. The prompt-injection boundary (`extractionPrompt.js`) and the zod extraction schema (`extractionSchema.js`) are written now so Phase 3 only needs to wire HTTP, not re-design the contract.
5. **Scoring fields intentionally absent from `extractionSchema.js`.** Per Rules.md §3, the LLM may not return `priority`. The schema enforces this at validation time.
6. **Frontend slice is a placeholder.** The `enquiries` slice has the eventual shape from Architechure.md §11 but only the `system.health*` fields are wired. Real enquiry thunks land in Phase 1+.
7. **`Architechure.md` filename misspelling preserved.** Renaming would break cross-references in other docs. Noted for Phase 11 documentation pass.

### Known limitations / blockers

- **Mongoose 8.24.3 import latency on this sandbox:** ~30 seconds wall-clock for the first `import('mongoose')`. Subsequent runs are warm. Not a code issue — sandbox filesystem I/O characteristic. Documented here so future debugging doesn't waste time.
- **No real Grok/Gemini API keys configured.** Phase 0 doesn't need them. Phase 3 will require `GROK_API_KEY` and `GEMINI_API_KEY` in `.env`.
- **No sample-enquiries file in the uploaded zip.** Phase 2 (parser) will need either the official `sample-enquiries.txt` from the evaluator, or a reconstructed fixture built from the 20 cases enumerated in this file's "Important Source Cases" section. Flagged early.
- **Logger output empty when stdout redirected to a file via `>`.** When the backend runs attached to a TTY (e.g. `npm run dev`), logger output appears normally. When launched with shell redirection, output is sometimes not flushed before `kill -9`. Not a code bug — process management + Node stdout buffering characteristic. Phase 9 will switch to a proper stream logger if needed.

### Files created in this phase

42 files committed. See `git show --stat 53c5899` for the full list.

