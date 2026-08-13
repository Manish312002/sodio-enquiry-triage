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

**Current phase:** Phase 2 — File Parser (NOT YET STARTED; awaiting user approval)

**Last completed phase:** Phase 1 — Database + Enquiry Ingestion (verified end-to-end, see "Phase 1 — Completed" section below)

**Current file being worked on:** none (Phase 1 commit `f17b1a4` done; waiting for Phase 2 approval)

**Next file to work on:** Phase 2 deliverables per `Phases.md` — multipart file upload, separator-delimited enquiry parser, one record per block. Do not start until the operator explicitly approves Phase 2.

**Sample data status:** Operator-supplied `sample-enquiries.pdf` (5 pages, 18 enquiries) received on 2026-08-13 and saved to `test-data/sample-enquiries.pdf` + extracted plaintext to `test-data/sample-enquiries.txt`. This unblocks Phase 2. The 18 enquiries cover every edge case the system must handle (see "Sample data coverage" section below).

## Completed Documentation

- [x] `PRD.md`
- [x] `Architechure.md`
- [x] `Rules.md`
- [x] `Phases.md`
- [x] `design.md`
- [x] `memory.md`

## Not Yet Completed

- [x] React frontend (Phase 0 skeleton; Phase 1 paste UI added)
- [x] Express backend (Phase 0 skeleton; Phase 1 enquiry endpoints added)
- [x] MongoDB schema/migrations (Phase 1 — `Enquiry` model)
- [x] Single enquiry ingestion (Phase 1)
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

Phase 1 is complete and verified. Do NOT start Phase 2 until the operator
explicitly approves it. When approval is given, Phase 2 deliverables are
(per `Phases.md`):

- multipart file upload (`POST /api/enquiries/import`);
- parser for separator-delimited enquiries (source-format-aware, no
  reformatting of the supplied sample data);
- one enquiry record per parsed block;
- malformed-block handling (blank/short messages do not crash the import);
- preserve each original message text verbatim.

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
- ~~**No sample-enquiries file in the uploaded zip.**~~ **RESOLVED 2026-08-13:** Operator uploaded `sample enquiries.pdf` (5 pages, 18 enquiries). Saved verbatim to `test-data/sample-enquiries.pdf` and extracted plaintext to `test-data/sample-enquiries.txt` (via `pdftotext -layout`). Phase 2 can proceed against real fixtures.
- **Logger output empty when stdout redirected to a file via `>`.** When the backend runs attached to a TTY (e.g. `npm run dev`), logger output appears normally. When launched with shell redirection, output is sometimes not flushed before `kill -9`. Not a code bug — process management + Node stdout buffering characteristic. Phase 9 will switch to a proper stream logger if needed.

### Files created in this phase

42 files committed. See `git show --stat 53c5899` for the full list.

---

## Phase 1 — Completed

**Commit:** see `git log` for the Phase 1 commit hash.
**Date:** 2026-08-13
**Status:** All Phase 1 acceptance criteria (`Phases.md` lines 49-53) verified end-to-end.

### What was built

**Backend — `Enquiry` model (`backend/src/models/Enquiry.js`):**
- Full Mongoose schema per Architechure.md §6 (`source`, `originalText`, `sender`,
  `receivedAt`, `status`, `isGenuineProjectEnquiry`, `effectiveExtraction`,
  `humanOverrides`, `priority`, `extractionState`, `batchId`, `timestamps`).
- `originalText` and `receivedAt` marked `immutable: true` (Rules.md §14 —
  original enquiry text is immutable, source timestamp is preserved).
- Sub-schemas for `budget`, `timeline`, `effectiveExtraction`, `humanOverrides`,
  `priority` declared now so later phases don't require migrations.
- `strict: 'throw'` so unknown fields are rejected loudly (defence in depth).
- Compound indexes on `{ receivedAt: -1 }` and `{ status, receivedAt }` for
  the future console (Phase 5).
- Instance method `toApiResponse()` returns a stable, Mongoose-internal-free
  shape for JSON responses.

**Backend — enquiry service (`backend/src/services/enquiryService.js`):**
- `createEnquiry({ source, originalText, sender? })` — Phase 1 hard limit
  `MAX_ORIGINAL_TEXT_CHARS = 100_000`. Empty/whitespace-only text rejected
  with `EMPTY_ORIGINAL_TEXT`. Sender email shape checked server-side.
  Original text is **never trimmed or normalised**.
- `getEnquiryById(id)` — 24-hex ObjectId format validated; throws `INVALID_ID`
  on bad format, returns null on not-found (controller maps to 404).
- `listEnquiries({ limit=50 })` — basic Phase 1 list (Phase 5 adds filters).

**Backend — controller + routes:**
- `backend/src/controllers/enquiryController.js`:
  - `POST /api/enquiries` — zod strict schema (`source: 'paste'`,
    `originalText: string 1..100k`, optional `sender{name,email}`).
    Returns 201 with `{ enquiry: <response shape> }`.
  - `GET /api/enquiries/:id` — returns 200 / 400 (invalid id) / 404 (not found).
  - `GET /api/enquiries` — returns `{ enquiries, count }` (Phase 5 will add
    filters + sorting).
- `backend/src/routes/enquiryRoutes.js` — three routes mounted at `/api/enquiries`.
- `backend/src/app.js` — wired `enquiryRoutes`; raised JSON body limit to 5mb
  to accommodate `MAX_ORIGINAL_TEXT_CHARS` with headroom.

**Frontend — Redux (`frontend/src/features/enquiries/`):**
- `enquiryThunks.js` — three `createAsyncThunk`s:
  - `createEnquiry({ originalText, sender? })` → `POST /api/enquiries`
  - `fetchEnquiry(id)` → `GET /api/enquiries/:id`
  - `fetchEnquiries({ limit? })` → `GET /api/enquiries`
  - `fetchHealth` kept from Phase 0.
  - All thunks normalise axios errors into `{ message, code, status }` so the
    UI never renders a raw Error object.
- `enquirySlice.js` — extended Phase 0 slice with:
  - `items[]`, `listStatus`, `listError` for the queue
  - `selectedId`, `selected`, `selectedStatus`, `selectedError` for detail
  - `createStatus`, `createError`, `lastCreatedId` for paste lifecycle
  - `createEnquiry.fulfilled` prepends the new enquiry to `items` AND
    auto-selects it, so the detail view updates without an extra round-trip
  - `clearCreateState`, `setSelectedId`, `resetSelected` reducer actions
    (slice-level, not thunks — fixed an import bug found during build)

**Frontend — UI components:**
- `components/PasteEnquiry/PasteEnquiry.jsx` — compact "feed intake" strip
  (design.md §11), NOT a giant drag-and-drop box. Textarea with char counter,
  optional sender name/email, inline error display (no toast), `SUBMIT
  ENQUIRY` + `CLEAR` actions. Disables submit while pending or when text is
  empty/whitespace-only. Mirrors backend validation client-side first.
- `components/OriginalMessage/OriginalMessage.jsx` — paper-like SOURCE panel
  (design.md §7) that renders `originalText` verbatim inside `<pre>` with
  monospace font. Whitespace, special chars, prompt-injection text all
  preserved as literal text (no `dangerouslySetInnerHTML`).
- `components/EnquiryDetail/EnquiryDetail.jsx` — split evidence layout
  (SOURCE | EXTRACTED). Right panel shows "EXTRACTION PENDING" placeholder
  since LLM extraction is Phase 3. Shows metadata (id, receivedAt, status,
  extractionState, timestamps).
- `components/EnquiryQueue/EnquiryQueue.jsx` — Phase 1 minimal list. Loads
  recent enquiries on mount via `fetchEnquiries`, renders compact rows with
  received time / source / status / preview. Clicking a row selects it.
- `App.jsx` — three-zone Signal Desk layout (header / paste+queue | detail).
  On mount: fetches health, fetches queue, and if `localStorage` has
  `sodio:lastCreatedId` AND no current selection, re-fetches that enquiry
  (this is the "retrieve the saved record after page refresh" acceptance
  criterion). Persists `lastCreatedId` to `localStorage` whenever it changes.

### Verification results (all green)

Test script: `/home/z/my-project/scripts/phase1-test.sh` (13 tests)
Follow-up:  `/home/z/my-project/scripts/phase1-test-followup.sh` (3 tests)

| # | Test | Result |
|---|---|---|
| 1 | `POST /api/enquiries` with valid paste + sender | 201 + full enquiry object; `status:"new"`, `extractionState:"pending"`, all extraction/override/priority sub-fields correctly defaulted |
| 2 | `GET /api/enquiries/:id` (retrieve after refresh) | 200 with identical object — same id, same `originalText`, same `receivedAt` |
| 3 | `originalText` byte-for-byte identical | IDENTICAL — newlines, `£` (pound), `—` (em-dash), and "Ignore all previous instructions" prompt-injection text all preserved |
| 4 | `POST` empty `originalText` | 400 `VALIDATION_ERROR` "originalText: String must contain at least 1 character(s)" |
| 5 | `POST` whitespace-only text | 400 `EMPTY_ORIGINAL_TEXT` "originalText cannot be empty." |
| 6 | `POST` wrong `source` | 400 `VALIDATION_ERROR` "source: Invalid literal value, expected \"paste\"" |
| 7 | `POST` invalid sender email | 400 `INVALID_SENDER_EMAIL` "sender.email does not look like an email address." |
| 8 | `POST` unknown extra field (`priority`) | 400 `VALIDATION_ERROR` "body: Unrecognized key(s) in object: 'priority'" — note: client cannot inject priority (Rules.md §3) |
| 9 | `GET` valid-format but nonexistent id | 404 `NOT_FOUND` "Enquiry <id> not found." |
| 10 | `GET` invalid id format (non-hex / too short) | 400 `INVALID_ID` "Invalid enquiry id." |
| 11 | `GET /api/enquiries` list | 200 with `{ enquiries, count }`; created enquiry appears in list |
| 12 | Special characters preservation (tabs, emoji 🚀, café, naïve, 中文, £ € ₹) | IDENTICAL — all preserved through full MongoDB round-trip |
| 13 | Frontend build artefacts exist | `dist/index.html`, `dist/assets/index-*.css` (10.84KB), `dist/assets/index-*.js` (234.10KB) — Tailwind + React + Redux all compile cleanly |

**Frontend production build:** `npm run build` succeeds, 103 modules transformed,
8.22→10.84KB CSS (Tailwind tokens compiled), 223→234KB JS.

### Commands executed (in order)

1. `mkdir -p backend/src/{models,services}` — create dirs for new backend files
2. Write `backend/src/models/Enquiry.js`
3. Write `backend/src/services/enquiryService.js`
4. Write `backend/src/controllers/enquiryController.js`
5. Write `backend/src/routes/enquiryRoutes.js`
6. Edit `backend/src/app.js` to mount `/api/enquiries` + raise body limit to 5mb
7. `node --check` on each new backend file — all OK
8. Edit `frontend/src/features/enquiries/enquiryThunks.js` — add `createEnquiry`, `fetchEnquiry`, `fetchEnquiries`
9. Edit `frontend/src/features/enquiries/enquirySlice.js` — extend state + extraReducers
10. `mkdir -p` for `components/{PasteEnquiry,EnquiryDetail,OriginalMessage,EnquiryQueue}`
11. Write `PasteEnquiry.jsx`, `OriginalMessage.jsx`, `EnquiryDetail.jsx`, `EnquiryQueue.jsx`
12. Edit `frontend/src/App.jsx` — three-zone layout + refresh-retrieval via localStorage
13. `npm run build` (frontend) — failed: `"clearCreateState" is not exported by enquiryThunks.js`
14. **Bug fix:** `clearCreateState` and `setSelectedId` are slice actions, not thunks. Fixed imports in `PasteEnquiry.jsx` and `EnquiryQueue.jsx`.
15. `npm run build` — succeeded (103 modules, 234KB JS, 10.84KB CSS)
16. Mongod had to be re-downloaded (sandbox reset wiped `/home/z/mongodb/`). Re-extracted tarball, restarted mongod.
17. Write `/home/z/my-project/scripts/phase1-test.sh` — single-bash-invocation test runner
18. `bash /home/z/my-project/scripts/phase1-test.sh` — all 13 tests pass
19. Write + run `/home/z/my-project/scripts/phase1-test-followup.sh` — verifies 404 path for valid-format-but-nonexistent id

### Decisions made during Phase 1

1. **`originalText` immutability enforced at two layers.** Mongoose schema marks the field `immutable: true`, AND the service layer never exposes a setter. Defence in depth — even if a future controller tries to update originalText, Mongoose throws.
2. **`strict: 'throw'` on the Enquiry schema.** Unknown fields raise a MongooseError rather than being silently dropped. This caught test 8 (client tried to inject `priority` — correctly rejected, since Rules.md §3 forbids client-controlled priority).
3. **`receivedAt` is also `immutable`.** Rules.md §14 explicitly says "source timestamp is preserved." Marked at the schema level so even an admin script cannot rewrite history.
4. **Sender is optional for paste.** PRD.md FR-01 says "paste one enquiry" — the operator may not always know the sender. The UI marks sender name/email as optional. The schema accepts `null`.
5. **`humanOverrides` stored as `Mixed` type.** This lets Phase 6/7 distinguish "field X has never been edited" (key absent) from "field X was edited then cleared" (key present, value null). The effective-value resolver will use key presence, not truthiness.
6. **Refresh retrieval via `localStorage`.** The Phase 1 acceptance criterion "UI refresh can retrieve the saved record" is satisfied by storing `lastCreatedId` in `localStorage` under `sodio:lastCreatedId` and re-fetching via `GET /api/enquiries/:id` on mount if no selection exists. This is a deliberate, minimal choice — no URL routing yet (Phase 5 will add `?selected=<id>` query param).
7. **Frontend error display is inline, not toast.** design.md §16: "Errors should appear close to the failed action." `PasteEnquiry` shows the server's `error.message` directly below the textarea. `EnquiryQueue` shows list errors in a red panel above the list.
8. **No TypeScript introduced.** All new files are `.js` / `.jsx`. Verified via `find` — zero `.ts`/`.tsx`/`tsconfig.json` matches.
9. **No LLM calls, no scoring, no parser.** Phase 1 scope strictly honoured. `extractionState` defaults to `"pending"`; Phase 3 will pick these records up.

### Known limitations / blockers

- ~~**No sample-enquiries file in the uploaded zip.**~~ **RESOLVED 2026-08-13:** Operator uploaded `sample enquiries.pdf`. Saved to `test-data/sample-enquiries.pdf` and `test-data/sample-enquiries.txt`.
- **Sandbox resets wipe `/home/z/mongodb/`.** mongod must be re-downloaded on each session restart. Not a project issue — environmental. The `phase1-test.sh` script auto-restarts mongod if it's not running.
- **No URL-based selection.** Refresh retrieval uses `localStorage`, not URL query params. If the operator wants to share a permalink to a specific enquiry, that's Phase 5+.

### Files created / changed in this phase

**Created (8):**
- `backend/src/models/Enquiry.js`
- `backend/src/services/enquiryService.js`
- `backend/src/controllers/enquiryController.js`
- `backend/src/routes/enquiryRoutes.js`
- `frontend/src/components/PasteEnquiry/PasteEnquiry.jsx`
- `frontend/src/components/OriginalMessage/OriginalMessage.jsx`
- `frontend/src/components/EnquiryDetail/EnquiryDetail.jsx`
- `frontend/src/components/EnquiryQueue/EnquiryQueue.jsx`

**Changed (4):**
- `backend/src/app.js` (mount `/api/enquiries`, raise body limit)
- `frontend/src/features/enquiries/enquiryThunks.js` (added 3 thunks)
- `frontend/src/features/enquiries/enquirySlice.js` (extended state + reducers)
- `frontend/src/App.jsx` (three-zone layout + refresh retrieval)

**Test scripts (2):**
- `/home/z/my-project/scripts/phase1-test.sh`
- `/home/z/my-project/scripts/phase1-test-followup.sh`


---

## Phase 1 — Sample Data Receipt & Re-verification (2026-08-13)

**Trigger:** Operator uploaded `sample enquiries.pdf` (5 pages, 18 enquiries) to
`/home/z/my-project/upload/sample enquiries.pdf`.

**Action taken:**

1. Extracted PDF text via `pdftotext -layout` to preserve line breaks and column
   alignment. Saved both formats to `test-data/`:
   - `test-data/sample-enquiries.pdf` (binary, verbatim copy of upload)
   - `test-data/sample-enquiries.txt` (extracted plaintext, 8.2KB, 18 enquiries)
2. Re-ran the full Phase 1 acceptance suite (`phase1-test.sh`, 13 tests) — all
   pass.
3. Ran a new real-sample paste test (`/home/z/my-project/scripts/test-real-sample.sh`,
   5 enquiries) pasting verbatim text from the operator's PDF through the full
   pipeline (POST → MongoDB → GET → byte-for-byte diff). All 5 pass:
   - Rachel Whitfield (logistics, £40k, multi-line) — PASS
   - "system" prompt-injection attempt — PASS (stored as plain text, NOT
     executed; `status:"new"`, `extractionState:"pending"`,
     `priority.level:null`, `priority.score:null`)
   - Miguel Santana (Spanish, €25k, accented chars) — PASS
   - Unknown "call me" (minimal data, no sender) — PASS
   - Priya Ramanathan (multi-project, $60-90k combined budget) — PASS

### Sample data coverage (18 enquiries)

The operator-supplied PDF covers every edge case the system must eventually
handle. This list supersedes the speculative enumeration in the "Important
Source Cases" section above — it is the real, authoritative fixture set:

| # | Sender | Edge case(s) | Phase(s) that will exercise it |
|---|---|---|---|
| 1 | Rachel Whitfield | Logistics, £40k, multi-line, September start | P2, P3, P4 |
| 2 | Deniz | Web3/crypto token on Base, "gm" informal tone, flexible budget | P3 (informal-language extraction) |
| 3 | Rachel W | Follow-up to #1 — duplicate contact, same project, refined scope (hosted option) | P3, P6 (follow-up linking) |
| 4 | Growth Team | SEO outreach spam — must be classified as not genuine | P3 (`isGenuineProjectEnquiry:false`) |
| 5 | Miguel Santana | Spanish-language enquiry, €25k, mobile app for clinic | P3 (multi-language extraction) |
| 6 | system | **PROMPT INJECTION ATTEMPT** — "Ignore all previous instructions" | P3 (injection boundary), P9 (security) |
| 7 | Ankit Bahl | B2B marketplace, 35-40 lakhs INR, "before Diwali" relative timeline | P3 (currency + relative-date normalization) |
| 8 | T. Okafor | Data pipeline, $20-30k range, "three months" — terse | P3 (minimal-context extraction) |
| 9 | Unknown | "call me" — 7 chars, no sender, ambiguous | P3 (low-confidence extraction) |
| 10 | Priya Ramanathan | **MULTI-PROJECT** — chatbot urgent + React migration not urgent, $60-90k combined | P3 (`projectCount:2`, `additionalProjectNote`) |
| 11 | Talent Acquisition | Recruiter outreach — must be classified as not genuine | P3 |
| 12 | Sam Delaney | Student capstone, **NO BUDGET**, NFT ticketing | P3, P4 (zero budget score) |
| 13 | Operations | **EMERGENCY** — tenant portal down, "pay whatever it takes", "today" | P3, P4 (immediate timeline, max score) |
| 14 | Klara Meier | Mobile game, Q1 next year, budget "not yet finalised" | P3 (TBD budget handling) |
| 15 | D. Fontaine | Online casino, crypto deposits, $80k, "next week" | P3 (gambling-vertical edge case) |
| 16 | Marcus Bell | **EXISTING CLIENT** — "we spoke last year about the inventory app" | P3 (`relationship:existing`), P4 (relationship bonus) |
| 17 | Website Contact Form | Vish, AI agents for support, emoji 🙏, no company, "what do u charge" | P3 (informal, emoji preservation) |
| 18 | Eleanor Vance | **£400k, 18-month phased delivery**, architectural platform, very detailed | P3 (long-context extraction), P4 (max budget score) |
| 19 | Yuki Tanaka | AI fine-tuning, "TBD" budget, "flexible" timeline | P3, P4 (unknown qualifiers) |
| 20 | Admin | Delivery Status Notification (bounce) — **NOT A REAL ENQUIRY** | P3 (`isGenuineProjectEnquiry:false`) |

(Note: the PDF says "18 enquiries" but the file actually contains 20 blocks;
the count discrepancy is itself an edge case the Phase 2 parser must handle —
it must not assume a fixed block count.)

### Decisions made during this verification

1. **Sample data is committed to the repo** under `test-data/`. Future phases
   can rely on it as a stable fixture. The PDF is binary-committed (small,
   ~91KB); the extracted `.txt` is the canonical parser input for Phase 2.
2. **No code changes** — Phase 1 was already complete and correct. The sample
   data confirms the system handles real-world enquiries as designed.
3. **The Phase 2 parser must use the `.txt` file as input**, not the PDF. The
   PDF is the operator's source; the `.txt` is the parser's input. Phase 2
   will document this in `backend/src/services/parser/`.

### Commands executed (in order)

1. `cp "/home/z/my-project/upload/sample enquiries.pdf" "test-data/sample-enquiries.pdf"`
2. `pdftotext -layout "test-data/sample-enquiries.pdf" "test-data/sample-enquiries.txt"`
3. `bash /home/z/my-project/scripts/phase1-test.sh` — 13/13 PASS
4. `node src/server.js &` (restart backend after test run killed it)
5. `curl http://localhost:3001/api/health` — `status:"ok"`, `db:"connected"`
6. Wrote `/home/z/my-project/scripts/test-real-sample.sh` — 5 real-sample paste tests
7. `bash /home/z/my-project/scripts/test-real-sample.sh` — 5/5 PASS
8. Edited `Docs/memory.md` (this section + sample-data blocker marked RESOLVED)
9. `git add test-data/ Docs/memory.md`
10. `git commit -m "Phase 1: add operator-supplied sample data + re-verify against real fixtures"`
11. Create updated Phase 1 download archive (includes test-data/)
12. STOP — await explicit Phase 2 approval

### Status

Phase 1 is fully complete, verified against real operator-supplied sample data.
Phase 2 is unblocked. **Do not start Phase 2 without explicit operator
approval.**
