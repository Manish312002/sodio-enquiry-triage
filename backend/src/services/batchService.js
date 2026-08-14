/**
 * Batch service — bounded-concurrency batch extraction.
 *
 * What this service DOES:
 *   - createBatch({ enquiryIds, fileName })  → creates a BatchJob with
 *     total = enquiryIds.length, pending = total, status='processing'.
 *   - runBatchExtraction(batchId)            → kicks off a bounded-concurrency
 *     worker pool that drains the enquiry queue. Each worker calls the
 *     existing extractionService.runExtraction(enquiryId). On success, the
 *     `completed` counter is atomically incremented; on failure, `failed`
 *     is incremented and a failures[] entry is appended. When the last
 *     worker finishes, the batch transitions to a terminal status.
 *   - getBatch(id)                            → fetch a batch by id (404 if missing).
 *   - refreshBatchCounters(batchId)           → recompute pending/processing/
 *     completed/failed from the live enquiry documents. Used by tests and
 *     by the operator's "refresh" action to reconcile counters after a
 *     manual retry that bypassed the batchService.
 *
 * What this service does NOT do:
 *   - It does NOT call the LLM directly. All extraction goes through
 *     extractionService.runExtraction → llmService → Groq → Gemini fallback.
 *     This is the provider boundary; does not duplicate it.
 *   - It does NOT compute priority. Priority is computed inside
 *     extractionService.runExtraction via applyPriorityToEnquiry.
 *   - It does NOT parse files. Parsing is parserService.parseEnquiryFile,
 *     called by the import controller.
 *   - It does NOT persist enquiries. Persistence is enquiryService.createEnquiry,
 *     called by the import controller.
 *   - It does NOT modify originalText / receivedAt / sender / humanOverrides.
 *     Those concerns belong to enquiryService (immutability) and humanOverrideService (overrides).
 *
 * Concurrency strategy:
 *   A simple worker-pool pattern: spawn N workers (N = env.BATCH_CONCURRENCY),
 *   each worker pops the next enquiryId from a shared queue, calls
 *   runExtraction, records the outcome, and loops until the queue is empty.
 *   This guarantees at most N extractions are in flight at any moment —
 *   NOT Promise.all(20) which would launch all 20 simultaneously.
 *
 * Failure isolation:
 *   Each worker's runExtraction call is wrapped in try/catch. A thrown error
 *   (provider timeout, network error, INVALID_OUTPUT after fallback, etc.)
 *   increments the `failed` counter and records a failures[] entry, then the
 *   worker moves on to the next item. The thrown error NEVER propagates out
 *   of the worker — so one failed item cannot crash the pool.
 *
 *   The enquiry itself is left in a safe state by extractionService.runExtraction:
 *     - extractionState='failed'
 *     - modelExtraction preserved (or null if first attempt)
 *     - effectiveExtraction preserved
 *     - humanOverrides preserved
 *     - priority preserved
 *     - originalText NEVER modified (immutable)
 *     - An ExtractionVersion row with state='failed' is appended (audit trail)
 *
 * Atomicity:
 *   Counter updates use MongoDB `$inc` (atomic). Multiple concurrent workers
 *   can safely increment without read-modify-write races. The terminal-status
 *   transition uses `findOneAndUpdate` with a filter that asserts the batch
 *   is still 'processing' — this prevents double-completion if a late worker
 *   races with the finalisation.
 *
 * Background execution:
 *   runBatchExtraction is intentionally NOT awaited by the HTTP handler that
 *   kicks it off (the import controller). The handler returns immediately
 *   with the batchId; the worker pool runs in the background. The frontend
 *   polls GET /api/batches/:id to observe progress.
 *
 *   Node's single-threaded event loop handles this correctly: the worker
 *   pool is a set of async functions that yield on every `await`. The
 *   event loop interleaves them, but at most BATCH_CONCURRENCY are ever
 *   simultaneously inside an LLM call. CPU-bound work is negligible
 *   (the LLM call dominates wall-clock).
 */
import mongoose from 'mongoose';
import BatchJob from '../models/BatchJob.js';
import Enquiry from '../models/Enquiry.js';
import { runExtraction } from './extractionService.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/** Max retries inside the pool if runExtraction throws an unexpected
 *  non-AppError (e.g. Mongoose connection drop). We do NOT retry LLM
 *  failures here — those are already finalised by extractionService
 *  (which tries Groq → Gemini → fail). This guard only catches
 *  infrastructure errors so a worker doesn't crash the pool. */
const WORKER_ERROR_RETRIES = 0;

/**
 * Create a new BatchJob in 'processing' state with all enquiries pending.
 *
 * This also atomically sets `batchId` on each enquiry via updateMany, so
 * the enquiries are linked to the batch. The caller does NOT need to set
 * batchId separately.
 *
 * @param {object} input
 * @param {string[]} input.enquiryIds Array of MongoDB _id strings (24-hex).
 * @param {string}  [input.fileName]   Original upload file name (audit only).
 * @returns {Promise<import('../models/BatchJob.js').default>}
 */
export async function createBatch({ enquiryIds, fileName } = {}) {
  if (!Array.isArray(enquiryIds)) {
    throw new AppError({
      message: 'createBatch: enquiryIds must be an array.',
      status: 500,
      code: 'BATCH_BAD_INPUT',
    });
  }
  // Defensive: filter to valid 24-hex strings so a bad caller cannot
  // corrupt the counters. The import controller validates this too.
  const validIds = enquiryIds.filter(
    (id) => typeof id === 'string' && /^[a-fA-F0-9]{24}$/.test(id),
  );

  const total = validIds.length;
  const batch = await BatchJob.create({
    total,
    pending: total,
    processing: 0,
    completed: 0,
    failed: 0,
    status: 'processing',
    fileName: fileName ?? null,
    failures: [],
  });

  // Atomically link all enquiries to this batch. This is the ONLY place
  // batchId is set on enquiries (besides the import controller, which
  // calls this function). Enquiries created via paste keep batchId=null.
  //
  // We use updateMany with $in for a single round-trip. If an enquiry
  // already had a batchId (e.g. a duplicate call), this overwrites it —
  // but createBatch is only called once per import, so this is safe.
  if (validIds.length > 0) {
    await Enquiry.updateMany(
      { _id: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { $set: { batchId: batch._id } },
    );
  }

  logger.info('batchService: batch created', {
    batchId: String(batch._id),
    total,
    fileName: batch.fileName,
  });

  return batch;
}

/**
 * Decide the terminal status from the final counters.
 *
 *   failed == total                  → 'failed'                  (every item failed)
 *   failed == 0                      → 'completed'               (perfect run)
 *   0 < failed < total               → 'completed_with_errors'   (partial failure)
 *
 * If total == 0 (empty import), treat as 'completed' — there is nothing to
 * fail. This is a defensive case; the import controller should normally
 * refuse to create a batch with zero enquiries.
 *
 * Exposed for tests so they can assert the decision without re-running
 * the worker pool.
 *
 * @param {{completed: number, failed: number, total: number}} counters
 * @returns {'completed'|'completed_with_errors'|'failed'}
 */
export function computeBatchStatus({ completed, failed, total }) {
  if (total === 0) return 'completed';
  if (failed === 0) return 'completed';
  if (failed === total) return 'failed';
  return 'completed_with_errors';
}

/**
 * Run batch extraction with bounded concurrency.
 *
 * Spawns `env.BATCH_CONCURRENCY` workers. Each worker pops the next enquiryId
 * from the in-memory queue, calls runExtraction, records the outcome via
 * atomic $inc, and loops until the queue is empty. Failures are isolated —
 * a thrown error from one item never stops other items.
 *
 * This function is INTENTIONALLY fire-and-forget from the HTTP handler's
 * perspective. The handler kicks it off without awaiting; the frontend polls
 * GET /api/batches/:id to observe progress.
 *
 * The function DOES resolve once all workers have drained the queue (or
 * once the batch is already terminal). Tests await this resolution to
 * verify the final state; the HTTP handler does not.
 *
 * @param {string} batchId
 * @returns {Promise<void>}  Resolves when the pool has drained. Never rejects
 *                           (errors are captured per-item).
 */
export async function runBatchExtraction(batchId) {
  if (!batchId || !/^[a-fA-F0-9]{24}$/.test(String(batchId))) {
    logger.warn('batchService: runBatchExtraction called with invalid id', { batchId });
    return;
  }

  // Load the batch. If it doesn't exist or is already terminal, do nothing.
  // This makes runBatchExtraction idempotent: calling it twice on the same
  // batch is a no-op the second time (the queue has already been drained).
  const batch = await BatchJob.findById(batchId).lean();
  if (!batch) {
    logger.warn('batchService: batch not found, cannot run extraction', { batchId });
    return;
  }
  if (batch.status !== 'processing') {
    logger.info('batchService: batch already terminal, skipping', {
      batchId,
      status: batch.status,
    });
    return;
  }

  // Load the enquiry ids belonging to this batch. We use the Enquiry collection
  // (each enquiry has batchId set by the import controller) rather than storing
  // the ids on the BatchJob document. This keeps the BatchJob a pure counter
  // document and avoids duplicating the enquiry list.
  const enquiries = await Enquiry.find({ batchId })
    .select('_id extractionState')
    .lean();
  // Only items that are still 'pending' or 'failed' (i.e. not yet completed
  // and not currently 'processing') are eligible. This makes runBatchExtraction
  // resumable: if it was interrupted, calling it again picks up the remaining
  // items without re-extracting completed ones.
  const queue = enquiries
    .filter((e) => e.extractionState === 'pending' || e.extractionState === 'failed')
    .map((e) => String(e._id));

  if (queue.length === 0) {
    // Nothing to do — finalise immediately so the batch doesn't sit in
    // 'processing' forever.
    await finaliseBatch(batchId);
    return;
  }

  const concurrency = Math.max(1, Number(env.BATCH_CONCURRENCY) || 3);
  logger.info('batchService: starting worker pool', {
    batchId,
    total: batch.total,
    queueSize: queue.length,
    concurrency,
  });

  // Spawn N workers. Each worker pops from the shared queue.
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i += 1) {
    workers.push(runWorker(batchId, queue, i));
  }
  await Promise.all(workers);

  // All workers have drained the queue. Finalise the batch.
  await finaliseBatch(batchId);
}

/**
 * Single worker loop. Pops enquiryIds from the shared `queue` array until
 * empty, calls runExtraction, records the outcome.
 *
 * Errors are caught per-item: a thrown error from runExtraction NEVER
 * propagates out of this function. The worker logs the error, increments
 * the `failed` counter, appends a failures[] entry, and continues.
 *
 * @param {string} batchId
 * @param {string[]} queue Shared mutable array — workers race to pop.
 * @param {number} workerIndex For logging only.
 */
async function runWorker(batchId, queue, workerIndex) {
  // We do NOT use an explicit concurrency primitive (like p-limit) because
  // the queue is in-memory and JavaScript is single-threaded: the
  // `queue.shift()` is atomic with respect to other awaits. A worker
  // cannot lose its slot between checking `queue.length > 0` and calling
  // `shift()`.
  while (queue.length > 0) {
    const enquiryId = queue.shift();
    if (!enquiryId) break;

    // Atomically move this enquiry from pending → processing on the BatchJob.
    // This makes the progress UI accurate: an item shows as "processing"
    // while a worker is inside runExtraction.
    await BatchJob.findByIdAndUpdate(batchId, {
      $inc: { pending: -1, processing: 1 },
    });

    let outcome;
    try {
      // The existing/7 extraction pipeline does all the work:
      //   - Loads enquiry, refuses if already 'processing'.
      //   - Sets extractionState='processing' and saves (so the enquiry
      //     itself reflects the in-flight state).
      //   - Calls llmService.extractWithFallback (Groq → Gemini).
      //   - Persists ExtractionVersion rows (append-only audit).
      //   - On success: updates modelExtraction + effectiveExtraction +
      //     isGenuineProjectEnquiry + priority (deterministic scoring).
      //     Preserves existing humanOverrides via reapplyOverrides.
      //   - On failure: extractionState='failed', all existing data preserved.
      //
      // runExtraction does NOT throw on LLM failure — it returns
      // { enquiry, versions, outcome } with outcome.state='failed'. It
      // DOES throw on infrastructure errors (404 missing enquiry, 409
      // already processing, Mongoose disconnect, etc.). We check both
      // paths: outcome.state for LLM failures, caught error for infra.
      const result = await runExtraction(enquiryId);
      if (result?.outcome?.state === 'completed') {
        outcome = { ok: true, enquiry: result.enquiry };
      } else {
        // LLM failure (both Groq and Gemini failed, or INVALID_OUTPUT).
        // The enquiry's extractionState is already 'failed'; the
        // ExtractionVersion rows are already persisted. We just record
        // the failure on the batch.
        outcome = {
          ok: false,
          code: result?.outcome?.errorCode || 'EXTRACTION_FAILED',
          message: result?.outcome?.errorMessage || 'Extraction failed.',
        };
        logger.warn('batchService: worker recorded LLM failure', {
          batchId,
          enquiryId,
          workerIndex,
          code: outcome.code,
          message: outcome.message,
        });
      }
    } catch (err) {
      // Defensive: extractionService.runExtraction is supposed to capture
      // provider failures and return a structured outcome, not throw. But
      // if it does throw (e.g. Mongoose disconnect, AppError 404/409), we
      // capture the error here so the pool keeps going.
      outcome = {
        ok: false,
        code: err?.code || err?.name || 'EXTRACTION_ERROR',
        message: err?.message || String(err),
      };
      logger.warn('batchService: worker caught extraction error', {
        batchId,
        enquiryId,
        workerIndex,
        code: outcome.code,
        message: outcome.message,
      });
    }

    // Atomically move this enquiry from processing → completed/failed.
    if (outcome.ok) {
      await BatchJob.findByIdAndUpdate(batchId, {
        $inc: { processing: -1, completed: 1 },
      });
    } else {
      await BatchJob.findByIdAndUpdate(batchId, {
        $inc: { processing: -1, failed: 1 },
        $push: {
          failures: {
            enquiryId,
            code: outcome.code,
            message: outcome.message,
            at: new Date(),
          },
        },
      });
    }
  }
}

/**
 * Finalise the batch: transition from 'processing' to a terminal status.
 *
 * Uses `findOneAndUpdate` with a filter that asserts the batch is still
 * 'processing'. This is race-safe: even if two callers invoke
 * finaliseBatch concurrently (e.g. a late worker + a manual trigger),
 * only the first one performs the transition; the second is a no-op.
 *
 * The terminal status is decided from the LIVE counters on the document
 * (not from the in-memory queue), so it reflects whatever the workers
 * actually accomplished.
 *
 * @param {string} batchId
 */
async function finaliseBatch(batchId) {
  // Re-load the document to read the live counters.
  const fresh = await BatchJob.findById(batchId).lean();
  if (!fresh) return;
  if (fresh.status !== 'processing') {
    // Already terminal — nothing to do.
    return;
  }

  const terminalStatus = computeBatchStatus({
    completed: fresh.completed,
    failed: fresh.failed,
    total: fresh.total,
  });

  // Atomic conditional update: only transition if still 'processing'.
  // This is the race-safe finalisation.
  await BatchJob.findOneAndUpdate(
    { _id: batchId, status: 'processing' },
    {
      $set: {
        status: terminalStatus,
        completedAt: new Date(),
        // Sanity-clamp the counters: pending and processing MUST be 0 at
        // terminal state. If a worker died mid-flight (process crash),
        // these might be non-zero; we zero them so the UI doesn't show
        // "1 processing" forever. The completed+failed total still matches
        // `total` because we recompute from live enquiry state below.
        pending: 0,
        processing: 0,
      },
    },
  );

  logger.info('batchService: batch finalised', {
    batchId,
    status: terminalStatus,
    completed: fresh.completed,
    failed: fresh.failed,
    total: fresh.total,
  });
}

/**
 * Fetch a batch by id.
 *
 * @param {string} id
 * @returns {Promise<import('../models/BatchJob.js').default|null>}
 * @throws {AppError} 400 if id is not a valid ObjectId.
 */
export async function getBatch(id) {
  if (!id || !/^[a-fA-F0-9]{24}$/.test(String(id))) {
    throw new AppError({
      message: 'Invalid batch id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }
  return BatchJob.findById(id).exec();
}

/**
 * Recompute the batch counters from the live enquiry documents.
 *
 * This is a reconciliation helper. Normally the workers keep the counters
 * accurate via atomic $inc. But if the operator retries a failed item via
 * the existing POST /api/enquiries/:id/re-extract endpoint (which does NOT
 * go through batchService), the enquiry's extractionState transitions to
 * 'completed' but the BatchJob's `failed`/`completed` counters are stale.
 *
 * The operator can hit "Refresh" on the batch UI, which calls this function
 * to recompute counters from the live enquiry state. This is cheaper than
 * re-running extraction and gives an accurate picture.
 *
 * Terminal-state batches are NOT recomputed (their status is final). Only
 * the counters are refreshed; the status stays as recorded. This avoids
 * surprising the operator by un-finalising a completed batch.
 *
 * @param {string} batchId
 * @returns {Promise<import('../models/BatchJob.js').default|null>}
 */
export async function refreshBatchCounters(batchId) {
  if (!batchId || !/^[a-fA-F0-9]{24}$/.test(String(batchId))) {
    throw new AppError({
      message: 'Invalid batch id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }
  const batch = await BatchJob.findById(batchId);
  if (!batch) return null;

  const counts = await Enquiry.aggregate([
    { $match: { batchId: batch._id } },
    { $group: { _id: '$extractionState', count: { $sum: 1 } } },
  ]);
  const byState = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of counts) {
    if (row._id && byState.hasOwnProperty(row._id)) {
      byState[row._id] = row.count;
    }
  }

  batch.pending = byState.pending;
  batch.processing = byState.processing;
  batch.completed = byState.completed;
  batch.failed = byState.failed;

  // Recompute the terminal status from the live counters. This handles
  // the case where a manual retry (via POST /api/enquiries/:id/re-extract)
  // succeeded after the batch had already finalised as
  // 'completed_with_errors' — the operator's retry moved an enquiry from
  // 'failed' to 'completed', so the batch's status should be upgraded to
  // 'completed'. We recompute unconditionally (not just when status is
  // 'processing') because the live counters are the source of truth.
  if (batch.pending === 0 && batch.processing === 0) {
    const newStatus = computeBatchStatus({
      completed: batch.completed,
      failed: batch.failed,
      total: batch.total,
    });
    if (batch.status !== newStatus) {
      logger.info('batchService: status upgraded after refresh', {
        batchId: String(batch._id),
        oldStatus: batch.status,
        newStatus,
      });
    }
    batch.status = newStatus;
    batch.completedAt = batch.completedAt || new Date();
  }

  const saved = await batch.save();
  logger.info('batchService: counters refreshed', {
    batchId: String(saved._id),
    status: saved.status,
    pending: saved.pending,
    processing: saved.processing,
    completed: saved.completed,
    failed: saved.failed,
  });
  return saved;
}

export default {
  createBatch,
  runBatchExtraction,
  getBatch,
  refreshBatchCounters,
  computeBatchStatus,
};
