# Sodio Enquiry Triage

An internal enquiry triage workbench. Ingest unstructured project enquiries
(pasted singly or uploaded as a separator-delimited file), extract structured
data with an LLM (Groq primary, Gemini fallback), compute priority
deterministically in application code, and give a human operator a fast
review console with inline corrections, re-extraction safety, and batch
progress with per-item failure handling.

## Stack

- **Frontend:** React + Vite + JavaScript, Tailwind CSS, Redux Toolkit +
  `createAsyncThunk`
- **Backend:** Node.js + Express.js + JavaScript
- **Database:** MongoDB + Mongoose
- **LLM:** Groq (primary, via `openai` SDK pointed at Groq's
  OpenAI-compatible endpoint) / Gemini (fallback, via `@google/genai` SDK)
  — server-side only, behind a provider abstraction
- **Validation:** zod (env, request bodies, LLM output)
- **Language:** JavaScript only — no TypeScript
- **Auth:** none (single shared workspace, per task brief)

## Project layout

```
.
├── backend/               # Express API + Mongoose + LLM adapters
│   ├── src/
│   │   ├── config/        # env.js (zod-validated), db.js
│   │   ├── controllers/   # enquiryController, healthController
│   │   ├── middleware/    # errorHandler, validateRequest, requestId
│   │   ├── models/        # Enquiry, ExtractionVersion, BatchJob
│   │   ├── routes/        # healthRoutes, enquiryRoutes, batchRoutes
│   │   ├── services/
│   │   │   ├── llm/       # extractionPrompt, extractionSchema,
│   │   │   │              # extractionJsonSchema, groqProvider,
│   │   │   │              # geminiProvider, llmService
│   │   │   ├── enquiryService, extractionService, parserService,
│   │   │   ├── scoringService, effectiveValueService,
│   │   │   ├── humanOverrideService, conflictService,
│   │   │   ├── reExtractService, batchService
│   │   └── utils/         # logger (redacting), constants
│   └── tests/             # unit + integration tests
├── frontend/              # Vite + React + Redux Toolkit
│   ├── src/
│   │   ├── app/store.js
│   │   ├── features/enquiries/  # enquirySlice, enquiryThunks, format
│   │   ├── components/          # EnquiryQueue, EnquiryDetail, FilterRail,
│   │   │                        # SortBar, ExtractionPanel, InlineField,
│   │   │                        # OriginalMessage, StatusTrack, PriorityBadge,
│   │   │                        # PasteEnquiry, BatchProgress
│   │   ├── services/api.js
│   │   └── styles/index.css
│   └── tests/             # unit tests (format, keyboardNav, …)
├── test-data/
│   ├── sample-enquiries.pdf     # Operator-supplied source (5 pages, 20 blocks)
│   └── sample-enquiries.txt     # Plaintext extraction (parser fixture)
├── AI-LOG.md              # AI mistakes + developer response
├── SELF-REVIEW.md         # Blunt self-review findings
├── .env.example           # Environment variable template (no secrets)
└── .gitignore
```

---

## Run it

> Requires Node.js ≥ 18 and a reachable MongoDB instance.

### 1. Backend

```bash
cd backend
cp ../.env.example ../.env       # then edit .env: MONGODB_URI, GROQ_API_KEY, GEMINI_API_KEY
npm install
npm run dev                      # serves http://localhost:3001
```

Health check:

```bash
curl http://localhost:3001/api/health
# {"status":"ok","db":"connected","dbHost":"127.0.0.1",...}
```

If MongoDB is unreachable, the server still starts and `/api/health`
returns `status:"degraded"` with the actual `db` state. The health
endpoint never lies — hiding a DB outage behind `status:"ok"` would
violate the Phase 0 acceptance criterion "backend connects to MongoDB".

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                      # serves http://localhost:5173
```

The Vite dev server proxies `/api` → `http://localhost:3001` (see
`frontend/vite.config.js`). Open <http://localhost:5173/> in a modern
browser.

### 3. Populate the queue

Two ingestion paths:

- **Paste a single enquiry** — top-of-page `PASTE ENQUIRY` strip → paste
  raw text → `Submit`. One enquiry record is created and extraction runs
  immediately.
- **Upload the sample file** — `IMPORT ENQUIRIES` strip → `Choose file`
  → select `test-data/sample-enquiries.txt` → wait for the segmented
  progress bar to reach `COMPLETED` (or `COMPLETED WITH ERRORS`).
  ~20 enquiries are created and extracted concurrently.

### 4. Try the six capabilities

Once the queue is populated:

1. Click any enquiry row → detail panel populates (SOURCE on the left,
   EXTRACTED + PRIORITY on the right).
2. Use the **FILTERS** rail (left) to filter by service / priority /
   status; use the **SORT** control to order by priority or date.
3. Click `[edit]` on any extracted field → type → `Enter` to save or
   `Esc` to cancel. The field switches from `MODEL` → `CONFIRMED` with
   a subtle accent tint.
4. Click `Re-extract` at the top of the EXTRACTED panel → a new
   extraction version is created; conflicts against existing overrides
   surface as a yellow `CONFLICT` banner with `[Keep confirmed]` /
   `[Accept new model]` actions.
5. Use the keyboard: `ArrowUp` / `ArrowDown` / `Home` / `End` move
   through the queue; `Enter` / `Esc` save / cancel inline edits.
6. Move an enquiry through the status track (`NEW → CONTACTED →
   QUALIFIED → DROPPED`) by clicking any node.

### 5. Tests

```bash
# Backend unit tests (no MongoDB required)
cd backend && npm run test:unit

# Backend integration tests (real MongoDB required)
cd backend && npm run test:integration

# Frontend unit tests (vitest, no DOM library)
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
| `GEMINI_API_KEY` | _(empty)_ | Fallback LLM provider key |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini model id |
| `LLM_TIMEOUT_MS` | `30000` | Per-provider timeout. Set to `100` to verify the timeout path |
| `LLM_MAX_RETRIES` | `1` | Retries for recoverable provider errors (5xx, network, timeout) |
| `BATCH_CONCURRENCY` | `3` | Bounded concurrency for batch extraction |
| `CORS_ALLOWED_ORIGINS` | `*` | Comma-separated allowlist. Set to a specific origin in production |

---