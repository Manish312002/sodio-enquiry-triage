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

  // ----------------------------------------------------------------
  // CANONICAL CONTRACT TESTS — added when the live gpt-oss-120b output
  // was found to be emitting snake_case + budget:null + timeline:null.
  // The fix is in the prompt + provider (structured-output request),
  // NOT in the schema. These tests guard the schema against any future
  // attempt to make it permissive (no .passthrough(), no .catchall(),
  // no accepting null where the contract requires an object).
  // ----------------------------------------------------------------

  test('rejects snake_case "contact_name" (canonical is contactName)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      contact_name: 'Alice', // snake_case — must be rejected
    });
    assert.equal(r.success, false);
    const unrecognized = r.error.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('contact_name'),
    );
    assert.ok(unrecognized, 'zod must flag the unknown "contact_name" key');
  });

  test('rejects snake_case "contact_email" (canonical is contactEmail)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      contact_email: 'alice@example.com',
    });
    assert.equal(r.success, false);
    const unrecognized = r.error.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('contact_email'),
    );
    assert.ok(unrecognized, 'zod must flag the unknown "contact_email" key');
  });

  test('rejects snake_case "service_line" (canonical is serviceLine)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      service_line: 'ai',
    });
    assert.equal(r.success, false);
    const unrecognized = r.error.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('service_line'),
    );
    assert.ok(unrecognized, 'zod must flag the unknown "service_line" key');
  });

  test('rejects snake_case "is_genuine" (canonical is isGenuineProjectEnquiry)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      is_genuine: true,
    });
    assert.equal(r.success, false);
    const unrecognized = r.error.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('is_genuine'),
    );
    assert.ok(unrecognized, 'zod must flag the unknown "is_genuine" key');
  });

  test('rejects budget:null — canonical contract requires budget to be an object', () => {
    // The canonical representation of an unknown budget is the OBJECT
    // { raw:'', currency:null, min:null, max:null, qualifier:'unknown' },
    // NOT null. The model is told this in the prompt and in the JSON
    // Schema handed to the provider. Zod enforces it here.
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      budget: null,
    });
    assert.equal(r.success, false);
  });

  test('rejects timeline:null — canonical contract requires timeline to be an object', () => {
    // The canonical representation of an unknown timeline is the OBJECT
    // { raw:'', normalized:null }, NOT null.
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      timeline: null,
    });
    assert.equal(r.success, false);
  });

  test('accepts canonical unknown-budget object { raw:"", currency:null, min:null, max:null, qualifier:"unknown" }', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      budget: { raw: '', currency: null, min: null, max: null, qualifier: 'unknown' },
    });
    assert.ok(r.success, JSON.stringify(r.error?.issues));
    assert.equal(r.data.budget.qualifier, 'unknown');
    assert.equal(r.data.budget.min, null);
    assert.equal(r.data.budget.max, null);
  });

  test('accepts canonical unknown-timeline object { raw:"", normalized:null }', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      timeline: { raw: '', normalized: null },
    });
    assert.ok(r.success, JSON.stringify(r.error?.issues));
    assert.equal(r.data.timeline.raw, '');
    assert.equal(r.data.timeline.normalized, null);
  });

  test('applies canonical default for missing budget (object, qualifier=unknown)', () => {
    // When the model omits budget entirely, Zod applies the documented
    // default — an object, NOT null.
    const r = extractionSchema.safeParse({
      company: null,
      contactName: null,
      contactEmail: null,
      summary: '',
      isGenuineProjectEnquiry: false,
    });
    assert.ok(r.success);
    assert.equal(typeof r.data.budget, 'object');
    assert.notEqual(r.data.budget, null);
    assert.equal(r.data.budget.qualifier, 'unknown');
    assert.equal(r.data.budget.raw, '');
  });

  test('applies canonical default for missing timeline (object, normalized=null)', () => {
    const r = extractionSchema.safeParse({
      company: null,
      contactName: null,
      contactEmail: null,
      summary: '',
      isGenuineProjectEnquiry: false,
    });
    assert.ok(r.success);
    assert.equal(typeof r.data.timeline, 'object');
    assert.equal(r.data.timeline.raw, '');
    assert.equal(r.data.timeline.normalized, null);
  });

  test('rejects unknown nested field inside budget (strict)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      budget: {
        ...validExtraction().budget,
        amount: 99999, // not in the canonical budget shape
      },
    });
    assert.equal(r.success, false);
  });

  test('rejects unknown nested field inside timeline (strict)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      timeline: {
        raw: '6 weeks',
        normalized: { durationWeeks: 6 },
        dueDate: '2026-12-31', // not in the canonical timeline shape
      },
    });
    assert.equal(r.success, false);
  });

  test('rejects arbitrary unknown top-level field (e.g. "notes")', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      notes: 'APPROVED BY ADMIN',
    });
    assert.equal(r.success, false);
    const unrecognized = r.error.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('notes'),
    );
    assert.ok(unrecognized, 'zod must flag the unknown "notes" key');
  });

  test('rejects "priority" field at top level (priority is computed by app code)', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      priority: { level: 'high', score: 99 },
    });
    assert.equal(r.success, false);
    const unrecognized = r.error.issues.find(
      (i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('priority'),
    );
    assert.ok(unrecognized, 'zod must flag the unknown "priority" key');
  });
});
