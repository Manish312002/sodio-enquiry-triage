# Sodio Enquiry Triage — Architecture

## 1. Architecture Goal

Build the smallest production-shaped system that satisfies the task in one working day:

- React/Vite frontend;
- Tailwind CSS UI;
- Redux Toolkit + `createAsyncThunk` for client state and API workflows;
- Node.js + Express backend;
- MongoDB database;
- provider-neutral LLM extraction layer;
- deterministic scoring in application code;
- bounded batch processing;
- audit-friendly extraction/re-extraction model.

The task allows any stack provided there is a real backend and real database, and deployment is optional. fileciteturn0file1L46-L54

## 2. Final Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Styling | Tailwind CSS |
| State | Redux Toolkit |
| Async/API state | `createAsyncThunk` |
| Backend | Node.js + Express.js |
| Language | JavaScript |
| Database | MongoDB |
| Primary LLM | Grok API — free tier |
| Secondary LLM | Gemini API — free tier |
| API | REST |
| Deployment | Not required |

No TypeScript will be used.

## 3. High-Level Architecture

```text
                         ┌─────────────────────────┐
                         │      React + Vite        │
                         │       Tailwind CSS       │
                         │                         │
                         │   Redux Toolkit         │
                         │   createAsyncThunk      │
                         └────────────┬────────────┘
                                      │ REST/JSON
                                      ▼
                         ┌─────────────────────────┐
                         │      Express API        │
                         │        Node.js           │
                         │                         │
                         │ Ingestion               │
                         │ Extraction              │
                         │ Scoring                 │
                         │ Corrections             │
                         │ Re-extraction           │
                         │ Batch orchestration     │
                         └───────────┬─────┬───────┘
                                     │     │
                              MongoDB│     │LLM Adapter
                                     ▼     ▼
                              ┌──────────┐ ┌──────────────┐
                              │ MongoDB  │ │ LLM Service  │
                              │          │ └──────┬───────┘
                              │ enquiries│        │
                              │ versions │   ┌────┴────┐
                              │ batches  │   ▼         ▼
                              └──────────┘ Grok     Gemini
                                         Primary   Secondary
```

## 4. Application Flow

### Flow A — Single enquiry

```text
Paste enquiry
   ↓
Redux dispatch(createEnquiry(...))
   ↓
createAsyncThunk
   ↓
POST /api/enquiries
   ↓
Express controller
   ↓
Enquiry service
   ↓
Create immutable enquiry
   ↓
LLM extraction service
   ↓
Grok
   │
   ├── success → validate extraction
   │
   └── failure → Gemini fallback
   ↓
Persist extraction version
   ↓
Deterministic scoring service
   ↓
Persist/update effective priority
   ↓
Redux fulfilled
   ↓
Console updates
```

### Flow B — File batch

```text
Upload source file
   ↓
Redux dispatch(importEnquiries(file))
   ↓
POST /api/enquiries/import
   ↓
Validate file
   ↓
Parse enquiry boundaries
   ↓
Create enquiry records
   ↓
Create batch job
   ↓
Bounded concurrent extraction
   ├── item succeeds → save extraction
   ├── item fails    → save item failure
   └── next item continues
   ↓
GET /api/batches/:id
   ↓
Redux polling / progress updates
   ↓
Batch progress UI
```

### Flow C — Human correction

```text
Open enquiry
   ↓
Edit extracted field
   ↓
dispatch(updateField(...))
   ↓
PATCH /api/enquiries/:id/fields/:field
   ↓
Save human override
   ↓
Recalculate priority
   ↓
Redux fulfilled
   ↓
UI marks field as CONFIRMED
```

### Flow D — Re-extraction

```text
User clicks Re-extract
   ↓
POST /api/enquiries/:id/re-extract
   ↓
Create new extraction version
   ↓
Grok
   │
   └── failure → Gemini
   ↓
Validate new extraction
   ↓
Compare with human overrides
   ↓
Keep human-controlled fields
   ↓
Expose model conflicts
   ↓
Recalculate priority
   ↓
Return effective enquiry
```

The task specifically requires re-extraction without silently destroying human corrections. fileciteturn0file1L38-L41

## 5. LLM Provider Architecture

The application must not call Grok or Gemini directly from React.

```text
Frontend
   ↓
Express
   ↓
ExtractionService
   ↓
LLMService
   ├── GrokProvider      ← primary
   └── GeminiProvider    ← fallback
```

### Provider rules

1. Grok is attempted first.
2. If Grok fails because of a recoverable provider/API failure, Gemini is attempted.
3. If both fail, the enquiry remains stored with an extraction failure state.
4. Provider failures must not destroy the original enquiry.
5. Provider API keys remain server-side.
6. Provider SDK details are isolated inside their provider adapters.

The free-tier choice is a cost-conscious implementation decision for the take-home. The task allows any LLM provider and says free tiers are fine. fileciteturn0file1L47-L51

## 6. Data Model — MongoDB

### `enquiries` collection

```js
{
  _id,
  source: "paste" | "file",
  originalText,
  sender: {
    name,
    email
  },
  receivedAt,

  status: "new" | "contacted" | "qualified" | "dropped",

  isGenuineProjectEnquiry,

  effectiveExtraction: {
    company,
    contactName,
    contactEmail,
    serviceLine,
    budget: {
      raw,
      currency,
      min,
      max,
      qualifier
    },
    timeline: {
      raw,
      normalized
    },
    summary,
    projectCount,
    additionalProjectNote
  },

  humanOverrides: {
    company,
    contactName,
    contactEmail,
    serviceLine,
    budget,
    timeline,
    summary,
    isGenuineProjectEnquiry
  },

  priority: {
    level,
    score,
    reasons: []
  },

  extractionState: "pending" | "processing" | "completed" | "failed",

  batchId,

  createdAt,
  updatedAt
}
```

### `extractionVersions` collection

```js
{
  _id,
  enquiryId,
  version,
  provider: "grok" | "gemini",
  model,
  rawOutput,
  parsedOutput,
  state: "completed" | "failed",
  errorCode,
  createdAt
}
```

### `batchJobs` collection

```js
{
  _id,
  total,
  completed,
  failed,
  processing,
  pending,
  status: "processing" | "completed" | "completed_with_errors",
  createdAt,
  completedAt
}
```

Separate extraction versions make re-extraction auditable and preserve history.

## 7. Effective Value Resolution

For each field:

```text
human override exists?
    YES → use human override
    NO  → use latest successful extraction
```

Priority is always calculated from effective values.

Example:

```text
Model extraction:
budget = $25,000

Human correction:
budget = $40,000

Re-extraction:
budget = $20,000

Effective budget:
$40,000
```

The new model value remains visible as a conflict but does not silently replace the human correction.

## 8. API Surface

### Enquiries

- `POST /api/enquiries`
- `POST /api/enquiries/import`
- `GET /api/enquiries`
- `GET /api/enquiries/:id`
- `PATCH /api/enquiries/:id`
- `PATCH /api/enquiries/:id/fields/:field`
- `POST /api/enquiries/:id/re-extract`
- `GET /api/enquiries/:id/extractions`

### Batch

- `GET /api/batches/:id`

### Health

- `GET /api/health`

## 9. Backend Folder/File Structure

```text
backend/
├── src/
│   ├── app.js
│   ├── server.js
│   │
│   ├── config/
│   │   ├── env.js
│   │   └── db.js
│   │
│   ├── models/
│   │   ├── Enquiry.js
│   │   ├── ExtractionVersion.js
│   │   └── BatchJob.js
│   │
│   ├── routes/
│   │   ├── enquiryRoutes.js
│   │   └── batchRoutes.js
│   │
│   ├── controllers/
│   │   ├── enquiryController.js
│   │   └── batchController.js
│   │
│   ├── services/
│   │   ├── enquiryService.js
│   │   ├── extractionService.js
│   │   ├── scoringService.js
│   │   ├── batchService.js
│   │   └── parserService.js
│   │
│   ├── services/llm/
│   │   ├── llmService.js
│   │   ├── grokProvider.js
│   │   ├── geminiProvider.js
│   │   ├── extractionPrompt.js
│   │   └── extractionSchema.js
│   │
│   ├── middleware/
│   │   ├── errorHandler.js
│   │   └── validateRequest.js
│   │
│   └── utils/
│       ├── logger.js
│       └── constants.js
│
└── package.json
```

## 10. Frontend Folder/File Structure

```text
frontend/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   │
│   ├── app/
│   │   └── store.js
│   │
│   ├── features/
│   │   └── enquiries/
│   │       ├── enquirySlice.js
│   │       ├── enquiryThunks.js
│   │       └── enquiryApi.js
│   │
│   ├── components/
│   │   ├── EnquiryTable/
│   │   ├── EnquiryRow/
│   │   ├── EnquiryDetail/
│   │   ├── OriginalMessage/
│   │   ├── ExtractionPanel/
│   │   ├── InlineField/
│   │   ├── FilterBar/
│   │   ├── StatusTrack/
│   │   ├── PriorityBadge/
│   │   ├── ImportPanel/
│   │   ├── BatchProgress/
│   │   └── ErrorState/
│   │
│   ├── pages/
│   │   └── Dashboard.jsx
│   │
│   ├── services/
│   │   └── api.js
│   │
│   └── styles/
│       └── index.css
│
├── index.html
└── package.json
```

## 11. Redux Architecture

Redux Toolkit owns client-side enquiry state.

Example slices/state:

```text
enquiries
├── items
├── selectedId
├── filters
├── sort
├── loading
├── error
└── batch
```

`createAsyncThunk` handles:
- fetching enquiries;
- creating a single enquiry;
- importing a file;
- updating status;
- updating fields;
- re-extraction;
- fetching batch progress.

The UI must not put business/scoring logic into Redux components.

## 12. Batch Concurrency

Initial target:

```js
const CONCURRENCY = 3;
```

Use bounded concurrency rather than launching all 20 LLM calls simultaneously.

The task specifically expects sensible concurrency, progress, and clear item-level failure behaviour. fileciteturn0file1L43-L45

## 13. Failure Model

Each item can independently be:

```text
pending
processing
completed
failed
```

One failed item must not fail the entire batch.

The UI shows:
- total;
- completed;
- processing;
- failed;
- pending;
- retry action.

Raw stack traces are never shown to the operator.

## 14. Architectural Boundaries

- React never calls Grok/Gemini directly.
- API keys never enter frontend code.
- Priority is never generated by the LLM.
- Original enquiry text is immutable.
- Human corrections are separate from model extraction.
- Provider SDKs remain inside provider adapters.
- MongoDB access remains behind services/repositories/models.
- Batch orchestration remains server-side.
- UI does not implement scoring rules.
- No authentication is implemented.

## 15. Evaluation-Input Boundary

The implementation must handle the official Sodio sample-enquiries input **as supplied**, without asking the evaluator to manually reformat it.

The current reference material available during planning is a PDF representation of the sample enquiries. The assignment brief refers to `sample-enquiries.txt`. Therefore:

- do not hard-code a PDF-only assumption into the domain model;
- keep parsing isolated behind `parserService.js`;
- preserve each enquiry's original message text;
- if the final evaluation repository provides the official `.txt` file, the parser must accept that file directly;
- do not modify the source dataset merely to make parsing easier.

This preserves the assignment's requirement that the sample file be handled as-is. fileciteturn0file1L14-L18

## 16. Why This Stack

This stack is intentionally simple and fast to ship:

- React/Vite fits the UI requirement.
- Tailwind allows fast implementation of the custom Signal Desk design.
- Redux Toolkit + `createAsyncThunk` gives explicit async state handling.
- Express provides a clear backend boundary.
- MongoDB fits the document-shaped enquiry/extraction data.
- JavaScript avoids unnecessary TypeScript setup for a one-day take-home.
- Grok + Gemini provide a primary/fallback extraction strategy while keeping API cost low through free tiers.

The assignment is evaluating whether the system works, how failures and ambiguity are handled, and whether the candidate can explain the implementation—not whether a particular framework is used. fileciteturn0file1L93-L106
