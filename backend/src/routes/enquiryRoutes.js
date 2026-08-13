/**
 * Enquiry routes.
 * Mounted at /api/enquiries in app.js.
 *
 * Architechure.md §8 API surface (Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7 subset):
 *   POST   /api/enquiries                                       (Phase 1) paste one enquiry
 *   POST   /api/enquiries/import                                (Phase 2) multipart file upload + parse + persist
 *   GET    /api/enquiries                                       (Phase 1+5) list recent (with filters + sort)
 *   GET    /api/enquiries/:id                                   (Phase 1) fetch one
 *   POST   /api/enquiries/:id/extract                           (Phase 3) trigger LLM extraction
 *   GET    /api/enquiries/:id/extractions                       (Phase 3) list extraction versions
 *   POST   /api/enquiries/:id/recalculate-priority              (Phase 4) recompute priority
 *   PATCH  /api/enquiries/:id/status                            (Phase 5) update workflow status
 *   PATCH  /api/enquiries/:id/fields/:field                     (Phase 6) apply / clear a human override
 *   POST   /api/enquiries/:id/re-extract                        (Phase 7) safe re-extraction with conflict detection
 *   POST   /api/enquiries/:id/fields/:field/accept-model        (Phase 7) accept new model value for a conflicted field
 *
 * Later phases mount additional routes (batch progress) on this same router.
 *
 * NOTE: `/import` is registered BEFORE `/:id` so Express does not match
 * "import" as an id parameter. `/extract`, `/extractions`,
 * `/recalculate-priority`, `/status`, `/fields/:field`,
 * `/re-extract`, and `/fields/:field/accept-model` are registered
 * AFTER `/:id` because they are sub-paths of a specific enquiry id and do
 * not collide with the `/:id` pattern.
 *
 * ROUTE ORDER for /:id/fields/:field vs /:id/fields/:field/accept-model:
 * Express matches routes in registration order. The longer, more specific
 * `accept-model` route MUST be registered BEFORE the shorter
 * `/:id/fields/:field` PATCH route — otherwise Express would interpret
 * "accept-model" as a field name in the PATCH route. We register
 * `POST /:id/fields/:field/accept-model` first; since it's a POST and
 * the PATCH is a different verb, they don't actually collide, but
 * ordering is still defensive.
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

// Phase 7 (registered BEFORE Phase 6 PATCH so the more specific POST
// route is matched first; verbs differ so there's no real collision,
// but this is the safe ordering).
// POST /:id/fields/:field/accept-model — explicit "accept new model value"
// after a re-extraction conflict.
router.post('/:id/fields/:field/accept-model', ctrl.acceptNewModelValue);

// Phase 6: human override on a single extracted field.
// Body: { value: <any> } — null clears the override.
router.patch('/:id/fields/:field', ctrl.updateField);

// Phase 7: safe re-extraction with conflict detection.
router.post('/:id/re-extract', ctrl.reExtractEnquiry);

export default router;
