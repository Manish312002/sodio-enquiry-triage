/**
 * Enquiry routes.
 * Mounted at /api/enquiries in app.js.
 *
 * Architechure.md §8 API surface (Phase 1 + Phase 2 subset):
 *   POST /api/enquiries          (Phase 1) paste one enquiry
 *   POST /api/enquiries/import   (Phase 2) multipart file upload + parse + persist
 *   GET  /api/enquiries          (Phase 1) list recent
 *   GET  /api/enquiries/:id      (Phase 1) fetch one
 *
 * Later phases mount additional routes (PATCH, re-extract, extractions) on
 * this same router.
 *
 * NOTE: `/import` is registered BEFORE `/:id` so Express does not match
 * "import" as an id parameter.
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

export default router;
