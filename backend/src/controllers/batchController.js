/**
 * Batch controller — HTTP endpoints for batch progress + status.
 *
 * API surface (Batch):
 *   GET /api/batches/:id   → fetch one batch (progress + counters + failures)
 *
 * adds:
 *   GET /api/batches/:id   → batchController.getBatch
 *   POST /api/batches/:id/refresh → batchController.refreshBatch
 *
 * The import endpoint (POST /api/enquiries/import) creates the BatchJob and
 * kicks off runBatchExtraction; that controller lives in enquiryController.js
 * because the route is mounted under /api/enquiries ( ).
 *
 * Per-item retry does NOT need a new endpoint: the existing
 *   POST /api/enquiries/:id/re-extract
 * already does exactly what's needed — it runs a new extraction
 * attempt, preserves all existing data on failure, and recalculates priority
 * on success. The frontend dispatches reExtractEnquiry for the failed
 * enquiry, then re-fetches the batch to see the updated counters.
 *
 * Security,:
 *   - The client cannot specify arbitrary LLM providers or models.
 *   - The client cannot set priority, modify originalText, or fabricate
 *     extraction results.
 *   - The client cannot fabricate batch completion counts — counters are
 *     incremented atomically by the server-side worker pool.
 *   - The client cannot modify another batch's items — batchId is taken
 *     from the URL, not the body.
 *   - No API keys are exposed.
 */
import * as batchService from '../services/batchService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

/**
 * GET /api/batches/:id
 *
 * Returns the batch's current state: counters, status, fileName, timestamps,
 * and the failures[] array (per-item failure codes + messages for the UI).
 *
 * The frontend polls this endpoint while status === 'processing' and stops
 * polling once status transitions to a terminal state
 * (completed | completed_with_errors | failed).
 *
 * Response (200):
 *   { batch: <batch response shape> }
 *
 * 400 on invalid id; 404 if batch not found.
 */
export const getBatch = asyncHandler(async (req, res) => {
  const batch = await batchService.getBatch(req.params.id);
  if (!batch) {
    throw new AppError({
      message: `Batch ${req.params.id} not found.`,
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  res.status(200).json({ batch: batch.toApiResponse() });
});

/**
 * POST /api/batches/:id/refresh
 *
 * Recompute the batch counters from the live enquiry documents. Useful after
 * the operator retries a failed item via POST /api/enquiries/:id/re-extract
 * (which bypasses batchService and leaves the BatchJob's counters stale).
 *
 * This endpoint does NOT re-run extraction. It only recomputes the
 * pending/processing/completed/failed counts from enquiry.extractionState.
 *
 * If the recomputation reveals that all items are now terminal (pending=0
 * AND processing=0) and the batch was still 'processing', the batch
 * transitions to a terminal status (completed | completed_with_errors |
 * failed) based on the final counters.
 *
 * Response (200):
 *   { batch: <refreshed batch response shape> }
 *
 * 400 on invalid id; 404 if batch not found.
 */
export const refreshBatch = asyncHandler(async (req, res) => {
  const batch = await batchService.refreshBatchCounters(req.params.id);
  if (!batch) {
    throw new AppError({
      message: `Batch ${req.params.id} not found.`,
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  res.status(200).json({ batch: batch.toApiResponse() });
});
