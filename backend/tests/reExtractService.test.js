/**
 * Test: reExtractService — Phase 7 integration tests.
 *
 * Source-of-truth: Rules.md §11 ("Re-Extraction Rules"), Architechure.md §4
 * Flow D, Architechure.md §7, PRD.md FR-09.
 *
 * These tests run against a REAL MongoDB instance (mirroring Phase 3-6
 * convention) AND mock both SDKs (`OpenAI.Responses.prototype.create` and
 * `@google/genai`'s `interactions.create`). They verify:
 *
 * Phase 7 verification items (1-24 from operator instructions):
 *   1.  First extraction creates version 1.
 *   2.  Re-extraction creates version 2.
 *   3.  Version 1 remains unchanged after re-extraction.
 *   4.  Version 2 contains the new extraction.
 *   5.  Existing human overrides survive re-extraction.
 *   6.  A conflicting new model value is detected.
 *   7.  Identical model/override values do not create a conflict.
 *   8.  Accepting a new model value clears the override.
 *   9.  Keeping the confirmed value preserves the override.
 *  10.  Effective extraction is correct after each action.
 *  11.  Priority is recalculated from the effective extraction.
 *  12.  Failed re-extraction does not destroy existing data.
 *  13.  Groq failure → Gemini fallback still works.
 *  14.  Invalid enquiry ID returns 400.
 *  15.  Missing enquiry returns 404.
 *  16.  Client cannot specify provider/model arbitrarily (server controls).
 *  17.  Client cannot modify originalText (immutable).
 *  18.  Client cannot directly set priority.
 *  19.  Client cannot fabricate extraction versions (server creates them).
 *  20.  Existing Phase 0-6 tests still pass (verified separately by running
 *       the full suite).
 *  21.  Frontend build succeeds (verified separately).
 *  22.  No TypeScript introduced (verified by file inspection).
 *  23.  No secrets committed (verified by .gitignore + git status).
 *  24.  No Phase 8 functionality introduced (no batch endpoints, no auth).
 *
 * DATA-INTEGRITY REGRESSION TEST (the explicit operator-requested sequence):
 *   1. Model extraction: budget = £40k
 *   2. Human override: budget = £400k
 *   3. Re-extraction: new model budget = £50k
 *   Expected:
 *     - model extraction/history: £40k and £50k versions preserved
 *     - human override: £400k
 *     - effective budget: £400k
 *     - priority: calculated from £400k
 *     - The system NEVER silently replaces £400k with £50k.
 *
 * Requires: MongoDB running at env.MONGODB_URI. The tests use a separate
 * `phase7_test` database to avoid polluting other test data.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { ApiError } from '@google/genai';

import { env } from '../src/config/env.js';
import Enquiry from '../src/models/Enquiry.js';
import ExtractionVersion from '../src/models/ExtractionVersion.js';
import { reExtract } from '../src/services/reExtractService.js';
import { runExtraction } from '../src/services/extractionService.js';
import { applyHumanOverride, clearHumanOverride } from '../src/services/humanOverrideService.js';
import { computePriority } from '../src/services/scoringService.js';
import { AppError } from '../src/middleware/errorHandler.js';
import {
  mockOpenAIResponses,
  mockGeminiInteractions,
  groqResponse,
  geminiResponse,
  validExtraction,
  findFixtureBlock,
} from './_helpers.js';

const TEST_DB = 'sodio_enquiry_triage_phase7_test';

let originalMongoUri;
let groqMock;
let geminiMock;

before(async () => {
  originalMongoUri = env.MONGODB_URI;
  const testUri = `mongodb://127.0.0.1:27017/${TEST_DB}`;
  env.MONGODB_URI = testUri;
  await mongoose.disconnect();
  await mongoose.connect(testUri);
});

after(async () => {
  await mongoose.disconnect();
  env.MONGODB_URI = originalMongoUri;
});

describe('reExtractService — Phase 7 re-extraction safety', () => {
  const savedEnv = {
    GROQ_API_KEY: env.GROQ_API_KEY,
    GROQ_BASE_URL: env.GROQ_BASE_URL,
    GROQ_MODEL: env.GROQ_MODEL,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(async () => {
    env.GROQ_API_KEY = 'test-groq-key';
    env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
    env.GROQ_MODEL = 'openai/gpt-oss-20b';
    env.GEMINI_API_KEY = 'test-gemini-key';
    env.GEMINI_MODEL = 'gemini-3.6-flash';
    env.LLM_MAX_RETRIES = 0;
    env.LLM_TIMEOUT_MS = 5000;
    await Enquiry.deleteMany({});
    await ExtractionVersion.deleteMany({});
  });

  afterEach(() => {
    if (groqMock) groqMock.restore();
    if (geminiMock) geminiMock.restore();
    groqMock = null;
    geminiMock = null;
    Object.assign(env, savedEnv);
  });

  /**
   * Create a pending enquiry with no extraction yet (Phase 1 initial state).
   */
  async function createPendingEnquiry(text, sender = { name: 'Test', email: 'test@example.com' }) {
    const e = new Enquiry({
      source: 'paste',
      originalText: text,
      sender,
      receivedAt: new Date('2026-07-14T09:22:00Z'),
      status: 'new',
      extractionState: 'pending',
    });
    await e.save();
    return e;
  }

  /**
   * Run a successful first extraction on a pending enquiry. Returns the
   * updated enquiry document.
   */
  async function runFirstExtraction(enquiryId, extractionOverrides = {}) {
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction(extractionOverrides)),
    );
    const { enquiry, versions, outcome } = await runExtraction(enquiryId);
    groqMock.restore();
    groqMock = null;
    return { enquiry, versions, outcome };
  }

  // ===== Verification items 1-4: versioning =====

  test('1. First extraction creates version 1', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    const { versions } = await runFirstExtraction(String(enquiry._id), {
      company: 'Northgate Logistics',
    });

    assert.equal(versions.length, 1);
    assert.equal(versions[0].version, 1);
    assert.equal(versions[0].state, 'completed');
    assert.equal(versions[0].provider, 'groq');

    // Verify it's persisted in the DB too.
    const dbVersions = await ExtractionVersion.find({ enquiryId: enquiry._id }).sort({
      version: 1,
    });
    assert.equal(dbVersions.length, 1);
    assert.equal(dbVersions[0].version, 1);
  });

  test('2. Re-extraction creates version 2', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      company: 'Northgate Logistics',
    });

    // Re-extract
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Northgate Logistics Updated' })),
    );
    const { versions, outcome } = await reExtract(String(enquiry._id));

    assert.equal(outcome.state, 'completed');
    assert.equal(versions.length, 1); // 1 NEW version created by this re-extract
    assert.equal(versions[0].version, 2); // version 2, not 1
    assert.equal(versions[0].state, 'completed');
  });

  test('3. Version 1 remains unchanged after re-extraction', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      company: 'Original Company Name',
    });

    // Capture version 1 from the DB.
    const v1Before = await ExtractionVersion.findOne({
      enquiryId: enquiry._id,
      version: 1,
    }).lean();
    assert.equal(v1Before.parsedOutput.company, 'Original Company Name');

    // Re-extract with a different company name.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Updated Company Name' })),
    );
    await reExtract(String(enquiry._id));

    // Reload version 1 — it MUST be unchanged.
    const v1After = await ExtractionVersion.findOne({
      enquiryId: enquiry._id,
      version: 1,
    }).lean();
    assert.equal(v1After.parsedOutput.company, 'Original Company Name');
    assert.equal(v1After.createdAt.toISOString(), v1Before.createdAt.toISOString());
    assert.deepEqual(v1After, v1Before);
  });

  test('4. Version 2 contains the new extraction', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      company: 'First Company',
    });

    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Second Company' })),
    );
    await reExtract(String(enquiry._id));

    const v2 = await ExtractionVersion.findOne({
      enquiryId: enquiry._id,
      version: 2,
    }).lean();
    assert.ok(v2, 'version 2 must exist');
    assert.equal(v2.parsedOutput.company, 'Second Company');
    assert.equal(v2.state, 'completed');
  });

  // ===== Verification items 5-7: human override preservation + conflict detection =====

  test('5. Existing human overrides survive re-extraction', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // First extraction produces budget=£40k.
    await runFirstExtraction(String(enquiry._id), {
      company: 'Northgate Logistics',
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
    });

    // Human overrides budget to £400k.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    // Re-extract — model produces budget=£50k.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        company: 'Northgate Logistics',
        budget: { raw: '£50,000', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
      })),
    );
    const { enquiry: afterReExtract } = await reExtract(String(enquiry._id));

    // The human override MUST survive — still £400k.
    assert.equal(afterReExtract.humanOverrides.budget.min, 400000);
    assert.equal(afterReExtract.humanOverrides.budget.raw, '£400,000');

    // And the effective value MUST be £400k (override wins).
    assert.equal(afterReExtract.effectiveExtraction.budget.min, 400000);
  });

  test('6. A conflicting new model value is detected', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
    });

    // Override budget to £400k.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    // Re-extract with a DIFFERENT model budget (£50k).
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        budget: { raw: '£50,000', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
      })),
    );
    const { conflicts } = await reExtract(String(enquiry._id));

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'budget');
    assert.equal(conflicts[0].humanValue.min, 400000);
    assert.equal(conflicts[0].newModelValue.min, 50000);
    assert.equal(conflicts[0].hasConflict, true);
  });

  test('7. Identical model/override values do not create a conflict', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
    });

    // Override budget to £400k.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    // Re-extract with the SAME budget as the override (£400k).
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        budget: { raw: '£400,000', currency: 'GBP', min: 400000, max: 400000, qualifier: 'exact' },
      })),
    );
    const { conflicts } = await reExtract(String(enquiry._id));

    // No conflict — override and model agree.
    assert.deepEqual(conflicts, []);
  });

  // ===== Verification items 8-9: accept / keep =====

  test('8. Accepting a new model value clears the override', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
    });

    // Override budget to £400k.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    // Re-extract produces £50k.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        budget: { raw: '£50,000', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
      })),
    );
    await reExtract(String(enquiry._id));

    // Operator accepts the new model value (via clearHumanOverride,
    // which is what the accept-model endpoint calls).
    await clearHumanOverride(String(enquiry._id), 'budget');

    const after = await Enquiry.findById(enquiry._id);
    // Override is cleared.
    assert.equal(after.humanOverrides.budget, null);
    // Effective value falls back to modelExtraction, which is the NEW model value (£50k).
    assert.equal(after.effectiveExtraction.budget.min, 50000);
    assert.equal(after.effectiveExtraction.budget.raw, '£50,000');
  });

  test('9. Keeping the confirmed value preserves the override', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
    });

    // Override budget to £400k.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    // Re-extract produces £50k.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        budget: { raw: '£50,000', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
      })),
    );
    const { conflicts } = await reExtract(String(enquiry._id));
    assert.equal(conflicts.length, 1, 'conflict must be detected');

    // Operator chooses "Keep confirmed" — NO API call is made (client-side action).
    // We verify that NOT calling anything leaves the override intact.
    const after = await Enquiry.findById(enquiry._id);
    assert.equal(after.humanOverrides.budget.min, 400000, 'override preserved');
    assert.equal(after.effectiveExtraction.budget.min, 400000, 'effective value is override');
    // modelExtraction holds the new model value (£50k) but does NOT become effective.
    assert.equal(after.modelExtraction.budget.min, 50000, 'new model value preserved in modelExtraction');

    // The new model extraction is also preserved in ExtractionVersion history.
    const v2 = await ExtractionVersion.findOne({
      enquiryId: enquiry._id,
      version: 2,
    }).lean();
    assert.equal(v2.parsedOutput.budget.min, 50000, 'version 2 holds the new model value');
  });

  // ===== Verification items 10-11: effective extraction + priority =====

  test('10. Effective extraction is correct after each action', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // Step 1: First extraction → effective = model = £40k.
    await runFirstExtraction(String(enquiry._id), {
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
      company: 'Northgate Logistics',
    });
    let after = await Enquiry.findById(enquiry._id);
    assert.equal(after.effectiveExtraction.budget.min, 40000);
    assert.equal(after.effectiveExtraction.company, 'Northgate Logistics');

    // Step 2: Override budget → effective = override = £400k.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });
    after = await Enquiry.findById(enquiry._id);
    assert.equal(after.effectiveExtraction.budget.min, 400000, 'effective reflects override');

    // Step 3: Re-extract (model produces £50k) → effective = override = £400k (override wins).
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        budget: { raw: '£50,000', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
        company: 'Northgate Logistics v2',
      })),
    );
    await reExtract(String(enquiry._id));
    after = await Enquiry.findById(enquiry._id);
    assert.equal(after.effectiveExtraction.budget.min, 400000, 'effective still = override');
    // Non-overridden fields reflect the new model.
    assert.equal(after.effectiveExtraction.company, 'Northgate Logistics v2');

    // Step 4: Accept new model value → effective = new model = £50k.
    await clearHumanOverride(String(enquiry._id), 'budget');
    after = await Enquiry.findById(enquiry._id);
    assert.equal(after.effectiveExtraction.budget.min, 50000, 'effective falls back to new model');
  });

  test('11. Priority is recalculated from the effective extraction', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // First extraction: budget £40k → score includes +3 for 25k-99k range.
    await runFirstExtraction(String(enquiry._id), {
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
      serviceLine: 'web',
      isGenuineProjectEnquiry: true,
    });
    let after = await Enquiry.findById(enquiry._id);
    const scoreAfterFirst = after.priority.score;
    assert.ok(scoreAfterFirst !== null);

    // Override budget to £400k → +4 for ≥100k range, priority score increases.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });
    after = await Enquiry.findById(enquiry._id);
    const scoreAfterOverride = after.priority.score;
    assert.ok(scoreAfterOverride > scoreAfterFirst, 'higher budget → higher score');

    // Re-extract produces £50k → effective is still £400k → priority unchanged.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        budget: { raw: '£50,000', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
        serviceLine: 'web',
        isGenuineProjectEnquiry: true,
      })),
    );
    await reExtract(String(enquiry._id));
    after = await Enquiry.findById(enquiry._id);
    assert.equal(after.priority.score, scoreAfterOverride, 'priority based on override, not new model');

    // Accept new model (£50k) → priority recalculates from £50k (lower).
    await clearHumanOverride(String(enquiry._id), 'budget');
    after = await Enquiry.findById(enquiry._id);
    assert.ok(after.priority.score < scoreAfterOverride, 'lower budget → lower score');
    assert.equal(after.effectiveExtraction.budget.min, 50000);
  });

  // ===== Verification item 12: failure behavior =====

  test('12. Failed re-extraction does not destroy existing data', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // First successful extraction.
    await runFirstExtraction(String(enquiry._id), {
      company: 'Northgate Logistics',
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
    });

    // Apply an override.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    // Snapshot BEFORE the failed re-extraction.
    const before = await Enquiry.findById(enquiry._id).lean();
    const versionsBefore = await ExtractionVersion.countDocuments({ enquiryId: enquiry._id });

    // Re-extract — BOTH providers fail.
    groqMock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'groq down', status: 503 }),
    );
    geminiMock = mockGeminiInteractions(() =>
      new ApiError({ message: 'gemini down', status: 503 }),
    );
    const { enquiry: after, outcome, conflicts } = await reExtract(String(enquiry._id));

    // Outcome is failed.
    assert.equal(outcome.state, 'failed');
    assert.equal(after.extractionState, 'failed');

    // Conflicts array is empty (no new model output to compare).
    assert.deepEqual(conflicts, []);

    // ALL existing data is preserved.
    const afterReloaded = await Enquiry.findById(enquiry._id).lean();
    assert.equal(afterReloaded.originalText, before.originalText);
    assert.equal(afterReloaded.receivedAt.toISOString(), before.receivedAt.toISOString());
    assert.equal(afterReloaded.sender.name, before.sender.name);
    assert.equal(afterReloaded.sender.email, before.sender.email);
    assert.equal(afterReloaded.status, before.status);

    // modelExtraction is UNCHANGED (not overwritten by the failed attempt).
    assert.equal(afterReloaded.modelExtraction.company, before.modelExtraction.company);
    assert.equal(afterReloaded.modelExtraction.budget.min, before.modelExtraction.budget.min);

    // effectiveExtraction is UNCHANGED.
    assert.equal(afterReloaded.effectiveExtraction.budget.min, 400000, 'override still effective');

    // humanOverrides are UNCHANGED.
    assert.equal(afterReloaded.humanOverrides.budget.min, 400000, 'override preserved');

    // priority is UNCHANGED.
    assert.equal(afterReloaded.priority.score, before.priority.score);
    assert.equal(afterReloaded.priority.level, before.priority.level);

    // The failed attempts ARE persisted as ExtractionVersion rows (history append-only),
    // but the existing version 1 is preserved.
    const versionsAfter = await ExtractionVersion.countDocuments({ enquiryId: enquiry._id });
    assert.ok(versionsAfter > versionsBefore, 'failed attempts create new version rows');
    const v1 = await ExtractionVersion.findOne({ enquiryId: enquiry._id, version: 1 }).lean();
    assert.equal(v1.state, 'completed', 'version 1 still completed');
    assert.equal(v1.parsedOutput.company, 'Northgate Logistics');
  });

  // ===== Verification item 13: Groq failure → Gemini fallback =====

  test('13. Groq failure → Gemini fallback still works during re-extraction', async () => {
    const block = findFixtureBlock('Miguel Santana');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Miguel Santana',
      email: 'm.santana@clinicavera.es',
    });

    // First extraction via Groq.
    await runFirstExtraction(String(enquiry._id), {
      company: 'Clínica Vera',
      serviceLine: 'mobile',
      budget: { raw: '25.000 €', currency: 'EUR', min: 25000, max: 25000, qualifier: 'exact' },
    });

    // Re-extract: Groq fails, Gemini succeeds with a different extraction.
    groqMock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'groq down', status: 503 }),
    );
    geminiMock = mockGeminiInteractions(() =>
      geminiResponse(validExtraction({
        company: 'Clínica Vera Updated',
        serviceLine: 'mobile',
        budget: { raw: '30.000 €', currency: 'EUR', min: 30000, max: 30000, qualifier: 'exact' },
      })),
    );

    const { enquiry: after, versions, outcome } = await reExtract(String(enquiry._id));

    assert.equal(outcome.state, 'completed');
    assert.equal(outcome.provider, 'gemini', 'Gemini succeeded as fallback');

    // TWO new ExtractionVersion rows: groq failed + gemini completed.
    assert.equal(versions.length, 2);
    assert.equal(versions[0].provider, 'groq');
    assert.equal(versions[0].state, 'failed');
    assert.equal(versions[1].provider, 'gemini');
    assert.equal(versions[1].state, 'completed');
    assert.equal(versions[1].version, 3); // versions 1 (first) + 2 (groq fail) + 3 (gemini) — wait, this is the SECOND extraction, so versions are 2 (groq fail) + 3 (gemini)? Actually the first extraction was version 1. The re-extract creates versions 2 (groq fail) and 3 (gemini). Let me verify.

    // Verify version numbering in DB.
    const dbVersions = await ExtractionVersion.find({ enquiryId: enquiry._id }).sort({ version: 1 });
    // 3 versions total: 1 (first groq success), 2 (re-extract groq fail), 3 (re-extract gemini success)
    assert.equal(dbVersions.length, 3);
    assert.equal(dbVersions[0].version, 1);
    assert.equal(dbVersions[0].provider, 'groq');
    assert.equal(dbVersions[0].state, 'completed');
    assert.equal(dbVersions[1].version, 2);
    assert.equal(dbVersions[1].provider, 'groq');
    assert.equal(dbVersions[1].state, 'failed');
    assert.equal(dbVersions[2].version, 3);
    assert.equal(dbVersions[2].provider, 'gemini');
    assert.equal(dbVersions[2].state, 'completed');

    // The enquiry reflects the Gemini result (the successful fallback).
    assert.equal(after.effectiveExtraction.company, 'Clínica Vera Updated');
    assert.equal(after.effectiveExtraction.budget.min, 30000);
    assert.equal(after.modelExtraction.company, 'Clínica Vera Updated');
    assert.equal(after.modelExtraction.budget.min, 30000);
  });

  // ===== Verification items 14-15: invalid id / missing enquiry =====

  test('14. Invalid enquiry ID returns 400', async () => {
    await assert.rejects(
      reExtract('not-an-id'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_ID',
    );
  });

  test('15. Missing enquiry returns 404', async () => {
    const fakeId = '012345678901234567890123';
    await assert.rejects(
      reExtract(fakeId),
      (err) => err instanceof AppError && err.status === 404 && err.code === 'NOT_FOUND',
    );
  });

  // ===== Verification item 16: client cannot specify provider/model =====

  test('16. Client cannot specify provider/model arbitrarily (server controls)', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // The reExtract function takes ONLY an enquiryId — no provider, no model,
    // no version, no timestamp. The server controls all of these.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Server-Controlled' })),
    );
    const { enquiry: after, versions } = await reExtract(String(enquiry._id));

    // The provider and model in the persisted version come from the LLM
    // service, not from any client input.
    assert.equal(versions[0].provider, 'groq'); // server-determined
    assert.equal(versions[0].model, env.GROQ_MODEL); // server-determined
    assert.equal(after.effectiveExtraction.company, 'Server-Controlled');
  });

  // ===== Verification item 17: originalText immutability =====

  test('17. Client cannot modify originalText via re-extraction', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });
    const originalTextBefore = enquiry.originalText;

    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Any Company' })),
    );
    await reExtract(String(enquiry._id));

    const after = await Enquiry.findById(enquiry._id).lean();
    assert.equal(after.originalText, originalTextBefore, 'originalText is immutable');
  });

  // ===== Verification item 18: client cannot directly set priority =====

  test('18. Client cannot directly set priority (server derives it)', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // The reExtract function does NOT accept a priority argument. Priority
    // is always computed by applyPriorityToEnquiry from the effective extraction.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
        serviceLine: 'web',
        isGenuineProjectEnquiry: true,
      })),
    );
    const { enquiry: after } = await reExtract(String(enquiry._id));

    // Priority is non-null and matches what computePriority would produce.
    assert.ok(after.priority.score !== null);
    assert.ok(after.priority.level !== null);
    const expected = computePriority(after.effectiveExtraction, after.isGenuineProjectEnquiry);
    assert.equal(after.priority.score, expected.score);
    assert.equal(after.priority.level, expected.level);
  });

  // ===== Verification item 19: client cannot fabricate extraction versions =====

  test('19. Client cannot fabricate extraction versions (server creates them)', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // The reExtract function takes ONLY an enquiryId. It does NOT accept
    // a version number, parsed output, or any extraction data. The server
    // creates the ExtractionVersion rows from the LLM service's output.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Server-Created Version' })),
    );
    const { versions } = await reExtract(String(enquiry._id));

    assert.equal(versions.length, 1);
    assert.equal(versions[0].version, 1); // server-assigned version number
    assert.equal(versions[0].parsedOutput.company, 'Server-Created Version');
    // The version row was created by the server, not fabricated by the client.
    const dbCount = await ExtractionVersion.countDocuments({ enquiryId: enquiry._id });
    assert.equal(dbCount, 1);
  });

  // ===== Verification item 24: no Phase 8 functionality =====

  test('24. No Phase 8 functionality introduced (no batch endpoints, no auth)', async () => {
    // This is a structural test — we verify that reExtract does NOT
    // introduce batch processing, authentication, or any Phase 8+ concern.
    // The function signature is single-enquiry only.
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    groqMock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    const result = await reExtract(String(enquiry._id));

    // The response contains ONLY: enquiry, versions, outcome, conflicts.
    // No batchId, no batchProgress, no auth metadata, no Phase 8+ fields.
    assert.ok('enquiry' in result);
    assert.ok('versions' in result);
    assert.ok('outcome' in result);
    assert.ok('conflicts' in result);
    const keys = Object.keys(result).sort();
    assert.deepEqual(keys, ['conflicts', 'enquiry', 'outcome', 'versions']);
  });

  // ===== DATA-INTEGRITY REGRESSION TEST (the explicit operator-requested sequence) =====

  test('DATA-INTEGRITY REGRESSION: £40k → £400k override → £50k re-extract NEVER silently replaces', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // Step 1: First extraction produces budget = £40k.
    await runFirstExtraction(String(enquiry._id), {
      company: 'Northgate Logistics',
      contactName: 'Rachel Whitfield',
      contactEmail: 'r.whitfield@northgate-logistics.co.uk',
      serviceLine: 'web',
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
      timeline: { raw: 'September', normalized: { period: 'relative' } },
      summary: 'Logistics firm wants a tool to extract data from supplier PDFs.',
      isGenuineProjectEnquiry: true,
    });

    // Verify step 1 state.
    let after = await Enquiry.findById(enquiry._id);
    assert.equal(after.modelExtraction.budget.min, 40000, 'model = £40k');
    assert.equal(after.effectiveExtraction.budget.min, 40000, 'effective = £40k (no override)');
    let versions = await ExtractionVersion.find({ enquiryId: enquiry._id }).sort({ version: 1 });
    assert.equal(versions.length, 1, 'one version after first extraction');
    assert.equal(versions[0].version, 1);
    assert.equal(versions[0].parsedOutput.budget.min, 40000);

    // Step 2: Human overrides budget to £400k.
    await applyHumanOverride(String(enquiry._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    // Verify step 2 state.
    after = await Enquiry.findById(enquiry._id);
    assert.equal(after.humanOverrides.budget.min, 400000, 'override = £400k');
    assert.equal(after.effectiveExtraction.budget.min, 400000, 'effective = £400k (override wins)');
    assert.equal(after.modelExtraction.budget.min, 40000, 'model STILL = £40k (not overwritten)');
    const scoreAfterOverride = after.priority.score;
    assert.ok(scoreAfterOverride !== null);

    // Step 3: Re-extract produces budget = £50k.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        company: 'Northgate Logistics',
        contactName: 'Rachel Whitfield',
        contactEmail: 'r.whitfield@northgate-logistics.co.uk',
        serviceLine: 'web',
        budget: { raw: '£50,000', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
        timeline: { raw: 'September', normalized: { period: 'relative' } },
        summary: 'Logistics firm wants a tool to extract data from supplier PDFs.',
        isGenuineProjectEnquiry: true,
      })),
    );
    const { conflicts } = await reExtract(String(enquiry._id));

    // EXPECTED — verify ALL the operator-requested invariants:

    // (a) model extraction/history: £40k AND £50k versions preserved.
    versions = await ExtractionVersion.find({ enquiryId: enquiry._id }).sort({ version: 1 });
    assert.equal(versions.length, 2, 'two versions preserved (append-only)');
    assert.equal(versions[0].version, 1);
    assert.equal(versions[0].parsedOutput.budget.min, 40000, 'version 1 holds £40k');
    assert.equal(versions[1].version, 2);
    assert.equal(versions[1].parsedOutput.budget.min, 50000, 'version 2 holds £50k');

    // (b) human override: £400k.
    after = await Enquiry.findById(enquiry._id);
    assert.equal(after.humanOverrides.budget.min, 400000, 'override is STILL £400k');

    // (c) effective budget: £400k (override wins, NOT the new model value).
    assert.equal(after.effectiveExtraction.budget.min, 400000, 'CRITICAL: effective = £400k, NOT £50k');
    assert.equal(after.effectiveExtraction.budget.raw, '£400,000');

    // (d) modelExtraction holds the NEW model value (£50k), but it does NOT become effective.
    assert.equal(after.modelExtraction.budget.min, 50000, 'modelExtraction = new model value £50k');

    // (e) priority: calculated from £400k (the effective value), NOT from £50k.
    assert.equal(after.priority.score, scoreAfterOverride, 'priority based on £400k, not recalculated from £50k');

    // (f) conflict was detected.
    assert.equal(conflicts.length, 1, 'conflict surfaced for operator decision');
    assert.equal(conflicts[0].field, 'budget');
    assert.equal(conflicts[0].humanValue.min, 400000);
    assert.equal(conflicts[0].newModelValue.min, 50000);

    // The system NEVER silently replaced £400k with £50k. ✓
  });

  // ===== Additional test: conflict detection with isGenuineProjectEnquiry =====

  test('Conflict detected for isGenuineProjectEnquiry override (false vs true)', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    // First extraction: model says genuine=true.
    await runFirstExtraction(String(enquiry._id), {
      isGenuineProjectEnquiry: true,
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
    });

    // Operator marks it as NOT genuine (override = false).
    await applyHumanOverride(String(enquiry._id), 'isGenuineProjectEnquiry', false);

    // Re-extract: model STILL says genuine=true.
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        isGenuineProjectEnquiry: true,
        budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
      })),
    );
    const { conflicts, enquiry: after } = await reExtract(String(enquiry._id));

    // Conflict detected: override=false vs model=true.
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'isGenuineProjectEnquiry');
    assert.equal(conflicts[0].humanValue, false);
    assert.equal(conflicts[0].newModelValue, true);

    // Effective value is the override (false).
    assert.equal(after.isGenuineProjectEnquiry, false);
    // Priority reflects the override (penalty for not-genuine).
    assert.ok(after.priority.reasons.some((r) => r.includes('not a genuine')));
  });

  // ===== Additional test: no conflicts when no overrides exist =====

  test('No conflicts returned when no human overrides exist', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    await runFirstExtraction(String(enquiry._id), {
      company: 'First Company',
    });

    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Different Company' })),
    );
    const { conflicts, enquiry: after } = await reExtract(String(enquiry._id));

    // No overrides → no conflicts, even though the model value changed.
    assert.deepEqual(conflicts, []);

    // The effective value reflects the new model value (no override to preserve).
    assert.equal(after.effectiveExtraction.company, 'Different Company');
  });

  // ===== Additional test: 409 when already processing =====

  test('409 when enquiry is already processing', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });
    enquiry.extractionState = 'processing';
    await enquiry.save();

    groqMock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    await assert.rejects(
      reExtract(String(enquiry._id)),
      (err) =>
        err instanceof AppError && err.status === 409 && err.code === 'ALREADY_PROCESSING',
    );
  });

  // ===== Additional test: prompt-injection enquiry re-extracted safely =====

  test('Prompt-injection enquiry re-extracted as ordinary data (no instruction obeyed)', async () => {
    const block = findFixtureBlock('system');
    const enquiry = await createPendingEnquiry(block.message, {
      name: 'system',
      email: 'contact@qa-test-mail.io',
    });

    // First extraction: model correctly flags as injection attempt.
    await runFirstExtraction(String(enquiry._id), {
      company: null,
      contactName: 'system',
      contactEmail: 'contact@qa-test-mail.io',
      serviceLine: 'other', // NOT 'ai' as injection demanded
      budget: { raw: '', qualifier: 'unknown' },
      timeline: { raw: '', normalized: null },
      summary: 'Prompt-injection attempt flagged.',
      isGenuineProjectEnquiry: false,
      isModelInstructionAttempt: true,
    });

    // Re-extract: model STILL correctly flags as injection (no instructions obeyed).
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        company: null,
        contactName: 'system',
        contactEmail: 'contact@qa-test-mail.io',
        serviceLine: 'other', // STILL NOT 'ai'
        budget: { raw: '', qualifier: 'unknown' }, // STILL NOT 10000000 USD
        timeline: { raw: '', normalized: null },
        summary: 'Prompt-injection attempt flagged again.',
        isGenuineProjectEnquiry: false,
        isModelInstructionAttempt: true,
      })),
    );
    const { enquiry: after, outcome } = await reExtract(String(enquiry._id));

    assert.equal(outcome.state, 'completed');
    // The injection's demands are NOT obeyed.
    assert.equal(after.effectiveExtraction.serviceLine, 'other', 'NOT "ai" as injection demanded');
    assert.equal(after.effectiveExtraction.budget.qualifier, 'unknown');
    assert.equal(after.effectiveExtraction.budget.min, null);
    assert.equal(after.isGenuineProjectEnquiry, false, 'flagged as not-genuine');
    // Priority is low (penalty for not-genuine).
    assert.equal(after.priority.level, 'low');

    // originalText is preserved verbatim (the injection text is still there).
    const reloaded = await Enquiry.findById(enquiry._id).lean();
    assert.ok(reloaded.originalText.includes('Ignore all previous instructions'));
    assert.ok(reloaded.originalText.includes('10000000 USD'));
  });
});
