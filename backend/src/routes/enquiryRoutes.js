/**
 * Enquiry routes.
 * Mounted at /api/enquiries in app.js.
 *
 * Architechure.md §8 API surface (Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 subset):
 *   POST   /api/enquiries                         (Phase 1) paste one enquiry
 *   POST   /api/enquiries/import                  (Phase 2) multipart file upload + parse + persist
 *   GET    /api/enquiries                         (Phase 1+5) list recent (with filters + sort)
 *   GET    /api/enquiries/:id                     (Phase 1) fetch one
 *   POST   /api/enquiries/:id/extract             (Phase 3) trigger LLM extraction
 *   GET    /api/enquiries/:id/extractions         (Phase 3) list extraction versions
 *   POST   /api/enquiries/:id/recalculate-priority (Phase 4) recompute priority
 *   PATCH  /api/enquiries/:id/status              (Phase 5) update workflow status
 *
 * Later phases mount additional routes (PATCH field edits, re-extract) on
 * this same router.
 *
 * NOTE: `/import` is registered BEFORE `/:id` so Express does not match
 * "import" as an id parameter. `/extract`, `/extractions`,
 * `/recalculate-priority`, and `/status` are registered AFTER `/:id`
 * because they are sub-paths of a specific enquiry id and do not collide
 * with the `/:id` pattern.
 */
import { Router } from 'express';
import * as ctrl from '../controllers/enquiryController.js';
import { uploadSingleEnquiryFile, handleUploadErrors } from '../middleware/uploadMiddleware.js';

const router = Router();

router.post('/', ctrl.createEnquiry);

// Phase 2: multipart file upload
router.post(
  '/import',
  uploadSingleEnquiryFile.single('file'),
  handleUploadErrors,
  ctrl.importEnquiries,
);

router.get('/', ctrl.listEnquiries);
router.get('/:id', ctrl.getEnquiry);

// Phase 3: LLM extraction
router.post('/:id/extract', ctrl.extractEnquiry);
router.get('/:id/extractions', ctrl.listExtractions);

// Phase 4: deterministic priority recalculation
router.post('/:id/recalculate-priority', ctrl.recalculatePriority);

// Phase 5: workflow status mutation (FR-08)
router.patch('/:id/status', ctrl.updateStatus);

export default router;
