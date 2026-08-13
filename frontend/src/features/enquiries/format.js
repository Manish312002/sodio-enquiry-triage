/**
 * Pure formatting helpers for the Phase 5 console.
 *
 * Extracted from the React components so the formatting logic can be
 * unit-tested without a DOM library. The frontend does not have vitest
 * or @testing-library installed (Phase 3-4 deliberately added zero new
 * test deps); these helpers are exercised with Node's built-in test
 * runner against the same enquiry response shape the backend returns.
 *
 * CRITICAL: nothing here recomputes priority (Rules.md §9). These are
 * pure display formatters only.
 */

/**
 * Format a budget subdocument into a short string for queue rows.
 * Returns null when there is no usable signal (so the row can hide it).
 *
 * @param {{ raw?: string, currency?: string|null, min?: number|null, max?: number|null, qualifier?: string|null }|null|undefined} b
 * @returns {string|null}
 */
export function formatBudgetShort(b) {
  if (!b) return null;
  if (b.raw && String(b.raw).trim()) return b.raw;
  if (b.min != null || b.max != null) {
    if (b.min != null && b.max != null && b.min !== b.max) {
      return `${b.min}–${b.max}${b.currency ? ' ' + b.currency : ''}`;
    }
    const v = b.max != null ? b.max : b.min;
    return `${v}${b.currency ? ' ' + b.currency : ''}`;
  }
  if (b.qualifier && b.qualifier !== 'unknown') return b.qualifier.toUpperCase();
  return null;
}

/**
 * Format a timeline subdocument into a short string for queue rows.
 * Returns null when no raw phrase is available.
 *
 * @param {{ raw?: string }|null|undefined} t
 * @returns {string|null}
 */
export function formatTimelineShort(t) {
  if (!t || !t.raw || !String(t.raw).trim()) return null;
  return t.raw;
}

/**
 * Format a service line enum value for display.
 *
 * @param {string|null|undefined} sl
 * @returns {string}  Uppercased label, or '—' if missing.
 */
export function formatServiceLine(sl) {
  if (!sl) return '—';
  return sl.toUpperCase();
}

/**
 * Format the genuine-project-enquiry flag for display.
 *
 * @param {boolean|null|undefined} v
 * @returns {'YES'|'NO'|'UNKNOWN'}
 */
export function formatGenuine(v) {
  if (v === true) return 'YES';
  if (v === false) return 'NO';
  return 'UNKNOWN';
}

/**
 * Format a budget subdocument into the richer detail-view representation.
 * Includes raw, parsed numeric, and qualifier when available.
 *
 * @param {{ raw?: string, currency?: string|null, min?: number|null, max?: number|null, qualifier?: string|null }|null|undefined} b
 * @returns {string}
 */
export function formatBudgetDetail(b) {
  if (!b) return '—';
  const parts = [];
  if (b.raw) parts.push(b.raw);
  const num = formatBudgetNumber(b);
  if (num) parts.push(`(${num})`);
  if (b.qualifier && b.qualifier !== 'unknown') parts.push(`[${b.qualifier}]`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

function formatBudgetNumber(b) {
  if (b.min == null && b.max == null) return null;
  if (b.min != null && b.max != null && b.min !== b.max) {
    return `${formatNumber(b.min)} – ${formatNumber(b.max)} ${b.currency || ''}`.trim();
  }
  const v = b.max != null ? b.max : b.min;
  return `${formatNumber(v)} ${b.currency || ''}`.trim();
}

function formatNumber(n) {
  if (n == null) return '';
  return Number(n).toLocaleString();
}

/**
 * Format a receivedAt timestamp for the queue row (compact).
 *
 * @param {string|Date|null|undefined} receivedAt
 * @returns {string}
 */
export function formatReceivedShort(receivedAt) {
  if (!receivedAt) return '—';
  const d = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Compute the priority rail color class for a given priority level.
 * Mirrors the logic in EnquiryQueue.jsx so tests can verify the mapping
 * without rendering React.
 *
 * @param {'high'|'medium'|'low'|null|undefined} level
 * @returns {string}  Tailwind background class.
 */
export function priorityRailClass(level) {
  if (level === 'high') return 'bg-accent';
  if (level === 'medium') return 'bg-warning';
  if (level === 'low') return 'bg-low';
  return 'bg-transparent';
}

/**
 * Selector: should the queue show the "NO MATCHES" empty state vs the
 * "NO SIGNAL YET" empty state? Determined by whether any filter is active.
 *
 * @param {{ serviceLine: string, priority: string, status: string }} filters
 * @returns {boolean}
 */
export function hasActiveFilter(filters) {
  if (!filters) return false;
  return (
    filters.serviceLine !== 'all' ||
    filters.priority !== 'all' ||
    filters.status !== 'all'
  );
}

/**
 * Extraction-state label for queue rows.
 *
 * @param {string|null|undefined} extractionState
 * @returns {string|null}  'PENDING' | 'EXTRACTING' | 'FAILED' | null
 */
export function extractionStateLabel(extractionState) {
  if (extractionState === 'pending') return 'PENDING';
  if (extractionState === 'processing') return 'EXTRACTING';
  if (extractionState === 'failed') return 'FAILED';
  return null;
}

// --- Phase 6 — human override helpers -------------------------------------

/**
 * The list of fields the operator can override through the
 * PATCH /api/enquiries/:id/fields/:field endpoint. Mirrors the backend's
 * OVERRIDEABLE_FIELDS allowlist. The frontend uses this for iteration and
 * validation — it does NOT enforce security (the backend is the source of
 * truth for the allowlist).
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
 * Check whether a field on an enquiry has an active (non-null) human override.
 *
 * Phase 6 override semantics:
 *   humanOverrides[field] === null  → no active override (use model value)
 *   humanOverrides[field] !== null → active override (false, 0, '' all count)
 *
 * The UI uses this to decide whether to label a field MODEL or CONFIRMED.
 *
 * @param {object|null|undefined} humanOverrides
 * @param {string} field
 * @returns {boolean}
 */
export function hasOverride(humanOverrides, field) {
  if (!humanOverrides || typeof humanOverrides !== 'object') return false;
  const v = humanOverrides[field];
  return v !== null && v !== undefined;
}

/**
 * Get the model value for a field. Falls back to effectiveExtraction when
 * modelExtraction is null (pre-Phase-6 records). For isGenuineProjectEnquiry,
 * reads the top-level enquiry field (it is not nested under modelExtraction).
 *
 * Mirrors the backend effectiveValueService.getModelValue logic so the UI
 * can show "MODEL value" alongside "CONFIRMED value" without an extra
 * round-trip.
 *
 * @param {object} enquiry
 * @param {string} field
 * @returns {unknown}
 */
export function getModelValue(enquiry, field) {
  if (!enquiry) return undefined;
  if (field === 'isGenuineProjectEnquiry') {
    // For isGenuineProjectEnquiry, the "model value" is the top-level field
    // WHEN no override is active. If an override is active, the top-level
    // field already reflects the override (the backend syncs them). So to
    // get the true model value, we'd need to look at the latest successful
    // ExtractionVersion. For Phase 6, we fall back to the top-level value
    // and let the UI label it MODEL only when no override is active.
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
 * Get the effective (displayed) value for a field — i.e. the merged value
 * the backend stores in effectiveExtraction (or the top-level
 * isGenuineProjectEnquiry).
 *
 * This is what the operator sees in the detail panel. The MODEL value (from
 * getModelValue) is shown alongside when an override is active, so the
 * operator can compare "MODEL said X / CONFIRMED is Y".
 *
 * @param {object} enquiry
 * @param {string} field
 * @returns {unknown}
 */
export function getEffectiveValue(enquiry, field) {
  if (!enquiry) return undefined;
  if (field === 'isGenuineProjectEnquiry') {
    return enquiry.isGenuineProjectEnquiry ?? null;
  }
  const eff = enquiry.effectiveExtraction;
  if (!eff || typeof eff !== 'object') return undefined;
  return eff[field];
}

/**
 * Render a value for display in the detail panel. Handles strings, booleans,
 * numbers, null/undefined, and the budget/timeline subdocument shapes.
 *
 * Used by InlineField to show the current effective value when not editing.
 *
 * @param {unknown} value
 * @param {string} field  Field name — used to pick the right formatter.
 * @returns {string}
 */
export function formatFieldValue(value, field) {
  // isGenuineProjectEnquiry has a meaningful "UNKNOWN" state (null/undefined)
  // that we want to display, not '—'. formatGenuine(null) → 'UNKNOWN'.
  if (field === 'isGenuineProjectEnquiry') return formatGenuine(value);
  if (value === null || value === undefined) return '—';
  if (field === 'serviceLine') return formatServiceLine(value);
  if (field === 'budget') return formatBudgetDetail(value);
  if (field === 'timeline') return formatTimelineShort(value) || '—';
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (typeof value === 'string') return value.length === 0 ? '(empty)' : value;
  if (typeof value === 'number') return String(value);
  return String(value);
}

// --- Phase 7 — re-extraction conflict helpers ---------------------------------

/**
 * Phase 7 — detect conflicts between active human overrides and a new model
 * extraction.
 *
 * Mirrors the backend `conflictService.detectConflicts` logic so the
 * frontend can render the conflict UI consistently. The backend remains
 * the source of truth (it returns the conflicts array in the re-extract
 * response), but the frontend can recompute conflicts locally when needed
 * (e.g. after an accept-model action, to verify the conflict is gone).
 *
 * A conflict exists for a field when ALL three conditions hold:
 *   1. humanOverrides[field] is active (non-null — false, 0, '' count).
 *   2. newModelOutput[field] is present and non-null.
 *   3. The two values differ (deep-equal for structured fields).
 *
 * @param {object|null|undefined} humanOverrides
 * @param {object|null|undefined} newModelOutput  The new model extraction's
 *   parsed output (e.g. `outcome.parsed` from the re-extract response, or
 *   `enquiry.modelExtraction` for the latest model snapshot).
 * @returns {Array<{field: string, humanValue: unknown, newModelValue: unknown, hasConflict: true}>}
 */
export function detectConflicts(humanOverrides, newModelOutput) {
  if (!humanOverrides || typeof humanOverrides !== 'object') return [];
  if (!newModelOutput || typeof newModelOutput !== 'object') return [];

  const conflicts = [];
  for (const field of OVERRIDEABLE_FIELDS) {
    const humanValue = humanOverrides[field];
    if (humanValue === null || humanValue === undefined) continue;
    if (!(field in newModelOutput)) continue;
    const newModelValue = newModelOutput[field];
    if (newModelValue === null || newModelValue === undefined) continue;
    if (valuesEqual(humanValue, newModelValue)) continue;
    conflicts.push({ field, humanValue, newModelValue, hasConflict: true });
  }
  return conflicts;
}

/**
 * Phase 7 — check whether a specific field has a conflict.
 *
 * Convenience wrapper around detectConflicts for single-field checks.
 * Used by InlineField to decide whether to render the CONFLICT UI.
 *
 * @param {object|null|undefined} humanOverrides
 * @param {object|null|undefined} newModelOutput
 * @param {string} field
 * @returns {boolean}
 */
export function hasConflict(humanOverrides, newModelOutput, field) {
  return detectConflicts(humanOverrides, newModelOutput).some((c) => c.field === field);
}

/**
 * Phase 7 — get the new model value for a specific field.
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
 * Internal: compare two field values for equality.
 * Uses JSON serialisation with sorted keys for deep equality on objects.
 * This mirrors the backend's `util.isDeepStrictEqual` semantics closely
 * enough for the conflict detection use case (the values are all
 * JSON-serialisable — strings, booleans, numbers, plain objects, arrays).
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function valuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  }
  return false;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = sortKeys(value[k]);
    }
    return sorted;
  }
  return value;
}
