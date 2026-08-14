/**
 * Effective-value resolver —.
 *
 *
 * ("Human Correction Rules"), ("Re-Extraction Rules").
 *
 * The core data relationship:
 *
 *   SOURCE (original message)
 *     ↓
 *   MODEL EXTRACTION (LLM output, stored in `modelExtraction`)
 *     ↓
 *   HUMAN CORRECTION (operator override, stored in `humanOverrides`)
 *     ↓
 *   EFFECTIVE VALUE (merged result, stored in `effectiveExtraction`)
 *     ↓
 *   DETERMINISTIC PRIORITY (computed by scoringService from effectiveExtraction)
 *
 * Override semantics:
 *   humanOverrides[field] === null  → no active override (use modelExtraction)
 *   humanOverrides[field] !== null → active override (use this value)
 *
 * `false`, `0`, and `''` are NON-NULL and therefore count as active overrides.
 * This lets the operator explicitly:
 *   - mark `isGenuineProjectEnquiry = false` (instead of model's `true`)
 *   - clear `company = ''` (instead of model's hallucinated name)
 *   - set `budget.min = 0` (instead of model's exaggerated number)
 *
 * Without this rule, the operator could not distinguish "I want this field
 * to be empty/false/zero" from "I haven't touched this field".
 *
 * PURE FUNCTIONS — no I/O, no side-effects, no zod. Same input always
 * produces the same output. Designed for unit testing in isolation.
 */

/**
 * The explicit allowlist of fields the operator may override.
 *
 *: "Human overrides are explicit." Only these field names are
 * accepted by the PATCH /api/enquiries/:id/fields/:field endpoint. Any
 * other field name (including `priority`, `originalText`, `receivedAt`,
 * `status`, `extractionState`, `batchId`) is rejected with 400.
 *
 * `priority` is intentionally NOT here — the operator cannot directly set
 * priority; it is always derived from the effective extraction by the
 * deterministic scoring service.
 *
 * `originalText` is intentionally NOT here — the original enquiry text is
 * immutable.
 *
 * `isGenuineProjectEnquiry` is here even though it is a top-level enquiry
 * field (not nested under effectiveExtraction) because the LLM extraction
 * produces it and the operator may legitimately want to correct the model's
 * judgement (e.g. model marked a borderline enquiry as `false` but the
 * operator knows it's a real project).
 */
export const OVERRIDEABLE_FIELDS = Object.freeze([
  'company',
  'contactName',
  'contactEmail',
  'serviceLine',
  'budget',
  'timeline',
  'summary',
  'isGenuineProjectEnquiry',
]);

/**
 * Service-line enum. Must match Enquiry.effectiveExtraction.serviceLine.
 */
export const SERVICE_LINES = Object.freeze([
  'ai',
  'blockchain',
  'web',
  'mobile',
  'game',
  'other',
]);

/**
 * Budget qualifier enum. Must match Enquiry.effectiveExtraction.budget.qualifier.
 */
export const BUDGET_QUALIFIERS = Object.freeze([
  'exact',
  'range',
  'flexible',
  'tbd',
  'unknown',
]);

/**
 * Check whether a field name is in the override allowlist.
 *
 * @param {string} field
 * @returns {boolean}
 */
export function isOverrideableField(field) {
  return OVERRIDEABLE_FIELDS.includes(field);
}

/**
 * Check whether a humanOverrides object has ANY active (non-null) override.
 *
 * Used by extractionService on re-extraction to decide whether to re-merge
 * overrides into the freshly-written effectiveExtraction.
 *
 * @param {object|null|undefined} humanOverrides
 * @returns {boolean}
 */
export function hasAnyOverride(humanOverrides) {
  if (!humanOverrides || typeof humanOverrides !== 'object') return false;
  for (const field of OVERRIDEABLE_FIELDS) {
    if (humanOverrides[field] !== null && humanOverrides[field] !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * Get the source-of-truth model value for a single field.
 *
 * Falls back to effectiveExtraction when modelExtraction is null (this
 * happens for enquiries created — wrote model
 * output directly into effectiveExtraction, so the two are equivalent).
 *
 * @param {object} enquiry Enquiry document (or response shape).
 * @param {string} field One of OVERRIDEABLE_FIELDS.
 * @returns {unknown}  The model value (or undefined if neither source has it).
 */
export function getModelValue(enquiry, field) {
  if (!enquiry) return undefined;
  if (field === 'isGenuineProjectEnquiry') {
    // isGenuineProjectEnquiry is a top-level field, not under effectiveExtraction.
    // On older records, it lives directly on the enquiry. On
    // records, it's still top-level (we don't duplicate it into modelExtraction).
    return enquiry.isGenuineProjectEnquiry ?? null;
  }
  const modelSrc =
    enquiry.modelExtraction && typeof enquiry.modelExtraction === 'object'
      ? enquiry.modelExtraction
      : enquiry.effectiveExtraction && typeof enquiry.effectiveExtraction === 'object'
        ? enquiry.effectiveExtraction
        : null;
  if (!modelSrc) return undefined;
  return modelSrc[field];
}

/**
 * Get the active override value for a single field.
 *
 * Returns `undefined` when there is no active override. Returns the override
 * value (which may be `false`, `0`, `''`, or any other non-null value) when
 * an override is active.
 *
 * @param {object|null|undefined} humanOverrides
 * @param {string} field
 * @returns {unknown|undefined}  The override value, or undefined if no override.
 */
export function getOverrideValue(humanOverrides, field) {
  if (!humanOverrides || typeof humanOverrides !== 'object') return undefined;
  const v = humanOverrides[field];
  if (v === null || v === undefined) return undefined;
  return v;
}

/**
 * Resolve the effective value for a single field.
 *
 *   if humanOverrides[field] is non-null  → use override value
 *   else                                  → use model value
 *
 * @param {object} enquiry
 * @param {string} field
 * @returns {{value: unknown, source: 'override'|'model'}}
 */
export function resolveEffectiveValue(enquiry, field) {
  const override = getOverrideValue(enquiry?.humanOverrides, field);
  if (override !== undefined) {
    return { value: override, source: 'override' };
  }
  return { value: getModelValue(enquiry, field), source: 'model' };
}

/**
 * Recompute the entire effectiveExtraction subdocument by merging
 * modelExtraction + humanOverrides.
 *
 * Used by:
 *   - humanOverrideService after applying/clearing an override
 *   - extractionService after a re-extraction (to re-apply existing overrides
 *     onto the fresh model output)
 *
 * Note: `isGenuineProjectEnquiry` is a TOP-LEVEL enquiry field, not nested
 * under effectiveExtraction. This function returns the merged extraction
 * subdocument only; the caller is responsible for setting
 * `enquiry.isGenuineProjectEnquiry` separately if the override is active.
 *
 * @param {object} enquiry Enquiry document with `modelExtraction`,
 *   `effectiveExtraction`, and `humanOverrides` populated.
 * @returns {object}  A fresh plain object representing the merged
 *   effectiveExtraction. The caller assigns this to `enquiry.effectiveExtraction`.
 */
export function computeEffectiveExtraction(enquiry) {
  if (!enquiry) {
    return {};
  }

  // Model source: prefer modelExtraction (), fall back to
  // effectiveExtraction (older records where modelExtraction is null).
  const modelSrc =
    enquiry.modelExtraction && typeof enquiry.modelExtraction === 'object'
      ? enquiry.modelExtraction
      : enquiry.effectiveExtraction && typeof enquiry.effectiveExtraction === 'object'
        ? enquiry.effectiveExtraction
        : {};

  const overrides =
    enquiry.humanOverrides && typeof enquiry.humanOverrides === 'object'
      ? enquiry.humanOverrides
      : {};

  // For each extraction sub-field, pick override if active, else model.
  // We deliberately do NOT touch projectCount or additionalProjectNote —
  // those are model-only signals (boundary: the operator does not
  // edit them through the field-edit endpoint).
  const eff = {
    company: pickOverride(overrides.company, modelSrc.company),
    contactName: pickOverride(overrides.contactName, modelSrc.contactName),
    contactEmail: pickOverride(overrides.contactEmail, modelSrc.contactEmail),
    serviceLine: pickOverride(overrides.serviceLine, modelSrc.serviceLine ?? 'other'),
    budget: pickOverride(overrides.budget, modelSrc.budget ?? { raw: '', qualifier: 'unknown' }),
    timeline: pickOverride(overrides.timeline, modelSrc.timeline ?? { raw: '' }),
    summary: pickOverride(overrides.summary, modelSrc.summary ?? ''),
    projectCount: modelSrc.projectCount ?? 1,
    additionalProjectNote: modelSrc.additionalProjectNote ?? null,
  };

  return eff;
}

/**
 * Re-apply existing human overrides onto a Mongoose enquiry document.
 *
 * This mutates `enquiry.effectiveExtraction` in place by replacing it with
 * the merged result. It does NOT call `enquiry.save()`. The caller is
 * responsible for saving.
 *
 * Used by extractionService after a successful re-extraction to ensure
 * effectiveExtraction reflects the operator's prior overrides rather than
 * the fresh model output.
 *
 * @param {import('../models/Enquiry.js').default} enquiry
 * @returns {void}
 */
export function reapplyOverrides(enquiry) {
  if (!enquiry) return;
  enquiry.effectiveExtraction = computeEffectiveExtraction(enquiry);

  // isGenuineProjectEnquiry is a top-level field; honour the override if active.
  const genuineOverride = enquiry.humanOverrides?.isGenuineProjectEnquiry;
  if (genuineOverride !== null && genuineOverride !== undefined) {
    enquiry.isGenuineProjectEnquiry = genuineOverride;
  }

  // Mongoose needs to be told that the Mixed humanOverrides subdoc may have
  // changed indirectly. Mark effectiveExtraction + isGenuineProjectEnquiry
  // as modified to be safe.
  enquiry.markModified('effectiveExtraction');
  enquiry.markModified('isGenuineProjectEnquiry');
}

/**
 * Internal: pick the override value if active, else fall back to the model
 * value. Treats `null` and `undefined` as "no override".
 *
 * @param {unknown} override
 * @param {unknown} modelValue
 * @returns {unknown}
 */
function pickOverride(override, modelValue) {
  if (override === null || override === undefined) return modelValue;
  return override;
}

export default {
  OVERRIDEABLE_FIELDS,
  SERVICE_LINES,
  BUDGET_QUALIFIERS,
  isOverrideableField,
  hasAnyOverride,
  getModelValue,
  getOverrideValue,
  resolveEffectiveValue,
  computeEffectiveExtraction,
  reapplyOverrides,
};
