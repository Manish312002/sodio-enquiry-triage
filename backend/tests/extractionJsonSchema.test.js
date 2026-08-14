/**
 * Test: extractionJsonSchema — the canonical JSON Schema handed to LLM
 * providers (Groq via OpenAI Responses API `text.format`, Gemini via
 * `response_format`).
 *
 * Guards that the JSON Schema is hand-aligned with the Zod schema
 * (extractionSchema.js) and the prompt (extractionPrompt.js):
 *   - same canonical camelCase field names
 *   - same enums (serviceLine, budget.qualifier)
 *   - same "budget/timeline are objects, never null" rule
 *   - same "priority is NOT in the schema" rule
 *   - same "additionalProperties: false" closed-shape rule (except
 *     timeline.normalized which is intentionally open-shaped per
 *     Rules.md §7)
 *   - strict:false (documented — see extractionJsonSchema.js header)
 *
 * If any of these drift from the Zod schema, this test file catches it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRACTION_JSON_SCHEMA,
  GROQ_TEXT_FORMAT,
} from '../src/services/llm/extractionJsonSchema.js';
import { extractionSchema } from '../src/services/llm/extractionSchema.js';
import { SERVICE_LINES, BUDGET_QUALIFIERS } from '../src/utils/constants.js';

describe('extractionJsonSchema — canonical JSON Schema handed to LLM providers', () => {
  test('top-level is an object with additionalProperties:false', () => {
    assert.equal(EXTRACTION_JSON_SCHEMA.type, 'object');
    assert.equal(EXTRACTION_JSON_SCHEMA.additionalProperties, false);
  });

  test('contains every canonical camelCase field name (hand-aligned with Zod)', () => {
    const zodShape = extractionSchema.shape;
    const jsonProps = EXTRACTION_JSON_SCHEMA.properties;
    const zodFields = Object.keys(zodShape).sort();
    const jsonFields = Object.keys(jsonProps).sort();
    assert.deepEqual(jsonFields, zodFields, 'JSON Schema fields must match Zod fields exactly');
  });

  test('required lists every top-level field', () => {
    const props = Object.keys(EXTRACTION_JSON_SCHEMA.properties).sort();
    const req = [...EXTRACTION_JSON_SCHEMA.required].sort();
    assert.deepEqual(req, props, 'every property must be in required');
  });

  test('priority is NOT in the JSON Schema (priority is computed by app code)', () => {
    assert.equal(
      EXTRACTION_JSON_SCHEMA.properties.priority,
      undefined,
      'priority must NOT be in the JSON Schema handed to the model',
    );
    assert.ok(
      !EXTRACTION_JSON_SCHEMA.required.includes('priority'),
      'priority must NOT be in required',
    );
  });

  test('serviceLine enum matches SERVICE_LINES constant', () => {
    const sl = EXTRACTION_JSON_SCHEMA.properties.serviceLine;
    assert.equal(sl.type, 'string');
    assert.deepEqual([...sl.enum].sort(), [...SERVICE_LINES].sort());
  });

  test('budget.qualifier enum matches BUDGET_QUALIFIERS constant', () => {
    const q = EXTRACTION_JSON_SCHEMA.properties.budget.properties.qualifier;
    assert.equal(q.type, 'string');
    assert.deepEqual([...q.enum].sort(), [...BUDGET_QUALIFIERS].sort());
  });

  test('budget is an object with additionalProperties:false (closed shape)', () => {
    const b = EXTRACTION_JSON_SCHEMA.properties.budget;
    assert.equal(b.type, 'object');
    assert.equal(b.additionalProperties, false);
    assert.deepEqual(
      [...Object.keys(b.properties)].sort(),
      ['raw', 'currency', 'min', 'max', 'qualifier'].sort(),
    );
    assert.deepEqual(
      [...b.required].sort(),
      ['raw', 'currency', 'min', 'max', 'qualifier'].sort(),
    );
  });

  test('timeline is an object with additionalProperties:false (closed shape)', () => {
    const t = EXTRACTION_JSON_SCHEMA.properties.timeline;
    assert.equal(t.type, 'object');
    assert.equal(t.additionalProperties, false);
    assert.deepEqual(
      [...Object.keys(t.properties)].sort(),
      ['normalized', 'raw'].sort(),
    );
    assert.deepEqual(
      [...t.required].sort(),
      ['normalized', 'raw'].sort(),
    );
  });

  test('timeline.normalized is intentionally open-shaped (additionalProperties:true)', () => {
    // Rules.md §7: "Open shape for normalized markers (urgency, duration,
    // period) — filled opportunistically without ever inventing dates."
    // This is the ONE relaxation from strict mode. See extractionJsonSchema.js
    // header for the rationale on why we use strict:false overall.
    const n = EXTRACTION_JSON_SCHEMA.properties.timeline.properties.normalized;
    assert.ok(Array.isArray(n.type));
    assert.ok(n.type.includes('object'));
    assert.ok(n.type.includes('null'));
    assert.equal(n.additionalProperties, true);
  });

  test('budget fields are nullable strings/numbers (matching Zod)', () => {
    const b = EXTRACTION_JSON_SCHEMA.properties.budget.properties;
    assert.deepEqual(b.raw.type, 'string');
    assert.ok(Array.isArray(b.currency.type));
    assert.ok(b.currency.type.includes('string'));
    assert.ok(b.currency.type.includes('null'));
    assert.ok(Array.isArray(b.min.type));
    assert.ok(b.min.type.includes('number'));
    assert.ok(b.min.type.includes('null'));
    assert.ok(Array.isArray(b.max.type));
    assert.ok(b.max.type.includes('number'));
    assert.ok(b.max.type.includes('null'));
  });

  test('projectCount is integer with minimum 1 (matching Zod)', () => {
    const pc = EXTRACTION_JSON_SCHEMA.properties.projectCount;
    assert.equal(pc.type, 'integer');
    assert.equal(pc.minimum, 1);
  });

  test('confidence is nullable number (matching Zod)', () => {
    const c = EXTRACTION_JSON_SCHEMA.properties.confidence;
    assert.ok(Array.isArray(c.type));
    assert.ok(c.type.includes('number'));
    assert.ok(c.type.includes('null'));
  });

  test('GROQ_TEXT_FORMAT wraps the schema with type:json_schema, name, strict:false', () => {
    assert.equal(GROQ_TEXT_FORMAT.format.type, 'json_schema');
    assert.equal(GROQ_TEXT_FORMAT.format.name, 'extraction');
    assert.equal(GROQ_TEXT_FORMAT.format.schema, EXTRACTION_JSON_SCHEMA);
    assert.equal(GROQ_TEXT_FORMAT.format.strict, false);
  });

  test('EXTRACTION_JSON_SCHEMA is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(EXTRACTION_JSON_SCHEMA));
    assert.ok(Object.isFrozen(GROQ_TEXT_FORMAT));
    assert.ok(Object.isFrozen(GROQ_TEXT_FORMAT.format));
  });

  test('no snake_case aliases appear anywhere in the schema properties', () => {
    // Walk the schema recursively and ensure no snake_case keys appear.
    const snakeCasePattern = /^[a-z]+_[a-z]/;
    const visit = (node, path) => {
      if (node && typeof node === 'object') {
        for (const k of Object.keys(node)) {
          if (k === 'properties' || k === 'required' || k === 'enum' || k === 'type' || k === 'additionalProperties' || k === 'minimum' || k === 'name' || k === 'schema' || k === 'strict' || k === 'format') {
            // skip meta keys
          } else if (snakeCasePattern.test(k)) {
            throw new Error(`snake_case key "${k}" found at ${path}`);
          }
          visit(node[k], `${path}.${k}`);
        }
      }
    };
    visit(EXTRACTION_JSON_SCHEMA, 'root');
    // No throw = pass
    assert.ok(true);
  });
});
