/**
 * Test: enquiryService — Phase 5 list filters + sorting + status mutation.
 *
 * Source-of-truth: Docs/PRD.md FR-05 / FR-08, Docs/Rules.md §14, Docs/Phases.md
 * Phase 5 acceptance criteria.
 *
 * These tests require a running MongoDB at env.MONGODB_URI. They use a
 * separate `phase5_test` database to avoid polluting dev/phase3/phase4 data.
 *
 * Coverage:
 *   1. listEnquiries with no filters returns recent records (default sort: receivedAt desc).
 *   2. serviceLine filter narrows the queue to a specific service.
 *   3. priority filter narrows the queue to a specific priority level.
 *   4. status filter narrows the queue to a specific workflow status.
 *   5. Combined filters (serviceLine + priority + status) work together.
 *   6. sort=priority desc orders by priority.score (high → medium → low).
 *   7. sort=receivedAt asc reverses the default order.
 *   8. 'all' filter values are equivalent to omission.
 *   9. Invalid filter values are silently ignored by the service layer
 *      (the controller's zod schema rejects them with 400 before reaching here).
 *  10. updateEnquiryStatus transitions new → contacted → qualified → dropped.
 *  11. updateEnquiryStatus allows non-linear jumps (new → dropped directly).
 *  12. updateEnquiryStatus rejects invalid status with INVALID_STATUS.
 *  13. updateEnquiryStatus rejects invalid id with INVALID_ID.
 *  14. updateEnquiryStatus 404 on missing enquiry.
 *  15. updateEnquiryStatus does NOT touch originalText/receivedAt/effectiveExtraction/priority.
 *  16. Enquiries with null priority (extraction pending) are excluded from
 *      priority=high/medium/low filters but included under priority=all.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import Enquiry from '../src/models/Enquiry.js';
import * as enquiryService from '../src/services/enquiryService.js';
import { AppError } from '../src/middleware/errorHandler.js';

const TEST_DB = 'sodio_enquiry_triage_phase5_test';

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
 * Insert a test enquiry with a given receivedAt offset and extraction state.
 * `priorityLevel` sets the priority.level + a synthetic priority.score.
 */
async function createTestEnquiry({
  name,
  serviceLine = 'web',
  priorityLevel = null,
  priorityScore = null,
  status = 'new',
  minutesAgo = 0,
  extractionState = 'completed',
}) {
  const receivedAt = new Date(Date.now() - minutesAgo * 60_000);
  const enquiry = new Enquiry({
    source: 'paste',
    originalText: `Test enquiry from ${name}.`,
    sender: { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com` },
    receivedAt,
    status,
    extractionState,
    effectiveExtraction:
      extractionState === 'completed'
        ? {
            company: `${name} Co`,
            contactName: name,
            contactEmail: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
            serviceLine,
            budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
            timeline: { raw: 'September', normalized: { period: 'relative' } },
            summary: `${name} wants a project.`,
            projectCount: 1,
            additionalProjectNote: null,
          }
        : null,
    isGenuineProjectEnquiry: extractionState === 'completed' ? true : null,
    priority:
      priorityLevel != null
        ? { level: priorityLevel, score: priorityScore, reasons: ['test reason'] }
        : { level: null, score: null, reasons: [] },
  });
  return enquiry.save();
}

describe('enquiryService — Phase 5 list filters + sorting', () => {
  test('1. No filters returns recent records (default sort: receivedAt desc)', async () => {
    await createTestEnquiry({ name: 'Alice', minutesAgo: 10 });
    await createTestEnquiry({ name: 'Bob', minutesAgo: 5 });
    await createTestEnquiry({ name: 'Carol', minutesAgo: 1 });

    const docs = await enquiryService.listEnquiries({ limit: 50 });
    assert.equal(docs.length, 3);
    // Most recent first (Carol received 1 minute ago, Alice 10 minutes ago).
    assert.equal(docs[0].sender.name, 'Carol');
    assert.equal(docs[2].sender.name, 'Alice');
  });

  test('2. serviceLine filter narrows to a specific service', async () => {
    await createTestEnquiry({ name: 'Alice', serviceLine: 'web' });
    await createTestEnquiry({ name: 'Bob', serviceLine: 'ai' });
    await createTestEnquiry({ name: 'Carol', serviceLine: 'web' });

    const docs = await enquiryService.listEnquiries({ serviceLine: 'web' });
    assert.equal(docs.length, 2);
    assert.ok(docs.every((d) => d.effectiveExtraction.serviceLine === 'web'));
  });

  test('3. priority filter narrows to a specific priority level', async () => {
    await createTestEnquiry({ name: 'Alice', priorityLevel: 'high', priorityScore: 10 });
    await createTestEnquiry({ name: 'Bob', priorityLevel: 'low', priorityScore: 1 });
    await createTestEnquiry({ name: 'Carol', priorityLevel: 'high', priorityScore: 9 });

    const docs = await enquiryService.listEnquiries({ priority: 'high' });
    assert.equal(docs.length, 2);
    assert.ok(docs.every((d) => d.priority.level === 'high'));
  });

  test('4. status filter narrows to a specific workflow status', async () => {
    await createTestEnquiry({ name: 'Alice', status: 'new' });
    await createTestEnquiry({ name: 'Bob', status: 'contacted' });
    await createTestEnquiry({ name: 'Carol', status: 'dropped' });

    const docs = await enquiryService.listEnquiries({ status: 'contacted' });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].sender.name, 'Bob');
  });

  test('5. Combined filters work together', async () => {
    await createTestEnquiry({
      name: 'Alice',
      serviceLine: 'web',
      priorityLevel: 'high',
      priorityScore: 10,
      status: 'new',
    });
    await createTestEnquiry({
      name: 'Bob',
      serviceLine: 'web',
      priorityLevel: 'low',
      priorityScore: 1,
      status: 'new',
    });
    await createTestEnquiry({
      name: 'Carol',
      serviceLine: 'ai',
      priorityLevel: 'high',
      priorityScore: 9,
      status: 'new',
    });

    const docs = await enquiryService.listEnquiries({
      serviceLine: 'web',
      priority: 'high',
      status: 'new',
    });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].sender.name, 'Alice');
  });

  test('6. sort=priority desc orders by priority.score (high → medium → low)', async () => {
    await createTestEnquiry({ name: 'Low', priorityLevel: 'low', priorityScore: 1, minutesAgo: 5 });
    await createTestEnquiry({
      name: 'High',
      priorityLevel: 'high',
      priorityScore: 12,
      minutesAgo: 10,
    });
    await createTestEnquiry({
      name: 'Medium',
      priorityLevel: 'medium',
      priorityScore: 5,
      minutesAgo: 1,
    });

    const docs = await enquiryService.listEnquiries({ sort: 'priority', dir: 'desc' });
    assert.equal(docs.length, 3);
    assert.equal(docs[0].sender.name, 'High');
    assert.equal(docs[1].sender.name, 'Medium');
    assert.equal(docs[2].sender.name, 'Low');
  });

  test('7. sort=receivedAt asc reverses the default order', async () => {
    await createTestEnquiry({ name: 'Alice', minutesAgo: 10 });
    await createTestEnquiry({ name: 'Bob', minutesAgo: 5 });
    await createTestEnquiry({ name: 'Carol', minutesAgo: 1 });

    const docs = await enquiryService.listEnquiries({ sort: 'receivedAt', dir: 'asc' });
    assert.equal(docs.length, 3);
    // Oldest first (Alice received 10 minutes ago).
    assert.equal(docs[0].sender.name, 'Alice');
    assert.equal(docs[2].sender.name, 'Carol');
  });

  test('8. "all" filter values are equivalent to omission', async () => {
    await createTestEnquiry({
      name: 'Alice',
      serviceLine: 'web',
      priorityLevel: 'high',
      priorityScore: 10,
      status: 'new',
    });
    await createTestEnquiry({
      name: 'Bob',
      serviceLine: 'ai',
      priorityLevel: 'low',
      priorityScore: 1,
      status: 'dropped',
    });

    const docs = await enquiryService.listEnquiries({
      serviceLine: 'all',
      priority: 'all',
      status: 'all',
    });
    assert.equal(docs.length, 2);
  });

  test('9. Invalid filter values are silently ignored by the service layer', async () => {
    // The controller's zod schema rejects these BEFORE reaching the service,
    // but the service layer is also defensive — invalid values simply do not
    // narrow the query. This is a defence-in-depth check.
    await createTestEnquiry({ name: 'Alice', serviceLine: 'web' });
    await createTestEnquiry({ name: 'Bob', serviceLine: 'ai' });

    const docs = await enquiryService.listEnquiries({
      serviceLine: 'invalid-value',
      priority: 'invalid-value',
      status: 'invalid-value',
    });
    assert.equal(docs.length, 2);
  });

  test('16. Pending-extraction enquiries excluded from priority filter but included under "all"', async () => {
    // Two completed extractions with high priority, one pending with no priority yet.
    await createTestEnquiry({
      name: 'HighA',
      priorityLevel: 'high',
      priorityScore: 10,
      extractionState: 'completed',
    });
    await createTestEnquiry({
      name: 'HighB',
      priorityLevel: 'high',
      priorityScore: 9,
      extractionState: 'completed',
    });
    await createTestEnquiry({
      name: 'Pending',
      priorityLevel: null,
      priorityScore: null,
      extractionState: 'pending',
    });

    const highOnly = await enquiryService.listEnquiries({ priority: 'high' });
    assert.equal(highOnly.length, 2);
    assert.ok(highOnly.every((d) => d.priority.level === 'high'));

    const all = await enquiryService.listEnquiries({ priority: 'all' });
    assert.equal(all.length, 3);
  });
});

describe('enquiryService — Phase 5 status mutation', () => {
  test('10. Linear transition new → contacted → qualified → dropped', async () => {
    const e = await createTestEnquiry({ name: 'Alice', status: 'new' });
    const id = String(e._id);

    const c = await enquiryService.updateEnquiryStatus(id, 'contacted');
    assert.equal(c.status, 'contacted');
    const q = await enquiryService.updateEnquiryStatus(id, 'qualified');
    assert.equal(q.status, 'qualified');
    const d = await enquiryService.updateEnquiryStatus(id, 'dropped');
    assert.equal(d.status, 'dropped');
  });

  test('11. Non-linear jump new → dropped is allowed', async () => {
    const e = await createTestEnquiry({ name: 'Spammer', status: 'new' });
    const d = await enquiryService.updateEnquiryStatus(String(e._id), 'dropped');
    assert.equal(d.status, 'dropped');
  });

  test('12. Invalid status rejected with INVALID_STATUS', async () => {
    const e = await createTestEnquiry({ name: 'Alice', status: 'new' });
    await assert.rejects(
      enquiryService.updateEnquiryStatus(String(e._id), 'frozen'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_STATUS',
    );
  });

  test('13. Invalid id rejected with INVALID_ID', async () => {
    await assert.rejects(
      enquiryService.updateEnquiryStatus('not-an-id', 'contacted'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_ID',
    );
  });

  test('14. Missing enquiry returns NOT_FOUND', async () => {
    const fakeId = '012345678901234567890123';
    await assert.rejects(
      enquiryService.updateEnquiryStatus(fakeId, 'contacted'),
      (err) => err instanceof AppError && err.status === 404 && err.code === 'NOT_FOUND',
    );
  });

  test('15. updateEnquiryStatus does NOT touch immutable or sibling fields', async () => {
    const e = await createTestEnquiry({
      name: 'Alice',
      status: 'new',
      priorityLevel: 'high',
      priorityScore: 10,
    });
    const originalText = e.originalText;
    const receivedAt = e.receivedAt;
    const effectiveExtraction = JSON.stringify(e.effectiveExtraction);
    const priorityScore = e.priority.score;

    const updated = await enquiryService.updateEnquiryStatus(String(e._id), 'contacted');

    // Immutable fields preserved.
    assert.equal(updated.originalText, originalText);
    assert.equal(updated.receivedAt.toISOString(), receivedAt.toISOString());
    // Sibling fields untouched.
    assert.equal(JSON.stringify(updated.effectiveExtraction), effectiveExtraction);
    assert.equal(updated.priority.score, priorityScore);
    assert.equal(updated.priority.level, 'high');
    // Status changed.
    assert.equal(updated.status, 'contacted');
  });
});
