/**
 * BatchJob Mongoose model.
 *
 * Source-of-truth: Architechure.md §6 ("batchJobs collection"), §4 Flow B,
 * §12 ("Batch Concurrency"), §13 ("Failure Model"), Rules.md §12 ("Batch").
 *
 * Phase 8 scope:
 *   - One BatchJob per import operation (POST /api/enquiries/import with
 *     a multipart file). The batch tracks the progress of bounded-concurrency
 *     LLM extraction across all enquiries that were parsed + persisted from
 *     the uploaded file.
 *   - Each individual enquiry retains its OWN independent extractionState,
 *     modelExtraction, effectiveExtraction, humanOverrides, priority, and
 *     ExtractionVersion history. The BatchJob document ONLY holds aggregate
 *     counters + status — it never embeds extraction results.
 *
 * Counter semantics (Architechure.md §6 + §13):
 *   - total      — fixed at creation, equals the number of enquiries that
 *                  were persisted from the import (NOT the parsed-block
 *                  count, since some blocks may have been skipped by the
 *                  parser). total = pending + processing + completed + failed
 *                  at all times.
 *   - pending    — enquiries that have NOT yet been picked up by a worker.
 *                  Decremented atomically when a worker starts an item.
 *   - processing — enquiries currently being extracted. Incremented when a
 *                  worker starts, decremented when the worker finishes
 *                  (success OR failure).
 *   - completed  — enquiries whose extraction ended in state='completed'.
 *   - failed     — enquiries whose extraction ended in state='failed'
 *                  (both Groq and Gemini failed, OR INVALID_OUTPUT).
 *
 * Status state-machine (Architechure.md §6):
 *
 *   processing  ──►  completed              (all items succeeded)
 *   processing  ──►  completed_with_errors  (≥1 item failed, ≥1 succeeded)
 *   processing  ──►  failed                 (every item failed)
 *
 * The terminal status is decided when the last worker finishes (pending=0 AND
 * processing=0). The batchService.computeBatchStatus helper centralises the
 * decision so the controller and tests share one definition.
 *
 * Atomicity (Rules.md §12 "Batch"):
 *   - Counter mutations use MongoDB `$inc` (atomic). Multiple concurrent
 *     workers can safely increment without read-modify-write races.
 *   - The terminal-status transition uses `findOneAndUpdate` with a filter
 *     that asserts the batch is still in 'processing' status — this prevents
 *     a double-completion if a late worker races with the finalisation.
 *
 * No LLM keys, no originalText, no parsedOutput, no priority live here.
 * Those concerns stay on the Enquiry + ExtractionVersion documents.
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const batchJobSchema = new Schema(
  {
    // total is fixed at creation time. The constructor sets
    // pending = total, processing = 0, completed = 0, failed = 0.
    total: { type: Number, required: true, min: 0 },

    pending: { type: Number, required: true, min: 0, default: 0 },
    processing: { type: Number, required: true, min: 0, default: 0 },
    completed: { type: Number, required: true, min: 0, default: 0 },
    failed: { type: Number, required: true, min: 0, default: 0 },

    status: {
      type: String,
      enum: ['processing', 'completed', 'completed_with_errors', 'failed'],
      required: true,
      default: 'processing',
      index: true,
    },

    // File name from the multipart upload — for operator traceability only.
    // Never stored as instruction-like content; never executed.
    fileName: { type: String, default: null },

    // Set when the batch reaches a terminal state (completed /
    // completed_with_errors / failed). null while still processing.
    completedAt: { type: Date, default: null },

    // Per-item failures are summarised here so the UI can list failed
    // enquiries without an extra join. Each entry is small (enquiryId +
    // a safe error code + a short message). The full ExtractionVersion
    // history remains on the ExtractionVersion collection.
    //
    // This array is APPEND-ONLY per enquiry: when a retry succeeds, the
    // enquiry's extractionState transitions to 'completed' but the
    // `failures` entry remains for audit. The operator can clear the
    // failure record by re-fetching the batch (which recomputes from
    // live enquiry state) — see batchService.refreshBatchCounters.
    failures: {
      type: [
        {
          enquiryId: { type: Schema.Types.ObjectId, required: true },
          code: { type: String, default: null },
          message: { type: String, default: null },
          at: { type: Date, default: () => new Date() },
        },
      ],
      default: () => [],
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
    strict: 'throw',
    collection: 'batchJobs',
  },
);

// Compound index for "find me the most recent batches" — used by the
// operator's batch history list (not yet a UI surface; available for
// Phase 10 polish).
batchJobSchema.index({ createdAt: -1 });

/**
 * Strip Mongoose internals for API responses.
 *
 * Response shape (Architechure.md §8 — GET /api/batches/:id):
 *   {
 *     id, total, pending, processing, completed, failed,
 *     status, fileName, createdAt, updatedAt, completedAt, failures
 *   }
 *
 * @returns {object}
 */
batchJobSchema.methods.toApiResponse = function toApiResponse() {
  const o = this.toObject({ depopulate: true, versionKey: false });
  return {
    id: String(o._id),
    total: o.total,
    pending: o.pending,
    processing: o.processing,
    completed: o.completed,
    failed: o.failed,
    status: o.status,
    fileName: o.fileName ?? null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    completedAt: o.completedAt ?? null,
    failures: (o.failures ?? []).map((f) => ({
      enquiryId: String(f.enquiryId),
      code: f.code ?? null,
      message: f.message ?? null,
      at: f.at,
    })),
  };
};

const BatchJob = model('BatchJob', batchJobSchema);

export default BatchJob;
