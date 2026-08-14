/**
 * Batch routes.
 * Mounted at /api/batches in app.js.
 *
 * Architechure.md §8 API surface (Batch):
 *   GET   /api/batches/:id          (Phase 8) fetch batch progress + counters
 *   POST  /api/batches/:id/refresh  (Phase 8) recompute counters from live state
 *
 * The import endpoint that CREATES a batch lives under /api/enquiries/import
 * (per Architechure.md §8) — see enquiryController.importEnquiries.
 *
 * Per-item retry does NOT have a batch-specific endpoint: the existing
 *   POST /api/enquiries/:id/re-extract  (Phase 7)
 * already does what's needed. The frontend dispatches reExtractEnquiry for
 * the failed enquiry, then re-fetches the batch to see updated counters.
 */
import { Router } from 'express';
import * as ctrl from '../controllers/batchController.js';

const router = Router();

router.get('/:id', ctrl.getBatch);
router.post('/:id/refresh', ctrl.refreshBatch);

export default router;
