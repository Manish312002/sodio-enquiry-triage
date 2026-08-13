/**
 * Human override service — Phase 6.
 *
 * Source-of-truth: Architechure.md §4 Flow C ("Human correction"),
 * Rules.md §10 ("Human Correction Rules"), Rules.md §14 ("Data Integrity").
 *
 * Public surface:
 *   - applyHumanOverride(enquiryId, field, value)  → save override + recompute effective + recalc priority
 *   - clearHumanOverride(enquiryId, field)         → delete override + recompute effective + recalc priority
 *   - validateFieldValue(field, value)             → throws AppError on invalid value shape
 *
 * Architectural boundaries:
 *   - The LLM is an extractor, NOT an authority (Rules.md §3). Human overrides
 *     do not call any LLM. They mutate `humanOverrides[field]` only.
 *   - `originalText`, `receivedAt`, `sender`, `status`, `extractionState`,
 *     `priority` are NEVER touched by this service.
 *   - Priority is always computed by the existing Phase 4 scoringService
 *     from the new effectiveExtraction. The frontend never sees a separate
 *     "set priority" path (Rules.md §9).
 *   - The field name is validated against an explicit allowlist
 *     (`OVERRIDEABLE_FIELDS`). `priority`, `originalText`, `receivedAt`,
 *     `status`, etc. are NOT in the allowlist and will be rejected with 400.
 *     This is the security boundary the operator explicitly asked us to test
 *     (Phase 6 instructions: "test that a request attempting to set priority
 *     is rejected").
 *
 * Effective-value resolution (Architechure.md §7):
 *   - When an override is applied, `effectiveExtraction` is recomputed by
 *     merging `modelExtraction` + `humanOverrides`.
 *   - When an override is cleared, the field falls back to the model value
 *     (sourced from `modelExtraction`, or `effectiveExtraction` for
 *     pre-Phase-6 records where `modelExtraction` is null).
 *   - `priority` is then recalculated by `applyPriorityToEnquiry` (Phase 4).
 *
 * Persistence model:
 *   - `humanOverrides[field] = null` → no active override (fall back to model)
 *   - `humanOverrides[field] = <non-null>` → active override (use this value)
 *   - `false`, `0`, `''` are NON-NULL and count as active overrides
 */
import Enquiry from '../models/Enquiry.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { applyPriorityToEnquiry } from './scoringService.js';
import {
  OVERRIDEABLE_FIELDS,
  SERVICE_LINES,
  BUDGET_QUALIFIERS,
  isOverrideableField,
  hasAnyOverride,
  computeEffectiveExtraction,
} from './effectiveValueService.js';

/**
 * Apply a human override to a single field on an enquiry.
 *
 * Steps:
 *   1. Validate enquiry id.
 *   2. Validate field name (must be in OVERRIDEABLE_FIELDS).
 *   3. Validate value shape (per-field validator).
 *   4. Load enquiry (404 if not found).
 *   5. Lazy-migrate: if `modelExtraction` is null, copy current
 *      `effectiveExtraction` into `modelExtraction` so the model value is
 *      preserved when an override is later cleared.
 *   6. Save override in `humanOverrides[field] = value`.
 *   7. Recompute `effectiveExtraction` from `modelExtraction + humanOverrides`.
 *   8. If `field === 'isGenuineProjectEnquiry'`, also set the top-level
 *      `enquiry.isGenuineProjectEnquiry` (which is what scoringService reads).
 *   9. Recalculate priority via `applyPriorityToEnquiry` (Phase 4).
 *  10. Save and return the updated enquiry.
 *
 * @param {string} enquiryId
 * @param {string} field  One of OVERRIDEABLE_FIELDS.
 * @param {unknown} value  The override value (validated per-field). Pass `null`
 *   to clear the override (same as `clearHumanOverride`).
 * @returns {Promise<import('../models/Enquiry.js').default>}
 * @throws {AppError} 400 INVALID_ID / INVALID_FIELD / INVALID_FIELD_VALUE;
 *                     404 NOT_FOUND.
 */
export async function applyHumanOverride(enquiryId, field, value) {
  // 1. Validate id
  if (!enquiryId || !/^[a-fA-F0-9]{24}$/.test(String(enquiryId))) {
    throw new AppError({
      message: 'Invalid enquiry id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }

  // 2. Validate field name against the explicit allowlist.
  if (!isOverrideableField(field)) {
    throw new AppError({
      message: `Field "${field}" is not editable. Allowed fields: ${OVERRIDEABLE_FIELDS.join(', ')}.`,
      status: 400,
      code: 'INVALID_FIELD',
      context: { field, allowed: OVERRIDEABLE_FIELDS },
    });
  }

  // 3. Validate value shape (per-field). A `null` value means "clear the
  //    override"; we accept it without running the per-field validator.
  if (value !== null) {
    validateFieldValue(field, value);
  }

  // 4. Load enquiry
  const enquiry = await Enquiry.findById(enquiryId);
  if (!enquiry) {
    throw new AppError({
      message: `Enquiry ${enquiryId} not found.`,
      status: 404,
      code: 'NOT_FOUND',
    });
  }

  // 5. Lazy-migrate: copy effectiveExtraction → modelExtraction if missing.
  //    This preserves the model value so the operator can later clear the
  //    override and get the model value back.
  if (!enquiry.modelExtraction) {
    enquiry.modelExtraction = enquiry.effectiveExtraction
      ? enquiry.effectiveExtraction.toObject
        ? enquiry.effectiveExtraction.toObject()
        : { ...enquiry.effectiveExtraction }
      : {};
    enquiry.markModified('modelExtraction');
  }

  // 6. Save the override.
  enquiry.humanOverrides[field] = value;
  enquiry.markModified('humanOverrides');

  // 7. Recompute effectiveExtraction from modelExtraction + humanOverrides.
  enquiry.effectiveExtraction = computeEffectiveExtraction(enquiry);

  // 8. isGenuineProjectEnquiry is a top-level field — sync it to the override
  //    if active, or to the model value if cleared. This is what the scoring
  //    service reads (scoringService.computePriority takes
  //    isGenuineProjectEnquiry as a separate argument).
  if (field === 'isGenuineProjectEnquiry') {
    if (value === null) {
      // Cleared — fall back to the model value.
      enquiry.isGenuineProjectEnquiry = enquiry.modelExtraction?.isGenuineProjectEnquiry ?? null;
    } else {
      enquiry.isGenuineProjectEnquiry = value;
    }
  }

  enquiry.markModified('effectiveExtraction');
  enquiry.markModified('isGenuineProjectEnquiry');

  // 9. Recalculate priority from the new effectiveExtraction (Phase 4).
  const priority = applyPriorityToEnquiry(enquiry);

  // 10. Save and return.
  await enquiry.save();

  logger.info('humanOverrideService: override applied', {
    enquiryId: String(enquiry._id),
    field,
    cleared: value === null,
    priorityLevel: priority.level,
    priorityScore: priority.score,
  });

  return enquiry;
}

/**
 * Clear a human override on a single field.
 *
 * Equivalent to `applyHumanOverride(enquiryId, field, null)` but exposed as
 * a separate method so the intent is unambiguous in the controller layer.
 *
 * After clearing:
 *   - `humanOverrides[field]` is set to null (no active override).
 *   - `effectiveExtraction[field]` is restored to the model value.
 *   - Priority is recalculated from the restored effective values.
 *
 * @param {string} enquiryId
 * @param {string} field
 * @returns {Promise<import('../models/Enquiry.js').default>}
 * @throws {AppError} 400 INVALID_ID / INVALID_FIELD; 404 NOT_FOUND.
 */
export async function clearHumanOverride(enquiryId, field) {
  return applyHumanOverride(enquiryId, field, null);
}

// --- Per-field value validators -------------------------------------------

/**
 * Validate an override value against the field's expected shape.
 *
 * Throws AppError(400, INVALID_FIELD_VALUE) on invalid input.
 *
 * Per-field rules:
 *   - company, contactName, summary: string, 0..2000 chars
 *   - contactEmail: string, basic email shape OR empty string (null/empty allowed)
 *   - serviceLine: enum (ai|blockchain|web|mobile|game|other)
 *   - isGenuineProjectEnquiry: strict boolean (true|false)
 *   - budget: object with optional {raw, currency, min, max, qualifier}.
 *     Numeric fields must be finite numbers or null. Qualifier must be enum.
 *     Currency must be a short string or null.
 *   - timeline: object with optional {raw, normalized}. raw must be a string.
 *     normalized may be any object (the model produces an opaque Mixed shape).
 *
 * @param {string} field
 * @param {unknown} value
 * @returns {void}
 * @throws {AppError}
 */
export function validateFieldValue(field, value) {
  const reject = (msg, ctx) =>
    new AppError({
      message: msg,
      status: 400,
      code: 'INVALID_FIELD_VALUE',
      context: { field, ...ctx },
    });

  switch (field) {
    case 'company':
    case 'contactName':
    case 'summary': {
      if (typeof value !== 'string') {
        throw reject(`Field "${field}" must be a string.`, { receivedType: typeof value });
      }
      if (value.length > 2000) {
        throw reject(`Field "${field}" is too long (max 2000 chars).`, { length: value.length });
      }
      return;
    }

    case 'contactEmail': {
      if (typeof value !== 'string') {
        throw reject('Field "contactEmail" must be a string.', { receivedType: typeof value });
      }
      if (value.length > 200) {
        throw reject('Field "contactEmail" is too long (max 200 chars).', { length: value.length });
      }
      // Allow empty string (= explicitly cleared email).
      if (value.length === 0) return;
      // Basic shape check (server-side). Not RFC 5322.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw reject('Field "contactEmail" does not look like an email address.', { value });
      }
      return;
    }

    case 'serviceLine': {
      if (!SERVICE_LINES.includes(value)) {
        throw reject(
          `Field "serviceLine" must be one of: ${SERVICE_LINES.join(', ')}.`,
          { received: value },
        );
      }
      return;
    }

    case 'isGenuineProjectEnquiry': {
      // Strict boolean only — no "true"/"false" strings, no 0/1.
      if (value !== true && value !== false) {
        throw reject(
          'Field "isGenuineProjectEnquiry" must be a strict boolean (true or false).',
          { receivedType: typeof value, received: value },
        );
      }
      return;
    }

    case 'budget': {
      validateBudgetValue(value, reject);
      return;
    }

    case 'timeline': {
      validateTimelineValue(value, reject);
      return;
    }

    default:
      // Should be unreachable — the field allowlist check above already
      // rejects unknown field names. Defensive.
      throw reject(`Field "${field}" is not editable.`);
  }
}

/**
 * Validate a budget override value.
 *
 * The budget override preserves the existing structure (Rules.md §6):
 *   {
 *     raw: string,                  // original wording, e.g. "£40,000"
 *     currency: string|null,        // ISO code or symbol, e.g. "GBP" or "£"
 *     min: number|null,             // lower bound
 *     max: number|null,             // upper bound
 *     qualifier: 'exact'|'range'|'flexible'|'tbd'|'unknown'
 *   }
 *
 * All fields are optional in the override (the operator may patch just the
 * numeric range, for example). When the override is applied, the resolver
 * replaces the entire budget subdocument with this value.
 *
 * @param {unknown} value
 * @param {(msg: string, ctx?: object) => AppError} reject
 * @returns {void}
 */
function validateBudgetValue(value, reject) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reject('Field "budget" must be an object.', { receivedType: typeof value });
  }

  const { raw, currency, min, max, qualifier } = value;

  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'string') {
      throw reject('budget.raw must be a string.', { receivedType: typeof raw });
    }
    if (raw.length > 500) {
      throw reject('budget.raw is too long (max 500 chars).', { length: raw.length });
    }
  }

  if (currency !== undefined && currency !== null) {
    if (typeof currency !== 'string') {
      throw reject('budget.currency must be a string or null.', { receivedType: typeof currency });
    }
    if (currency.length > 20) {
      throw reject('budget.currency is too long (max 20 chars).', { length: currency.length });
    }
  }

  if (min !== undefined && min !== null) {
    if (typeof min !== 'number' || !Number.isFinite(min) || min < 0) {
      throw reject('budget.min must be a non-negative finite number or null.', { value: min });
    }
  }

  if (max !== undefined && max !== null) {
    if (typeof max !== 'number' || !Number.isFinite(max) || max < 0) {
      throw reject('budget.max must be a non-negative finite number or null.', { value: max });
    }
  }

  // If both min and max are present, max must be >= min.
  if (
    typeof min === 'number' &&
    Number.isFinite(min) &&
    typeof max === 'number' &&
    Number.isFinite(max) &&
    max < min
  ) {
    throw reject('budget.max must be >= budget.min.', { min, max });
  }

  if (qualifier !== undefined && qualifier !== null) {
    if (!BUDGET_QUALIFIERS.includes(qualifier)) {
      throw reject(
        `budget.qualifier must be one of: ${BUDGET_QUALIFIERS.join(', ')}.`,
        { received: qualifier },
      );
    }
  }
}

/**
 * Validate a timeline override value.
 *
 * The timeline override preserves the existing structure (Rules.md §7):
 *   {
 *     raw: string,                  // original wording, e.g. "September"
 *     normalized: object|null       // opaque Mixed shape from the model
 *   }
 *
 * The operator typically only edits `raw`. The `normalized` field is
 * preserved as-is from the model (or from a prior override). We do not
 * invent dates (Rules.md §7).
 *
 * @param {unknown} value
 * @param {(msg: string, ctx?: object) => AppError} reject
 * @returns {void}
 */
function validateTimelineValue(value, reject) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reject('Field "timeline" must be an object.', { receivedType: typeof value });
  }

  const { raw, normalized } = value;

  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'string') {
      throw reject('timeline.raw must be a string.', { receivedType: typeof raw });
    }
    if (raw.length > 500) {
      throw reject('timeline.raw is too long (max 500 chars).', { length: raw.length });
    }
  }

  if (normalized !== undefined && normalized !== null) {
    if (typeof normalized !== 'object' || Array.isArray(normalized)) {
      throw reject('timeline.normalized must be an object or null.', {
        receivedType: typeof normalized,
      });
    }
  }
}

export default {
  applyHumanOverride,
  clearHumanOverride,
  validateFieldValue,
  OVERRIDEABLE_FIELDS,
};
