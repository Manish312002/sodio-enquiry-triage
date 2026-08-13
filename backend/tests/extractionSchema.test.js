/**
 * Test: extractionSchema (zod)
 *
 * Verifies that the extraction schema:
 *   - accepts a fully-populated valid extraction
 *   - rejects unknown fields (strict mode)
 *   - rejects out-of-enum serviceLine / budget.qualifier
 *   - coerces defaults for missing optional fields
 *   - never contains a `priority` field (priority is computed by
 *     scoringService in Phase 4, NOT by the LLM — Rules.md §3)
 *   - handles Unicode content (Spanish, currency symbols, emoji)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractionSchema } from '../src/services/llm/extractionSchema.js';
import { validExtraction } from './_helpers.js';

describe('extractionSchema', () => {
  test('accepts a fully-populated valid extraction', () => {
    const r = extractionSchema.safeParse(validExtraction());
    assert.ok(r.success, JSON.stringify(r.error?.issues));
    assert.equal(r.data.company, 'Test Co');
    assert.equal(r.data.budget.qualifier, 'exact');
    assert.equal(r.data.isGenuineProjectEnquiry, true);
  });

  test('applies defaults for missing optional fields', () => {
    const r = extractionSchema.safeParse({
      company: null,
      contactName: null,
      contactEmail: null,
      summary: '',
      isGenuineProjectEnquiry: false,
    });
    assert.ok(r.success);
    assert.equal(r.data.serviceLine, 'other');
    assert.equal(r.data.budget.qualifier, 'unknown');
    assert.equal(r.data.projectCount, 1);
    assert.equal(r.data.confidence, null);
  });

  test('rejects unknown top-level fields (strict mode)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      priority: { level: 'high', score: 99 }, // must NOT be in LLM schema
    });
    assert.equal(r.success, false);
    // zod reports unrecognized_keys with code 'unrecognized_keys' and
    // the unknown key names in `keys`, not in `path`.
    const unrecognized = r.error.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('priority'),
    );
    assert.ok(unrecognized, 'zod must flag the unknown "priority" key');
  });

  test('rejects out-of-enum serviceLine', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      serviceLine: 'design', // not in [ai|blockchain|web|mobile|game|other]
    });
    assert.equal(r.success, false);
  });

  test('rejects out-of-enum budget.qualifier', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      budget: { ...validExtraction().budget, qualifier: 'huge' },
    });
    assert.equal(r.success, false);
  });

  test('schema does NOT declare a `priority` field', () => {
    // Sanity: the LLM schema must never include priority (Rules.md §3).
    // We introspect the zod shape to confirm.
    const shape = extractionSchema.shape;
    assert.equal(shape.priority, undefined, 'priority must NOT be in extractionSchema');
  });

  test('accepts null for nullable string fields', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      company: null,
      contactName: null,
      contactEmail: null,
      additionalProjectNote: null,
    });
    assert.ok(r.success);
  });

  test('accepts empty string for contactEmail', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      contactEmail: '',
    });
    assert.ok(r.success);
  });

  test('preserves Unicode content in summary field', () => {
    const unicode = 'Buenos días — clínica móvil — 25.000 € — ¿Pueden? 🙏';
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      summary: unicode,
    });
    assert.ok(r.success);
    assert.equal(r.data.summary, unicode);
  });

  test('preserves multi-currency raw budget strings', () => {
    const cases = [
      '£40,000',
      '25.000 €',
      '$80k',
      '35-40 lakhs',
      '$60k and $90k',
      '₹50,00,000',
    ];
    for (const raw of cases) {
      const r = extractionSchema.safeParse({
        ...validExtraction(),
        budget: { raw, currency: null, min: null, max: null, qualifier: 'unknown' },
      });
      assert.ok(r.success, `Failed for: ${raw}`);
      assert.equal(r.data.budget.raw, raw);
    }
  });

  test('rejects negative projectCount', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      projectCount: -1,
    });
    assert.equal(r.success, false);
  });

  test('rejects confidence > 1', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      confidence: 1.5,
    });
    assert.equal(r.success, false);
  });

  test('budget.normalized accepts Mixed (open shape)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      timeline: {
        raw: '6 weeks',
        normalized: { durationWeeks: 6, urgency: 'normal' },
      },
    });
    assert.ok(r.success);
    assert.equal(r.data.timeline.normalized.durationWeeks, 6);
  });
});
