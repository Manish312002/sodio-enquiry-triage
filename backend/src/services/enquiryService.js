/**
 * Enquiry service — repository boundary for the Enquiry collection.
 *
 * MongoDB access remains behind services/repositories/models.
 *
 * Surface:
 *   - createEnquiry({ source, originalText, sender? }) -> saved enquiry
 *   - getEnquiryById(id) -> enquiry | null
 *   - listEnquiries({ limit, filters?, sort? }) -> [enquiry]
 *
 * Deliberately does NOT:
 *   - run extraction
 *   - compute priority
 *   - accept human overrides
 *   - support re-extraction
 *
 * Original text immutability is enforced at two layers:
 *   1. Mongoose schema marks `originalText` and `receivedAt` as `immutable`.
 *   2. This service never exposes a setter for those fields.
 */
import Enquiry from '../models/Enquiry.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/** Hard limit on originalText size. Generous; sample enquiries are <2KB. */
export const MAX_ORIGINAL_TEXT_CHARS = 100_000;

/**
 * Persist a new enquiry. Stores only the immutable source data;
 * `status` defaults to `new`, `extractionState` defaults to `pending`.
 *
 * Accepts an optional `receivedAt` Date so file imports
 * can preserve the source timestamp from the parsed `Received:` header.
 * If omitted, defaults to the current time (paste behaviour).
 *
 * @param {object} input
 * @param {'paste'|'file'} input.source
 * @param {string} input.originalText Verbatim; never trimmed.
 * @param {{name?: string, email?: string}} [input.sender]
 * @param {Date} [input.receivedAt]  Optional source timestamp.
 * @returns {Promise<import('../models/Enquiry.js').default>}
 */
export async function createEnquiry({ source, originalText, sender, receivedAt } = {}) {
  if (!source || !['paste', 'file'].includes(source)) {
    throw new AppError({
      message: 'Invalid source. Allowed: paste, file.',
      status: 400,
      code: 'INVALID_SOURCE',
    });
  }

  if (typeof originalText !== 'string') {
    throw new AppError({
      message: 'originalText must be a string.',
      status: 400,
      code: 'INVALID_ORIGINAL_TEXT',
    });
  }

  // We intentionally do NOT trim or normalise originalText.
  // Empty/whitespace-only content is rejected with a readable message.
  if (originalText.length === 0 || originalText.trim().length === 0) {
    throw new AppError({
      message: 'originalText cannot be empty.',
      status: 400,
      code: 'EMPTY_ORIGINAL_TEXT',
    });
  }

  if (originalText.length > MAX_ORIGINAL_TEXT_CHARS) {
    throw new AppError({
      message: `originalText is too long (max ${MAX_ORIGINAL_TEXT_CHARS} chars).`,
      status: 413,
      code: 'ORIGINAL_TEXT_TOO_LARGE',
    });
  }

  // Sender is optional (the paste UI does not require it).
  // file imports may yield sender values like "n/a" or empty
  // strings when the source file has no real email for a block.
  const senderDoc =
    sender && typeof sender === 'object'
      ? {
          name: typeof sender.name === 'string' && sender.name.trim() ? sender.name.trim() : null,
          email: typeof sender.email === 'string' && sender.email.trim() ? sender.email.trim() : null,
        }
      : { name: null, email: null };

  // Basic email shape check (server-side). We do not require RFC 5322 here.
  //
  // Source-aware handling:
  //   - source='paste': strict. Reject with 400 INVALID_SENDER_EMAIL.
  //'s paste UI explicitly validates this; a bad email here is
  //     a real user error.
  //   - source='file': tolerant. The source file may contain placeholders
  //     like "n/a" (see Vish's contact-form enquiry in the sample fixture).
  //     Rather than crashing the whole import: one failed
  //     item must not crash the whole batch), we downgrade the email to
  //     null and log a warning. The original raw value is preserved in
  //     originalText, so no information is lost.
  if (senderDoc.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderDoc.email)) {
    if (source === 'paste') {
      throw new AppError({
        message: 'sender.email does not look like an email address.',
        status: 400,
        code: 'INVALID_SENDER_EMAIL',
      });
    }
    // source === 'file' — downgrade to null with a warning.
    logger.warn('File import: sender email failed shape check; downgrading to null', {
      originalValue: senderDoc.email,
    });
    senderDoc.email = null;
  }

  // receivedAt: file imports pass the parsed source timestamp.
  // paste omits it, so we default to now. We validate that it's a
  // real Date — if a caller passes a string, we coerce; if invalid, we
  // fall back to now (defensive — never crash the import over a bad date).
  let finalReceivedAt;
  if (receivedAt === undefined || receivedAt === null) {
    finalReceivedAt = new Date();
  } else if (receivedAt instanceof Date) {
    finalReceivedAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;
  } else if (typeof receivedAt === 'string') {
    const parsed = new Date(receivedAt);
    finalReceivedAt = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    finalReceivedAt = new Date();
  }

  const enquiry = new Enquiry({
    source,
    originalText,
    sender: senderDoc,
    receivedAt: finalReceivedAt,
    status: 'new',
    extractionState: 'pending',
  });

  try {
    const saved = await enquiry.save();
    logger.info('Enquiry created', { id: String(saved._id), source, len: originalText.length });
    return saved;
  } catch (err) {
    // Mongoose ValidationError, immutable violation, etc.
    if (err?.name === 'ValidationError') {
      throw new AppError({
        message: `Validation failed: ${err.message}`,
        status: 400,
        code: 'VALIDATION_ERROR',
        context: { mongooseKind: err.name },
      });
    }
    if (err?.name === 'MongooseError' && /immutable/i.test(err.message)) {
      throw new AppError({
        message: 'Attempted to modify an immutable field.',
        status: 400,
        code: 'IMMUTABLE_FIELD',
      });
    }
    // Re-throw everything else to the central error handler.
    throw err;
  }
}

/**
 * Fetch a single enquiry by id.
 *
 * @param {string} id
 * @returns {Promise<import('../models/Enquiry.js').default|null>}
 * @throws {AppError} 400 if id is not a valid ObjectId.
 */
export async function getEnquiryById(id) {
  if (!id || !/^[a-fA-F0-9]{24}$/.test(String(id))) {
    throw new AppError({
      message: 'Invalid enquiry id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }
  return Enquiry.findById(id).exec();
}

/**
 * List recent enquiries with optional filters + sorting.
 *
 * md §9:
 *   - serviceLine: 'all' | 'ai' | 'blockchain' | 'web' | 'mobile' | 'game' | 'other'
 *   - priority:    'all' | 'high' | 'medium' | 'low'
 *   - status:      'all' | 'new' | 'contacted' | 'qualified' | 'dropped'
 *   - sort:        'priority' | 'receivedAt' (default: 'receivedAt')
 *   - dir:         'asc' | 'desc' (default: 'desc')
 *   - limit:       1..200 (default: 50)
 *
 * All filters are optional and validated by the controller (zod). The
 * service layer applies them defensively — `all` / undefined values are
 * skipped, and only known enum values are passed to MongoDB.
 *
 * `priority` is not a top-level field; it lives at `priority.level` on
 * the document. We filter on that sub-path. Enquiries with no priority
 * yet (extractionState != 'completed') have `priority.level = null` and
 * are excluded when filtering by a specific level — they remain visible
 * only under the 'all' filter (which is the desired behaviour: the
 * operator wants to see pending/failed items in the default view).
 *
 * Sorting by priority uses the numeric `priority.score` field so that
 * high (≥8) sorts above medium (4-7) above low (≤3). Items with null
 * priority score are treated as the lowest possible value (-Infinity)
 * so they sink to the bottom in descending order.
 *
 * @param {object} [opts]
 * @param {string} [opts.serviceLine='all']
 * @param {string} [opts.priority='all']
 * @param {string} [opts.status='all']
 * @param {string} [opts.sort='receivedAt']
 * @param {string} [opts.dir='desc']
 * @param {number} [opts.limit=50]
 * @returns {Promise<object[]>}  Lean plain objects (no Mongoose methods).
 */
export async function listEnquiries({
  serviceLine = 'all',
  priority = 'all',
  status = 'all',
  sort = 'receivedAt',
  dir = 'desc',
  limit = 50,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const query = {};

  const SERVICE_LINES = ['ai', 'blockchain', 'web', 'mobile', 'game', 'other'];
  if (typeof serviceLine === 'string' && SERVICE_LINES.includes(serviceLine)) {
    query['effectiveExtraction.serviceLine'] = serviceLine;
  }

  const PRIORITIES = ['high', 'medium', 'low'];
  if (typeof priority === 'string' && PRIORITIES.includes(priority)) {
    query['priority.level'] = priority;
  }

  const STATUSES = ['new', 'contacted', 'qualified', 'dropped'];
  if (typeof status === 'string' && STATUSES.includes(status)) {
    query.status = status;
  }

  // Sort key. Priority sort uses priority.score so the order is high → med → low.
  // receivedAt sort uses the immutable source timestamp.
  const SORT_KEYS = ['priority', 'receivedAt'];
  const safeSort = SORT_KEYS.includes(sort) ? sort : 'receivedAt';
  const safeDir = dir === 'asc' ? 1 : -1;

  let sortSpec;
  if (safeSort === 'priority') {
    // Secondary sort by receivedAt so equal-priority items have a stable order.
    sortSpec = { 'priority.score': safeDir, receivedAt: safeDir };
  } else {
    sortSpec = { receivedAt: safeDir };
  }

  return Enquiry.find(query).sort(sortSpec).limit(safeLimit).lean().exec();
}

/**
 * Update the workflow status of an existing enquiry.
 *
 * implements FR-08 "Status workflow":
 *   new → contacted → qualified → dropped
 *
 *: "Status changes are validated against allowed statuses."
 * We do NOT enforce the linear order — the operator may move an enquiry
 * directly from 'new' to 'dropped' (e.g. obvious spam) or revert from
 * 'qualified' back to 'contacted'. The four enum values are the only
 * allowed states; any other value is rejected with 400.
 *
 * This function does NOT touch:
 *   - originalText / receivedAt (immutable, enforced at schema level)
 *   - effectiveExtraction (
 *   - humanOverrides (
 *   - priority (status is independent of priority score)
 *   - extractionState (extraction is a separate concern)
 *
 * @param {string} id
 * @param {string} status Must be one of: new, contacted, qualified, dropped.
 * @returns {Promise<import('../models/Enquiry.js').default>}  The updated enquiry.
 * @throws {AppError} 400 if id is invalid or status is not in the allowed enum.
 * @throws {AppError} 404 if enquiry not found.
 */
export async function updateEnquiryStatus(id, status) {
  if (!id || !/^[a-fA-F0-9]{24}$/.test(String(id))) {
    throw new AppError({
      message: 'Invalid enquiry id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }

  const ALLOWED_STATUSES = ['new', 'contacted', 'qualified', 'dropped'];
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new AppError({
      message: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(', ')}.`,
      status: 400,
      code: 'INVALID_STATUS',
    });
  }

  const enquiry = await Enquiry.findById(id);
  if (!enquiry) {
    throw new AppError({
      message: `Enquiry ${id} not found.`,
      status: 404,
      code: 'NOT_FOUND',
    });
  }

  enquiry.status = status;
  const saved = await enquiry.save();
  logger.info('Enquiry status updated', {
    id: String(saved._id),
    status: saved.status,
  });
  return saved;
}

export default {
  createEnquiry,
  getEnquiryById,
  listEnquiries,
  updateEnquiryStatus,
  MAX_ORIGINAL_TEXT_CHARS,
};
