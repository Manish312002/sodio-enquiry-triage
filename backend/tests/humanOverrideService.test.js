/**
 * Test: humanOverrideService — Phase 6 integration tests.
 *
 * Source-of-truth: Architechure.md §4 Flow C, §7 Effective Value Resolution,
 * Rules.md §10 Human Correction Rules, Rules.md §14 Data Integrity.
 *
 * These tests require a running MongoDB at env.MONGODB_URI. They use a
 * separate `phase6_test` database to avoid polluting dev/phase3/4/5 data.
 *
 * Coverage (Phase 6 testing items 1-13 from the operator's instructions):
 *   1.  applyHumanOverride — model extraction remains unchanged after edit
 *   2.  applyHumanOverride — human override is persisted
 *   3.  applyHumanOverride — effective value uses human override
 *   4.  applyHumanOverride — priority recalculates after edit (budget £40k → £400k → HIGH)
 *   5.  applyHumanOverride — priority reasons reflect the effective value
 *   6.  clearHumanOverride — restores model value
 *   7.  clearHumanOverride — priority recalculates after clearing
 *   8.  applyHumanOverride — invalid field is rejected (INVALID_FIELD)
 *   9.  applyHumanOverride — invalid field value is rejected (INVALID_FIELD_VALUE)
 *  10.  applyHumanOverride — missing enquiry returns 404
 *  11.  applyHumanOverride — invalid enquiry id returns 400 (INVALID_ID)
 *  12.  SECURITY: originalText cannot be changed via field-edit endpoint
 *  13.  SECURITY: arbitrary properties cannot be injected into humanOverrides
 *  14.  SECURITY: a request attempting to set `priority` is rejected
 *  15.  isGenuineProjectEnquiry override = false beats model = true
 *  16.  isGenuineProjectEnquiry override = true beats model = false
 *  17.  serviceLine override accepts only enum values
 *  18.  budget override preserves structure (raw, currency, min, max, qualifier)
 *  19.  timeline override preserves raw wording and normalized
 *  20.  Lazy migration: pre-Phase-6 record (modelExtraction=null) gets modelExtraction populated on first edit
 *  21.  clearHumanOverride on a field with no override is a safe no-op (effective unchanged)
 *  22.  applyHumanOverride does NOT touch originalText/receivedAt/status/extractionState
 *  23.  Multiple sequential overrides on different fields accumulate correctly
 *  24.  Re-applying an override on the same field replaces the previous override value
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import Enquiry from '../src/models/Enquiry.js';
import {
  applyHumanOverride,
  clearHumanOverride,
  validateFieldValue,
} from '../src/services/humanOverrideService.js';
import { AppError } from '../src/middleware/errorHandler.js';
import { computePriority } from '../src/services/scoringService.js';

const TEST_DB = 'sodio_enquiry_triage_phase6_test';

let originalMongoUri;

before(async () => {
  originalMongoUri = env.MONGODB_URI;
  env.MONGODB_URI = `${originalMongoUri.replace(/\/[^/]*$/, '')}/${TEST_DB}`;
  await mongoose.connect(env.MONGODB_URI);
});

after(async () => {
  await mongoose.disconnect();
  env.MONGODB_URI = originalMongoUri;
});

beforeEach(async () => {
  await Enquiry.deleteMany({});
});

afterEach(async () => {
  await Enquiry.deleteMany({});
});

/**
 * Build a Phase-6-era enquiry: has BOTH modelExtraction and effectiveExtraction
 * populated (mirroring what extractionService does on a successful extraction).
 *
 * If `overrides` contains `isGenuineProjectEnquiry` or `effectiveExtraction`,
 * the priority is recomputed from those overrides so the starting state is
 * consistent (rather than computing priority from the default genuine=true
 * model and then having it disagree with the stored isGenuineProjectEnquiry).
 */
async function createPhase6Enquiry(overrides = {}) {
  const defaultModel = {
    company: 'Northgate Logistics',
    contactName: 'Rachel Whitfield',
    contactEmail: 'r.whitfield@northgate.example',
    serviceLine: 'web',
    budget: {
      raw: '£40,000',
      currency: 'GBP',
      min: 40000,
      max: 40000,
      qualifier: 'exact',
    },
    timeline: { raw: 'September', normalized: { period: 'relative' } },
    summary: 'A mid-sized logistics firm looking for a supplier portal.',
    projectCount: 1,
    additionalProjectNote: null,
  };

  const effectiveExtraction = overrides.effectiveExtraction ?? defaultModel;
  const modelExtraction = overrides.modelExtraction ?? defaultModel;
  const isGenuine = overrides.isGenuineProjectEnquiry ?? true;

  const enquiry = new Enquiry({
    source: 'paste',
    originalText: 'Hi, we are Northgate Logistics. We need a portal. Budget £40k. September. Rachel.',
    sender: { name: 'Rachel Whitfield', email: 'r.whitfield@northgate.example' },
    receivedAt: new Date('2026-07-14T09:22:00Z'),
    status: 'new',
    extractionState: 'completed',
    isGenuineProjectEnquiry: isGenuine,
    modelExtraction,
    effectiveExtraction,
    humanOverrides: {},
    priority: { level: null, score: null, reasons: [] },
    ...overrides,
  });
  // Always (re)compute priority from the actual stored effective extraction
  // + isGenuineProjectEnquiry so the starting state is internally consistent.
  const priority = computePriority(enquiry.effectiveExtraction, enquiry.isGenuineProjectEnquiry);
  enquiry.priority = priority;
  return enquiry.save();
}

/**
 * Build a pre-Phase-6 enquiry: modelExtraction is null, effectiveExtraction
 * holds the model output (this is what Phase 3 wrote before Phase 6 existed).
 */
async function createPrePhase6Enquiry() {
  const modelOutput = {
    company: 'Old Co',
    contactName: 'Old Person',
    contactEmail: 'old@example.com',
    serviceLine: 'web',
    budget: { raw: '£20,000', currency: 'GBP', min: 20000, max: 20000, qualifier: 'exact' },
    timeline: { raw: 'next month', normalized: null },
    summary: 'Old summary.',
    projectCount: 1,
    additionalProjectNote: null,
  };
  const enquiry = new Enquiry({
    source: 'paste',
    originalText: 'legacy enquiry',
    sender: { name: 'Old Person', email: 'old@example.com' },
    receivedAt: new Date('2026-01-01T00:00:00Z'),
    status: 'new',
    extractionState: 'completed',
    isGenuineProjectEnquiry: true,
    modelExtraction: null, // pre-Phase-6 record
    effectiveExtraction: modelOutput,
    humanOverrides: {},
    priority: { level: null, score: null, reasons: [] },
  });
  const priority = computePriority(modelOutput, true);
  enquiry.priority = priority;
  return enquiry.save();
}

describe('humanOverrideService — Phase 6 override application', () => {
  test('1. Model extraction remains unchanged after human edit', async () => {
    const e = await createPhase6Enquiry();
    const beforeModel = JSON.parse(JSON.stringify(e.modelExtraction));

    await applyHumanOverride(String(e._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    const after = await Enquiry.findById(e._id);
    assert.deepEqual(
      JSON.parse(JSON.stringify(after.modelExtraction)),
      beforeModel,
      'modelExtraction must be untouched',
    );
  });

  test('2. Human override is persisted in humanOverrides[field]', async () => {
    const e = await createPhase6Enquiry();
    await applyHumanOverride(String(e._id), 'company', 'Override Co');

    const after = await Enquiry.findById(e._id);
    assert.equal(after.humanOverrides.company, 'Override Co');
  });

  test('3. Effective value uses human override', async () => {
    const e = await createPhase6Enquiry();
    await applyHumanOverride(String(e._id), 'company', 'Override Co');

    const after = await Enquiry.findById(e._id);
    assert.equal(after.effectiveExtraction.company, 'Override Co');
    // Other fields stay from model
    assert.equal(after.effectiveExtraction.contactName, 'Rachel Whitfield');
  });

  test('4. Priority recalculates after human edit (budget £40k → £400k → HIGH)', async () => {
    const e = await createPhase6Enquiry();
    // Initial priority for £40k should be MEDIUM (genuine +4, budget +3, timeline 0, service +1, relationship 0 = 8 → HIGH actually)
    // Wait, let me compute: 4 + 3 + 0 + 1 + 0 = 8 → HIGH. Hmm.
    // £40k = budget 25,000-99,999 = +3. timeline "September" = no recognizable signal = 0. service web = +1. genuine = +4. total = 8 → HIGH
    // So initial priority should already be HIGH. Let me adjust the test to verify the priority CHANGES.

    const before = await Enquiry.findById(e._id);
    const beforeScore = before.priority.score;

    // Edit budget to £400k (≥ 100k = +4)
    await applyHumanOverride(String(e._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    const after = await Enquiry.findById(e._id);
    assert.equal(after.priority.level, 'high');
    // Budget went from +3 (£40k) to +4 (£400k), so score should increase by 1
    assert.equal(after.priority.score, beforeScore + 1);
  });

  test('5. Priority reasons reflect the effective value', async () => {
    const e = await createPhase6Enquiry();
    await applyHumanOverride(String(e._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });

    const after = await Enquiry.findById(e._id);
    // Reasons array should mention the 400000 figure (the override value)
    const budgetReason = after.priority.reasons.find((r) => r.includes('budget:'));
    assert.ok(budgetReason, 'should have a budget reason line');
    assert.ok(budgetReason.includes('100,000'), 'budget reason should mention ≥ 100,000 threshold');
    assert.ok(budgetReason.includes('400000'), 'budget reason should mention the effective value');
  });

  test('6. Clearing an override restores the model value', async () => {
    const e = await createPhase6Enquiry();
    await applyHumanOverride(String(e._id), 'company', 'Override Co');
    // Verify the override was applied
    let mid = await Enquiry.findById(e._id);
    assert.equal(mid.effectiveExtraction.company, 'Override Co');

    // Now clear it
    await clearHumanOverride(String(e._id), 'company');

    const after = await Enquiry.findById(e._id);
    assert.equal(after.humanOverrides.company, null);
    assert.equal(after.effectiveExtraction.company, 'Northgate Logistics');
  });

  test('7. Priority recalculates after clearing an override', async () => {
    const e = await createPhase6Enquiry();
    const beforeScore = (await Enquiry.findById(e._id)).priority.score;

    // Override budget to £400k (higher score)
    await applyHumanOverride(String(e._id), 'budget', {
      raw: '£400,000',
      currency: 'GBP',
      min: 400000,
      max: 400000,
      qualifier: 'exact',
    });
    const midScore = (await Enquiry.findById(e._id)).priority.score;
    assert.equal(midScore, beforeScore + 1);

    // Clear the override — score should drop back to the original
    await clearHumanOverride(String(e._id), 'budget');
    const afterScore = (await Enquiry.findById(e._id)).priority.score;
    assert.equal(afterScore, beforeScore);
  });

  test('8. Invalid field is rejected with INVALID_FIELD', async () => {
    const e = await createPhase6Enquiry();
    await assert.rejects(
      applyHumanOverride(String(e._id), 'priority', { level: 'HIGH', score: 999 }),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD',
    );
  });

  test('9. Invalid field value is rejected with INVALID_FIELD_VALUE', async () => {
    const e = await createPhase6Enquiry();

    // serviceLine must be an enum value
    await assert.rejects(
      applyHumanOverride(String(e._id), 'serviceLine', 'design'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD_VALUE',
    );

    // isGenuineProjectEnquiry must be a strict boolean
    await assert.rejects(
      applyHumanOverride(String(e._id), 'isGenuineProjectEnquiry', 'true'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD_VALUE',
    );

    // budget.min must be a non-negative number
    await assert.rejects(
      applyHumanOverride(String(e._id), 'budget', { min: -100 }),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD_VALUE',
    );

    // company must be a string
    await assert.rejects(
      applyHumanOverride(String(e._id), 'company', 42),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD_VALUE',
    );
  });

  test('10. Missing enquiry returns 404 NOT_FOUND', async () => {
    const fakeId = '012345678901234567890123';
    await assert.rejects(
      applyHumanOverride(fakeId, 'company', 'X'),
      (err) => err instanceof AppError && err.status === 404 && err.code === 'NOT_FOUND',
    );
  });

  test('11. Invalid enquiry id returns 400 INVALID_ID', async () => {
    await assert.rejects(
      applyHumanOverride('not-an-id', 'company', 'X'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_ID',
    );
  });

  test('12. SECURITY: originalText cannot be changed via field-edit endpoint', async () => {
    const e = await createPhase6Enquiry();
    const before = e.originalText;

    await assert.rejects(
      applyHumanOverride(String(e._id), 'originalText', 'HACKED'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD',
    );

    const after = await Enquiry.findById(e._id);
    assert.equal(after.originalText, before);
  });

  test('13. SECURITY: arbitrary properties cannot be injected into humanOverrides', async () => {
    const e = await createPhase6Enquiry();
    await assert.rejects(
      applyHumanOverride(String(e._id), 'arbitraryProperty', 'X'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD',
    );

    const after = await Enquiry.findById(e._id);
    // humanOverrides must not contain any arbitrary key
    const keys = Object.keys(after.humanOverrides.toObject ? after.humanOverrides.toObject() : after.humanOverrides);
    assert.ok(!keys.includes('arbitraryProperty'));
  });

  test('14. SECURITY: a request attempting to set priority is rejected', async () => {
    const e = await createPhase6Enquiry();
    const beforeScore = e.priority.score;

    await assert.rejects(
      applyHumanOverride(String(e._id), 'priority', { level: 'HIGH', score: 999 }),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD',
    );

    const after = await Enquiry.findById(e._id);
    assert.equal(after.priority.score, beforeScore);
    assert.notEqual(after.priority.score, 999);
  });

  test('15. isGenuineProjectEnquiry override = false beats model = true', async () => {
    const e = await createPhase6Enquiry();
    assert.equal(e.isGenuineProjectEnquiry, true);

    await applyHumanOverride(String(e._id), 'isGenuineProjectEnquiry', false);

    const after = await Enquiry.findById(e._id);
    assert.equal(after.isGenuineProjectEnquiry, false);
    assert.equal(after.humanOverrides.isGenuineProjectEnquiry, false);
    // Score should drop: genuine +4 → not-genuine -5 = -9 swing
    // Original: +4 (genuine) + budget +3 + timeline 0 + service +1 = 8 (HIGH)
    // After:    -5 + 3 + 0 + 1 = -1 (LOW)
    assert.equal(after.priority.level, 'low');
  });

  test('16. isGenuineProjectEnquiry override = true beats model = false', async () => {
    const e = await createPhase6Enquiry({
      isGenuineProjectEnquiry: false,
      modelExtraction: {
        company: 'Spam Co',
        contactName: 'Spammer',
        contactEmail: 'spam@example.com',
        serviceLine: 'other',
        budget: { raw: '', currency: null, min: null, max: null, qualifier: 'unknown' },
        timeline: { raw: '', normalized: null },
        summary: 'spam message',
        projectCount: 1,
        additionalProjectNote: null,
      },
      effectiveExtraction: {
        company: 'Spam Co',
        contactName: 'Spammer',
        contactEmail: 'spam@example.com',
        serviceLine: 'other',
        budget: { raw: '', currency: null, min: null, max: null, qualifier: 'unknown' },
        timeline: { raw: '', normalized: null },
        summary: 'spam message',
        projectCount: 1,
        additionalProjectNote: null,
      },
    });
    assert.equal(e.isGenuineProjectEnquiry, false);

    await applyHumanOverride(String(e._id), 'isGenuineProjectEnquiry', true);

    const after = await Enquiry.findById(e._id);
    assert.equal(after.isGenuineProjectEnquiry, true);
    assert.equal(after.humanOverrides.isGenuineProjectEnquiry, true);
    // Score should rise: not-genuine -5 → genuine +4 = +9 swing
    assert.ok(after.priority.score > e.priority.score);
  });

  test('17. serviceLine override accepts only enum values', async () => {
    const e = await createPhase6Enquiry();

    // Valid enum
    await applyHumanOverride(String(e._id), 'serviceLine', 'ai');
    let after = await Enquiry.findById(e._id);
    assert.equal(after.effectiveExtraction.serviceLine, 'ai');

    // Invalid enum
    await assert.rejects(
      applyHumanOverride(String(e._id), 'serviceLine', 'design'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_FIELD_VALUE',
    );
  });

  test('18. Budget override preserves structure (raw, currency, min, max, qualifier)', async () => {
    const e = await createPhase6Enquiry();
    const newBudget = {
      raw: '£500,000',
      currency: 'GBP',
      min: 500000,
      max: 500000,
      qualifier: 'exact',
    };
    await applyHumanOverride(String(e._id), 'budget', newBudget);

    const after = await Enquiry.findById(e._id);
    const effBudget = after.effectiveExtraction.budget.toObject
      ? after.effectiveExtraction.budget.toObject()
      : after.effectiveExtraction.budget;
    assert.equal(effBudget.raw, '£500,000');
    assert.equal(effBudget.currency, 'GBP');
    assert.equal(effBudget.min, 500000);
    assert.equal(effBudget.max, 500000);
    assert.equal(effBudget.qualifier, 'exact');
  });

  test('19. Timeline override preserves raw wording and normalized', async () => {
    const e = await createPhase6Enquiry();
    const newTimeline = { raw: 'ASAP', normalized: { urgency: 'immediate' } };
    await applyHumanOverride(String(e._id), 'timeline', newTimeline);

    const after = await Enquiry.findById(e._id);
    const effTimeline = after.effectiveExtraction.timeline.toObject
      ? after.effectiveExtraction.timeline.toObject()
      : after.effectiveExtraction.timeline;
    assert.equal(effTimeline.raw, 'ASAP');
    assert.deepEqual(effTimeline.normalized, { urgency: 'immediate' });
  });

  test('20. Lazy migration: pre-Phase-6 record (modelExtraction=null) gets modelExtraction populated on first edit', async () => {
    const e = await createPrePhase6Enquiry();
    assert.equal(e.modelExtraction, null);

    await applyHumanOverride(String(e._id), 'company', 'Override Co');

    const after = await Enquiry.findById(e._id);
    assert.ok(after.modelExtraction, 'modelExtraction should be populated after first edit');
    assert.equal(after.modelExtraction.company, 'Old Co'); // copied from effectiveExtraction
    assert.equal(after.effectiveExtraction.company, 'Override Co');
  });

  test('21. clearHumanOverride on a field with no override is a safe no-op', async () => {
    const e = await createPhase6Enquiry();
    const beforeCompany = e.effectiveExtraction.company;

    await clearHumanOverride(String(e._id), 'company');

    const after = await Enquiry.findById(e._id);
    assert.equal(after.effectiveExtraction.company, beforeCompany);
    assert.equal(after.humanOverrides.company, null);
  });

  test('22. applyHumanOverride does NOT touch originalText/receivedAt/status/extractionState', async () => {
    const e = await createPhase6Enquiry();
    const beforeText = e.originalText;
    const beforeReceived = e.receivedAt.toISOString();
    const beforeStatus = e.status;
    const beforeState = e.extractionState;

    await applyHumanOverride(String(e._id), 'company', 'Override Co');

    const after = await Enquiry.findById(e._id);
    assert.equal(after.originalText, beforeText);
    assert.equal(after.receivedAt.toISOString(), beforeReceived);
    assert.equal(after.status, beforeStatus);
    assert.equal(after.extractionState, beforeState);
  });

  test('23. Multiple sequential overrides on different fields accumulate correctly', async () => {
    const e = await createPhase6Enquiry();

    await applyHumanOverride(String(e._id), 'company', 'Co A');
    await applyHumanOverride(String(e._id), 'serviceLine', 'ai');
    await applyHumanOverride(String(e._id), 'summary', 'New summary.');

    const after = await Enquiry.findById(e._id);
    assert.equal(after.humanOverrides.company, 'Co A');
    assert.equal(after.humanOverrides.serviceLine, 'ai');
    assert.equal(after.humanOverrides.summary, 'New summary.');
    assert.equal(after.effectiveExtraction.company, 'Co A');
    assert.equal(after.effectiveExtraction.serviceLine, 'ai');
    assert.equal(after.effectiveExtraction.summary, 'New summary.');
    // Unedited fields stay from model
    assert.equal(after.effectiveExtraction.contactName, 'Rachel Whitfield');
  });

  test('24. Re-applying an override on the same field replaces the previous override value', async () => {
    const e = await createPhase6Enquiry();

    await applyHumanOverride(String(e._id), 'company', 'First Override');
    let mid = await Enquiry.findById(e._id);
    assert.equal(mid.effectiveExtraction.company, 'First Override');

    await applyHumanOverride(String(e._id), 'company', 'Second Override');
    const after = await Enquiry.findById(e._id);
    assert.equal(after.humanOverrides.company, 'Second Override');
    assert.equal(after.effectiveExtraction.company, 'Second Override');
  });
});

describe('humanOverrideService — validateFieldValue (pure unit checks)', () => {
  test('25. company accepts any string up to 2000 chars', () => {
    validateFieldValue('company', '');
    validateFieldValue('company', 'A'.repeat(2000));
    assert.throws(() => validateFieldValue('company', 'A'.repeat(2001)), (err) => err.code === 'INVALID_FIELD_VALUE');
    assert.throws(() => validateFieldValue('company', 42), (err) => err.code === 'INVALID_FIELD_VALUE');
  });

  test('26. contactEmail accepts valid email or empty string', () => {
    validateFieldValue('contactEmail', '');
    validateFieldValue('contactEmail', 'a@b.co');
    assert.throws(
      () => validateFieldValue('contactEmail', 'not-an-email'),
      (err) => err.code === 'INVALID_FIELD_VALUE',
    );
  });

  test('27. isGenuineProjectEnquiry rejects strings/numbers/null', () => {
    validateFieldValue('isGenuineProjectEnquiry', true);
    validateFieldValue('isGenuineProjectEnquiry', false);
    assert.throws(
      () => validateFieldValue('isGenuineProjectEnquiry', 'true'),
      (err) => err.code === 'INVALID_FIELD_VALUE',
    );
    assert.throws(
      () => validateFieldValue('isGenuineProjectEnquiry', 1),
      (err) => err.code === 'INVALID_FIELD_VALUE',
    );
  });

  test('28. budget rejects max < min', () => {
    assert.throws(
      () => validateFieldValue('budget', { min: 100, max: 50 }),
      (err) => err.code === 'INVALID_FIELD_VALUE',
    );
  });

  test('29. budget qualifier must be enum', () => {
    assert.throws(
      () => validateFieldValue('budget', { qualifier: 'invalid' }),
      (err) => err.code === 'INVALID_FIELD_VALUE',
    );
    validateFieldValue('budget', { qualifier: 'exact' });
  });
});
