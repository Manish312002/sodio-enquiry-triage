/**
 * PriorityBadge — Phase 5.
 *
 * Renders the deterministic priority computed by the backend (Phase 4).
 * The frontend NEVER recomputes priority (Rules.md §9, Architechure.md §14).
 *
 * design.md §10:
 *   HIGH — strong accent marker
 *   MEDIUM — amber marker
 *   LOW — muted marker
 *
 * Detail-view variant additionally shows the numeric score and a `Why?`
 * affordance that expands to reveal the backend's reason lines.
 *
 * Queue variant is compact: just the level label + score, no expandable
 * reasons (the queue is for scanning, the detail view is for explaining).
 */
import { useState } from 'react';

const LEVEL_LABEL = {
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

/**
 * @param {object} props
 * @param {{ level: 'high'|'medium'|'low'|null, score: number|null, reasons?: string[] }} props.priority
 * @param {boolean} [props.compact=false]  Compact variant for queue rows.
 * @param {boolean} [props.showReasons=false]  Show expandable reasons list.
 */
export default function PriorityBadge({ priority, compact = false, showReasons = false }) {
  const [expanded, setExpanded] = useState(false);

  if (!priority || priority.level == null) {
    return (
      <span className="font-mono text-micro text-ink-muted tracking-widest" aria-label="priority none">
        —
      </span>
    );
  }

  const level = priority.level;
  const label = LEVEL_LABEL[level] || level.toUpperCase();

  // Visual treatment per design.md §10.
  const railClass =
    level === 'high'
      ? 'bg-accent'
      : level === 'medium'
        ? 'bg-warning'
        : 'bg-low';

  const textClass =
    level === 'high'
      ? 'text-accent'
      : level === 'medium'
        ? 'text-warning'
        : 'text-low';

  const score = typeof priority.score === 'number' ? priority.score : null;

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1.5 font-mono text-micro tracking-widest"
        aria-label={`priority ${label}${score != null ? `, score ${score}` : ''}`}
      >
        <span className={`h-2 w-2 rounded-full ${railClass}`} aria-hidden />
        <span className={textClass}>{label}</span>
        {score != null && <span className="text-ink-muted">· {score}</span>}
      </span>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${railClass}`} aria-hidden />
        <span className={`font-mono text-section tracking-widest ${textClass}`}>{label}</span>
        {score != null && (
          <span className="font-mono text-small text-ink-muted">· {score} pts</span>
        )}
        {showReasons && Array.isArray(priority.reasons) && priority.reasons.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 font-mono text-micro text-ink-muted hover:text-ink underline-offset-2 hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? 'hide why' : 'why?'}
          </button>
        )}
      </div>
      {showReasons && expanded && Array.isArray(priority.reasons) && (
        <ul className="mt-2 space-y-1 border-l-2 border-line pl-3">
          {priority.reasons.map((r, i) => (
            <li key={i} className="font-mono text-small text-ink-muted">
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
