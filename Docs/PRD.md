# Sodio Enquiry Triage — Product Requirements Document

## 1. Product

**Working name:** Sodio Enquiry Triage

An internal, single-workspace tool that ingests unstructured project enquiries, uses an LLM to extract structured information, computes priority deterministically, and gives a human operator a fast console for reviewing, correcting, filtering, and progressing enquiries.

The source brief requires the system to accept a single pasted enquiry and a file containing many enquiries, including the supplied sample file without reformatting. fileciteturn0file1L14-L26

## 1A. Locked Technology Stack

The implementation is locked to:

- **Frontend:** React + Vite + JavaScript
- **Styling:** Tailwind CSS
- **State management:** Redux Toolkit
- **Async/API state:** `createAsyncThunk`
- **Backend:** Node.js + Express.js + JavaScript
- **Database:** MongoDB + Mongoose
- **Primary LLM:** Grok API, free tier
- **Secondary LLM:** Gemini API, free tier
- **API style:** REST
- **Deployment:** Not required; local execution is sufficient
- **Language:** JavaScript only; no TypeScript

No authentication is required or will be implemented.

The task permits any stack as long as there is a real backend and real database, and explicitly states that deployment is optional. fileciteturn0file1L46-L54

## 2. Goal

Reduce the manual effort required to understand incoming enquiries while keeping a human in control of extracted data, priority, and workflow status.

The system must make model mistakes visible and recoverable rather than treating the LLM as authoritative.

## 3. Targeted Users

### Primary user — Sodio enquiry operator

A member of the Sodio team who:
- reviews incoming enquiries;
- checks extracted company/contact/project information;
- corrects model mistakes;
- decides whether an enquiry is genuine;
- moves enquiries through the workflow;
- uses filters and sorting to decide what needs attention first.

### Secondary user — Engineer / reviewer

A technical reviewer who needs to inspect:
- extraction behaviour;
- deterministic scoring;
- failure handling;
- re-extraction behaviour;
- data model and architecture.

No authentication or multi-user permission model is required. The task explicitly specifies one shared workspace with no login. fileciteturn0file1L46-L54

## 4. Core Jobs To Be Done

1. Paste one enquiry and extract it.
2. Upload a multi-enquiry file and process it in a batch.
3. See extraction progress without blocking the whole UI.
4. Review extracted fields beside the original message.
5. Correct any extracted field inline.
6. Filter and sort the enquiry queue.
7. Move an enquiry through `new → contacted → qualified → dropped`.
8. Re-run extraction when the prompt/model improves without silently overwriting human corrections.
9. Understand failures at item level instead of losing the entire batch.

## 5. Functional Requirements

### FR-01 — Single enquiry ingestion

The operator can paste one enquiry into an input surface and submit it.

The system creates an enquiry record containing the original text and runs extraction.

### FR-02 — File ingestion

The operator can upload a file containing multiple enquiries.

The supplied sample file must be accepted as-is; it must not be reformatted to make parsing easier. fileciteturn0file1L15-L18

The parser should identify enquiry boundaries using the source format and preserve each original enquiry verbatim.

### FR-03 — LLM extraction

For every enquiry, extract at minimum:
- company;
- contact name;
- contact email;
- service line: `ai | blockchain | web | mobile | game | other`;
- budget with currency;
- timeline;
- one-line summary;
- genuine project enquiry flag.

These are mandatory task fields. fileciteturn0file1L19-L26

Recommended additional fields:
- extraction confidence;
- extraction version;
- model/provider metadata;
- `is_model_instruction_attempt`;
- failure reason;
- correction history;
- duplicate/reference grouping;
- project count.

### FR-04 — Deterministic priority

Priority must be computed in application code from extracted fields.

The LLM must never return or decide `high / medium / low` as the authoritative priority. The task explicitly requires non-LLM scoring. fileciteturn0file1L26-L29

The exact scoring policy is defined in `Rules.md`.

### FR-05 — Console

The main console provides:
- enquiry list;
- company/contact;
- service line;
- budget;
- timeline;
- priority;
- status;
- received date;
- extraction state.

Required filters:
- service line;
- priority;
- status.

Required sorting:
- priority;
- date.

The brief explicitly requires these console behaviours. fileciteturn0file1L31-L37

### FR-06 — Inline correction

Every extracted field can be edited inline.

Human edits must be stored separately from the latest model extraction so the system knows which values are human-controlled.

### FR-07 — Detail view

A detail view presents:
- original enquiry text;
- extracted values;
- human corrections;
- current priority;
- current status;
- extraction history;
- errors, if any.

The original message must remain immutable.

### FR-08 — Status workflow

Allowed statuses:

`new → contacted → qualified → dropped`

The operator can move an enquiry between these states. The required workflow comes directly from the brief. fileciteturn0file1L34-L37

### FR-09 — Re-extraction

The operator can explicitly re-run extraction for an enquiry.

A re-extraction creates a new extraction version. It must not silently replace human-corrected fields. The brief calls this out as a key design decision. fileciteturn0file1L38-L41

Default merge policy:
1. Keep the immutable original text.
2. Keep all human corrections.
3. Store the new model extraction as a new version.
4. Apply new model values only to fields that have never been manually corrected.
5. Surface conflicts where the new extraction differs from a human-controlled value.
6. Let the operator explicitly accept a model value over a correction.

### FR-10 — Batch processing

Batch processing must:
- process multiple enquiries concurrently with a bounded concurrency limit;
- show progress;
- show completed / failed counts;
- allow successful items to remain successful when another item fails;
- show item-level failure reasons;
- avoid a single blocking request for all 20 enquiries.

The task specifically expects sensible concurrency, progress, and item-level failure handling. fileciteturn0file1L43-L45

## 6. Non-Goals

Do not build:
- authentication;
- role/permission management;
- public customer accounts;
- email sending;
- CRM integrations;
- automatic outbound replies;
- payment processing;
- deployment infrastructure as a required feature;
- LLM-based priority decisions.

Authentication is explicitly out of scope. fileciteturn0file1L46-L54

## 7. Key Product Decisions

### Same person / same project

Keep separate enquiry records because they are separate incoming messages and must retain their original timestamps/text.

Link likely duplicates through a lightweight `relatedEnquiryId` / duplicate group rather than merging records. The operator can therefore see the follow-up while preserving the audit trail.

### Budget formats

Store:
- `raw`: exactly what the sender wrote;
- `currency`: normalized ISO-style currency code when confidently inferable;
- `min` / `max`: numeric values only when safely derivable;
- `qualifier`: `exact | range | flexible | tbd | unknown`.

Examples:
- `£400,000` → exact numeric value + GBP.
- `35-40 lakhs` → INR range only if the phrase clearly denotes Indian lakhs.
- `budget flexible` → qualifier `flexible`, no invented number.
- `TBD` → qualifier `tbd`, no invented number.

Never fabricate a numeric budget.

### Timeline

Store both:
- `raw`: original phrase;
- normalized representation where useful.

Examples:
- `ASAP` → urgency class `immediate`;
- `6 weeks` → duration `6 weeks`;
- `Q1 next year` → period `Q1`, relative year;
- `before Diwali` → raw phrase retained; no fabricated calendar date unless an explicit reference date is safely available.

### Non-enquiries

Messages such as marketing outreach, recruiter outreach, bounce notices, or vague non-project messages are retained but marked `isGenuineProjectEnquiry = false`.

They remain visible so the operator can audit triage behaviour.

The sample data intentionally contains non-enquiries and a delivery failure. fileciteturn0file0L31-L38 fileciteturn0file0L171-L177

### Model-directed instruction

The message containing “Ignore all previous instructions” is treated as untrusted enquiry content, not as an instruction to the application or model.

The extraction prompt explicitly separates system/developer instructions from user-supplied enquiry text and requires the model to extract the text rather than obey it.

The task explicitly identifies this case as an evaluation point. fileciteturn0file1L61-L68

### Multiple projects in one enquiry

Do not silently split one email into multiple customer records.

Store one enquiry record and extract the primary service/budget/timeline fields required by the console. Preserve the complete original text and record `projectCount` plus an `additionalProjectNote` when multiple distinct projects are detected.

If the distinction materially affects qualification, flag it for human review.

The sample contains an enquiry describing two separate projects. fileciteturn0file0L80-L85

## 8. UX Principle

The interface should feel like an operational workbench rather than a generic AI dashboard.

Design direction:
- dense but readable queue;
- strong typographic hierarchy;
- original message as a first-class source of truth;
- restrained use of colour, mainly for priority/status;
- keyboard-friendly inline editing;
- deliberate visual separation between model output and human-confirmed data;
- no decorative AI chat UI, oversized gradients, generic metric cards, or “AI magic” animations.

## 9. Success Criteria

The product is successful when:
- the sample file can be ingested as-is;
- all six core capabilities are demonstrably working;
- model failures become recoverable UI states rather than uncaught stack traces;
- priority is reproducible from application code;
- human corrections survive re-extraction;
- batch processing visibly handles partial failure;
- the operator can understand the original text and extracted result without leaving the detail view.

The evaluator explicitly prioritizes running the six required capabilities, failure handling, decisions on ambiguous inputs, data modelling, secrets/untrusted input, failure states, cost, and the ability to explain the code. fileciteturn0file1L93-L101
