/**
 * Enquiry controller.
 *
 * endpoints:
 *   POST /api/enquiries create one enquiry from a paste
 *   GET  /api/enquiries/:id fetch a single enquiry (for refresh retrieval)
 *   GET  /api/enquiries list recent enquiries (basic;
 *
 * endpoint:
 *   POST /api/enquiries/import parse a sample-enquiries file and persist records
 *
 * endpoints:
 *   POST /api/enquiries/:id/extract trigger LLM extraction for one enquiry
 *   GET  /api/enquiries/:id/extractions list extraction versions for one enquiry
 *
 * endpoint:
 *   POST /api/enquiries/:id/recalculate-priority recompute deterministic priority
 *
 * Later phases add: PATCH (field edits), re-extract. Each has its own
 * controller method (added in this file when its phase lands).
 */
import { z } from 'zod';
import * as enquiryService from '../services/enquiryService.js';
import * as extractionService from '../services/extractionService.js';
import { recalculatePriorityForEnquiry } from '../services/scoringService.js';
import {
  applyHumanOverride,
  clearHumanOverride,
  validateFieldValue,
} from '../services/humanOverrideService.js';
import { OVERRIDEABLE_FIELDS } from '../services/effectiveValueService.js';
import { reExtract } from '../services/reExtractService.js';
import { parseEnquiryFile, MAX_FILE_SIZE_BYTES } from '../services/parserService.js';
import * as batchService from '../services/batchService.js';
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
    source: z.literal('paste'), // paste source; file imports use 'file'
    originalText: z.string().min(1).max(enquiryService.MAX_ORIGINAL_TEXT_CHARS),
    sender: senderSchema,
  })
  .strict();

const listEnquiriesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    serviceLine: z
      .enum(['all', 'ai', 'blockchain', 'web', 'mobile', 'game', 'other'])
      .optional(),
    priority: z.enum(['all', 'high', 'medium', 'low']).optional(),
    status: z.enum(['all', 'new', 'contacted', 'qualified', 'dropped']).optional(),
    sort: z.enum(['priority', 'receivedAt']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();

const updateStatusBodySchema = z
  .object({
    status: z.enum(['new', 'contacted', 'qualified', 'dropped']),
  })
  .strict();

/**
 * PATCH /api/enquiries/:id/fields/:field body schema.
 *
 * The body must contain `value` (the override value). `value: null` is
 * the explicit "clear the override" signal — the service treats null as
 * "no active override, fall back to the model value".
 *
 * The field name is in the URL path (`:field`) and is validated against
 * OVERRIDEABLE_FIELDS in the service layer. `priority`, `originalText`,
 * `receivedAt`, `status`, etc. are NOT in the allowlist and will be
 * rejected with INVALID_FIELD.
 *
 * We use `.passthrough()` rather than `.strict()` for the body schema
 * because the value field's shape varies per field (string / boolean /
 * object). The per-field validator in humanOverrideService handles the
 * deep shape check. Zod here only enforces "body has a `value` key".
 */
const updateFieldBodySchema = z
  .object({
    value: z.any(),
  })
  .passthrough();

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
 * supports query filters + sorting (FR-05):
 *   ?serviceLine=web filter by extracted service line
 *   ?priority=high filter by computed priority level
 *   ?status=new filter by workflow status
 *   ?sort=priority|receivedAt sort by priority score or received date
 *   ?dir=asc|desc sort direction (default desc)
 *   ?limit=50 1..200
 *
 * All filters accept 'all' (or omission) to skip. The response shape is
 * stable across phases so the frontend contract does not break.
 *
 * 200 -> { enquiries: [<enquiry response shape>...], count: number }
 * 400 on invalid query
 */
export const listEnquiries = asyncHandler(async (req, res) => {
  const parsed = listEnquiriesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message =
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') ||
      'Invalid query';
    throw new AppError({ message, status: 400, code: 'VALIDATION_ERROR' });
  }
  const docs = await enquiryService.listEnquiries({
    limit: parsed.data.limit,
    serviceLine: parsed.data.serviceLine,
    priority: parsed.data.priority,
    status: parsed.data.status,
    sort: parsed.data.sort,
    dir: parsed.data.dir,
  });
  const enquiries = docs.map(toEnquiryResponseShape);
  res.status(200).json({ enquiries, count: enquiries.length });
});

/**
 * PATCH /api/enquiries/:id/status
 *
 * move an enquiry through the workflow:
 *   new → contacted → qualified → dropped
 *
 * Body: { status: 'new' | 'contacted' | 'qualified' | 'dropped' }
 *
 *: "Status changes are validated against allowed statuses."
 * Linear order is NOT enforced — the operator may jump between any two
 * allowed states. Unknown enum values are rejected with 400.
 *
 * This endpoint does NOT modify originalText / receivedAt / sender /
 * effectiveExtraction / humanOverrides / priority / extractionState.
 * Those concerns belong to other phases (
 *
 * 200 -> { enquiry: <updated enquiry response shape> }
 * 400 on invalid id or invalid status
 * 404 if enquiry not found
 */
export const updateStatus = asyncHandler(async (req, res) => {
  const parsed = updateStatusBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const message =
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') ||
      'Invalid request body';
    throw new AppError({
      message,
      status: 400,
      code: 'VALIDATION_ERROR',
      context: { zodIssues: parsed.error.issues.length },
    });
  }
  const saved = await enquiryService.updateEnquiryStatus(req.params.id, parsed.data.status);
  res.status(200).json({ enquiry: saved.toApiResponse() });
});

/**
 * PATCH /api/enquiries/:id/fields/:field
 *
 * apply a human override to a single extracted field.
 *
 * Flow C ("Human correction"):
 *   Edit field → save override → recalculate priority → return updated enquiry.
 *
 * Body: { value: <any> }
 *   - `value: null` clears the override (falls back to model extraction).
 *   - `value: <non-null>` sets the override to that value. The shape must
 *     match the field's expected type (validated by humanOverrideService).
 *
 * The field name is validated against OVERRIDEABLE_FIELDS. `priority`,
 * `originalText`, `receivedAt`, `status`, `extractionState`, `batchId`,
 * `sender`, etc. are NOT editable through this endpoint. This is the
 * security boundary: the client cannot inject arbitrary properties into
 * humanOverrides, cannot directly set priority, and cannot mutate
 * originalText.
 *
 * After the override is applied:
 *   1. `humanOverrides[field]` is set to the value (or null if cleared).
 *   2. `effectiveExtraction` is recomputed by merging modelExtraction +
 *      humanOverrides (effectiveValueService.computeEffectiveExtraction).
 *   3. Priority is recalculated by the existing scoringService
 *      from the new effectiveExtraction (applyPriorityToEnquiry).
 *   4. The enquiry is saved and returned.
 *
 * The model extraction is NEVER overwritten — it lives in `modelExtraction`
 * and is preserved unchanged so the operator can later clear the override
 * and get the model value back.
 *
 * 200 -> { enquiry: <updated enquiry response shape> }
 * 400 on invalid id, invalid field name, or invalid field value
 * 404 if enquiry not found
 */
export const updateField = asyncHandler(async (req, res) => {
  const { id, field } = req.params;

  // 1. Validate body shape (must have `value` key).
  const parsed = updateFieldBodySchema.safeParse(req.body);
  if (!parsed.success) {
    const message =
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') ||
      'Invalid request body';
    throw new AppError({
      message,
      status: 400,
      code: 'VALIDATION_ERROR',
      context: { zodIssues: parsed.error.issues.length },
    });
  }

  const value = parsed.data.value;

  // 2. Early field-name rejection (defence in depth — the service also
  //    checks). This lets us return a clear 400 before touching the DB.
  if (!OVERRIDEABLE_FIELDS.includes(field)) {
    throw new AppError({
      message: `Field "${field}" is not editable. Allowed fields: ${OVERRIDEABLE_FIELDS.join(', ')}.`,
      status: 400,
      code: 'INVALID_FIELD',
      context: { field, allowed: OVERRIDEABLE_FIELDS },
    });
  }

  // 3. Apply (or clear) the override. `value === null` clears; any other
  //    value is validated by humanOverrideService.validateFieldValue.
  const saved =
    value === null
      ? await clearHumanOverride(id, field)
      : await applyHumanOverride(id, field, value);

  res.status(200).json({ enquiry: saved.toApiResponse() });
});

/**
 * POST /api/enquiries/:id/re-extract
 *
 * safe re-extraction of an enquiry.
 *
 * Flow D ("Re-extraction"):
 *   User clicks Re-extract → POST /api/enquiries/:id/re-extract →
 *   Create new extraction version → Grok → Gemini fallback →
 *   Validate → Compare with human overrides → Keep human-controlled
 *   fields → Expose conflicts → Recalculate priority → Return.
 *
 * The critical invariant:
 *   A re-extraction is a new version, NOT an overwrite. Existing human
 *   overrides are PRESERVED. The new model extraction is stored as a new
 *   ExtractionVersion row (append-only) AND becomes the new
 *   `enquiry.modelExtraction` (the latest model output). The
 *   `effectiveExtraction` is recomputed by merging the new modelExtraction
 *   with the preserved humanOverrides (overrides win).
 *
 * Conflicts are detected per field: a conflict exists when an active
 * human override differs from the new model value. The conflicts array
 * is returned in the response so the UI can surface the operator decision
 * (Keep confirmed / Accept new model) for each conflicted field.
 *
 * Failure behavior:
 *   If re-extraction fails (both Groq and Gemini fail, or INVALID_OUTPUT),
 *   the existing modelExtraction, effectiveExtraction, humanOverrides, and
 *   priority are ALL preserved unchanged. Only extractionState transitions
 *   to 'failed'. The operator can retry.
 *
 * SECURITY:
 *   - The client cannot specify provider, model, version, or timestamp.
 *     The server controls all of these.
 *   - The client cannot submit arbitrary model values as if they came from
 *     Groq/Gemini. The LLM service is the only source of model values.
 *   - originalText is NEVER modified (immutable ).
 *   - The client cannot directly set priority. Priority is always derived
 *     from the effective extraction by the deterministic scoring service.
 *
 * Response (200):
 *   {
 *     enquiry:   <updated enquiry response shape>,
 *     versions:  [<new extraction version response shape>, ...],
 *     outcome:   { state, provider, model, errorCode, errorMessage,
 *                  durationMs, attempts: [...] },
 *     conflicts: [{ field, humanValue, newModelValue, hasConflict }, ...]
 *   }
 *
 * 400 on invalid id; 404 if enquiry not found; 409 if already processing.
 */
export const reExtractEnquiry = asyncHandler(async (req, res) => {
  const { enquiry, versions, outcome, conflicts } = await reExtract(req.params.id);

  res.status(200).json({
    enquiry: enquiry.toApiResponse(),
    versions: versions.map((v) => v.toApiResponse()),
    outcome: {
      state: outcome.state,
      provider: outcome.provider,
      model: outcome.model,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      durationMs: outcome.durationMs,
      attempts: outcome.attempts.map((a) => ({
        provider: a.provider,
        model: a.model,
        state: a.state,
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        durationMs: a.durationMs,
      })),
    },
    conflicts,
  });
});

/**
 * POST /api/enquiries/:id/fields/:field/accept-model
 *
 * explicit "accept the new model value" action for a conflicted
 * field.
 *
 * After a re-extraction produces a model value that conflicts with an
 * active human override, the operator can either:
 *   - Keep the confirmed (human) value  → no API call (override stays)
 *   - Accept the new model value         → POST /fields/:field/accept-model
 *
 * "Accept new model" semantics,:
 *   - The human override for this field is CLEARED (set to null).
 *   - The effective value falls back to the latest modelExtraction value
 *     (which is the new model value, since re-extraction updated
 *     modelExtraction to the latest output).
 *   - Priority is recalculated from the new effective extraction.
 *
 * This endpoint is semantically distinct from `PATCH /fields/:field` with
 * `value: null` (which also clears the override). The distinction is
 * intentional and audit-friendly: "accept-model" records the operator's
 * explicit decision to adopt the new model value after a re-extraction
 * conflict, whereas "clear" simply removes the override without that
 * context. Both paths converge on the same `clearHumanOverride` service
 * call — the data result is identical, only the API surface differs.
 *
 * IMPORTANT: This action is EXPLICIT. The system NEVER automatically
 * accepts a new model value merely because re-extraction succeeded.
 * The operator must click [Accept new model] for each conflicted field
 * individually.
 *
 * The field name is validated against OVERRIDEABLE_FIELDS. `priority`,
 * `originalText`, `receivedAt`, `status`, etc. are rejected with
 * INVALID_FIELD (defence in depth — the service also checks).
 *
 * Response (200):
 *   {
 *     enquiry: <updated enquiry response shape>,
 *     acceptedField: <field name>,
 *     newEffectiveValue: <the new effective value for this field>
 *   }
 *
 * 400 on invalid id or invalid field; 404 if enquiry not found.
 */
export const acceptNewModelValue = asyncHandler(async (req, res) => {
  const { id, field } = req.params;

  // 1. Early field-name rejection (defence in depth — the service also
  //    checks). This lets us return a clear 400 before touching the DB.
  if (!OVERRIDEABLE_FIELDS.includes(field)) {
    throw new AppError({
      message: `Field "${field}" is not editable. Allowed fields: ${OVERRIDEABLE_FIELDS.join(', ')}.`,
      status: 400,
      code: 'INVALID_FIELD',
      context: { field, allowed: OVERRIDEABLE_FIELDS },
    });
  }

  // 2. Clear the override. After clearing, the effective value falls back
  //    to enquiry.modelExtraction[field] (the latest model output, which
  //    was updated by the most recent re-extraction). Priority is
  //    recalculated by applyPriorityToEnquiry inside clearHumanOverride.
  const saved = await clearHumanOverride(id, field);

  // 3. Read the new effective value for the response so the UI can confirm.
  const newEffectiveValue =
    field === 'isGenuineProjectEnquiry'
      ? saved.isGenuineProjectEnquiry
      : saved.effectiveExtraction?.[field];

  logger.info('acceptNewModelValue: override cleared, new model value adopted', {
    enquiryId: String(saved._id),
    field,
    newEffectiveValue:
      typeof newEffectiveValue === 'string' ? newEffectiveValue.slice(0, 80) : newEffectiveValue,
  });

  res.status(200).json({
    enquiry: saved.toApiResponse(),
    acceptedField: field,
    newEffectiveValue,
  });
});

/**
 * POST /api/enquiries/import
 *
 * multipart file upload. The uploaded file is parsed by
 * parserService.parseEnquiryFile() into structured input records. Each
 * parsed record is persisted via enquiryService.createEnquiry() with
 * source='file' and the parsed receivedAt timestamp.
 *
 * extension — after persisting, the endpoint:
 *   1. Creates a BatchJob with total = enquiries.length.
 *   2. Atomically sets `batchId` on all persisted enquiries (one updateMany).
 *   3. Kicks off batchService.runBatchExtraction(batchId) WITHOUT awaiting
 *      (fire-and-forget). The HTTP handler returns immediately with the
 *      batchId so the frontend can start polling GET /api/batches/:id.
 *
 * Flow B:
 *   Upload → POST /api/enquiries/import → validate → parse → create
 *   enquiry records → create batch job → bounded concurrent extraction →
 *   GET /api/batches/:id → polling → batch progress UI.
 *
 * Behaviour Batch / §13 File Handling):
 *   - One failed block does NOT crash the import. Per-item failures are
 *     collected and returned in `failed[]`.
 *   - originalText is preserved EXACTLY (parser does no normalization).
 *   - LLM extraction runs in the BACKGROUND after the HTTP response is sent.
 *     The HTTP handler does NOT block on extraction.
 *   - extractionState defaults to 'pending'; the background workers transition
 *     it through processing → completed|failed.
 *
 * Request: multipart/form-data with field `file` containing a .txt file.
 * Response (200):
 *   {
 *     enquiries: [<enquiry response shape>, ...],   // successfully persisted
 *     failed:    [{ blockIndex, reason }, ...],     // parse/persist failures
 *     meta:      { fileName, totalBlocks, parsedCount, persistedCount,
 *                  failedCount, skippedCount, warnings },
 *     batch:     { id, total, status, ... } | null  // null if 0
 *                                                     enquiries persisted
 *   }
 *
 * If no enquiries were persisted (all blocks failed parsing/persistence),
 * no BatchJob is created and `batch` is null. This avoids creating an empty
 * batch that would immediately transition to 'completed' with total=0.
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
  // One failure does NOT crash the batch.
  // We collect the SAVED Mongoose documents (not just the API response shape)
  // so we can set their batchId after the BatchJob is created.
  const enquiries = [];
  const persistedDocs = [];
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
      persistedDocs.push(saved);
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

  // --- ---
  //
  // Only create a batch if at least one enquiry was persisted. This avoids
  // creating an empty batch (total=0) that would immediately transition to
  // 'completed' — operators would see a meaningless batch in their history.
  let batch = null;
  if (persistedDocs.length > 0) {
    // createBatch atomically sets batchId on all persisted enquiries via
    // updateMany (see batchService.createBatch). The controller does NOT
    // need to set batchId separately.
    const batchDoc = await batchService.createBatch({
      enquiryIds: persistedDocs.map((d) => String(d._id)),
      fileName,
    });

    batch = batchDoc.toApiResponse();

    // Fire-and-forget: kick off the worker pool WITHOUT awaiting. The HTTP
    // handler returns immediately; the frontend polls GET /api/batches/:id
    // to observe progress. Errors inside the pool are captured per-item
    // (see batchService.runWorker) and NEVER propagate to the HTTP layer.
    //
    // We deliberately do NOT .catch() here — runBatchExtraction is designed
    // to never reject (it catches everything internally). The .catch() is
    // defensive only; if it ever fires, it logs without crashing the process.
    batchService
      .runBatchExtraction(String(batchDoc._id))
      .catch((err) => {
        logger.error('Import: background batch extraction failed unexpectedly', {
          batchId: String(batchDoc._id),
          message: err?.message,
        });
      });

    logger.info('Import: batch created, background extraction started', {
      batchId: String(batchDoc._id),
      total: persistedDocs.length,
    });
  }

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
    batch,
  });
});

/**
 * POST /api/enquiries/:id/extract
 *
 * trigger LLM extraction for one persisted enquiry.
 *
 * Flow:
 *   - Load enquiry (404 if not found).
 *   - Refuse if already 'processing' (409).
 *   - Call llmService.extractWithFallback(originalText):
 *       Grok → success → persist version, update effectiveExtraction
 *       Grok recoverable failure → Gemini → success/failure
 *       Grok non-recoverable failure (INVALID_OUTPUT) → do NOT try Gemini
 *   - Persist one ExtractionVersion per provider attempt (success AND failure).
 *   - On success: extractionState='completed', effectiveExtraction updated.
 *   - On failure: extractionState='failed', effectiveExtraction untouched.
 *   - originalText, receivedAt, sender, status are NEVER modified.
 *
 * Response (200):
 *   {
 *     enquiry:    <updated enquiry response shape>,
 *     versions:   [<extraction version response shape>, ...],
 *     outcome:    { state, provider, model, errorCode, errorMessage, durationMs }
 *   }
 *
 * Note:
 * endpoint with explicit conflict-resolution semantics against human
 * overrides.'s `extract` is the simpler "first extraction" path.
 */
export const extractEnquiry = asyncHandler(async (req, res) => {
  const { enquiry, versions, outcome } = await extractionService.runExtraction(
    req.params.id,
  );

  res.status(200).json({
    enquiry: enquiry.toApiResponse(),
    versions: versions.map((v) => v.toApiResponse()),
    outcome: {
      state: outcome.state,
      provider: outcome.provider,
      model: outcome.model,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      durationMs: outcome.durationMs,
      attempts: outcome.attempts.map((a) => ({
        provider: a.provider,
        model: a.model,
        state: a.state,
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        durationMs: a.durationMs,
      })),
    },
  });
});

/**
 * GET /api/enquiries/:id/extractions
 *
 * list all extraction versions for an enquiry, ordered by version.
 *
 * Response (200):
 *   {
 *     extractions: [<extraction version response shape>, ...],
 *     count: number
 *   }
 *
 * This endpoint exposes the audit trail so the operator (and's
 * re-extraction conflict UI) can inspect what each provider returned.
 */
export const listExtractions = asyncHandler(async (req, res) => {
  const docs = await extractionService.listExtractions(req.params.id);
  const extractions = docs.map((o) => ({
    id: String(o._id),
    enquiryId: String(o.enquiryId),
    version: o.version,
    provider: o.provider,
    model: o.model,
    rawOutput: o.rawOutput ?? null,
    parsedOutput: o.parsedOutput ?? null,
    state: o.state,
    errorCode: o.errorCode ?? null,
    errorMessage: o.errorMessage ?? null,
    durationMs: o.durationMs ?? null,
    createdAt: o.createdAt,
  }));
  res.status(200).json({ extractions, count: extractions.length });
});

/**
 * POST /api/enquiries/:id/recalculate-priority
 *
 * recompute the deterministic priority from the enquiry's CURRENT
 * effectiveExtraction + isGenuineProjectEnquiry values, and persist the result.
 *
 * This endpoint is the approved convenience mechanism for recalculating
 * priority independently of (re-)extraction. It does NOT:
 *   - call the LLM
 *   - modify originalText / receivedAt / sender / status
 *   - modify effectiveExtraction or humanOverrides
 *   - implement broader human-edit functionality (
 *
 * Flow C shows the intended long-term shape: a human
 * edit saves an override, then priority is recalculated. ships
 * only the recalculation half; the override-saving half lands.
 * Until then, this endpoint is useful for:
 *   - re-scoring after a manual DB correction during ops
 *   - re-scoring the entire backlog after a scoring-rule tweak
 *   - independent verification that scoring is deterministic
 *
 * Response (200):
 *   {
 *     enquiry:  <updated enquiry response shape, including new priority>,
 *     priority: { score, level, reasons }
 *   }
 *
 * 400 on invalid id; 404 if enquiry not found.
 */
export const recalculatePriority = asyncHandler(async (req, res) => {
  const { enquiry, priority } = await recalculatePriorityForEnquiry(req.params.id);
  res.status(200).json({
    enquiry: enquiry.toApiResponse(),
    priority,
  });
});

/**
 * Map a lean Mongoose plain object (from .lean()) into the same response
 * shape produced by Enquiry.prototype.toApiResponse(). `listEnquiries`
 * uses .lean() for performance, so the instance method is unavailable
 * there — this helper keeps the response shape stable across endpoints.
 *
 * @param {object} o Lean document from Mongoose.
 * @returns {object}  API response shape (matches toApiResponse).
 */
function toEnquiryResponseShape(o) {
  return {
    id: String(o._id),
    source: o.source,
    originalText: o.originalText,
    sender: o.sender ?? { name: null, email: null },
    receivedAt: o.receivedAt,
    status: o.status,
    isGenuineProjectEnquiry: o.isGenuineProjectEnquiry ?? null,
    effectiveExtraction: o.effectiveExtraction ?? null,
    modelExtraction: o.modelExtraction ?? null,
    humanOverrides: o.humanOverrides ?? {},
    priority: o.priority ?? { level: null, score: null, reasons: [] },
    extractionState: o.extractionState,
    batchId: o.batchId ? String(o.batchId) : null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
