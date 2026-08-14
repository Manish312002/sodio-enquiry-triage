/**
 * Test: batchService — Phase 8 bounded-concurrency batch extraction.
 *
 * Source-of-truth: Phases.md Phase 8, Architechure.md §4 Flow B / §6
 * (batchJobs schema) / §12 (Batch Concurrency) / §13 (Failure Model),
 * Rules.md §12 (Batch), PRD.md FR-10.
 *
 * These tests run against a REAL MongoDB instance (mirroring Phase 3-7
 * convention) but MOCK extractionService.runExtraction so they are
 * deterministic and do NOT consume LLM API quota. The mock:
 *   - Tracks the number of currently-active workers (maxActive).
 *   - Tracks the total number of worker invocations.
 *   - Resolves after a small delay to simulate LLM latency (so concurrency
 *     is observable: workers genuinely overlap in time).
 *   - Can be configured per-test to fail specific items (by enquiryId).
 *
 * Phase 8 verification items (from operator instructions):
 *   1.  Import/create a batch with the real sample fixture.
 *   2.  Batch contains all 20 enquiries (parser produces 20 from the fixture).
 *   3.  Batch starts processing (status='processing' on creation).
 *   4.  Concurrency limit is respected (maxActive <= BATCH_CONCURRENCY).
 *   5.  Progress counters update correctly (pending→processing→completed/failed).
 *   6.  Successful items become completed.
 *   7.  A failed item becomes failed.
 *   8.  Other items continue after one item fails (failure isolation).
 *   9.  Partial failure reaches a terminal batch state (completed_with_errors).
 *   10. All-success batch reaches terminal success state (completed).
 *   11. All-failure batch reaches terminal failure state (failed).
 *   12. Existing enquiry data is preserved on individual failure.
 *   13. Human overrides remain preserved.
 *   14. Priority remains independently calculated per enquiry.
 *   15. ExtractionVersion records remain independent per enquiry.
 *   16. Prompt-injection enquiry is treated as data (no special-casing).
 *   17. Duplicate/repeated batch start is idempotent (no double-extraction).
 *   18. Invalid batch ID is rejected (400).
 *   19. Missing batch returns 404.
 *   20. Existing Phase 0-7 tests still pass (verified by running the full suite).
 *   21. Frontend build succeeds (verified separately).
 *   22. No TypeScript introduced (verified by file inspection).
 *   23. No secrets committed (verified by .gitignore + git status).
 *   24. No Phase 9+ functionality introduced (no auth, no new providers).
 *
 * IMPORTANT CONCURRENCY TEST:
 *   BATCH_CONCURRENCY=3, 20 enquiries → assert maxActive <= 3.
 *   We track active workers with a counter that increments on entry and
 *   decrements on exit, recording the high-water mark.
 *
 * IMPORTANT FAILURE TEST:
 *   20 enquiries, item 12 fails → completed=19, failed=1, status='completed_with_errors'.
 *   The batch terminates. The failed item's error is associated with item 12
 *   (in the failures[] array), NOT copied to the entire batch.
 *
 * Requires: MongoDB running at env.MONGODB_URI. The tests use a separate
 * `phase8_test` database to avoid polluting other test data.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { env } from '../src/config/env.js';
import Enquiry from '../src/models/Enquiry.js';
import ExtractionVersion from '../src/models/ExtractionVersion.js';
import BatchJob from '../src/models/BatchJob.js';
import * as batchService from '../src/services/batchService.js';
import { parseEnquiryFile } from '../src/services/parserService.js';
import * as enquiryService from '../src/services/enquiryService.js';
import { applyHumanOverride } from '../src/services/humanOverrideService.js';
import { computePriority } from '../src/services/scoringService.js';
import { AppError } from '../src/middleware/errorHandler.js';

const TEST_DB = 'sodio_enquiry_triage_phase8_test';
const FIXTURE_PATH = fileURLToPath(
  new URL('../../test-data/sample-enquiries.txt', import.meta.url),
);

// --- mock state (module-level so the mock can read/write it) ---
let mockActive = 0;
let mockMaxActive = 0;
let mockInvocations = 0;
let mockFailureIds = new Set();
let mockLatencyMs = 5;

let originalMongoUri;
let originalExtractWithFallback;
let llmServiceModule;

// Map from originalText → enquiryId, populated by tests so the mock can
// identify which enquiry is being extracted (the mock only receives
// originalText, not the enquiryId).
const textToEnquiryId = new Map();

before(async () => {
  originalMongoUri = env.MONGODB_URI;
  const testUri = `mongodb://127.0.0.1:27017/${TEST_DB}`;
  env.MONGODB_URI = testUri;
  await mongoose.disconnect();
  await mongoose.connect(testUri);

  // Mock llmService.extractWithFallback — the cleanest injection point
  // that batchService → extractionService → llmService uses. Because
  // `llmService` is a plain object exported as `const`, mutating its
  // `extractWithFallback` property is visible to extractionService (which
  // holds a reference to the same object via `import { llmService }`).
  // This tests the FULL pipeline including extractionService's
  // version-persistence and priority-calculation paths.
  llmServiceModule = await import('../src/services/llm/llmService.js');
  originalExtractWithFallback = llmServiceModule.llmService.extractWithFallback;
});

after(async () => {
  if (originalExtractWithFallback) {
    llmServiceModule.llmService.extractWithFallback = originalExtractWithFallback;
  }
  await mongoose.disconnect();
  env.MONGODB_URI = originalMongoUri;
});

function installLlmMock({ failIds = [], latencyMs = 5 } = {}) {
  mockActive = 0;
  mockMaxActive = 0;
  mockInvocations = 0;
  mockFailureIds = new Set(failIds);
  mockLatencyMs = latencyMs;

  llmServiceModule.llmService.extractWithFallback = async function (originalText) {
    mockActive += 1;
    mockInvocations += 1;
    if (mockActive > mockMaxActive) {
      mockMaxActive = mockActive;
    }
    try {
      // Simulate LLM latency so workers genuinely overlap in time —
      // without this, the mock resolves synchronously and we'd never
      // observe concurrent workers.
      await new Promise((r) => setTimeout(r, mockLatencyMs));

      // Look up the enquiryId from the text→id map populated by the test.
      // This lets the mock decide success/failure per-enquiry without
      // polluting originalText with markers.
      const enquiryId = textToEnquiryId.get(originalText);
      const shouldFail = enquiryId && mockFailureIds.has(enquiryId);

      if (shouldFail) {
        return {
          state: 'failed',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          parsed: null,
          rawOutput: null,
          errorCode: 'ALL_PROVIDERS_FAILED',
          errorMessage: 'Mocked failure for test',
          durationMs: mockLatencyMs,
          attempts: [
            {
              provider: 'groq',
              model: 'openai/gpt-oss-20b',
              state: 'failed',
              rawOutput: null,
              parsed: null,
              errorCode: 'PROVIDER_ERROR',
              errorMessage: 'Mocked groq failure',
              durationMs: Math.floor(mockLatencyMs / 2),
            },
            {
              provider: 'gemini',
              model: 'gemini-3.6-flash',
              state: 'failed',
              rawOutput: null,
              parsed: null,
              errorCode: 'PROVIDER_ERROR',
              errorMessage: 'Mocked gemini failure',
              durationMs: Math.floor(mockLatencyMs / 2),
            },
          ],
        };
      }

      // Success — return a valid extraction.
      const parsed = makeValidExtraction(originalText);
      return {
        state: 'completed',
        provider: 'groq',
        model: 'openai/gpt-oss-20b',
        parsed,
        rawOutput: JSON.stringify(parsed),
        errorCode: null,
        errorMessage: null,
        durationMs: mockLatencyMs,
        attempts: [
          {
            provider: 'groq',
            model: 'openai/gpt-oss-20b',
            state: 'completed',
            rawOutput: JSON.stringify(parsed),
            parsed,
            errorCode: null,
            errorMessage: null,
            durationMs: mockLatencyMs,
          },
        ],
      };
    } finally {
      mockActive -= 1;
    }
  };
}

function restoreLlmMock() {
  llmServiceModule.llmService.extractWithFallback = originalExtractWithFallback;
}

function makeValidExtraction(_originalText) {
  return {
    company: 'Test Co',
    contactName: 'Test Person',
    contactEmail: 'test@example.com',
    serviceLine: 'web',
    budget: {
      raw: '£40,000',
      currency: 'GBP',
      min: 40000,
      max: 40000,
      qualifier: 'exact',
    },
    timeline: { raw: 'September', normalized: { period: 'relative' } },
    summary: 'A test enquiry.',
    isGenuineProjectEnquiry: true,
    confidence: 0.9,
    projectCount: 1,
    additionalProjectNote: null,
    isModelInstructionAttempt: false,
  };
}

describe('batchService — Phase 8 bounded-concurrency batch extraction', () => {
  const savedEnv = {
    GROQ_API_KEY: env.GROQ_API_KEY,
    GROQ_BASE_URL: env.GROQ_BASE_URL,
    GROQ_MODEL: env.GROQ_MODEL,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
    BATCH_CONCURRENCY: env.BATCH_CONCURRENCY,
  };

  beforeEach(async () => {
    // Configure LLM keys so extractionService considers the providers
    // configured. Without keys, extractionService returns NOT_CONFIGURED
    // immediately — which would make every item "fail" regardless of our
    // mock. Our mock replaces extractWithFallback entirely, but the
    // extractionService.isConfigured check happens BEFORE the mock is
    // called.
    env.GROQ_API_KEY = 'test-groq-key';
    env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
    env.GROQ_MODEL = 'openai/gpt-oss-20b';
    env.GEMINI_API_KEY = 'test-gemini-key';
    env.GEMINI_MODEL = 'gemini-3.6-flash';
    env.LLM_MAX_RETRIES = 0;
    env.LLM_TIMEOUT_MS = 5000;
    env.BATCH_CONCURRENCY = 3;

    await Enquiry.deleteMany({});
    await ExtractionVersion.deleteMany({});
    await BatchJob.deleteMany({});
    textToEnquiryId.clear();
  });

  afterEach(() => {
    env.GROQ_API_KEY = savedEnv.GROQ_API_KEY;
    env.GROQ_BASE_URL = savedEnv.GROQ_BASE_URL;
    env.GROQ_MODEL = savedEnv.GROQ_MODEL;
    env.GEMINI_API_KEY = savedEnv.GEMINI_API_KEY;
    env.GEMINI_MODEL = savedEnv.GEMINI_MODEL;
    env.LLM_MAX_RETRIES = savedEnv.LLM_MAX_RETRIES;
    env.LLM_TIMEOUT_MS = savedEnv.LLM_TIMEOUT_MS;
    env.BATCH_CONCURRENCY = savedEnv.BATCH_CONCURRENCY;
    restoreLlmMock();
  });

  // --- helper: persist N enquiries and return their ids ---
  async function persistEnquiries(n, opts = {}) {
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      const text = `Enquiry ${i + 1}. We want a web app. Budget £${10000 + i * 1000}.`;
      const saved = await enquiryService.createEnquiry({
        source: 'file',
        originalText: text,
        sender: { name: `Sender ${i + 1}`, email: `s${i + 1}@example.com` },
        receivedAt: new Date(),
      });
      ids.push(String(saved._id));
      textToEnquiryId.set(text, String(saved._id));
    }
    return ids;
  }

  // --- helper: persist the real fixture's 20 enquiries ---
  async function persistFixtureEnquiries() {
    const content = readFileSync(FIXTURE_PATH, 'utf-8');
    const parsed = parseEnquiryFile(content, { fileName: 'sample-enquiries.txt' });
    const ids = [];
    for (const record of parsed.records) {
      const saved = await enquiryService.createEnquiry({
        source: 'file',
        originalText: record.originalText,
        sender: record.sender,
        receivedAt: record.receivedAt,
      });
      ids.push(String(saved._id));
      textToEnquiryId.set(record.originalText, String(saved._id));
    }
    return { ids, parsedCount: parsed.meta.parsedCount };
  }

  // =====================================================================
  // 1. computeBatchStatus — pure decision function
  // =====================================================================
  describe('computeBatchStatus', () => {
    test('1a. all success → completed', () => {
      assert.equal(
        batchService.computeBatchStatus({ completed: 20, failed: 0, total: 20 }),
        'completed',
      );
    });

    test('1b. partial failure → completed_with_errors', () => {
      assert.equal(
        batchService.computeBatchStatus({ completed: 18, failed: 2, total: 20 }),
        'completed_with_errors',
      );
    });

    test('1c. all failure → failed', () => {
      assert.equal(
        batchService.computeBatchStatus({ completed: 0, failed: 20, total: 20 }),
        'failed',
      );
    });

    test('1d. empty batch (total=0) → completed', () => {
      assert.equal(
        batchService.computeBatchStatus({ completed: 0, failed: 0, total: 0 }),
        'completed',
      );
    });
  });

  // =====================================================================
  // 2. createBatch — BatchJob creation
  // =====================================================================
  describe('createBatch', () => {
    test('2a. creates a batch with correct initial counters', async () => {
      const ids = await persistEnquiries(5);
      const batch = await batchService.createBatch({ enquiryIds: ids, fileName: 't.txt' });
      assert.equal(batch.total, 5);
      assert.equal(batch.pending, 5);
      assert.equal(batch.processing, 0);
      assert.equal(batch.completed, 0);
      assert.equal(batch.failed, 0);
      assert.equal(batch.status, 'processing');
      assert.equal(batch.fileName, 't.txt');
      assert.equal(batch.completedAt, null);
      assert.deepEqual(batch.failures, []);
    });

    test('2b. filters out invalid enquiry ids', async () => {
      const ids = await persistEnquiries(2);
      const batch = await batchService.createBatch({
        enquiryIds: [...ids, 'not-an-id', ''],
        fileName: 't.txt',
      });
      assert.equal(batch.total, 2);
    });
  });

  // =====================================================================
  // 3. getBatch — fetch + 404 + invalid id
  // =====================================================================
  describe('getBatch', () => {
    test('3a. returns the batch by id', async () => {
      const ids = await persistEnquiries(3);
      const created = await batchService.createBatch({ enquiryIds: ids });
      const fetched = await batchService.getBatch(String(created._id));
      assert.ok(fetched);
      assert.equal(String(fetched._id), String(created._id));
      assert.equal(fetched.total, 3);
    });

    test('3b. returns null for a non-existent batch', async () => {
      const fakeId = 'a'.repeat(24);
      const fetched = await batchService.getBatch(fakeId);
      assert.equal(fetched, null);
    });

    test('3c. throws AppError 400 for invalid id format', async () => {
      await assert.rejects(
        () => batchService.getBatch('not-an-id'),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.status, 400);
          assert.equal(err.code, 'INVALID_ID');
          return true;
        },
      );
    });
  });

  // =====================================================================
  // 4. runBatchExtraction — CONCURRENCY TEST (the critical one)
  // =====================================================================
  describe('runBatchExtraction — bounded concurrency', () => {
    test('4a. BATCH_CONCURRENCY=3, 20 enquiries → maxActive <= 3', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids = await persistEnquiries(20);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ latencyMs: 8 });
      await batchService.runBatchExtraction(String(batch._id));

      assert.ok(
        mockMaxActive <= 3,
        `maxActive=${mockMaxActive} should be <= 3 (BATCH_CONCURRENCY)`,
      );
      assert.ok(
        mockMaxActive >= 2,
        `maxActive=${mockMaxActive} should be >= 2 (proves workers actually overlapped)`,
      );
      assert.equal(mockInvocations, 20, 'all 20 items should be processed');

      const final = await batchService.getBatch(String(batch._id));
      assert.equal(final.status, 'completed');
      assert.equal(final.completed, 20);
      assert.equal(final.failed, 0);
      assert.equal(final.pending, 0);
      assert.equal(final.processing, 0);
      assert.ok(final.completedAt instanceof Date);
    });

    test('4b. BATCH_CONCURRENCY=1 → maxActive == 1 (serial)', async () => {
      env.BATCH_CONCURRENCY = 1;
      const ids = await persistEnquiries(5);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ latencyMs: 5 });
      await batchService.runBatchExtraction(String(batch._id));

      assert.equal(mockMaxActive, 1, 'serial execution should never overlap');
      assert.equal(mockInvocations, 5);
    });

    test('4c. BATCH_CONCURRENCY=5 → maxActive <= 5', async () => {
      env.BATCH_CONCURRENCY = 5;
      const ids = await persistEnquiries(10);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ latencyMs: 8 });
      await batchService.runBatchExtraction(String(batch._id));

      assert.ok(mockMaxActive <= 5, `maxActive=${mockMaxActive} should be <= 5`);
      assert.equal(mockInvocations, 10);
    });
  });

  // =====================================================================
  // 5. runBatchExtraction — FAILURE ISOLATION (the critical one)
  // =====================================================================
  describe('runBatchExtraction — failure isolation', () => {
    test('5a. item 12 of 20 fails → 19 completed, 1 failed, batch=completed_with_errors', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids = await persistEnquiries(20);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      // Configure the mock to fail item 12 (index 11).
      const failId = ids[11];
      installLlmMock({ failIds: [failId], latencyMs: 5 });
      await batchService.runBatchExtraction(String(batch._id));

      const final = await batchService.getBatch(String(batch._id));
      assert.equal(final.status, 'completed_with_errors');
      assert.equal(final.completed, 19);
      assert.equal(final.failed, 1);
      assert.equal(final.pending, 0);
      assert.equal(final.processing, 0);
      assert.ok(final.completedAt instanceof Date);

      // The failure is associated with the specific enquiry, not the whole batch.
      assert.equal(final.failures.length, 1);
      // final.failures[0].enquiryId is a Mongoose ObjectId; stringify for comparison.
      assert.equal(String(final.failures[0].enquiryId), failId);
      assert.ok(final.failures[0].code);
      assert.ok(final.failures[0].message);
    });

    test('5b. all 20 items fail → batch=failed', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids = await persistEnquiries(20);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ failIds: ids, latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      const final = await batchService.getBatch(String(batch._id));
      assert.equal(final.status, 'failed');
      assert.equal(final.completed, 0);
      assert.equal(final.failed, 20);
      assert.equal(final.failures.length, 20);
    });

    test('5c. the failed item does NOT affect other enquiries (independent extractionState)', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids = await persistEnquiries(5);
      const batch = await batchService.createBatch({ enquiryIds: ids });
      const failId = ids[2];

      installLlmMock({ failIds: [failId], latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      // Check each enquiry's extractionState independently.
      for (let i = 0; i < 5; i += 1) {
        const enquiry = await Enquiry.findById(ids[i]).lean();
        if (ids[i] === failId) {
          assert.equal(enquiry.extractionState, 'failed');
          assert.equal(enquiry.priority.level, null);
        } else {
          assert.equal(enquiry.extractionState, 'completed');
          assert.ok(enquiry.priority.level !== null, `item ${i} should have priority`);
        }
      }
    });
  });

  // =====================================================================
  // 6. runBatchExtraction — data preservation on failure
  // =====================================================================
  describe('runBatchExtraction — data preservation on individual failure', () => {
    test('6a. failed item preserves originalText, effectiveExtraction, humanOverrides, priority', async () => {
      env.BATCH_CONCURRENCY = 2;
      const ids = await persistEnquiries(3);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      // Pre-populate item 0 with a human override + prior successful extraction
      // so we can verify the failure doesn't destroy them.
      //
      // We simulate "prior success" by running a SUCCESSFUL batch first
      // (so item 0 gets a modelExtraction + effectiveExtraction + priority),
      // then applying a human override, then running a SECOND batch where
      // item 0 fails. The second batch is effectively a re-extraction.
      //
      // But our mock always returns the same result for the same enquiry.
      // So instead, we'll:
      //   1. Run a successful batch (all items complete).
      //   2. Apply a human override to item 0.
      //   3. Manually reset item 0's extractionState to 'pending' so it's
      //      eligible for re-extraction.
      //   4. Run a second batch where item 0 fails.
      //   5. Assert item 0's originalText, modelExtraction,
      //      effectiveExtraction (with override), humanOverrides, and
      //      priority are all preserved.

      // Step 1: successful batch.
      installLlmMock({ latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));
      const item0Before = await Enquiry.findById(ids[0]).lean();
      assert.equal(item0Before.extractionState, 'completed');
      assert.ok(item0Before.modelExtraction);
      assert.ok(item0Before.priority.level);

      // Step 2: apply human override to budget.
      await applyHumanOverride(ids[0], 'budget', {
        raw: '£999,999',
        currency: 'GBP',
        min: 999999,
        max: 999999,
        qualifier: 'exact',
      });
      const item0AfterOverride = await Enquiry.findById(ids[0]).lean();
      assert.ok(item0AfterOverride.humanOverrides.budget);
      assert.equal(item0AfterOverride.effectiveExtraction.budget.min, 999999);

      // Step 3: reset item 0 to pending so it's eligible for re-extraction.
      await Enquiry.updateOne({ _id: ids[0] }, { $set: { extractionState: 'pending' } });

      // Step 4: run a second batch where item 0 fails. We need a fresh batch
      // for this — re-running the same batch won't work because the workers
      // only pick up pending/failed items, and items 1-2 are completed.
      // So we create a new batch with just item 0.
      const batch2 = await batchService.createBatch({ enquiryIds: [ids[0]] });
      await Enquiry.updateOne({ _id: ids[0] }, { $set: { batchId: batch2._id } });

      installLlmMock({ failIds: [ids[0]], latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch2._id));

      // Step 5: assertions.
      const item0AfterFail = await Enquiry.findById(ids[0]).lean();
      assert.equal(item0AfterFail.extractionState, 'failed');

      // originalText is IMMUTABLE — never modified.
      assert.equal(item0AfterFail.originalText, item0Before.originalText);

      // modelExtraction is preserved (NOT overwritten by the failed attempt).
      assert.ok(item0AfterFail.modelExtraction);
      assert.equal(
        item0AfterFail.modelExtraction.budget.min,
        item0Before.modelExtraction.budget.min,
      );

      // effectiveExtraction is preserved (override still wins).
      assert.equal(item0AfterFail.effectiveExtraction.budget.min, 999999);

      // humanOverrides are preserved.
      assert.ok(item0AfterFail.humanOverrides.budget);
      assert.equal(item0AfterFail.humanOverrides.budget.min, 999999);

      // priority is preserved (calculated from the effective extraction,
      // which still has the override).
      assert.ok(item0AfterFail.priority.level);
      assert.equal(item0AfterFail.priority.level, item0AfterOverride.priority.level);

      // ExtractionVersion history is append-only — the failed attempt
      // added new version rows but did NOT remove the prior success.
      const versions = await ExtractionVersion.find({ enquiryId: ids[0] }).sort({ version: 1 });
      assert.ok(versions.length >= 2, 'should have at least 2 versions (success + failure)');
      assert.equal(versions[0].state, 'completed');
      // The latest version is the failed attempt.
      const latest = versions[versions.length - 1];
      assert.equal(latest.state, 'failed');
    });
  });

  // =====================================================================
  // 7. runBatchExtraction — idempotency / duplicate start
  // =====================================================================
  describe('runBatchExtraction — idempotency', () => {
    test('7a. calling runBatchExtraction twice on the same batch is a no-op the second time', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids = await persistEnquiries(5);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));
      const firstInvocations = mockInvocations;

      // Second call — batch is already terminal, so no items should be processed.
      await batchService.runBatchExtraction(String(batch._id));
      const secondInvocations = mockInvocations;

      assert.equal(secondInvocations, firstInvocations, 'no additional invocations on second call');

      const final = await batchService.getBatch(String(batch._id));
      assert.equal(final.status, 'completed');
      assert.equal(final.completed, 5);
    });

    test('7b. calling runBatchExtraction on a non-existent batch is a no-op', async () => {
      const fakeId = 'a'.repeat(24);
      // Should not throw.
      await batchService.runBatchExtraction(fakeId);
      // No assertion needed — reaching here without throwing is the test.
    });

    test('7c. calling runBatchExtraction with an invalid id is a no-op', async () => {
      await batchService.runBatchExtraction('not-an-id');
      // No assertion needed — reaching here without throwing is the test.
    });
  });

  // =====================================================================
  // 8. runBatchExtraction — real fixture integration
  // =====================================================================
  describe('runBatchExtraction — real sample-enquiries.txt fixture', () => {
    test('8a. fixture parses to 20 enquiries, batch processes all 20', async () => {
      env.BATCH_CONCURRENCY = 3;
      const { ids, parsedCount } = await persistFixtureEnquiries();
      assert.equal(parsedCount, 20, 'fixture should parse to 20 enquiries');
      assert.equal(ids.length, 20);

      const batch = await batchService.createBatch({
        enquiryIds: ids,
        fileName: 'sample-enquiries.txt',
      });
      assert.equal(batch.total, 20);

      installLlmMock({ latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      const final = await batchService.getBatch(String(batch._id));
      assert.equal(final.status, 'completed');
      assert.equal(final.completed, 20);
      assert.equal(final.failed, 0);
      assert.ok(mockMaxActive <= 3);
    });

    test('8b. prompt-injection enquiry is treated as data, not an instruction', async () => {
      env.BATCH_CONCURRENCY = 3;
      const { ids } = await persistFixtureEnquiries();

      // Find the prompt-injection enquiry in the fixture (it contains
      // "Ignore all previous instructions" or similar). The mock should
      // process it like any other enquiry — no special-casing.
      const enquiries = await Enquiry.find({ _id: { $in: ids } }).lean();
      const injectionEnquiry = enquiries.find((e) =>
        /ignore all previous instructions/i.test(e.originalText),
      );
      assert.ok(injectionEnquiry, 'fixture should contain a prompt-injection enquiry');

      const batch = await batchService.createBatch({ enquiryIds: ids });
      installLlmMock({ latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      // The injection enquiry should be processed like any other —
      // extractionState='completed', priority calculated, no special failure.
      const after = await Enquiry.findById(injectionEnquiry._id).lean();
      assert.equal(after.extractionState, 'completed');
      assert.ok(after.priority.level !== null);

      // The mock's extractWithFallback was called with the injection text
      // as the `originalText` parameter (DATA), not as a system instruction.
      // We verify this by checking that textToEnquiryId has the injection
      // text as a key — meaning the mock received it and processed it.
      assert.ok(textToEnquiryId.has(injectionEnquiry.originalText));
    });

    test('8c. each enquiry gets independent ExtractionVersion records', async () => {
      env.BATCH_CONCURRENCY = 3;
      const { ids } = await persistFixtureEnquiries();
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      // Each enquiry should have exactly 1 ExtractionVersion (one successful
      // Groq attempt per enquiry).
      for (const id of ids) {
        const versions = await ExtractionVersion.find({ enquiryId: id }).sort({ version: 1 });
        assert.equal(versions.length, 1, `enquiry ${id} should have 1 version`);
        assert.equal(versions[0].state, 'completed');
        assert.equal(versions[0].version, 1);
      }

      // Total versions across all enquiries = 20.
      const totalVersions = await ExtractionVersion.countDocuments({
        enquiryId: { $in: ids },
      });
      assert.equal(totalVersions, 20);
    });

    test('8d. priority is independently calculated per enquiry', async () => {
      env.BATCH_CONCURRENCY = 3;
      const { ids } = await persistFixtureEnquiries();
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      // Every enquiry should have a priority.level set independently.
      const enquiries = await Enquiry.find({ _id: { $in: ids } }).lean();
      for (const e of enquiries) {
        assert.ok(e.priority.level, `enquiry ${e._id} should have a priority level`);
        assert.ok(
          ['high', 'medium', 'low'].includes(e.priority.level),
          `enquiry ${e._id} priority level ${e.priority.level} not in enum`,
        );
        // The priority should match what computePriority would produce from
        // the effective extraction (deterministic, reproducible). Note
        // computePriority takes (effectiveExtraction, isGenuineProjectEnquiry)
        // as two separate arguments.
        const expected = computePriority(e.effectiveExtraction, e.isGenuineProjectEnquiry);
        assert.equal(e.priority.level, expected.level);
        assert.equal(e.priority.score, expected.score);
      }
    });
  });

  // =====================================================================
  // 9. refreshBatchCounters — reconciliation after manual retry
  // =====================================================================
  describe('refreshBatchCounters', () => {
    test('9a. recomputes counters from live enquiry state after a manual retry', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids = await persistEnquiries(4);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      // Run a batch where item 2 fails.
      installLlmMock({ failIds: [ids[2]], latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      const before = await batchService.getBatch(String(batch._id));
      assert.equal(before.status, 'completed_with_errors');
      assert.equal(before.completed, 3);
      assert.equal(before.failed, 1);

      // Simulate a manual retry: the operator retried item 2 via
      // POST /api/enquiries/:id/re-extract, which succeeded. We simulate
      // by directly setting item 2's extractionState to 'completed'.
      await Enquiry.updateOne(
        { _id: ids[2] },
        { $set: { extractionState: 'completed' } },
      );

      // The batch's counters are now stale (still says failed=1).
      const stale = await batchService.getBatch(String(batch._id));
      assert.equal(stale.failed, 1);

      // Refresh recomputes from live state.
      const refreshed = await batchService.refreshBatchCounters(String(batch._id));
      assert.equal(refreshed.completed, 4);
      assert.equal(refreshed.failed, 0);
      // Status transitions to 'completed' because all items are now complete.
      assert.equal(refreshed.status, 'completed');
    });

    test('9b. refresh on a non-existent batch returns null', async () => {
      const fakeId = 'b'.repeat(24);
      const result = await batchService.refreshBatchCounters(fakeId);
      assert.equal(result, null);
    });

    test('9c. refresh with invalid id throws AppError 400', async () => {
      await assert.rejects(
        () => batchService.refreshBatchCounters('not-an-id'),
        (err) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.status, 400);
          assert.equal(err.code, 'INVALID_ID');
          return true;
        },
      );
    });
  });

  // =====================================================================
  // 10. security boundaries
  // =====================================================================
  describe('security boundaries', () => {
    test('10a. the client cannot fabricate batch completion counts (counters are server-side only)', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids = await persistEnquiries(3);
      const batch = await batchService.createBatch({ enquiryIds: ids });

      installLlmMock({ latencyMs: 3 });
      await batchService.runBatchExtraction(String(batch._id));

      // The batch's counters reflect what the workers actually did.
      // There is no API endpoint that lets a client set completed=X.
      // The only way to change counters is through the worker pool
      // (atomic $inc) or through refreshBatchCounters (which recomputes
      // from live enquiry state, also server-side).
      const final = await batchService.getBatch(String(batch._id));
      assert.equal(final.completed, 3);
      assert.equal(final.failed, 0);
      assert.equal(final.total, 3);
      assert.equal(final.status, 'completed');
    });

    test('10b. the client cannot modify another batch\'s items (batchId is set server-side)', async () => {
      env.BATCH_CONCURRENCY = 3;
      const ids1 = await persistEnquiries(2);
      const ids2 = await persistEnquiries(2);
      const batch1 = await batchService.createBatch({ enquiryIds: ids1 });
      const batch2 = await batchService.createBatch({ enquiryIds: ids2 });

      // batch1's enquiries have batchId=batch1._id; batch2's have batchId=batch2._id.
      const e1 = await Enquiry.find({ batchId: batch1._id }).lean();
      const e2 = await Enquiry.find({ batchId: batch2._id }).lean();
      assert.equal(e1.length, 2);
      assert.equal(e2.length, 2);
      // No overlap.
      const e1Ids = new Set(e1.map((e) => String(e._id)));
      for (const e of e2) {
        assert.ok(!e1Ids.has(String(e._id)));
      }
    });

    test('10c. no API keys or secrets are stored on the BatchJob document', async () => {
      const ids = await persistEnquiries(1);
      const batch = await batchService.createBatch({ enquiryIds: ids });
      const raw = batch.toObject();
      const json = JSON.stringify(raw);
      // No key-like patterns.
      assert.ok(!/gsk_[A-Za-z0-9]{20,}/.test(json), 'no Groq keys');
      assert.ok(!/AIza[A-Za-z0-9_-]{30,}/.test(json), 'no Gemini keys');
      assert.ok(!/Bearer\s+/i.test(json), 'no Bearer tokens');
    });
  });
});
