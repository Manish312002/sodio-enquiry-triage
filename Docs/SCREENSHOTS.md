# Screenshots — Phase 10 / Phase 11

This document describes how to capture screenshots that demonstrate the six
core capabilities required by the brief (PRD §9 Success Criteria).

The application is designed so all six capabilities are visible from a single
browser tab once the sample file has been ingested. No special seed script is
needed — the operator just runs the backend + frontend and uploads the
provided `test-data/sample-enquiries.txt`.

## Prerequisites

```bash
# Terminal 1 — backend (with MongoDB running on localhost:27017)
cd backend
cp .env.example .env   # then edit .env to set GROQ_API_KEY / GEMINI_API_KEY
npm install
npm run dev            # serves http://localhost:5174/api/*

# Terminal 2 — frontend
cd frontend
npm install
npm run dev            # serves http://localhost:5173/
```

Open <http://localhost:5173/> in a modern browser (Chrome / Firefox / Safari).

## Capture workflow

1. **Ingest the sample file** so the queue is populated:
   - Scroll to the **IMPORT ENQUIRIES** strip (below the **PASTE ENQUIRY** strip).
   - Click "Choose file" and select `test-data/sample-enquiries.txt`.
   - Wait for the segmented progress bar to reach `COMPLETED` (or
     `COMPLETED WITH ERRORS` if any extraction failed — that itself is a
     capability demonstration).
   - The queue should now show ~20 enquiry rows.

2. **Click any enquiry row** to populate the detail panel.

3. Use the browser's built-in screenshot tool (or `Cmd+Shift+4` on macOS,
   `Win+Shift+S` on Windows) to capture each of the six views below.

## The six capability screenshots

### 1. Single + file ingestion

Capture: the **IMPORT ENQUIRIES** strip with the segmented progress bar
showing `20 ENQUIRIES — COMPLETED`, plus the queue populated below it.

This demonstrates:
- The sample file was accepted as-is (no reformatting).
- The parser identified enquiry boundaries correctly.
- Each enquiry became a row in the queue.

### 2. LLM extraction

Capture: an enquiry selected in the queue, with the **EXTRACTED** panel on the
right showing all 8 fields populated (COMPANY / CONTACT / EMAIL / SERVICE /
BUDGET / TIMELINE / SUMMARY / GENUINE PROJECT ENQUIRY).

Each field should show a `MODEL` chip (no human override yet).

### 3. Deterministic priority

Capture: the **PRIORITY** section at the bottom of the EXTRACTED panel.

It should show:
- A coloured dot (orange=HIGH, amber=MEDIUM, grey=LOW).
- The level label (HIGH / MEDIUM / LOW).
- The numeric score (`· 11 pts`).
- A `why?` button — click it to expand the reason lines and include the
  expanded list in the screenshot.

This demonstrates that priority is computed from extracted fields by
application code (not by the LLM) and is reproducible.

### 4. Console with filters + sort

Capture: the full three-zone desktop layout at ≥1280px width.

Show:
- The **FILTERS** rail on the left with one filter active (e.g. SERVICE =
  WEB), so the queue shows only matching rows.
- The **SORT** control set to PRIORITY DESC, so HIGH enquiries appear first.
- The count in the queue header (`N ITEMS`) reflecting the filtered count,
  not the total.

### 5. Inline correction

Capture: the EXTRACTED panel with at least one field showing the `CONFIRMED`
chip + accent left border (after the operator has edited a field).

Steps to produce the confirmed state:
- Click `[edit]` on the COMPANY field.
- Change the value (e.g. fix a typo, or change "Northgate Logistics" to
  "Northgate Logistics Ltd").
- Press `Enter` (or click `[save]`).
- The field now shows the `CONFIRMED` chip and a faint accent-soft background
  tint, distinguishable from the `MODEL` fields.

This demonstrates the human-vs-model visual distinction (design.md §8).

### 6. Re-extraction safety

Capture: the EXTRACTED panel showing the `CONFLICT — N FIELDS` warning banner
after a re-extraction that produced different model values.

Steps to produce the conflict state:
- Edit at least one field (e.g. set BUDGET to a different value).
- Click `[Re-extract]` at the top of the EXTRACTED panel.
- Wait for the new extraction to complete.
- If the new model output differs from the confirmed override, the panel
  shows a yellow `CONFLICT` banner + the conflicted field shows
  `[Keep confirmed]` / `[Accept new model]` actions.

If re-extraction produces no conflicts, capture the green
`NEW MODEL AVAILABLE` banner instead — this demonstrates the merge policy
(non-overridden fields silently update, overrides are preserved).

## Optional: failure states

Capture these additional screenshots to demonstrate failure handling:

- **EXTRACTION FAILED**: click `[Re-extract]` after setting
  `LLM_TIMEOUT_MS=100` in `backend/.env` and providing a fake API key — the
  panel shows the red `EXTRACTION FAILED` block with a `[Re-extract]` button,
  and the original message + existing extraction are preserved.
- **BATCH WITH FAILURES**: set `BATCH_CONCURRENCY=1` and a fake API key,
  then re-ingest the sample file — the segmented bar shows red segments for
  failed items, and the **FAILED ITEMS** list shows `[Retry]` buttons.

## Responsive behaviour

Capture the queue at three widths to demonstrate the responsive layout
(design.md §17):

- **Desktop** (≥1280px): three-zone layout (FILTER RAIL | QUEUE | DETAIL).
- **Tablet** (768–1023px): filter rail collapses, queue + detail remain.
- **Mobile** (<640px): single-column stack — paste strip, batch progress,
  filter rail, queue, detail all flow vertically.

Use the browser dev tools' responsive mode (or resize the window) to capture
each width.

## What NOT to capture

Per design.md §2, do NOT capture or include:

- generic AI chat bubbles / floating assistant UI;
- oversized hero cards or KPI metric rows;
- glassmorphism / purple-blue gradients;
- "AI thinking" spinner animations;
- raw stack traces from the console.

The Signal Desk aesthetic is intentionally restrained — the screenshots
should reflect that.
