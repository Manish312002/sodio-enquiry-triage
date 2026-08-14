/**
 * Test: effectiveValueService — Phase 6 pure effective-value resolver.
 *
 * Source-of-truth: Architechure.md §7 ("Effective Value Resolution"),
 * Rules.md §10 ("Human Correction Rules"), Rules.md §14 ("Data Integrity").
 *
 * These tests are PURE — no MongoDB, no I/O. The effective-value resolver
 * must be deterministic and side-effect-free so it can be unit-tested in
 * isolation.
 *
 * Coverage:
 *   1. isOverrideableField — allowlist boundary
 *   2. hasAnyOverride — null/undefined values count as "no override"
 *   3. hasAnyOverride — false/0/'' count as active overrides
 *   4. getModelValue — prefers modelExtraction, falls back to effectiveExtraction
 *   5. getModelValue — isGenuineProjectEnquiry reads top-level field
 *   6. getOverrideValue — null/undefined mean no override; non-null is active
 *   7. resolveEffectiveValue — override wins over model
 *   8. resolveEffectiveValue — model is used when override is null
 *   9. computeEffectiveExtraction — full merge
 *  10. computeEffectiveExtraction — preserves projectCount + additionalProjectNote from model
 *  11. computeEffectiveExtraction — handles missing modelExtraction (pre-Phase-6 records)
 *  12. computeEffectiveExtraction — empty overrides returns model values
 *  13. computeEffectiveExtraction — budget override replaces entire budget subdoc
 *  14. computeEffectiveExtraction — timeline override replaces entire timeline subdoc
 *  15. OVERRIDEABLE_FIELDS excludes priority and originalText
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  OVERRIDEABLE_FIELDS,
  SERVICE_LINES,
  BUDGET_QUALIFIERS,
  isOverrideableField,
  hasAnyOverride,
  getModelValue,
  getOverrideValue,
  resolveEffectiveValue,
  computeEffectiveExtraction,
} from '../src/services/effectiveValueService.js';

describe('effectiveValueService — Phase 6 pure resolver', () => {
  describe('isOverrideableField / OVERRIDEABLE_FIELDS', () => {
    test('1. allowlist contains exactly the 8 editable fields', () => {
      assert.deepEqual([...OVERRIDEABLE_FIELDS].sort(), [
        'budget',
        'company',
        'contactEmail',
        'contactName',
        'isGenuineProjectEnquiry',
        'serviceLine',
        'summary',
        'timeline',
      ]);
    });

    test('2. priority is NOT in the allowlist (security boundary)', () => {
      assert.equal(isOverrideableField('priority'), false);
    });

    test('3. originalText is NOT in the allowlist (immutability)', () => {
      assert.equal(isOverrideableField('originalText'), false);
    });

    test('4. receivedAt, status, extractionState, batchId, sender are NOT in the allowlist', () => {
      assert.equal(isOverrideableField('receivedAt'), false);
      assert.equal(isOverrideableField('status'), false);
      assert.equal(isOverrideableField('extractionState'), false);
      assert.equal(isOverrideableField('batchId'), false);
      assert.equal(isOverrideableField('sender'), false);
      assert.equal(isOverrideableField('createdAt'), false);
      assert.equal(isOverrideableField('updatedAt'), false);
      assert.equal(isOverrideableField('_id'), false);
    });

    test('5. all 8 declared fields return true', () => {
      for (const f of OVERRIDEABLE_FIELDS) {
        assert.equal(isOverrideableField(f), true);
      }
    });

    test('6. unknown / arbitrary field names return false', () => {
      assert.equal(isOverrideableField('arbitraryProp'), false);
      assert.equal(isOverrideableField(''), false);
      assert.equal(isOverrideableField(null), false);
      assert.equal(isOverrideableField(undefined), false);
      assert.equal(isOverrideableField(123), false);
    });
  });

  describe('hasAnyOverride', () => {
    test('7. null / undefined / empty object → no override', () => {
      assert.equal(hasAnyOverride(null), false);
      assert.equal(hasAnyOverride(undefined), false);
      assert.equal(hasAnyOverride({}), false);
      assert.equal(
        hasAnyOverride({
          company: null,
          contactName: null,
          contactEmail: null,
          serviceLine: null,
          budget: null,
          timeline: null,
          summary: null,
          isGenuineProjectEnquiry: null,
        }),
        false,
      );
    });

    test('8. false / 0 / empty-string count as ACTIVE overrides (non-null)', () => {
      assert.equal(hasAnyOverride({ company: '' }), true);
      assert.equal(hasAnyOverride({ isGenuineProjectEnquiry: false }), true);
      assert.equal(hasAnyOverride({ budget: { raw: '', min: 0, max: 0 } }), true);
    });

    test('9. mixed null + non-null → has override', () => {
      assert.equal(
        hasAnyOverride({
          company: null,
          contactName: null,
          contactEmail: null,
          serviceLine: 'web',
          budget: null,
          timeline: null,
          summary: null,
          isGenuineProjectEnquiry: null,
        }),
        true,
      );
    });
  });

  describe('getModelValue', () => {
    test('10. prefers modelExtraction over effectiveExtraction', () => {
      const enquiry = {
        modelExtraction: { company: 'Model Co' },
        effectiveExtraction: { company: 'Effective Co' },
      };
      assert.equal(getModelValue(enquiry, 'company'), 'Model Co');
    });

    test('11. falls back to effectiveExtraction when modelExtraction is null (pre-Phase-6 records)', () => {
      const enquiry = {
        modelExtraction: null,
        effectiveExtraction: { company: 'Pre-Phase-6 Co' },
      };
      assert.equal(getModelValue(enquiry, 'company'), 'Pre-Phase-6 Co');
    });

    test('12. isGenuineProjectEnquiry reads top-level enquiry field, not modelExtraction', () => {
      const enquiry = {
        isGenuineProjectEnquiry: true,
        modelExtraction: { company: 'X' }, // modelExtraction does NOT contain isGenuineProjectEnquiry
      };
      assert.equal(getModelValue(enquiry, 'isGenuineProjectEnquiry'), true);
    });

    test('13. returns undefined for unknown enquiry', () => {
      assert.equal(getModelValue(null, 'company'), undefined);
      assert.equal(getModelValue(undefined, 'company'), undefined);
    });
  });

  describe('getOverrideValue', () => {
    test('14. null / undefined / missing → undefined (no override)', () => {
      assert.equal(getOverrideValue({ company: null }, 'company'), undefined);
      assert.equal(getOverrideValue({ company: undefined }, 'company'), undefined);
      assert.equal(getOverrideValue({}, 'company'), undefined);
      assert.equal(getOverrideValue(null, 'company'), undefined);
    });

    test('15. false / 0 / empty-string → returns the value (active override)', () => {
      assert.equal(getOverrideValue({ company: '' }, 'company'), '');
      assert.equal(getOverrideValue({ isGenuineProjectEnquiry: false }, 'isGenuineProjectEnquiry'), false);
      assert.deepEqual(getOverrideValue({ budget: { min: 0 } }, 'budget'), { min: 0 });
    });
  });

  describe('resolveEffectiveValue', () => {
    test('16. override wins over model when active', () => {
      const enquiry = {
        modelExtraction: { company: 'Model Co' },
        effectiveExtraction: { company: 'Model Co' },
        humanOverrides: { company: 'Override Co' },
      };
      const result = resolveEffectiveValue(enquiry, 'company');
      assert.equal(result.value, 'Override Co');
      assert.equal(result.source, 'override');
    });

    test('17. model wins when override is null', () => {
      const enquiry = {
        modelExtraction: { company: 'Model Co' },
        effectiveExtraction: { company: 'Model Co' },
        humanOverrides: { company: null },
      };
      const result = resolveEffectiveValue(enquiry, 'company');
      assert.equal(result.value, 'Model Co');
      assert.equal(result.source, 'model');
    });

    test('18. override = false beats model = true (for isGenuineProjectEnquiry)', () => {
      const enquiry = {
        isGenuineProjectEnquiry: true,
        modelExtraction: { company: 'X' },
        humanOverrides: { isGenuineProjectEnquiry: false },
      };
      const result = resolveEffectiveValue(enquiry, 'isGenuineProjectEnquiry');
      assert.equal(result.value, false);
      assert.equal(result.source, 'override');
    });
  });

  describe('computeEffectiveExtraction', () => {
    const baseModel = {
      company: 'Model Co',
      contactName: 'Model Person',
      contactEmail: 'model@example.com',
      serviceLine: 'web',
      budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
      timeline: { raw: 'September', normalized: { period: 'relative' } },
      summary: 'Model summary.',
      projectCount: 1,
      additionalProjectNote: null,
    };

    test('19. empty overrides → effective === model', () => {
      const enquiry = {
        modelExtraction: baseModel,
        effectiveExtraction: baseModel,
        humanOverrides: {},
      };
      const eff = computeEffectiveExtraction(enquiry);
      assert.equal(eff.company, 'Model Co');
      assert.equal(eff.serviceLine, 'web');
      assert.equal(eff.budget.raw, '£40,000');
      assert.equal(eff.timeline.raw, 'September');
      assert.equal(eff.summary, 'Model summary.');
      assert.equal(eff.projectCount, 1); // preserved from model
      assert.equal(eff.additionalProjectNote, null); // preserved from model
    });

    test('20. partial overrides — only overridden fields change, others stay from model', () => {
      const enquiry = {
        modelExtraction: baseModel,
        effectiveExtraction: baseModel,
        humanOverrides: { company: 'Override Co', serviceLine: 'ai' },
      };
      const eff = computeEffectiveExtraction(enquiry);
      assert.equal(eff.company, 'Override Co');
      assert.equal(eff.serviceLine, 'ai');
      // Untouched fields stay from model
      assert.equal(eff.contactName, 'Model Person');
      assert.equal(eff.contactEmail, 'model@example.com');
      assert.equal(eff.budget.raw, '£40,000');
      assert.equal(eff.timeline.raw, 'September');
      assert.equal(eff.summary, 'Model summary.');
      assert.equal(eff.projectCount, 1);
    });

    test('21. budget override replaces the entire budget subdoc', () => {
      const newBudget = {
        raw: '£500,000',
        currency: 'GBP',
        min: 500000,
        max: 500000,
        qualifier: 'exact',
      };
      const enquiry = {
        modelExtraction: baseModel,
        effectiveExtraction: baseModel,
        humanOverrides: { budget: newBudget },
      };
      const eff = computeEffectiveExtraction(enquiry);
      assert.deepEqual(eff.budget, newBudget);
      // Other fields untouched
      assert.equal(eff.company, 'Model Co');
    });

    test('22. timeline override preserves raw wording; normalized is replaced wholesale', () => {
      const newTimeline = { raw: 'ASAP', normalized: { urgency: 'immediate' } };
      const enquiry = {
        modelExtraction: baseModel,
        effectiveExtraction: baseModel,
        humanOverrides: { timeline: newTimeline },
      };
      const eff = computeEffectiveExtraction(enquiry);
      assert.deepEqual(eff.timeline, newTimeline);
    });

    test('23. handles missing modelExtraction (pre-Phase-6 records)', () => {
      const enquiry = {
        modelExtraction: null,
        effectiveExtraction: baseModel,
        humanOverrides: { company: 'Override Co' },
      };
      const eff = computeEffectiveExtraction(enquiry);
      assert.equal(eff.company, 'Override Co');
      // Falls back to effectiveExtraction for the model source
      assert.equal(eff.contactName, 'Model Person');
      assert.equal(eff.budget.raw, '£40,000');
    });

    test('24. handles null enquiry (defensive)', () => {
      assert.deepEqual(computeEffectiveExtraction(null), {});
      assert.deepEqual(computeEffectiveExtraction(undefined), {});
    });

    test('25. projectCount + additionalProjectNote are NOT overrideable — always from model', () => {
      const enquiry = {
        modelExtraction: { ...baseModel, projectCount: 3, additionalProjectNote: 'multi' },
        effectiveExtraction: baseModel,
        humanOverrides: { projectCount: 999, additionalProjectNote: 'hacked' },
      };
      const eff = computeEffectiveExtraction(enquiry);
      // Even if the override object contains these keys, the resolver
      // ignores them — they are model-only signals.
      assert.equal(eff.projectCount, 3);
      assert.equal(eff.additionalProjectNote, 'multi');
    });
  });

  describe('SERVICE_LINES + BUDGET_QUALIFIERS enums', () => {
    test('26. SERVICE_LINES matches Rules.md §5 allowlist', () => {
      assert.deepEqual([...SERVICE_LINES].sort(), [
        'ai',
        'blockchain',
        'game',
        'mobile',
        'other',
        'web',
      ]);
    });

    test('27. BUDGET_QUALIFIERS matches Rules.md §6 allowlist', () => {
      assert.deepEqual([...BUDGET_QUALIFIERS].sort(), [
        'exact',
        'flexible',
        'range',
        'tbd',
        'unknown',
      ]);
    });
  });
});
