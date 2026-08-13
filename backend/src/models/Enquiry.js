/**
 * Enquiry Mongoose model.
 *
 * Schema source-of-truth: Architechure.md §6 ("Data Model — MongoDB").
 *
 * Phase 1 scope:
 *   - Only `originalText`, `source`, `sender`, `receivedAt`, `status`,
 *     `extractionState` are populated at create time.
 *   - `effectiveExtraction`, `humanOverrides`, `priority`, `batchId` are
 *     declared now (with safe defaults) so later phases do not require
 *     schema migrations.
 *
 * Immutability rules enforced at the schema level (Rules.md §14):
 *   - `originalText` is `select: true` but the service layer must refuse to
 *     overwrite it after creation. We also mark it `immutable` in Mongoose
 *     so any attempt to set it on update throws.
 *   - `receivedAt` is also `immutable` (source timestamp is preserved).
 *
 * No LLM extraction is performed in Phase 1. `extractionState` defaults to
 * `pending` so Phase 3 can pick the record up later.
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const budgetSchema = new Schema(
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

const timelineSchema = new Schema(
  {
    raw: { type: String, default: '' },
    normalized: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: true },
);

const effectiveExtractionSchema = new Schema(
  {
    company: { type: String, default: null },
    contactName: { type: String, default: null },
    contactEmail: { type: String, default: null },
    serviceLine: {
      type: String,
      enum: ['ai', 'blockchain', 'web', 'mobile', 'game', 'other'],
      default: 'other',
    },
    budget: { type: budgetSchema, default: () => ({}) },
    timeline: { type: timelineSchema, default: () => ({}) },
    summary: { type: String, default: '' },
    projectCount: { type: Number, default: 1 },
    additionalProjectNote: { type: String, default: null },
  },
  { _id: false, strict: true },
);

const humanOverridesSchema = new Schema(
  {
    company: { type: Schema.Types.Mixed, default: null },
    contactName: { type: Schema.Types.Mixed, default: null },
    contactEmail: { type: Schema.Types.Mixed, default: null },
    serviceLine: { type: Schema.Types.Mixed, default: null },
    budget: { type: Schema.Types.Mixed, default: null },
    timeline: { type: Schema.Types.Mixed, default: null },
    summary: { type: Schema.Types.Mixed, default: null },
    isGenuineProjectEnquiry: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: true },
);

// Human overrides are stored as Mixed so we can record "field X was edited to
// value Y" (including `null`/deletion) versus "field X has never been edited".
// The effective-value resolver in Phase 6/7 distinguishes these by checking
// whether the override key is present (vs. undefined).

const prioritySchema = new Schema(
  {
    level: {
      type: String,
      enum: ['high', 'medium', 'low'],
      default: null,
    },
    score: { type: Number, default: null },
    reasons: { type: [String], default: () => [] },
  },
  { _id: false, strict: true },
);

const enquirySchema = new Schema(
  {
    source: {
      type: String,
      enum: ['paste', 'file'],
      required: true,
      index: true,
    },

    // IMMUTABLE after creation (Rules.md §14).
    originalText: {
      type: String,
      required: true,
      immutable: true,
      // No trim — whitespace is part of the original evidence.
      // No maxlength here; the API layer enforces a sane limit so we can
      // return a readable 400 instead of a Mongoose ValidationError.
    },

    sender: {
      name: { type: String, default: null },
      email: { type: String, default: null },
    },

    // IMMUTABLE after creation — source timestamp is preserved.
    receivedAt: {
      type: Date,
      required: true,
      immutable: true,
      default: () => new Date(),
    },

    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'dropped'],
      default: 'new',
      index: true,
    },

    isGenuineProjectEnquiry: { type: Schema.Types.Mixed, default: null },

    effectiveExtraction: {
      type: effectiveExtractionSchema,
      default: () => ({}),
    },

    humanOverrides: {
      type: humanOverridesSchema,
      default: () => ({}),
    },

    priority: {
      type: prioritySchema,
      default: () => ({}),
    },

    extractionState: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },

    batchId: { type: Schema.Types.ObjectId, default: null, index: true },
  },
  {
    timestamps: true, // createdAt + updatedAt
    strict: 'throw', // refuse unknown fields loudly (defence in depth)
    collection: 'enquiries',
  },
);

// --- indexes for the future console (Phase 5) ---
// receivedAt is already queried often; compound with status for the queue.
enquirySchema.index({ receivedAt: -1 });
enquirySchema.index({ status: 1, receivedAt: -1 });
// Phase 5: priority filter + sort
enquirySchema.index({ 'priority.level': 1, receivedAt: -1 });
enquirySchema.index({ 'priority.score': -1, receivedAt: -1 });
// Phase 5: service-line filter
enquirySchema.index({ 'effectiveExtraction.serviceLine': 1, receivedAt: -1 });

/**
 * Strip Mongoose internals from a lean document for API responses.
 * Keeps _id (as a string), originalText, source, sender, receivedAt, status,
 * extractionState, priority, createdAt, updatedAt.
 *
 * Phase 1 only populates a subset; the response shape is stable so the
 * frontend contract does not change when later phases fill in extraction data.
 *
 * @param {import('mongoose').Document} doc
 * @returns {object}
 */
enquirySchema.methods.toApiResponse = function toApiResponse() {
  const o = this.toObject({ depopulate: true, versionKey: false });
  return {
    id: String(o._id),
    source: o.source,
    originalText: o.originalText,
    sender: o.sender ?? { name: null, email: null },
    receivedAt: o.receivedAt,
    status: o.status,
    isGenuineProjectEnquiry: o.isGenuineProjectEnquiry ?? null,
    effectiveExtraction: o.effectiveExtraction ?? null,
    humanOverrides: o.humanOverrides ?? {},
    priority: o.priority ?? { level: null, score: null, reasons: [] },
    extractionState: o.extractionState,
    batchId: o.batchId ? String(o.batchId) : null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
};

const Enquiry = model('Enquiry', enquirySchema);

export default Enquiry;
