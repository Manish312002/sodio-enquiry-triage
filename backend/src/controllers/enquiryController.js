/**
 * Enquiry controller.
 *
 * Phase 1 endpoints:
 *   POST /api/enquiries         create one enquiry from a paste
 *   GET  /api/enquiries/:id     fetch a single enquiry (for refresh retrieval)
 *   GET  /api/enquiries         list recent enquiries (basic; Phase 5 adds filters)
 *
 * Phase 2 endpoint:
 *   POST /api/enquiries/import  parse a sample-enquiries file and persist records
 *
 * Later phases add: PATCH, re-extract, list extractions. Each has its own
 * controller method (added in this file when its phase lands).
 */
import { z } from 'zod';
import * as enquiryService from '../services/enquiryService.js';
import { parseEnquiryFile, MAX_FILE_SIZE_BYTES } from '../services/parserService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

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

/**
 * POST /api/enquiries/import
 *
 * Phase 2 — multipart file upload. The uploaded file is parsed by
 * parserService.parseEnquiryFile() into structured input records. Each
 * parsed record is persisted via enquiryService.createEnquiry() with
 * source='file' and the parsed receivedAt timestamp.
 *
 * Behaviour (Rules.md §12 Batch / §13 File Handling):
 *   - One failed block does NOT crash the import. Per-item failures are
 *     collected and returned in `failed[]`.
 *   - originalText is preserved EXACTLY (parser does no normalization).
 *   - No LLM calls. No priority scoring. No batch job creation.
 *     extractionState defaults to 'pending' — Phase 3 will pick them up.
 *
 * Request: multipart/form-data with field `file` containing a .txt file.
 * Response (200):
 *   {
 *     enquiries: [<enquiry response shape>, ...],   // successfully persisted
 *     failed:    [{ blockIndex, reason }, ...],     // parse/persist failures
 *     meta:      { fileName, totalBlocks, parsedCount, persistedCount,
 *                  failedCount, skippedCount, warnings }
 *   }
 *
 * Phase 3 will extend this endpoint to start batch extraction after persist.
 */
export const importEnquiries = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError({
      message: "No file uploaded. Use multipart/form-data with field 'file'.",
      status: 400,
      code: 'NO_FILE_UPLOADED',
    });
  }

  if (req.file.size > MAX_FILE_SIZE_BYTES) {
    throw new AppError({
      message: `File is too large (max ${MAX_FILE_SIZE_BYTES} bytes).`,
      status: 413,
      code: 'FILE_TOO_LARGE',
    });
  }

  // Decode the uploaded bytes as UTF-8. If decoding fails, reject loudly.
  let fileContent;
  try {
    fileContent = req.file.buffer.toString('utf-8');
  } catch (err) {
    throw new AppError({
      message: `Could not decode file as UTF-8: ${err.message}`,
      status: 400,
      code: 'INVALID_ENCODING',
    });
  }

  const fileName = req.file.originalname || 'unknown';

  logger.info('Import: parsing file', {
    fileName,
    sizeBytes: req.file.size,
    contentType: req.file.mimetype,
  });

  // --- Parse (pure function, no I/O) ---
  const parsed = parseEnquiryFile(fileContent, { fileName });

  logger.info('Import: parse complete', {
    fileName,
    totalBlocks: parsed.meta.totalBlocks,
    parsedCount: parsed.meta.parsedCount,
    skippedCount: parsed.meta.skippedCount,
    warnings: parsed.warnings.length,
  });

  // --- Persist each parsed record ---
  // One failure does NOT crash the batch (Rules.md §12).
  const enquiries = [];
  const failed = [];

  for (const record of parsed.records) {
    try {
      const saved = await enquiryService.createEnquiry({
        source: 'file',
        originalText: record.originalText,
        sender: record.sender,
        receivedAt: record.receivedAt,
      });
      enquiries.push(saved.toApiResponse());
    } catch (err) {
      // AppError (validation etc.) or Mongoose error. Record the failure
      // and continue with the next record.
      failed.push({
        blockIndex: record.blockIndex,
        reason: err?.code || err?.name || 'PERSIST_FAILED',
        message: err?.message || String(err),
      });
      logger.warn('Import: per-item persist failed', {
        blockIndex: record.blockIndex,
        code: err?.code,
        message: err?.message,
      });
    }
  }

  // Combine parser-level skipped blocks with persist-level failures.
  const allFailed = [...parsed.skipped, ...failed];

  res.status(200).json({
    enquiries,
    failed: allFailed,
    meta: {
      fileName,
      totalBlocks: parsed.meta.totalBlocks,
      parsedCount: parsed.meta.parsedCount,
      persistedCount: enquiries.length,
      failedCount: allFailed.length,
      skippedCount: parsed.meta.skippedCount,
      warnings: parsed.warnings,
    },
  });
});
