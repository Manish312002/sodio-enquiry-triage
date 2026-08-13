/**
 * Enquiry service — repository boundary for the Enquiry collection.
 *
 * Architechure.md §14: "MongoDB access remains behind services/repositories/models."
 *
 * Phase 1 surface:
 *   - createEnquiry({ source, originalText, sender? }) -> saved enquiry
 *   - getEnquiryById(id) -> enquiry | null
 *   - listEnquiries({ limit }) -> [enquiry]  (basic; filters come in Phase 5)
 *
 * Phase 1 deliberately does NOT:
 *   - run extraction (Phase 3)
 *   - compute priority (Phase 4)
 *   - accept human overrides (Phase 6)
 *   - support re-extraction (Phase 7)
 *
 * Original text immutability is enforced at two layers:
 *   1. Mongoose schema marks `originalText` and `receivedAt` as `immutable`.
 *   2. This service never exposes a setter for those fields.
 */
import Enquiry from '../models/Enquiry.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/** Phase 1 hard limit on originalText size. Generous; sample enquiries are <2KB. */
export const MAX_ORIGINAL_TEXT_CHARS = 100_000;

/**
 * Persist a new enquiry. Phase 1 only stores the immutable source data;
 * `status` defaults to `new`, `extractionState` defaults to `pending`.
 *
 * Phase 2 extension: accepts an optional `receivedAt` Date so file imports
 * can preserve the source timestamp from the parsed `Received:` header
 * (Rules.md §14: "Source timestamp is preserved"). If omitted, defaults to
 * the current time (Phase 1 behaviour for paste).
 *
 * @param {object} input
 * @param {'paste'|'file'} input.source
 * @param {string} input.originalText  Verbatim; never trimmed.
 * @param {{name?: string, email?: string}} [input.sender]
 * @param {Date} [input.receivedAt]  Optional source timestamp (Phase 2).
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

  // We intentionally do NOT trim or normalise originalText (Rules.md §14).
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

  // Sender is optional for Phase 1 (the paste UI does not require it).
  // Phase 2 file imports may yield sender values like "n/a" or empty
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
  //     Phase 1's paste UI explicitly validates this; a bad email here is
  //     a real user error.
  //   - source='file': tolerant. The source file may contain placeholders
  //     like "n/a" (see Vish's contact-form enquiry in the sample fixture).
  //     Rather than crashing the whole import (Rules.md §12: one failed
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

  // receivedAt: Phase 2 file imports pass the parsed source timestamp.
  // Phase 1 paste omits it, so we default to now. We validate that it's a
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
 * List recent enquiries (Phase 5 will add filters / sorting).
 *
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @returns {Promise<import('../models/Enquiry.js').default[]>}
 */
export async function listEnquiries({ limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return Enquiry.find().sort({ receivedAt: -1 }).limit(safeLimit).lean().exec();
}

export default { createEnquiry, getEnquiryById, listEnquiries, MAX_ORIGINAL_TEXT_CHARS };
