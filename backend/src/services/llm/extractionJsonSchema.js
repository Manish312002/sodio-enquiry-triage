/**
 * Canonical JSON Schema for LLM extraction output (Phase 3 → canonical-contract fix).
 *
 * Source-of-truth: Rules.md §5 (extraction fields), §6 (budget), §7 (timeline).
 * The Zod schema in `extractionSchema.js` is the FINAL server-side validator.
 * This JSON Schema is what we hand to the LLM provider (Groq via the OpenAI
 * Responses API `text.format.type='json_schema'`; Gemini via `response_format`)
 * so the model is told the canonical contract BEFORE it generates output —
 * not just validated after the fact.
 *
 * The two schemas are kept hand-aligned. Any change to one MUST be mirrored
 * in the other. Tests in `extractionSchema.test.js` and
 * `extractionJsonSchema.test.js` guard the alignment.
 *
 * Why not strict:true (OpenAI Structured Outputs)?
 * --------------------------------------------------
 * OpenAI's `strict:true` mode requires `additionalProperties:false` on every
 * object schema and forces every property into `required`. Our
 * `timeline.normalized` field is INTENTIONALLY open-shaped (Rules.md §7:
 * "Open shape for normalized markers (urgency, duration, period) — filled
 * opportunistically without ever inventing dates"). Forcing it into a closed
 * object would either (a) over-constrain the model into emitting placeholder
 * values for keys that don't apply, or (b) reject legitimate extractions
 * when the model emits an unanticipated marker key.
 *
 * Therefore we use `type:'json_schema'` with `strict:false` (the strongest
 * supported alternative). The model receives the full canonical schema as
 * guidance, every field name and enum is documented, and Zod remains the
 * authoritative validation boundary (Rules.md §5 — defense in depth).
 *
 * Field-name contract (camelCase, EXACT):
 *   company, contactName, contactEmail, serviceLine, budget, timeline,
 *   summary, isGenuineProjectEnquiry, confidence, projectCount,
 *   additionalProjectNote, isModelInstructionAttempt
 *
 * Snake_case aliases (contact_name, contact_email, service_line, is_genuine)
 * are NOT in the contract and MUST be rejected by Zod.
 *
 * `priority` is deliberately NOT in this schema (Rules.md §3, §9 — priority
 * is computed by `scoringService.js`, never by the LLM).
 */
import { SERVICE_LINES, BUDGET_QUALIFIERS } from '../../utils/constants.js';

/**
 * Canonical JSON Schema handed to the LLM provider.
 *
 * `additionalProperties:false` is set on every object whose shape is fixed
 * (top-level extraction, budget, timeline). `timeline.normalized` is the
 * single exception: it is `type:['object','null']` with
 * `additionalProperties:true` so the model can emit the opportunistic
 * urgency/duration/period markers described in Rules.md §7 without being
 * forced into a fixed key set.
 *
 * @type {{ [key: string]: unknown }}
 */
export const EXTRACTION_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    company: { type: ['string', 'null'] },
    contactName: { type: ['string', 'null'] },
    contactEmail: { type: ['string', 'null'] },
    serviceLine: { type: 'string', enum: SERVICE_LINES },
    budget: {
      type: 'object',
      additionalProperties: false,
      properties: {
        raw: { type: 'string' },
        currency: { type: ['string', 'null'] },
        min: { type: ['number', 'null'] },
        max: { type: ['number', 'null'] },
        qualifier: { type: 'string', enum: BUDGET_QUALIFIERS },
      },
      required: ['raw', 'currency', 'min', 'max', 'qualifier'],
    },
    timeline: {
      type: 'object',
      additionalProperties: false,
      properties: {
        raw: { type: 'string' },
        normalized: {
          // Open shape per Rules.md §7 — opportunistic markers.
          // See "Why not strict:true" note in the file header.
          type: ['object', 'null'],
          additionalProperties: true,
        },
      },
      required: ['raw', 'normalized'],
    },
    summary: { type: 'string' },
    isGenuineProjectEnquiry: { type: 'boolean' },
    confidence: { type: ['number', 'null'] },
    projectCount: { type: 'integer', minimum: 1 },
    additionalProjectNote: { type: ['string', 'null'] },
    isModelInstructionAttempt: { type: 'boolean' },
  },
  required: [
    'company',
    'contactName',
    'contactEmail',
    'serviceLine',
    'budget',
    'timeline',
    'summary',
    'isGenuineProjectEnquiry',
    'confidence',
    'projectCount',
    'additionalProjectNote',
    'isModelInstructionAttempt',
  ],
});

/**
 * Wrapper for the OpenAI Responses API `text.format` field.
 *
 * Shape: { type: 'json_schema', name, schema, strict }
 *
 * `strict:false` — see file header for rationale (timeline.normalized is
 * intentionally open-shaped per Rules.md §7).
 */
export const GROQ_TEXT_FORMAT = Object.freeze({
  format: Object.freeze({
    type: 'json_schema',
    name: 'extraction',
    schema: EXTRACTION_JSON_SCHEMA,
    strict: false,
  }),
});

export default EXTRACTION_JSON_SCHEMA;
