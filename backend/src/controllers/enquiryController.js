/**
 * Enquiry controller.
 *
 * Phase 1 endpoints:
 *   POST /api/enquiries         create one enquiry from a paste
 *   GET  /api/enquiries/:id     fetch a single enquiry (for refresh retrieval)
 *   GET  /api/enquiries         list recent enquiries (basic; Phase 5 adds filters)
 *
 * Later phases add: PATCH, re-extract, list extractions, import. Each has its
 * own controller method (added in this file when its phase lands).
 */
import { z } from 'zod';
import * as enquiryService from '../services/enquiryService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

// --- request schemas (zod) ---

const senderSchema = z
  .object({
    name: z.string().max(200).optional(),
    email: z.string().max(200).optional(),
  })
  .strict()
  .optional();

const createEnquiryBodySchema = z
  .object({
    source: z.literal('paste'), // Phase 1: only paste; file lands in Phase 2
    originalText: z.string().min(1).max(enquiryService.MAX_ORIGINAL_TEXT_CHARS),
    sender: senderSchema,
  })
  .strict();

const listEnquiriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

// --- controllers ---

/**
 * POST /api/enquiries
 *
 * Body: { source: 'paste', originalText: string, sender?: {name?, email?} }
 *
 * 201 on success -> { enquiry: <enquiry response shape> }
 * 400 on validation error
 */
export const createEnquiry = asyncHandler(async (req, res) => {
  const parsed = createEnquiryBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const message =
      parsed.error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ') || 'Invalid request body';
    throw new AppError({
      message,
      status: 400,
      code: 'VALIDATION_ERROR',
      context: { zodIssues: parsed.error.issues.length },
    });
  }

  const saved = await enquiryService.createEnquiry(parsed.data);

  res.status(201).json({
    enquiry: saved.toApiResponse(),
  });
});

/**
 * GET /api/enquiries/:id
 *
 * 200 -> { enquiry: <enquiry response shape> }
 * 400 on invalid id
 * 404 if not found
 */
export const getEnquiry = asyncHandler(async (req, res) => {
  const doc = await enquiryService.getEnquiryById(req.params.id);
  if (!doc) {
    throw new AppError({
      message: `Enquiry ${req.params.id} not found.`,
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  res.status(200).json({ enquiry: doc.toApiResponse() });
});

/**
 * GET /api/enquiries
 *
 * 200 -> { enquiries: [<enquiry response shape>...], count: number }
 *
 * Phase 5 will add filters + sorting. For Phase 1 this just returns the most
 * recent records, lean — used by the console placeholder and for refresh tests.
 */
export const listEnquiries = asyncHandler(async (req, res) => {
  const parsed = listEnquiriesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message =
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') ||
      'Invalid query';
    throw new AppError({ message, status: 400, code: 'VALIDATION_ERROR' });
  }
  const docs = await enquiryService.listEnquiries({ limit: parsed.data.limit });
  // Map through toApiResponse-compatible shape. `docs` are lean objects so
  // they don't have the instance method — we normalise here instead.
  const enquiries = docs.map((o) => ({
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
  }));
  res.status(200).json({ enquiries, count: enquiries.length });
});
