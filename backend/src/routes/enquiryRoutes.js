/**
 * Enquiry routes.
 * Mounted at /api/enquiries in app.js.
 *
 * Architechure.md §8 API surface (Phase 1 subset):
 *   POST /api/enquiries
 *   GET  /api/enquiries
 *   GET  /api/enquiries/:id
 *
 * Later phases mount additional routes on this same router.
 */
import { Router } from 'express';
import * as ctrl from '../controllers/enquiryController.js';

const router = Router();

router.post('/', ctrl.createEnquiry);
router.get('/', ctrl.listEnquiries);
router.get('/:id', ctrl.getEnquiry);

export default router;
