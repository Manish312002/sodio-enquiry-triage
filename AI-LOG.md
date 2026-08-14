# AI-LOG

This file records concrete mistakes made by the LLM-assisted build
(Grok `gpt-oss-20b` primary, Gemini `gemini-3.6-flash` fallback, plus
the coding-assistant LLM used to scaffold this repository) and the
developer's response to each.

Only mistakes that influenced the shipped design or that required
non-trivial developer intervention are recorded here. Trivial mistakes
(typos, missing imports caught by the linter on first run, etc.) are
not recorded.

---

## Mistake #1 — Live Grok output emitted snake_case + `null` budget/timeline, breaking the Zod contract

**When:** surfaced during live verification after the SDK migration
(commit `410145c`); fix shipped as commit `071f793` ("fix(extraction):
enforce ONE canonical contract across prompt + provider + Zod").

**What the model did:**

Live `gpt-oss-20b` output via Groq's OpenAI-compatible endpoint was
failing Zod validation. Three independent contract violations were
observed:

1. **Snake_case field names.** The model emitted `contact_name`,
   `contact_email`, `service_line`, `is_genuine` instead of the
   canonical camelCase names (`contactName`, `contactEmail`,
   `serviceLine`, `isGenuineProjectEnquiry`). The Zod schema is
   `.strict()` so unknown keys are rejected — every extraction
   failed validation and was classified `INVALID_OUTPUT` with
   `recoverable=false` (Gemini fallback NOT called).
2. **`budget: null` and `timeline: null`.** The contract requires
   `budget` and `timeline` to be structured objects
   (`{raw, currency, min, max, qualifier}` /
   `{raw, normalized}`) with the unknown-representation values
   populated when the model can't infer a structured value. The
   model emitted bare `null`, which the Zod schema rejected.
3. **`groqProvider` was requesting generic JSON mode** —
   `text: { format: { type: 'json_object' } }`. The model never saw
   the canonical schema, only the prompt's prose description, so it
   free-formed the field names and shapes based on its own
   preferences.

**Why it slipped through:**

The prompt was originally written with prose field descriptions and
used generic `json_object` mode for the provider request. The Zod
schema was the only canonical contract. The unit tests used a mocked
LLM HTTP server that returned camelCase compliant output, so the
mismatch between prompt-prose, provider-request, and Zod was not
visible until a real Groq call was made.

**Developer response:**

Layered a single canonical contract across three layers (commit
`071f793`):

- **Layer 1 — Prompt** (`extractionPrompt.js`): rewritten to
  explicitly document every canonical camelCase field name, its
  type, allowed enum values, the null/unknown representation, the
  forbidden snake_case aliases, the "budget and timeline MUST be
  objects (never null)" rule, and the "no priority field" rule.
- **Layer 2 — Provider request** (`extractionJsonSchema.js` +
  `groqProvider.js` + `geminiProvider.js`): a single canonical
  JSON Schema (`EXTRACTION_JSON_SCHEMA`) is now handed to both
  providers. Groq receives it via `text: { format: { type:
  'json_schema', name: 'extraction', schema:
  EXTRACTION_JSON_SCHEMA, strict: false } }` (openai@7.4.0 SDK
  supports this on the Responses API). Gemini receives it via
  `response_format: EXTRACTION_JSON_SCHEMA`. Both providers receive
  the SAME canonical schema, kept hand-aligned with Zod.
- **Layer 3 — Zod** (`extractionSchema.js`): UNCHANGED. Still
  `.strict()`, no `.passthrough()`, no `.catchall()`, no accepting
  `null` where the contract requires an object. Zod remains the
  authoritative post-response validator (defence in depth).

Why `strict: false` (not `strict: true`) on the JSON Schema:
OpenAI Structured Outputs `strict: true` mode requires
`additionalProperties: false` on every object schema and forces
every property into `required`. Our `timeline.normalized` field is
intentionally open-shaped ("Open shape for normalized markers —
filled opportunistically without ever inventing dates"). Forcing it
into a closed object would either over-constrain the model into
emitting placeholder values for keys that don't apply, or reject
legitimate extractions when the model emits an unanticipated marker
key. Therefore `strict: false` is used; the model receives the full
canonical schema as guidance, and Zod remains the authoritative
validation boundary.

**Tests added (25 new, 0 regressions):**

- `extractionSchema.test.js` — 13 new tests: snake_case rejection
  (4), `budget:null` rejection, `timeline:null` rejection, canonical
  unknown-budget/timeline object acceptance, default application,
  nested strict rejection, `notes` rejection, `priority` rejection.
- `extractionJsonSchema.test.js` (NEW) — 15 tests guarding JSON
  Schema ↔ Zod alignment (canonical field names, enums,
  `additionalProperties`, `priority` absent, GROQ_TEXT_FORMAT
  wrapper shape, frozen/immutable, no snake_case anywhere).
- `extractionPrompt.test.js` — 12 new tests guarding canonical-
  contract documentation in the prompt (every field name, forbidden
  snake_case, no `priority`, `serviceLine` enum, `budget.qualifier`
  enum, budget/timeline object shapes, `confidence` range,
  `projectCount` minimum, `additionalProjectNote` semantics,
  `isModelInstructionAttempt` semantics).
- `groqProvider.test.js` — replaced the `json_object` assertion
  with a comprehensive `json_schema`-with-canonical-schema test.
- `geminiProvider.test.js` — replaced the `response_format`
  assertion with a comprehensive canonical-schema test.

**Lesson:** A prompt is not a contract. Prose descriptions of field
names and shapes are easy for the model to drift from. The
canonical contract must be machine-readable (JSON Schema) and must
be handed to the model directly via the provider's structured-
output mechanism, not just described in the prompt. Zod alone
catches the drift but only after a wasted LLM call; the JSON
Schema prevents the drift in the first place.

---

## Mistake #2 — The LLM hallucinated a company name from a vague "call me" message

**When:** surfaced during effective-value-resolver design (decision:
"Override semantics: null = no override, non-null = active").

**What the model did:**

One of the sample enquiries is a vague "Hi, saw your website, call me
at 555-1234 — John" message with no company name in the text. The
model emitted `company: "John's Company"` — a plausible-sounding but
fabricated value with no basis in the source text. The contract
explicitly says "Unknown values must remain unknown/null. Do not
hallucinate."

**Why it matters:**

The fabricated name would have been displayed to the operator as if
it were a real extracted value. Without a way to explicitly clear
the field (rather than just leave it as the model's value), the
operator would have to either accept the fabrication or overwrite
it with another string — there was no "I want this field to be
empty" action.

**Developer response:**

Designed the override semantics so that `null` means "no override
/ fall back to model" and any non-null value (including `''`,
`false`, `0`) means "active override". This lets the operator:

- mark `isGenuineProjectEnquiry = false` (instead of model's `true`);
- clear `company = ''` (instead of model's hallucinated name);
- set `budget.min = 0` (instead of model's exaggerated number).

Without this rule, the operator could not distinguish "I want this
field to be empty/false/zero" from "I haven't touched this field".

The `PATCH /fields/:field` endpoint accepts `value: null` to clear
an override (an alternative to the `[clear]` button in the UI). A
`null` value is accepted without running the per-field validator —
this lets the operator clear any field without worrying about the
validator rejecting the `null` shape.

The 29-test `humanOverrideService.test.js` integration suite covers
this explicitly:

- test 7: clear `company` override → effective value falls back to
  model's hallucinated name (override was removed, not replaced with
  empty string);
- test 22: set `company = ''` as an active override → effective
  value is `''` (override is active, model value preserved in
  `modelExtraction` for comparison display);
- test 25: `projectCount` and `additionalProjectNote` are NOT
  overrideable — the resolver always takes them from
  `modelExtraction`, ignoring any value that might accidentally
  appear in `humanOverrides`.

**Lesson:** When the LLM is the extractor (not the authority), every
field needs an "I disagree" path that includes "I want this field to
be empty / false / zero" — not just "I want to replace it with a
different value". The `null`-vs-non-null distinction is the
cleanest way to express this without a separate "cleared" marker
field per override.

---

## Mistake #3 — The coding-assistant LLM generated an EXTRACTED panel that overflowed vertically and clipped long values

**When:** surfaced during responsive-layout verification
(screenshots revealed the EXTRACTED panel was taller than the
viewport and long budget / summary values were truncated with no
way to read them); fix shipped as commit `96ddc65` ("fix(ui): make
EXTRACTED panel scroll independently + wrap long values") and
refined as commit `ce2de59` ("fix(ui): wrap intake + footer in
shrink-0 so detail grid keeps full viewport height").

**What the model did:**

The detail-view layout used a CSS grid where the DETAIL column had
no explicit height constraint. The EXTRACTED panel inside it grew
to its natural content height; if the content was taller than the
viewport, the panel overflowed the page (the page itself scrolled,
not the panel). Worse, `InlineField` value spans used `truncate`
(Tailwind's `overflow-hidden text-ellipsis whitespace-nowrap`) so
long budget strings like `"£400,000 – £600,000 over 6 months, paid
in tranches"` were clipped mid-character with no way to read the
full value.

The model's layout reasoning was correct in isolation (use a CSS
grid, let columns size to content), but it didn't account for the
combined height of STATUS + SOURCE + EXTRACTED + PRIORITY stacked
inside the DETAIL column at typical viewport heights, and it didn't
think about long values inside `InlineField` rows.

**Why it slipped through:**

The dev server initially had only short-field sample data (the
operator hadn't yet uploaded the real `sample-enquiries.txt` with
its genuinely long budget / summary strings). The pure-logic
frontend tests don't render components, so the visual overflow was
invisible to the test suite.

**Developer response (commit `96ddc65`):**

- Main container gets `lg:h-full lg:flex lg:flex-col lg:min-h-0
  lg:overflow-hidden` so the page itself doesn't scroll on desktop;
  the inner columns manage their own scroll.
- Grid changes to `lg:items-stretch lg:flex-1 lg:min-h-0` so the
  grid fills available height instead of sizing to content.
- Detail column wrapper becomes `lg:min-h-0 lg:overflow-y-auto
  lg:overflow-x-hidden` — the sole scroll container for STATUS +
  SOURCE + EXTRACTED + PRIORITY on desktop. The page no longer
  scrolls; only the detail column does.
- `InlineField` value span changes from `truncate` to
  `flex-1 min-w-0 break-words whitespace-normal` so long values
  wrap onto multiple lines instead of being clipped.
- `OriginalMessage` `<pre>` loses its `max-h-[60vh] overflow-auto`
  (the nested scrollbar was confusing — the parent detail column
  is now the sole scroll container).

**Developer response (commit `ce2de59`):**

- Wraps the `PasteEnquiry` strip + `BatchProgress` strip + footer in
  `shrink-0` divs so the detail grid keeps full viewport height
  instead of being squeezed by the intake panel's natural height.

**Lesson:** Pure-logic frontend tests are not enough for visual layout
correctness. The decision to skip `@testing-library/react` + jsdom
was a reasonable cost-saving at the time, but it left a class of
bugs (CSS height / overflow interactions) that only a rendering test
or a manual screenshot could catch. See `SELF-REVIEW.md` finding #2.

---

## Mistake #4 — The model tried to emit a `priority` field, twice

**When:** surfaced when the extraction prompt was first written and
re-surfaced during the prompt-injection audit. Caught both times by
the schema layer before any priority was persisted.

**What the model did:**

On two separate occasions, the model (mocked LLM in unit tests, and
the coding-assistant LLM that drafted an early version of the
extraction prompt) included a `priority` field in the extraction
output. The first time it was `"priority": "high"`; the second time
it was `"priority": {"level": "high", "score": 9, "reasons":
[...]}` — a more elaborate structure that looked plausible but
violated the same rule.

The contract is explicit: "The LLM is an extractor, not an
authority. The model may NOT calculate authoritative priority." It
reinforces: "Priority is calculated from effective structured
fields."

**Why it matters:**

If the model's `priority` field had been accepted, the deterministic
scoring service would have been bypassed — the operator would see
a priority that the model "decided" rather than one computed from
the effective extraction fields. A spam message with a model-emitted
`priority: "high"` would jump to the top of the queue regardless of
its actual commercial signal.

**Developer response:**

Implemented a four-layer priority guard:

1. **Zod schema** (`extractionSchema.js`) does not declare a
   `priority` field. `.strict()` rejects unknown keys, so any
   `priority` key in the model output causes the entire extraction
   to be classified `INVALID_OUTPUT` with `recoverable=false`
   (Gemini fallback NOT called).
2. **JSON Schema** handed to the model (`extractionJsonSchema.js`)
   does not include `priority`. The model never sees `priority` as
   an available field in the structured-output contract.
3. **Prompt** (`extractionPrompt.js`) explicitly tells the model
   "Do NOT emit a top-level `priority` field. Priority is computed
   by application code, not by you."
4. **Tests** verify priority's absence at all three layers:
   `extractionSchema.test.js` ("rejects priority field"),
   `extractionJsonSchema.test.js` ("priority is not in the JSON
   schema"), `groqProvider.test.js` and `geminiProvider.test.js`
   (canonical-schema assertions don't include priority).

**Lesson:** "Don't do X" in the prompt is not enough. The model
will occasionally ignore prose instructions, especially when the
instruction conflicts with its training distribution (priority
fields are common in classification tasks). The boundary must be
enforced structurally (schema exclusion) and verified by tests, not
just by prompt language.

---

## Mistake #5 — Multiple subtle UX gaps left by the coding-assistant LLM across the build

**When:** surfaced during the UX polish audit (commit `387fa15`).
Several smaller AI-generated UX decisions needed correction; they
are bundled here because they share a root cause.

**What the model did (or didn't do):**

1. **Queue rows had no ArrowUp / ArrowDown / Home / End keyboard
   navigation.** Rows were `<button>` elements (so focusable), but
   the only way to move between them was Tab, which is linear and
   doesn't skip the action buttons inside each row. The design spec
   explicitly requires "Keyboard navigation through table rows and
   editable fields". The model implemented focusability but not
   navigation.
2. **Confirmed fields had only an accent left border.** The design
   spec says "no dramatic colour fill" but a subtle background tint
   is appropriate to make confirmed fields pop when scanning. The
   model interpreted "no dramatic colour fill" as "no background
   fill at all", which made confirmed fields visually identical to
   model fields at a glance.
3. **SOURCE label was `text-ink-muted`** (same as other section
   headers). The acceptance criterion says "original text remains
   visually prominent" — the SOURCE panel should read as the
   authoritative evidence surface, not just another section header.
4. **Queue skeleton was 4 rows of 2 lines each;** detail skeleton
   was 3 lines. Neither matched the real row / panel structure.
   The design spec says "skeleton rows that preserve the table
   structure". The model used a generic skeleton shape instead of
   mirroring the actual content layout.
5. **`BatchProgress` importing state was a single `animate-pulse`
   text line.** No progress shape was visible during the upload +
   parse phase. The model treated "importing" as a single transient
   state rather than a multi-segment progress affordance.
6. **`transition-colors` had no explicit duration.** The design spec
   says "120–180ms transitions". The model used Tailwind's default
   `transition-colors` (which is 150ms in v3 but not guaranteed
   across versions). Acceptable, but not explicit.

**Why these slipped through:**

Each individual decision was defensible in isolation. The model
correctly cited the design spec; it just consistently chose the
more conservative interpretation. The cumulative effect was a UI
that worked but didn't fully deliver on the design system's intent.

**Developer response (commit `387fa15`):**

- Added `nextQueueIndex(length, currentIndex, key)` pure helper to
  `format.js`; `EnquiryQueue` got `handleKeyDown` + roving
  `tabIndex` (selected row = 0, others = -1) + `role="listbox"` /
  `role="option"` ARIA attributes + manual DOM focus management.
  17 new tests in `frontend/tests/keyboardNav.test.js`.
- Added `bg-accent-soft/30` background tint to confirmed fields in
  `InlineField.jsx` (in addition to the existing accent left border).
  Tint is at 30% opacity over the warm surface so it reads as a
  faint highlighter mark, not a coloured block.
- `OriginalMessage.jsx` SOURCE label changed from `text-ink-muted`
  to `text-ink` (full strength); added `IMMUTABLE` pill next to the
  label; border upgraded from `border-line` to `border-line-strong`;
  `<pre>` gets `leading-relaxed`.
- Queue skeleton upgraded to 5 rows with priority rail + 3-line
  structure + `aria-busy="true"`. Detail skeleton upgraded to 5
  lines.
- `BatchProgress.jsx` importing state now shows a 12-segment
  skeleton bar with staggered animation delays (80ms apart).
- All `transition-colors` changed to `transition-colors duration-150`
  across `FilterRail`, `SortBar`, `StatusTrack`, `InlineField`.

**Lesson:** AI-generated UI code tends to under-deliver on visual
hierarchy. The model reads "restrained" or "no dramatic" and
interprets it as "minimum viable". A human reviewer with the design
spec open must explicitly demand the intended emphasis (label
strength, background tint, skeleton fidelity). This is most
efficient as a single dedicated polish pass rather than catching
each gap piecemeal during the build.

---

## Mistake #6 — Test-assertion bugs (twice)

**When:** Parser tests (first run: 17/19 passed — two "failures"
were test bugs, not parser bugs); unit tests for the extraction
layer (three test bugs in the first run).

**What the model did:**

When the coding-assistant LLM wrote tests, it sometimes asserted
against an incorrect API contract or used the wrong assertion
shape. Examples:

- Parser tests: asserted that `sender.email` was strictly validated
  for file-imported enquiries. The parser actually needs to tolerate
  missing / malformed sender emails in file imports (the sample
  file has blocks with no `From:` line at all). The parser was
  correct; the test assertion was wrong.
- Extraction unit tests: asserted zod's `unrecognized_keys` error
  was at `error.path` — actually it's at `error.keys` in zod 3.x.
  The schema was correct; the test used the wrong assertion
  property.
- Extraction unit tests: asserted a mock method's return shape that
  didn't match how `vitest` mocks actually return values. The
  implementation was correct; the mock setup was wrong.
- Extraction unit tests: URL-encoded a fixture path that didn't
  need encoding. The fixture loading was correct; the test
  over-engineered the path.

**Developer response:**

- Made `sender.email` validation source-aware (strict for paste,
  tolerant for file). Re-tested: 20/20 persisted.
- Fixed 3 test bugs (zod `unrecognized_keys` uses `keys` not
  `path`; mock.method return shape; fixture path URL-encoding).
  Final: 85/85 unit tests pass.

**Lesson:** When a test fails, the first question is "is the test
right?" not "is the code wrong?". AI-generated tests inherit the
model's assumptions about the API contract — if the model's mental
model of the contract is slightly off, the test will assert against
the wrong shape and the implementation will look broken. Always
cross-reference the test assertion against the actual
source-of-truth (the schema, the controller, the design spec)
before "fixing" the implementation to match a failing test.

---

## Summary

Six concrete AI mistakes are recorded above. The pattern across all
six:

| # | Mistake | Layer caught | Layer fixed |
|---|---|---|---|
| 1 | snake_case + null budget/timeline | Live LLM call (post-deploy) | Canonical contract across 3 layers |
| 2 | Hallucinated company name | Effective-value design | Override semantics (null vs non-null) |
| 3 | EXTRACTED panel overflow + clipped values | Screenshots | CSS height/overflow + `break-words` |
| 4 | Model emitted `priority` field | Schema layer (immediate) | Four-layer priority guard |
| 5 | Subtle UX gaps across the build | Polish audit | Dedicated UX polish pass |
| 6 | Test-assertion bugs (twice) | Test failure (first run) | Cross-reference assertion vs source-of-truth |

The bar applied: a mistake is "meaningful" if it influenced the
shipped design (Mistake #1, #2, #4, #5) or if it required
non-trivial developer intervention to diagnose (Mistake #3, #6).
Trivial mistakes (typos, missing imports, lint warnings caught on
first run) are not recorded.
