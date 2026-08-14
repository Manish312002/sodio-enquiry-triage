# SELF-REVIEW

Three blunt review findings about this submission. The task brief asks for "three blunt review findings"
— not three compliments with a polite criticism attached. Each
finding below names a real gap, explains why it matters, and
proposes the smallest fix that would close it.

---

## Finding #1 — Live end-to-end verification of the final phases is missing

**What's missing:**

The build sandbox that produced this commit has no MongoDB instance
and no outbound network access to `api.groq.com` or
`generativelanguage.googleapis.com`. As a result:

- **85 backend integration tests** (Phase 3 extractionService +
  Phase 4 enquiryService + Phase 6 humanOverrideService + Phase 7
  reExtractService + Phase 8 batchService) require a real MongoDB
  and have NOT been run in the sandbox that produced this commit.
  They were verified in earlier sandboxes (memory.md records
  85/85 PASS for each phase as it landed) but the sandbox resets
  between sessions, so there is no current proof they all pass
  together on the final commit (`43deae4`).
- **Live LLM extraction** has never been successfully executed
  against a real Groq API key in any sandbox. The Canonical
  Contract Fix (commit `071f793`) was driven by an observed
  snake_case / null budget output from a live `gpt-oss-20b` call
  in an earlier sandbox, but the fix itself was verified with
  mocked LLM HTTP. There is no current proof that real
  `gpt-oss-20b` returns valid canonical-contract output for our
  prompt + JSON Schema combination.
- **Live Gemini fallback path** has never been triggered by a real
  Groq provider error. Unit tests mock both providers and verify
  the fallback chain, but the actual "Groq returned 503 → Gemini
  succeeds" sequence has only been verified with mocks.

**Why it matters:**

The repository ships with a `npm run test:integration` script that
the operator is expected to run locally with MongoDB. If the
operator runs it and 5 tests fail because of a regression
introduced in Phase 9 or Phase 10 (which only touched frontend +
middleware + a Gemini provider timeout wrapper, but a regression
is conceivable), the failure surfaces during evaluation, not
during build. Same for live LLM extraction: if `gpt-oss-20b`
drifted again since the Canonical Contract Fix was written, the
first signal will be an operator complaint, not a build-time
test failure.

**Smallest fix:**

Two commands, both in the operator's hands (the sandbox cannot
run them):

```bash
# 1. Integration tests with real MongoDB
cd backend
npm run test:integration    # 85 tests, ~30s

# 2. Live canonical-extraction verification with real Groq key
cp .env.example .env        # then edit .env: GROQ_API_KEY=gsk_...
node /home/z/my-project/scripts/verify-canonical-extraction.js
# runs the extraction against a real enquiry + verifies the
# canonical contract is honoured end-to-end
```

If I had half a day in a sandbox with MongoDB + egress, I would
run both, capture any failures, and patch before submission. I
don't, so I'm flagging it here.

---

## Finding #2 — Frontend component rendering tests are intentionally missing

**What's missing:**

The frontend test suite (`frontend/tests/`) contains 84 tests, all
of which are **pure-logic unit tests**:

- `format.test.js` — pure helpers (formatters, override detection,
  model/effective value resolution, allowlist boundary, conflict
  detection).
- `keyboardNav.test.js` — the `nextQueueIndex` pure helper for
  queue keyboard navigation.

There are zero tests that render a React component to the DOM and
assert on its output. The frontend has 11 components
(`EnquiryQueue`, `EnquiryDetail`, `FilterRail`, `SortBar`,
`ExtractionPanel`, `InlineField`, `OriginalMessage`, `StatusTrack`,
`PriorityBadge`, `PasteEnquiry`, `BatchProgress`); none of them
have a rendering test.

**Why it was skipped:**

Phase 6 decision 10: "Full React component
rendering tests would require adding `vitest` + `@testing-library/react`
+ `jsdom` as dev dependencies — Phase 3-5 deliberately added zero
new test deps, and Phase 6 honours that constraint."

**Why it matters:**

This is the root cause of Mistake #3 in `AI-LOG.md` (the EXTRACTED
panel overflow + clipped long values bug that needed commit to fix). The pure-logic tests verified that
`formatFieldValue(budget)` returned the right string, but they
couldn't catch that the string was being rendered inside a
`truncate` span that clipped it. The bug was only visible in a
screenshot.

The same gap explains why Phase 10 needed a dedicated polish pass
(Mistake #5 in `AI-LOG.md`): the subtle UX gaps (missing keyboard
nav, weak SOURCE label, weak confirmed-field tint, generic
skeleton shape) were all invisible to the pure-logic test suite.
A rendering test for `EnquiryDetail` against a representative
enquiry fixture would have caught the SOURCE label strength issue
on the first run; a rendering test for `InlineField` with an
override active would have caught the missing tint.

**Smallest fix:**

Add three dev dependencies and one smoke test per component:

```bash
cd frontend
npm i -D vitest @testing-library/react jsdom
```

Then write rendering smoke tests for the three highest-risk
components: `EnquiryDetail` (verifies SOURCE / EXTRACTED /
PRIORITY all render against a representative enquiry fixture),
`ExtractionPanel` (verifies MODEL vs CONFIRMED visual distinction
renders correctly), `EnquiryQueue` (verifies the queue renders
the right number of rows + that the selected row has `tabIndex=0`
and others have `tabIndex=-1`).

Estimated effort: half a day. Estimated return: catches the next
visual regression before it ships, not after.

---

## Finding #3 — Live LLM extraction is unverified against the real Groq API

**What's missing:**

The Canonical Extraction Contract Fix (commit, documented
in `AI-LOG.md` Mistake #1) was driven by observed live Groq output
(snake_case field names, `null` budget, `null` timeline). The fix
layered a JSON Schema into the provider request so the model
receives the canonical contract directly, not just a prose
description in the prompt.

The fix was verified with **mocked LLM HTTP** — the unit tests in
`extractionService.test.js`, `groqProvider.test.js`, and
`geminiProvider.test.js` mock the SDK calls and assert that the
right JSON Schema is passed to the provider. They prove the
contract is correctly *sent*. They do not prove that real
`gpt-oss-20b` *honours* the contract.

**Why it matters:**

The whole point of the Canonical Contract Fix was to stop the model
from drifting to snake_case / null budget / null timeline. If the
model still drifts (because `strict: false` in the JSON Schema
gives it permission to, or because `gpt-oss-20b` has a quirk where
it ignores `response_format` for certain prompt structures), the
first signal will be an operator complaint that "extraction is
failing for these 5 enquiries" — not a build-time test failure.

There's a related risk: the JSON Schema and the Zod schema are
hand-aligned. If a future change updates one but not the other,
`extractionJsonSchema.test.js` (15 alignment tests) will catch
the drift. But the alignment tests only verify the schemas match
each other; they don't verify the schemas match what the model
actually emits.

**Smallest fix:**

The repository already includes
`/home/z/my-project/scripts/verify-canonical-extraction.js` — a
live-verification script that takes a real `gsk_...` key, runs the
extraction against a sample enquiry, and asserts the response
honours the canonical contract. The operator (or the evaluator)
can run it:

```bash
cd backend
cp .env.example .env        # then edit .env: GROQ_API_KEY=gsk_...
node /home/z/my-project/scripts/verify-canonical-extraction.js
```

What's missing is a **regression corpus** — a directory of
~20 representative enquiries (the sample file already provides
this) with expected extraction fields checked in, and a script
that runs all 20 through real Groq and reports any field that
drifts from the expected shape. This would let a CI run catch
model drift before it ships. Estimated effort: half a day to
write the script + capture the expected outputs once; subsequent
runs are free.

Until that exists, the canonical contract is a well-tested
*contract* but an unverified *behaviour*.

---

## Summary

| # | Finding | Severity | Smallest fix |
|---|---|---|---|
| 1 | Live end-to-end verification of final phases missing | High | Run `npm run test:integration` + `verify-canonical-extraction.js` locally (operator) |
| 2 | Frontend component rendering tests intentionally missing | Medium | Add `@testing-library/react` + jsdom + 3 smoke tests (~half day) |
| 3 | Live LLM extraction unverified against real Groq API | Medium | Run `verify-canonical-extraction.js` + add a regression-corpus script (~half day) |

All three findings share a root cause: the build sandbox has
limited infrastructure (no MongoDB, no outbound network to LLM
providers, no headless browser for component rendering tests).
The code is structured to make all three verifications possible
locally — the test scripts exist, the verification script exists,
the dependency surface for `@testing-library/react` is small. What's
missing is the execution environment, not the design.
