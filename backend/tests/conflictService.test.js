/**
 * Test: conflictService — Phase 7 pure unit tests.
 *
 * Source-of-truth: Rules.md §11 ("Re-Extraction Rules"), Architechure.md §7
 * ("Effective Value Resolution"), PRD.md FR-09 ("Re-extraction").
 *
 * These tests are PURE — no I/O, no MongoDB, no mocks. They verify the
 * conflict detection logic in isolation.
 *
 * Coverage:
 *   1. No overrides → no conflicts (even if model provides values).
 *   2. Override present, model absent → no conflicts.
 *   3. Override and model identical → no conflicts (per spec: "Do not
 *      treat identical human/model values as meaningful conflicts").
 *   4. Override and model differ → conflict for that field.
 *   5. Multiple conflicts detected across multiple fields.
 *   6. Field with override but model value is null → no conflict.
 *   7. Field with null override (cleared) but model has value → no conflict.
 *   8. Falsy override values (false, 0, '') count as active and can conflict.
 *   9. isGenuineProjectEnquiry: override=false vs model=true → conflict.
 *  10. isGenuineProjectEnquiry: override=true vs model=true → no conflict.
 *  11. budget deep-equal: same structure → no conflict.
 *  12. budget deep-equal: different min → conflict.
 *  13. budget deep-equal: different qualifier → conflict.
 *  14. timeline deep-equal: same raw, different normalized → conflict.
 *  15. Fields NOT in OVERRIDEABLE_FIELDS are ignored (defence in depth).
 *  16. Empty/missing humanOverrides → no conflicts.
 *  17. Empty/missing newModelOutput → no conflicts.
 *  18. hasConflict returns true for a conflicted field.
 *  19. hasConflict returns false for a non-conflicted field.
 *  20. getNewModelValue returns the model value when present.
 *  21. getNewModelValue returns undefined when absent.
 *  22. getNewModelValue returns undefined when null.
 *  23. Override on field A, model only on field B → no conflicts.
 *  24. Conflict shape: { field, humanValue, newModelValue, hasConflict: true }.
 *  25. Mixed: some fields conflict, some don't — only conflicts returned.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectConflicts,
  hasConflict,
  getNewModelValue,
  OVERRIDEABLE_FIELDS,
} from '../src/services/conflictService.js';

describe('conflictService — Phase 7 conflict detection', () => {
  test('1. No overrides → no conflicts', () => {
    const humanOverrides = {
      company: null,
      contactName: null,
      contactEmail: null,
      serviceLine: null,
      budget: null,
      timeline: null,
      summary: null,
      isGenuineProjectEnquiry: null,
    };
    const newModel = {
      company: 'Acme',
      budget: { raw: '£50k', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
    };
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('2. Override present, model absent → no conflicts', () => {
    const humanOverrides = {
      company: 'Override Co',
      budget: null,
    };
    const newModel = {}; // model provides nothing
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('3. Override and model identical → no conflicts', () => {
    const humanOverrides = {
      company: 'Acme',
      budget: { raw: '£50k', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
    };
    const newModel = {
      company: 'Acme',
      budget: { raw: '£50k', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
    };
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('4. Override and model differ → conflict for that field', () => {
    const humanOverrides = { company: 'Override Co' };
    const newModel = { company: 'Model Co' };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'company');
    assert.equal(conflicts[0].humanValue, 'Override Co');
    assert.equal(conflicts[0].newModelValue, 'Model Co');
    assert.equal(conflicts[0].hasConflict, true);
  });

  test('5. Multiple conflicts detected across multiple fields', () => {
    const humanOverrides = {
      company: 'Override Co',
      contactName: 'Override Person',
      serviceLine: 'web',
    };
    const newModel = {
      company: 'Model Co',
      contactName: 'Model Person',
      serviceLine: 'mobile',
    };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 3);
    const fields = conflicts.map((c) => c.field).sort();
    assert.deepEqual(fields, ['company', 'contactName', 'serviceLine']);
  });

  test('6. Field with override but model value is null → no conflict', () => {
    const humanOverrides = { company: 'Override Co' };
    const newModel = { company: null };
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('7. Field with null override (cleared) but model has value → no conflict', () => {
    const humanOverrides = { company: null };
    const newModel = { company: 'Model Co' };
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('8. Falsy override values (false, 0, "") count as active and can conflict', () => {
    // isGenuineProjectEnquiry=false is an active override (Phase 6 semantics).
    const humanOverrides = { isGenuineProjectEnquiry: false };
    const newModel = { isGenuineProjectEnquiry: true };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'isGenuineProjectEnquiry');
    assert.equal(conflicts[0].humanValue, false);
    assert.equal(conflicts[0].newModelValue, true);
  });

  test('9. isGenuineProjectEnquiry: override=false vs model=true → conflict', () => {
    const humanOverrides = { isGenuineProjectEnquiry: false };
    const newModel = { isGenuineProjectEnquiry: true };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'isGenuineProjectEnquiry');
  });

  test('10. isGenuineProjectEnquiry: override=true vs model=true → no conflict', () => {
    const humanOverrides = { isGenuineProjectEnquiry: true };
    const newModel = { isGenuineProjectEnquiry: true };
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('11. budget deep-equal: same structure → no conflict', () => {
    const budget = { raw: '£50k', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' };
    const humanOverrides = { budget };
    const newModel = { budget: { ...budget } }; // different object, same values
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('12. budget deep-equal: different min → conflict', () => {
    const humanOverrides = {
      budget: { raw: '£400k', currency: 'GBP', min: 400000, max: 400000, qualifier: 'exact' },
    };
    const newModel = {
      budget: { raw: '£50k', currency: 'GBP', min: 50000, max: 50000, qualifier: 'exact' },
    };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'budget');
    assert.equal(conflicts[0].humanValue.min, 400000);
    assert.equal(conflicts[0].newModelValue.min, 50000);
  });

  test('13. budget deep-equal: different qualifier → conflict', () => {
    const humanOverrides = {
      budget: { raw: '£400k', currency: 'GBP', min: 400000, max: 400000, qualifier: 'exact' },
    };
    const newModel = {
      budget: { raw: '£400k', currency: 'GBP', min: 400000, max: 400000, qualifier: 'range' },
    };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'budget');
    assert.equal(conflicts[0].humanValue.qualifier, 'exact');
    assert.equal(conflicts[0].newModelValue.qualifier, 'range');
  });

  test('14. timeline deep-equal: same raw, different normalized → conflict', () => {
    const humanOverrides = {
      timeline: { raw: 'September', normalized: { period: 'relative' } },
    };
    const newModel = {
      timeline: { raw: 'September', normalized: { period: 'Q3' } },
    };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'timeline');
  });

  test('15. Fields NOT in OVERRIDEABLE_FIELDS are ignored (defence in depth)', () => {
    // Even if the caller injects an override for `priority` or `originalText`,
    // the conflict detector ignores them because they're not in the allowlist.
    const humanOverrides = {
      company: 'Override Co',
      // Injected fields that should be IGNORED:
      priority: { level: 'high', score: 99 },
      originalText: 'HACKED',
      receivedAt: '2020-01-01',
    };
    const newModel = {
      company: 'Model Co',
      // These should also be ignored:
      priority: { level: 'low', score: 0 },
      originalText: 'DIFFERENT',
    };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].field, 'company');
    // No conflict for priority, originalText, or receivedAt.
    assert.ok(!conflicts.some((c) => c.field === 'priority'));
    assert.ok(!conflicts.some((c) => c.field === 'originalText'));
    assert.ok(!conflicts.some((c) => c.field === 'receivedAt'));
  });

  test('16. Empty/missing humanOverrides → no conflicts', () => {
    assert.deepEqual(detectConflicts(null, { company: 'Acme' }), []);
    assert.deepEqual(detectConflicts(undefined, { company: 'Acme' }), []);
    assert.deepEqual(detectConflicts({}, { company: 'Acme' }), []);
  });

  test('17. Empty/missing newModelOutput → no conflicts', () => {
    assert.deepEqual(detectConflicts({ company: 'Override Co' }, null), []);
    assert.deepEqual(detectConflicts({ company: 'Override Co' }, undefined), []);
    assert.deepEqual(detectConflicts({ company: 'Override Co' }, {}), []);
  });

  test('18. hasConflict returns true for a conflicted field', () => {
    const humanOverrides = { company: 'Override Co' };
    const newModel = { company: 'Model Co' };
    assert.equal(hasConflict(humanOverrides, newModel, 'company'), true);
  });

  test('19. hasConflict returns false for a non-conflicted field', () => {
    const humanOverrides = { company: 'Override Co' };
    const newModel = { company: 'Override Co' }; // identical
    assert.equal(hasConflict(humanOverrides, newModel, 'company'), false);
    // Field with no override:
    assert.equal(hasConflict({ company: null }, newModel, 'company'), false);
    // Field with override but no model value:
    assert.equal(hasConflict({ company: 'Override Co' }, {}, 'company'), false);
  });

  test('20. getNewModelValue returns the model value when present', () => {
    const newModel = { company: 'Model Co' };
    assert.equal(getNewModelValue(newModel, 'company'), 'Model Co');
  });

  test('21. getNewModelValue returns undefined when absent', () => {
    const newModel = { company: 'Model Co' };
    assert.equal(getNewModelValue(newModel, 'budget'), undefined);
  });

  test('22. getNewModelValue returns undefined when null', () => {
    const newModel = { company: null };
    assert.equal(getNewModelValue(newModel, 'company'), undefined);
  });

  test('23. Override on field A, model only on field B → no conflicts', () => {
    const humanOverrides = { company: 'Override Co' };
    const newModel = { contactName: 'Model Person' }; // different field
    assert.deepEqual(detectConflicts(humanOverrides, newModel), []);
  });

  test('24. Conflict shape: { field, humanValue, newModelValue, hasConflict: true }', () => {
    const humanOverrides = { company: 'Override Co' };
    const newModel = { company: 'Model Co' };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 1);
    const c = conflicts[0];
    // Shape check
    assert.equal(typeof c.field, 'string');
    assert.ok('humanValue' in c);
    assert.ok('newModelValue' in c);
    assert.equal(c.hasConflict, true);
  });

  test("25. Mixed: some fields conflict, some do not — only conflicts returned", () => {
    const humanOverrides = {
      company: 'Override Co',          // conflicts with model
      contactName: 'Same Name',        // identical to model → no conflict
      contactEmail: 'override@example.com', // conflicts with model
      serviceLine: null,               // no override → no conflict
      budget: null,                    // no override → no conflict
    };
    const newModel = {
      company: 'Model Co',
      contactName: 'Same Name',
      contactEmail: 'model@example.com',
      serviceLine: 'web',
      budget: { raw: '£50k', qualifier: 'exact' },
    };
    const conflicts = detectConflicts(humanOverrides, newModel);
    assert.equal(conflicts.length, 2);
    const fields = conflicts.map((c) => c.field).sort();
    assert.deepEqual(fields, ['company', 'contactEmail']);
  });

  test('26. OVERRIDEABLE_FIELDS includes all 8 fields', () => {
    assert.equal(OVERRIDEABLE_FIELDS.length, 8);
    assert.ok(OVERRIDEABLE_FIELDS.includes('company'));
    assert.ok(OVERRIDEABLE_FIELDS.includes('contactName'));
    assert.ok(OVERRIDEABLE_FIELDS.includes('contactEmail'));
    assert.ok(OVERRIDEABLE_FIELDS.includes('serviceLine'));
    assert.ok(OVERRIDEABLE_FIELDS.includes('budget'));
    assert.ok(OVERRIDEABLE_FIELDS.includes('timeline'));
    assert.ok(OVERRIDEABLE_FIELDS.includes('summary'));
    assert.ok(OVERRIDEABLE_FIELDS.includes('isGenuineProjectEnquiry'));
  });

  test('27. OVERRIDEABLE_FIELDS excludes priority and originalText', () => {
    assert.ok(!OVERRIDEABLE_FIELDS.includes('priority'));
    assert.ok(!OVERRIDEABLE_FIELDS.includes('originalText'));
    assert.ok(!OVERRIDEABLE_FIELDS.includes('receivedAt'));
    assert.ok(!OVERRIDEABLE_FIELDS.includes('status'));
  });
});
