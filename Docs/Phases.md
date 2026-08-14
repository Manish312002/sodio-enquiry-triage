# Sodio Enquiry Triage — Implementation Phases

## Phase 0 — Project Foundation

### Goal
Create the smallest runnable full-stack skeleton using the locked JavaScript stack.

### Stack
- React + Vite;
- Tailwind CSS;
- Redux Toolkit + `createAsyncThunk`;
- Node.js + Express.js;
- MongoDB + Mongoose;
- Grok primary LLM adapter;
- Gemini secondary/fallback adapter.

### Build
- frontend;
- backend;
- MongoDB connection;
- environment configuration;
- health endpoint;
- basic error middleware;
- Git repository and meaningful first commit.

### Acceptance Criteria
- frontend starts locally;
- backend starts locally;
- backend connects to MongoDB;
- Tailwind is working;
- Redux store is working;
- no secrets are committed;
- no TypeScript is introduced.

## Phase 1 — Database + Enquiry Ingestion

### Goal
Create durable enquiry records.

### Build
- `Enquiry` MongoDB model/collection;
- schema/model definition;
- enquiry repository;
- `POST /api/enquiries`;
- paste-single-enquiry UI;
- immutable original text;
- source and received date fields.

### Acceptance Criteria
- one pasted enquiry creates one database record;
- original text is preserved exactly;
- validation errors are readable;
- UI refresh can retrieve the saved record.

---

## Phase 2 — File Parser

### Goal
Process the supplied sample file without changing it.

### Build
- multipart file upload;
- parser for separator-delimited enquiries;
- extraction of From / Email / Received / Message;
- one enquiry record per block;
- parser tests using the supplied sample-enquiries dataset as the reference dataset;
- malformed block handling.

### Acceptance Criteria
- sample data is accepted without reformatting;
- each separator-delimited enquiry becomes an individual record;
- blank/short messages do not crash the import;
- original message text is preserved.

The task requires the supplied sample-enquiries input to be handled as-is, without manual reformatting. fileciteturn0file1L14-L18

---

## Phase 3 — LLM Extraction

### Goal
Turn each enquiry into validated structured data.

### Build
- `LLMExtractor` interface;
- provider adapter;
- extraction prompt;
- strict response schema;
- retry for transient provider errors;
- invalid-output handling;
- extraction version persistence.

### Acceptance Criteria
Every successful extraction contains:
- company;
- contact name;
- contact email;
- service line;
- budget;
- timeline;
- summary;
- genuine-enquiry flag.

The required extraction fields are specified in the task. fileciteturn0file1L19-L26

---

## Phase 4 — Deterministic Scoring

### Goal
Compute priority independently from the LLM.

### Build
- scoring function;
- score explanation;
- thresholds;
- tests for high/medium/low;
- recalculation after human edits.

### Acceptance Criteria
- no LLM field controls priority directly;
- same input always produces same score;
- score is explainable;
- threshold tests pass.

---

## Phase 5 — Triage Console

### Goal
Create the operational workbench.

### Build
- enquiry table;
- service-line filter;
- priority filter;
- status filter;
- priority sort;
- date sort;
- status control;
- empty/loading/error states.

### Acceptance Criteria
Operator can:
- see all enquiries;
- filter by required dimensions;
- sort by required dimensions;
- identify failed extraction items;
- move status through the defined workflow.

---

## Phase 6 — Detail View + Inline Editing

### Goal
Make human review first-class.

### Build
- split detail view;
- original text panel;
- extracted data panel;
- inline field editing;
- human override storage;
- visual indicator for human-controlled fields;
- priority recalculation.

### Acceptance Criteria
- original text and extraction are visible together;
- every extracted field can be corrected;
- correction survives page reload;
- priority changes when corrected data changes scoring.

---

## Phase 7 — Re-Extraction Safety

### Goal
Implement the task's highest-value design decision.

### Build
- extraction version history;
- re-extract action;
- effective-value resolver;
- human override preservation;
- conflict display;
- explicit accept-model-value action.

### Acceptance Criteria
Scenario:

```text
Model says: Budget = $25,000
Human corrects: Budget = $40,000
Re-extract says: Budget = $20,000
```

Expected result:

```text
Effective budget = $40,000
Human correction remains intact
New model result is visible as a conflict
```

No silent data loss.

---

## Phase 8 — Batch Progress + Partial Failure

### Goal
Process 20 enquiries without a blocking spinner.

### Build
- bounded concurrency;
- batch job record;
- progress endpoint;
- per-item states;
- retry failed item;
- completed/failed/remaining counters.

### Acceptance Criteria
- 20 enquiries can process concurrently within the configured limit;
- UI visibly updates progress;
- one failed item does not fail successful items;
- failed item can be retried;
- no single “20 requests in one blocking call” implementation.

The brief explicitly evaluates progress, concurrency, and item-level failure. fileciteturn0file1L43-L45

---

## Phase 9 — Security + AI Boundaries

### Goal
Harden untrusted-input and secret-handling paths.

### Build
- server-only API keys;
- prompt injection boundary;
- input validation;
- file limits;
- safe error responses;
- safe logs;
- provider timeout;
- no client-to-provider direct calls.

### Acceptance Criteria
The model-directed sample enquiry is treated as ordinary data and cannot override extraction instructions.

---

## Phase 10 — UX Polish + Verification

### Goal
Deliver a distinctive but restrained operational UI.

### Build
- final design tokens;
- typography;
- keyboard interactions;
- visual hierarchy;
- loading/error/empty states;
- responsive layout;
- screenshot-ready data.

### Acceptance Criteria
- UI does not resemble a generic AI chat/dashboard template;
- original text remains visually prominent;
- human corrections are clearly distinguishable;
- priority/status colours are consistent;
- all six required capabilities can be demonstrated.

---

## Phase 11 — Submission Documentation

### Goal
Prepare the repository for evaluation.

### Required
- `README.md` with exact requested sections;
- `AI-LOG.md`;
- `SELF-REVIEW.md`;
- screenshots (3–4) or short screen recording;
- intact Git commit history.

The task explicitly requires these submission artefacts and sections. fileciteturn0file1L69-L91

### Acceptance Criteria
README contains:
- Run it;
- What works / what doesn't;
- Decisions;
- Re-extraction;
- Scoring rule;
- Two more days.

AI-LOG contains at least two concrete AI mistakes and the developer's response.

SELF-REVIEW contains three blunt review findings.

---

## Phase Order Summary

```text
0 Foundation
   ↓
1 Database + single ingestion
   ↓
2 File parser
   ↓
3 LLM extraction
   ↓
4 Deterministic scoring
   ↓
5 Console
   ↓
6 Detail + editing
   ↓
7 Re-extraction safety
   ↓
8 Batch progress + failure
   ↓
9 Security / AI boundaries
   ↓
10 UX polish
   ↓
11 Submission docs
```

The implementation should prioritise a working end-to-end vertical slice before visual polish.
