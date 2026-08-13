/**
 * ExtractionVersion Mongoose model.
 *
 * Source-of-truth: Architechure.md §6 ("extractionVersions collection").
 *
 * Purpose:
 *   Each LLM extraction attempt (success OR failure) is persisted as an
 *   append-only version row. This implements Rules.md §14:
 *     "Extraction versions are append-only."
 *
 *   A failed attempt is also persisted (state='failed', errorCode set) so
 *   the operator can inspect what went wrong without losing the audit trail.
 *
 * Phase 3 scope:
 *   - One ExtractionVersion per extraction attempt (Grok or Gemini).
 *   - If Grok fails recoverably and Gemini succeeds, BOTH versions are
 *     persisted: one failed (grok) + one completed (gemini).
 *   - `parsedOutput` is the zod-validated extraction object (or null on
 *     failure). `rawOutput` is whatever the provider returned before
 *     validation (string body, parsed JSON, or error payload).
 *   - `errorCode` uses stable codes defined in llmService.js
 *     (e.g. 'PROVIDER_NETWORK_ERROR', 'PROVIDER_TIMEOUT', 'INVALID_OUTPUT',
 *     'NOT_CONFIGURED', 'ALL_PROVIDERS_FAILED').
 *
 * Relation to Enquiry:
 *   - `enquiryId` references the parent Enquiry. We do NOT use populate
 *     here — the relationship is one-way (ExtractionVersion -> Enquiry).
 *     Phase 7 (re-extraction safety) will add a `GET /api/enquiries/:id/extractions`
 *     endpoint that queries by enquiryId.
 *
 * Immutability:
 *   - The whole document is effectively immutable after creation: we never
 *     update an ExtractionVersion, we only ever insert a new one.
 *   - We do not enforce this at the schema level (Mongoose `immutable`
 *     applies to fields, not documents) but the service layer never calls
 *     `.findByIdAndUpdate()` on this collection.
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const parsedBudgetSchema = new Schema(
  {
    raw: { type: String, default: '' },
    currency: { type: String, default: null },
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    qualifier: {
      type: String,
      enum: ['exact', 'range', 'flexible', 'tbd', 'unknown'],
      default: 'unknown',
    },
  },
  { _id: false, strict: true },
);

const parsedTimelineSchema = new Schema(
  {
    raw: { type: String, default: '' },
    normalized: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: true },
);

const parsedOutputSchema = new Schema(
  {
    company: { type: String, default: null },
    contactName: { type: String, default: null },
    contactEmail: { type: String, default: null },
    serviceLine: {
      type: String,
      enum: ['ai', 'blockchain', 'web', 'mobile', 'game', 'other'],
      default: 'other',
    },
    budget: { type: parsedBudgetSchema, default: () => ({}) },
    timeline: { type: parsedTimelineSchema, default: () => ({}) },
    summary: { type: String, default: '' },
    isGenuineProjectEnquiry: { type: Boolean, default: false },
    confidence: { type: Number, default: null },
    projectCount: { type: Number, default: 1 },
    additionalProjectNote: { type: String, default: null },
    isModelInstructionAttempt: { type: Boolean, default: false },
  },
  { _id: false, strict: true },
);

const extractionVersionSchema = new Schema(
  {
    enquiryId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      ref: 'Enquiry',
    },

    // Monotonic per-enquiry version number. The service layer computes this
    // as `count(enquiryId) + 1` so re-extraction (Phase 7) creates version 2, 3, ...
    version: { type: Number, required: true, min: 1 },

    provider: {
      type: String,
      enum: ['grok', 'gemini'],
      required: true,
    },

    model: { type: String, required: true },

    // `rawOutput` is Mixed so we can store whatever the provider returned:
    //   - parsed JSON object (when the response was JSON-valid)
    //   - raw string body (when JSON parsing failed)
    //   - a short error payload (when the provider threw before responding)
    // We never store secrets here. The fetch layer never puts auth headers
    // into the response body.
    rawOutput: { type: Schema.Types.Mixed, default: null },

    // `parsedOutput` is the zod-validated extraction object. On failure,
    // this is null (and `state='failed'`).
    parsedOutput: { type: parsedOutputSchema, default: null },

    state: {
      type: String,
      enum: ['completed', 'failed'],
      required: true,
    },

    // Stable error codes from llmService (see llmService.js).
    // null when state='completed'.
    errorCode: { type: String, default: null },

    // Safe, short, user-facing error message. null when state='completed'.
    errorMessage: { type: String, default: null },

    // Duration of the provider call in milliseconds (for observability).
    // Includes any retries against the same provider.
    durationMs: { type: Number, default: null },
  },
  {
    timestamps: true, // createdAt + updatedAt
    strict: 'throw',
    collection: 'extractionVersions',
  },
);

// Compound index: list versions for an enquiry, ordered by version number.
extractionVersionSchema.index({ enquiryId: 1, version: 1 });

/**
 * Strip Mongoose internals for API responses.
 *
 * @returns {object}
 */
extractionVersionSchema.methods.toApiResponse = function toApiResponse() {
  const o = this.toObject({ depopulate: true, versionKey: false });
  return {
    id: String(o._id),
    enquiryId: String(o.enquiryId),
    version: o.version,
    provider: o.provider,
    model: o.model,
    rawOutput: o.rawOutput ?? null,
    parsedOutput: o.parsedOutput ?? null,
    state: o.state,
    errorCode: o.errorCode ?? null,
    errorMessage: o.errorMessage ?? null,
    durationMs: o.durationMs ?? null,
    createdAt: o.createdAt,
  };
};

const ExtractionVersion = model('ExtractionVersion', extractionVersionSchema);

export default ExtractionVersion;
