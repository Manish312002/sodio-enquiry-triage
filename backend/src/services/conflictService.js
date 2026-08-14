/**
 * Conflict detection service.
 *
 * The core invariant:
 *
 *   A new model extraction MUST NEVER silently destroy an existing
 *   human override.
 *
 * When a re-extraction produces a model value that DIFFERS from an active
 * human override on the SAME field, the system must surface the conflict
 * so the operator can decide explicitly:
 *
 *   - Keep the confirmed (human) value  → override stays, model value is
 *     visible in extraction history but does NOT become effective.
 *   - Accept the new model value         → override is cleared, the new
 *     model value becomes effective, priority recalculates.
 *
 * Conflict definition (per field):
 *
 *   1. humanOverrides[field] is active (non-null — `false`, `0`, `''`
 *      all count as active per override semantics).
 *   2. The new model extraction provides a value for the same field
 *      (non-null, non-undefined).
 *   3. The new model value DIFFERS from the human override (deep-equal
 *      check for structured fields like budget/timeline).
 *
 * If any of these conditions is false, there is no conflict for that field:
 *   - No active override → no conflict possible (the new model value
 *     becomes effective automatically).
 *   - Active override but new model value is null/undefined → no conflict
 *     (the model has no opinion on this field; the override stands).
 *   - Active override and new model value is IDENTICAL to the override
 *     → no conflict (the operator and the model agree; nothing to decide).
 *
 * PURE FUNCTIONS — no I/O, no side-effects, no zod. Same input always
 * produces the same output. Designed for unit testing in isolation and
 * for sharing the same logic between backend and frontend.
 */
import { isDeepStrictEqual } from 'node:util';

import { OVERRIDEABLE_FIELDS } from './effectiveValueService.js';

// Re-export so consumers can import OVERRIDEABLE_FIELDS from either module.
// The canonical source remains effectiveValueService.js.
export { OVERRIDEABLE_FIELDS };

/**
 * @typedef {Object} FieldConflict
 * @property {string} field One of OVERRIDEABLE_FIELDS.
 * @property {unknown} humanValue The active override value.
 * @property {unknown} newModelValue The new model extraction's value.
 * @property {true} hasConflict Always true (only present for conflicts).
 */

/**
 * Detect conflicts between active human overrides and a new model extraction.
 *
 * Iterates over OVERRIDEABLE_FIELDS. For each field, checks the three
 * conflict conditions (active override, model has a value, values differ).
 * Returns the list of fields where all three conditions hold.
 *
 * @param {object|null|undefined} humanOverrides The enquiry.humanOverrides subdocument.
 * @param {object|null|undefined} newModelOutput The new model extraction's parsed output
 *   (e.g. `outcome.parsed` from extractionService, or the latest ExtractionVersion.parsedOutput).
 *   Must contain the field values keyed by OVERRIDEABLE_FIELDS names.
 * @returns {FieldConflict[]}  Conflicts, one per conflicted field. Empty array if none.
 */
export function detectConflicts(humanOverrides, newModelOutput) {
  if (!humanOverrides || typeof humanOverrides !== 'object') return [];
  if (!newModelOutput || typeof newModelOutput !== 'object') return [];

  const conflicts = [];
  for (const field of OVERRIDEABLE_FIELDS) {
    const humanValue = humanOverrides[field];
    // Condition 1: active override (non-null, non-undefined).
    // semantics: false, 0, '' are NON-NULL and count as active.
    if (humanValue === null || humanValue === undefined) continue;

    // Condition 2: new model provides a value for this field.
    // We use hasOwnProperty to distinguish "field absent" from "field is null".
    // If the model output explicitly sets the field to null, we treat that as
    // "model has no opinion" → no conflict.
    if (!(field in newModelOutput)) continue;
    const newModelValue = newModelOutput[field];
    if (newModelValue === null || newModelValue === undefined) continue;

    // Condition 3: values differ (deep-equal for structured fields).
    if (valuesEqual(humanValue, newModelValue)) continue;

    conflicts.push({
      field,
      humanValue,
      newModelValue,
      hasConflict: true,
    });
  }
  return conflicts;
}

/**
 * Check whether a specific field has a conflict between an active override
 * and a new model value.
 *
 * Convenience wrapper around detectConflicts for single-field checks.
 *
 * @param {object|null|undefined} humanOverrides
 * @param {object|null|undefined} newModelOutput
 * @param {string} field One of OVERRIDEABLE_FIELDS.
 * @returns {boolean}
 */
export function hasConflict(humanOverrides, newModelOutput, field) {
  const conflicts = detectConflicts(humanOverrides, newModelOutput);
  return conflicts.some((c) => c.field === field);
}

/**
 * Get the new model value for a specific field, if one is present.
 *
 * Returns `undefined` when the new model output does not provide a value
 * for the field (field absent, null, or undefined).
 *
 * @param {object|null|undefined} newModelOutput
 * @param {string} field
 * @returns {unknown|undefined}
 */
export function getNewModelValue(newModelOutput, field) {
  if (!newModelOutput || typeof newModelOutput !== 'object') return undefined;
  if (!(field in newModelOutput)) return undefined;
  const v = newModelOutput[field];
  if (v === null || v === undefined) return undefined;
  return v;
}

/**
 * Compare two field values for equality.
 *
 * Uses Node's `util.isDeepStrictEqual` for structured values (budget,
 * timeline objects) and strict equality for primitives. This handles:
 *   - string === string
 *   - boolean === boolean
 *   - number === number
 *   - deep-equal for objects (budget, timeline)
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function valuesEqual(a, b) {
  // Fast path for primitives.
  if (a === b) return true;
  // NaN !== NaN, but for our fields NaN never appears (validators reject it).
  // Different types are never equal.
  if (typeof a !== typeof b) return false;
  // Objects (including arrays): use deep strict equal.
  if (typeof a === 'object' && typeof b === 'object') {
    return isDeepStrictEqual(a, b);
  }
  return false;
}

export default {
  detectConflicts,
  hasConflict,
  getNewModelValue,
  OVERRIDEABLE_FIELDS,
};
