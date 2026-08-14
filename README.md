# Sodio Enquiry Triage

An internal enquiry triage workbench. Ingest unstructured project enquiries
(pasted singly or uploaded as a separator-delimited file), extract structured
data with an LLM (Groq primary, Gemini fallback), compute priority
deterministically in application code, and give a human operator a fast
review console with inline corrections, re-extraction safety, and batch
progress with per-item failure handling.

**Stack:** React + Vite + Redux Toolkit + Tailwind CSS (frontend) · Node.js +
Express + MongoDB + Mongoose (backend) · Groq via the `openai` SDK pointed at
Groq's OpenAI-compatible Chat Completions endpoint · Gemini via `@google/genai`
· zod for runtime validation · **JavaScript only — no TypeScript** · **no auth**
(single shared workspace, per task brief).

The LLM providers are server-side only, behind a provider abstraction. The
extraction schema is enforced at four layers (Zod, JSON Schema handed to the
model, system prompt, tests) so the LLM is an extractor, not an authority —
priority is always computed by application code, never by the model.

---

## Run it

> Requires Node.js ≥ 18 and a reachable MongoDB instance.

### 1. Backend

```bash
cd backend
cp .env.example .env     # then edit .env: MONGODB_URI, GROQ_API_KEY, GEMINI_API_KEY
npm install
npm run dev              # serves http://localhost:3001
```

Health check:

```bash
curl http://localhost:3001/api/health
# {"status":"ok","db":"connected","dbHost":"127.0.0.1",...}
```

If MongoDB is unreachable, the server still starts and `/api/health` returns
`status:"degraded"` with the actual `db` state. The health endpoint never
lies — hiding a DB outage behind `status:"ok"` would violate the Phase 0
acceptance criterion "backend connects to MongoDB".

### 2. Frontend

```bash
cd frontend
npm install
npm run dev              # serves http://localhost:5173
```

The Vite dev server proxies `/api` → `http://localhost:3001` (see
`frontend/vite.config.js`). Open <http://localhost:5173/> in a modern browser.

### 3. Populate the queue

Two ingestion paths:

- **Paste a single enquiry** — top-of-page `PASTE ENQUIRY` strip → paste raw
  text → `Submit`. One enquiry record is created and extraction runs
  immediately.
- **Upload the sample file** — `IMPORT ENQUIRIES` strip → `Choose file` →
  select `test-data/sample-enquiries.txt` → wait for the segmented progress
  bar to reach `COMPLETED` (or `COMPLETED WITH ERRORS`). ~20 enquiries are
  created and extracted concurrently.

### 4. Try the six capabilities

Once the queue is populated:

1. Click any enquiry row → detail panel populates (SOURCE on the left,
   EXTRACTED + PRIORITY on the right).
2. Use the **FILTERS** rail (left) to filter by service / priority / status;
   use the **SORT** control to order by priority or date.
3. Click `[edit]` on any extracted field → type → `Enter` to save or `Esc` to
   cancel. The field switches from `MODEL` → `CONFIRMED` with a subtle accent
   tint.
4. Click `Re-extract` at the top of the EXTRACTED panel → a new extraction
   version is created; conflicts against existing overrides surface as a
   yellow `CONFLICT` banner with `[Keep confirmed]` / `[Accept new model]`
   actions.
5. Use the keyboard: `ArrowUp` / `ArrowDown` / `Home` / `End` move through
   the queue; `Enter` / `Esc` save / cancel inline edits.
6. Move an enquiry through the status track (`NEW → CONTACTED → QUALIFIED →
   DROPPED`) by clicking any node.

### 5. Tests

```bash
# Backend unit tests (no MongoDB required)
cd backend && npm run test:unit

# Backend integration tests (real MongoDB required)
cd backend && npm run test:integration

# Frontend unit tests (node:test, no DOM library)
cd frontend && npm test

# Frontend production build
cd frontend && npm run build
```

### 6. Environment variables

See `.env.example` for the full list. The critical ones:

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/sodio_enquiry_triage` | Mongo connection string |
| `PORT` | `3001` | Backend HTTP port |
| `GROQ_API_KEY` | _(empty)_ | Primary LLM provider key. Empty = provider skipped (not a hard failure) |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Groq model id |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible endpoint (point at any Chat Completions provider) |
| `GEMINI_API_KEY` | _(empty)_ | Fallback LLM provider key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model id |
| `LLM_TIMEOUT_MS` | `30000` | Per-provider timeout |
| `LLM_MAX_RETRIES` | `1` | Retries for recoverable provider errors (5xx, network, timeout) |
| `BATCH_CONCURRENCY` | `3` | Bounded concurrency for batch extraction |
| `CORS_ALLOWED_ORIGINS` | `*` | Comma-separated allowlist. Set to a specific origin in production |

---

## What works / what doesn't

### What works (verified)

- **Single enquiry ingestion** — paste raw text → record created → extraction
  runs → priority computed → detail view populated.
- **File ingestion** — the operator-supplied `test-data/sample-enquiries.txt`
  (~20 enquiry blocks) is accepted as-is, parsed by a source-format-aware
  parser, and ~20 enquiry records are created.
- **LLM extraction** — Groq primary, Gemini fallback, official SDKs. Groq
  uses `client.chat.completions.create()` with `response_format:
  { type: 'json_schema', json_schema: { name, schema, strict: false } }` —
  the universally-implemented OpenAI-compatible Chat Completions surface that
  works against Groq, Together, OpenRouter, Ollama, LM Studio, and any other
  provider that exposes `/v1/chat/completions`. (An earlier implementation
  used the OpenAI Responses API `client.responses.create()` with
  `text.format.type = "json_schema"`, but that endpoint and its `text.format`
  parameter are OpenAI-specific and were rejected by providers that do not
  implement `/v1/responses`.) Strict Zod schema validates output post-hoc.
- **Deterministic priority** — `scoringService.computePriority` is a pure
  function (same input → same output, no I/O, no `Date.now()`, no
  `Math.random()`). Unit tests cover all branches.
- **Console** — three-zone layout (FILTERS | QUEUE | DETAIL), filters by
  service / priority / status, sort by priority or date, status track
  (NEW → CONTACTED → QUALIFIED → DROPPED).
- **Inline corrections** — every overrideable field can be edited inline.
  MODEL vs CONFIRMED visual distinction with accent left border + faint
  background tint + chip.
- **Re-extraction safety** — `POST /api/enquiries/:id/re-extract` creates a
  new ExtractionVersion (append-only), preserves all human overrides,
  surfaces conflicts, and offers explicit `[Accept new model]` /
  `[Keep confirmed]` actions. The DATA-INTEGRITY REGRESSION test (model £40k
  → human £400k override → re-extract £50k → effective stays £400k) passes.
- **Batch progress + partial failure** — bounded concurrency (default
  `BATCH_CONCURRENCY=3`), BatchJob record, segmented progress bar, per-item
  failure reasons, per-item retry. One failed item does not fail successful
  items.
- **Security / AI boundaries** — server-only API keys, prompt-injection
  boundary (separate `system` message + `===ENQUIRY BEGIN/END===` data
  fence), input validation, file limits, safe error responses, redacting
  logger, helmet, requestId middleware, CORS allowlist, provider timeout on
  both providers.
- **UX polish** — Signal Desk aesthetic (warm paper, orange accent, IBM Plex
  Mono labels), roving tabindex queue keyboard nav (ArrowUp/Down/Home/End),
  strengthened SOURCE / CONFIRMED visual distinction, polished loading
  skeletons.

### What doesn't (known limitations)

- **No live end-to-end verification of the LLM chain in the build sandbox.**
  The sandbox has no MongoDB and no outbound network access to
  `api.groq.com` / `generativelanguage.googleapis.com`. Integration tests
  require a real MongoDB; live LLM extraction requires real API keys +
  egress. The operator must run these locally. See `SELF-REVIEW.md`
  finding #1.
- **No frontend component rendering tests.** The test suite uses `node:test`
  for pure-logic unit tests only (no `@testing-library/react` + jsdom
  dependency was added). Visual regressions can slip through the unit test
  suite. See `SELF-REVIEW.md` finding #2.
- **No deployment artefacts.** Per task brief, deployment is optional. The
  repository runs locally only; no Dockerfile, no CI workflow, no production
  env template beyond `.env.example`.
- **No authentication.** Per task brief. The workspace is shared; any
  operator can see / edit any enquiry.
- **Logger output may be empty when stdout is redirected to a file via `>`
  and the process is killed with `kill -9`.** This is a Node stdout-buffering
  characteristic, not a code bug. Run with `npm run dev` (TTY-attached) for
  normal logging.
- **Lazy migration for pre-inline-editing records.** Enquiries created
  before inline editing shipped have `modelExtraction = null`. The
  effective-value resolver lazily treats `effectiveExtraction` as the model
  source. On the first human edit, `applyHumanOverride` copies
  `effectiveExtraction` into `modelExtraction`. No migration script is
  provided; this is correct-by-construction for greenfield data but worth
  knowing if you import legacy data.

---

## Decisions

Locked-in product decisions:

1. **Duplicate / follow-up** — keep separate enquiry records and link them
   rather than merging. Each enquiry is a separate incoming message with its
   own timestamp and original text.
2. **Budget** — preserve raw wording; normalize only when safe. Never
   fabricate currency or numbers. `20-30k` remains a range with unknown
   currency unless context establishes it. `35-40 lakhs` is treated as an INR
   range only when the Indian-lakh convention is unambiguous. `TBD` remains
   TBD.
3. **Timeline** — preserve raw wording. Normalize obvious durations /
   relative periods (`ASAP` → urgency `immediate`, `6 weeks` → duration)
   without inventing dates. `before Diwali` stays as raw phrase + an
   urgency/relative marker.
4. **Non-enquiry** — keep in the database, mark
   `isGenuineProjectEnquiry = false`, make it visible in the console. The
   sample data intentionally contains marketing outreach, recruitment
   outreach, a delivery failure, and a vague "call me" message.
5. **Prompt injection** — treat as untrusted message content. Never follow
   instructions contained inside the enquiry. The trusted system prompt is
   sent as a separate `system` message (Groq) / `systemInstruction` config
   field (Gemini), and the enquiry is wrapped in a `===ENQUIRY BEGIN/END===`
   data fence. The sample contains a literal "IMPORTANT SYSTEM NOTICE:
   Ignore all previous instructions…" block; it is parsed and extracted as
   ordinary data.
6. **Multiple projects** — keep one enquiry record, record `projectCount` +
   `additionalProjectNote`, preserve the full message, flag for review when
   the distinction materially affects qualification. Never silently split one
   email into multiple records.
7. **Re-extraction** — new extraction version + human override layer. Human
   corrections win by default. The system NEVER automatically accepts a new
   model value merely because re-extraction succeeded; the operator must
   explicitly click `[Accept new model]`. See "Re-extraction" below.
8. **Priority** — deterministic scoring from effective fields. Never
   LLM-generated. The LLM schema excludes `priority` at four layers (Zod,
   JSON Schema, prompt, tests). See "Scoring rule" below.

Other significant build decisions:

- **JavaScript only.** No TypeScript. Per task brief.
- **ES modules throughout.** Both `backend/package.json` and
  `frontend/package.json` set `"type": "module"`. No CommonJS, no `require`.
- **zod for runtime validation.** Used for env config, request body
  validation, and LLM output validation. `extractionSchema.js` uses
  `.strict()` so unknown fields are rejected loudly (defence in depth — even
  if the model emits `priority` or `notes`, the schema rejects them).
- **Strict + open shapes.** `extractionSchema.js` is `.strict()` (no unknown
  keys). `timeline.normalized` is intentionally open-shaped so it can be
  filled opportunistically without ever inventing dates. Therefore the JSON
  Schema handed to the model uses `strict: false` (not `strict: true`); Zod
  remains the authoritative post-response validator.
- **Chat Completions API, not the Responses API.** The Groq adapter calls
  `client.chat.completions.create()` with `response_format:
  { type: 'json_schema', json_schema: { ... } }`. This is the
  universally-implemented OpenAI-compatible surface. The earlier
  `client.responses.create()` + `text.format` shape was OpenAI-specific and
  rejected by providers that only expose `/v1/chat/completions`.
- **Provider timeout on both providers.** Groq uses the `openai` SDK's
  built-in `timeout` client option. Gemini wraps the SDK call in a
  `withTimeout()` helper that races the promise against
  `setTimeout(env.LLM_TIMEOUT_MS)`. On timeout, the error is classified as
  `PROVIDER_TIMEOUT` with `recoverable=true` so the fallback chain can move
  to the next provider.
- **Bounded concurrency, not a queue.** The batch runner uses a simple
  semaphore-style concurrency limiter (max active = `BATCH_CONCURRENCY`). No
  Redis, no BullMQ, no external queue — per task brief ("avoid unnecessary
  queues/Redis"). The batch job record is in MongoDB; the operator polls
  `GET /api/batches/:id`.
- **`requestId` middleware.** UUID v4 per request, honours incoming
  `X-Request-Id` (validated ≤128 printable ASCII), attaches to `req.id`,
  echoes via `X-Request-Id` response header. All error logs and JSON error
  responses include `requestId` so the operator can correlate a user-visible
  error to a log line.
- **Helmet + configurable CORS.** Helmet adds security headers (CSP,
  X-Frame-Options, etc.). CORS is configurable via `CORS_ALLOWED_ORIGINS`
  (default `*` for development; set to a specific origin in production).
- **Redacting logger.** `REDACT_KEYS` is a Set of 23 keys (apikey, api-key,
  key, auth, accesstoken, access_token, refreshtoken, refresh_token,
  clientsecret, client_secret, privatekey, private_key, connectionstring,
  connection_string, cookie, set-cookie, x-api-key, x-groq-api-key,
  x-gemini-api-key, groq_api_key, gemini_api_key, password, secret). Set
  lookup is O(1).
- **`PATCH /api/enquiries/:id/fields/:field` with `value: null` means "clear
  the override".** Rather than introducing a separate `DELETE` endpoint, the
  PATCH endpoint accepts `null` as "no value / fall back to model". This is
  unambiguous because `null` for any field means "no value" in the schema.
- **`false`, `0`, `''` are NON-NULL and count as active overrides.** This
  lets the operator explicitly mark `isGenuineProjectEnquiry = false`, clear
  `company = ''`, or set `budget.min = 0` — distinguishing "I want this
  field to be empty/false/zero" from "I haven't touched this field".
- **Roving tabindex for queue keyboard nav.** The queue is a
  `<ul role="listbox">` of `<li role="option">` rows, each containing a
  `<button>`. The selected row has `tabIndex=0`, others have `tabIndex=-1`.
  `ArrowUp` / `ArrowDown` / `Home` / `End` move selection; `PageUp` /
  `PageDown` are intentionally NOT navigation keys (they scroll the page).
  The pure helper `nextQueueIndex(length, currentIndex, key)` is extracted
  to `format.js` for unit testing.

---

## Re-extraction

Re-extraction is the task's highest-value design decision. The brief
explicitly requires that re-running extraction must not silently destroy
human corrections.

### Flow

```
Existing model extraction
        +
Human overrides
        +
New model extraction
        ↓
Conflict detection
        ↓
Human decision where necessary
        ↓
Effective extraction
        ↓
Deterministic priority
```

### Endpoints

- `POST /api/enquiries/:id/re-extract` — triggers a safe re-extraction.
  Validates the enquiry id; preserves `originalText` (immutable); runs the
  existing Groq → Gemini fallback chain; creates a NEW ExtractionVersion row
  (append-only — never overwrites historical versions); preserves all
  existing human overrides via `reapplyOverrides`; recalculates
  `effectiveExtraction` from new `modelExtraction` + preserved
  `humanOverrides`; recalculates deterministic priority; returns
  `{enquiry, versions, outcome, conflicts}`.
- `POST /api/enquiries/:id/fields/:field/accept-model` — explicit "accept
  new model value" action. Clears the override for that field, so the
  effective value falls back to the new `modelExtraction` value. Priority
  recalculated. The action is EXPLICIT — the system NEVER automatically
  accepts a new model value merely because re-extraction succeeded.
- `PATCH /api/enquiries/:id/fields/:field` with `value: null` — clears an
  override (alternative to the `[clear]` button in the UI).

### Conflict detection

`conflictService.detectConflicts(humanOverrides, newModelOutput)` returns
`[{field, humanValue, newModelValue, hasConflict}]` for each field where ALL
three conditions hold:

1. `humanOverrides[field]` is active (non-null).
2. `newModelOutput[field]` is present and non-null.
3. The two values differ (deep-equal for structured fields via
   `util.isDeepStrictEqual`).

If at least one conflict exists, the EXTRACTED panel shows a yellow
`CONFLICT — N FIELDS` banner. Each conflicted field shows
`[Keep confirmed]` / `[Accept new model]` actions. "Keep confirmed" is a
client-side only action (the override is already preserved server-side); it
just acknowledges the conflict and removes it from the local array.

If re-extraction produces no conflicts, the panel shows a green
`NEW MODEL AVAILABLE` banner — this demonstrates the merge policy
(non-overridden fields silently update, overrides are preserved).

### Effective-value resolution

```
human override exists (non-null)?
    YES → use human override
    NO  → use latest successful model extraction
```

`projectCount` and `additionalProjectNote` are model-only signals (not
overrideable). The resolver always takes them from `modelExtraction`,
ignoring any value that might accidentally appear in `humanOverrides`.

### Failure behavior

If re-extraction fails:
- existing model extraction remains intact (`modelExtraction` unchanged)
- existing extraction versions remain intact (history is append-only)
- human overrides remain intact
- effective extraction remains intact
- priority remains intact
- `extractionState` transitions to `'failed'`

The operator can retry. A failed re-extraction does NOT destroy successful
previous extraction data.

### DATA-INTEGRITY REGRESSION test

The explicit operator-requested sequence is verified end-to-end by an
integration test:

```
Test: "DATA-INTEGRITY REGRESSION: £40k → £400k override
       → £50k re-extract NEVER silently replaces"

1. Extraction returns Budget = £40,000      → priority score 8 (HIGH)
2. Human edits Budget = £400,000            → priority score 9 (HIGH, +1)
3. Re-extract returns Budget = £50,000      → conflict detected
4. Effective budget stays £400,000          → human override preserved
5. New model result (£50,000) is visible    → shown as a conflict
6. No silent data loss
```

The test passes. See `backend/tests/reExtractService.test.js`.

---

## Scoring rule

Priority is computed in application code only
(`backend/src/services/scoringService.js`). The LLM may not return or decide
`high / medium / low` as the authoritative priority — the extraction schema
excludes `priority` at four layers (Zod, JSON Schema, prompt, tests).

`computePriority(effectiveExtraction, isGenuineProjectEnquiry)` is a PURE
function: same input → same output, no I/O, no `Date.now()` drift, no
`Math.random()`. Unit tests cover all branches.

### Rule

```
base                        0

project legitimacy
  genuine project enquiry   +4
  not genuine               -5

budget  (major currencies USD/GBP/EUR only)
  ≥ 100,000                 +4
  25,000 – 99,999           +3
  < 25,000                  +1
  flexible / TBD            +1   (qualifier-based, no fabricated number)
  no budget                 0

timeline
  immediate / ASAP / today
  / next week / ≤ 1 week    +3
  ≤ 6 weeks                 +3
  1 – 3 months              +2
  longer / Q1 / 3+ months   +1
  unknown                   0

service fit
  ai | blockchain | web
  | mobile | game           +1
  other / unclear           0

relationship signal
  existing client /
  explicit follow-up        +1

thresholds
  high                      score ≥ 8
  medium                    score 4 – 7
  low                       score ≤ 3
```

### Why these thresholds

The scoring intentionally favours:

1. genuine project intent (`+4` for genuine, `-5` for not — net `-1` means
   non-enquiries never accidentally become medium priority from budget
   alone);
2. commercial signal (explicit budget is worth more than flexible / TBD);
3. near-term actionability (ASAP and ≤6 weeks both score `+3`).

A spam message with a large-looking number must not become high priority
simply because the model extracted a budget. The `MAJOR_CURRENCIES` guard
explicitly excludes INR (lakhs), IDR, etc. from the numeric thresholds — for
those currencies the conservative non-numeric score (`+1` when a budget is
present) is applied instead.

### Explainability

`computePriority` returns `{ score, level, reasons }` where `reasons` is an
array of human-readable strings (e.g. `"genuine project enquiry +4"`,
`"budget ≥ 100,000 in major currency +4"`, `"timeline immediate +3"`,
`"service: ai +1"`). The detail-view `PriorityBadge` shows the level + score;
clicking `why?` expands the reason list. The operator can always see why an
enquiry scored what it scored.

### Recalculation

Priority is recalculated:

- after a successful extraction (initial or re-extract);
- after a human edit to any field that contributes to the score;
- after `[Accept new model]` or `[Clear override]`.

The recalculation reads `enquiry.effectiveExtraction` + the top-level
`enquiry.isGenuineProjectEnquiry` field. The frontend never duplicates the
scoring algorithm — it reads `enquiry.priority` as returned by the backend.

---

## Two more days

If I had two more days, in priority order:

1. **Live end-to-end verification against real Groq + Gemini.** The Canonical
   Contract Fix was driven by observed snake_case / null budget output from a
   live `gpt-oss-20b` call, but the fix itself was verified with mocked LLM
   HTTP because the build sandbox has no outbound network access to
   `api.groq.com`. Day one: run a small `scripts/verify-canonical-extraction.js`
   with a real `gsk_...` key against all ~20 sample enquiries; capture the
   actual model output; patch the prompt for any remaining drift. Day two:
   repeat with Gemini and confirm the fallback path works on real provider
   errors (not just simulated ones). The recent migration from the Responses
   API to the Chat Completions API makes this even more important — the new
   request shape (`messages[]` + `response_format`) is universally supported,
   but only a live call confirms the model actually emits the canonical
   camelCase field names against the new envelope.

2. **Frontend component rendering tests.** The current test suite uses
   `node:test` for pure-logic unit tests only — no `@testing-library/react`
   + jsdom dependency was added, to keep the dependency surface small. The
   cost: visual regressions can slip through the pure-logic unit test suite.
   Add `@testing-library/react` + jsdom + a `vitest` browser environment;
   write smoke tests for `EnquiryDetail`, `ExtractionPanel`, `InlineField`,
   `EnquiryQueue` rendering against representative enquiry fixtures.

3. **Real-time batch progress via WebSocket / SSE.** The batch runner uses
   polling (`GET /api/batches/:id` every 1s). This is fine for ~20 enquiries
   at concurrency 3, but for a larger batch (200+) the polling interval
   becomes a UX compromise. A Server-Sent Events stream from the batch
   endpoint would let the UI update the segmented bar in real time without
   polling overhead. The infrastructure is already in place (Express,
   helmet, requestId) — it's a half-day of work to add an SSE endpoint and a
   corresponding Redux listener.

4. **Extraction prompt A/B harness.** Right now the prompt is a single
   canonical contract; if extraction quality regresses on a future model
   version, the only signal is operator complaints. Add a `promptVersion`
   field to `ExtractionVersion` and a small comparison UI that shows the
   same enquiry extracted under two prompts side-by-side. The data model
   already supports it — `ExtractionVersion` is append-only.

5. **Duplicate / follow-up linking.** Decision #1 above says "keep separate
   records and link them". The linking is currently a `relatedEnquiryId`
   field in the schema, but there's no UI to set it and no automatic
   detection. Add a simple "Mark as follow-up of…" action in the detail
   panel + a backend heuristic that suggests likely duplicates (same contact
   email + within 7 days).

6. **Deployment artefacts.** Per task brief, deployment is optional. But a
   `docker-compose.yml` (MongoDB + backend + frontend) would make the "Run
   it" steps trivial for the evaluator. Half a day; mostly packaging, no new
   code.
