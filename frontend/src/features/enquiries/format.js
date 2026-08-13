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
