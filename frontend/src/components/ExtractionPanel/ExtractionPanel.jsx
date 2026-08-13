/**
 * ExtractionPanel — Phase 5.
 *
 * Renders the EXTRACTED block on the right side of the detail view
 * (design.md §7). Handles all extraction states explicitly:
 *
 *   - extractionState === 'pending'    → "EXTRACTION PENDING" placeholder
 *   - extractionState === 'processing' → "EXTRACTING…" placeholder
 *   - extractionState === 'failed'     → "EXTRACTION FAILED" + retry CTA
 *                                         (Phase 7 owns re-extract; we
 *                                          just surface the failure here)
 *   - extractionState === 'completed'  → field-by-field render of the
 *                                         effectiveExtraction subdocument.
 *
 * Each field is labelled MODEL when there is no human override for it
 * (Phase 6 owns overrides). We do not display CONFIRMED for any value
 * in Phase 5 because no human-confirmation flow exists yet — the
 * operator's instructions explicitly forbid falsely labelling model
 * values as "confirmed".
 *
 * SECURITY: original enquiry text and extracted values are all rendered
 * via React's default text escaping. No dangerouslySetInnerHTML.
 */
import PriorityBadge from '../PriorityBadge/PriorityBadge';
import {
  formatServiceLine,
  formatBudgetDetail,
  formatTimelineShort,
  formatGenuine,
} from '../../features/enquiries/format';

/**
 * @param {object} props
 * @param {object} props.enquiry  Enquiry response shape (see backend toApiResponse).
 */
export default function ExtractionPanel({ enquiry }) {
  const state = enquiry?.extractionState;

  if (state === 'pending' || state === 'processing') {
    return (
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-ink-muted tracking-widest">
          {state === 'processing' ? 'EXTRACTING…' : 'EXTRACTION PENDING'}
        </p>
        <p className="mt-2 text-body text-ink-muted">
          {state === 'processing'
            ? 'The backend is currently running LLM extraction for this enquiry.'
            : 'This enquiry has not been extracted yet. Use POST /api/enquiries/:id/extract from the backend or import + batch-extract to populate structured fields.'}
        </p>
      </Section>
    );
  }

  if (state === 'failed') {
    return (
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-danger tracking-widest">EXTRACTION FAILED</p>
        <p className="mt-2 text-body text-ink-muted">
          The LLM provider did not return a valid structured extraction for
          this enquiry. The original message is preserved unchanged. Phase 7
          will add a re-extract action; for now the operator can re-trigger
          via the backend API.
        </p>
      </Section>
    );
  }

  if (state !== 'completed' || !enquiry?.effectiveExtraction) {
    return (
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-ink-muted tracking-widest">
          EXTRACTION UNKNOWN
        </p>
        <p className="mt-2 text-body text-ink-muted">
          The enquiry has an unrecognised extraction state. The original
          message remains the source of truth.
        </p>
      </Section>
    );
  }

  const e = enquiry.effectiveExtraction;

  return (
    <div className="space-y-4">
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-ink-muted tracking-widest mb-3">MODEL</p>
        <dl className="space-y-2.5">
          <FieldRow label="COMPANY" value={e.company} />
          <FieldRow label="CONTACT" value={e.contactName} />
          <FieldRow label="EMAIL" value={e.contactEmail} mono />
          <FieldRow label="SERVICE" value={formatServiceLine(e.serviceLine)} />
          <FieldRow label="BUDGET" value={formatBudgetDetail(e.budget)} />
          <FieldRow label="TIMELINE" value={formatTimelineShort(e.timeline) || '—'} />
          <FieldRow label="SUMMARY" value={e.summary} block />
          <FieldRow
            label="GENUINE PROJECT ENQUIRY"
            value={formatGenuine(enquiry.isGenuineProjectEnquiry)}
          />
          {e.projectCount != null && e.projectCount > 1 && (
            <FieldRow label="PROJECT COUNT" value={String(e.projectCount)} />
          )}
          {e.additionalProjectNote && (
            <FieldRow label="ADDITIONAL PROJECT NOTE" value={e.additionalProjectNote} block />
          )}
        </dl>
      </Section>

      {enquiry.priority && enquiry.priority.level != null && (
        <Section title="PRIORITY">
          <PriorityBadge priority={enquiry.priority} showReasons />
          <p className="mt-2 font-mono text-micro text-ink-muted">
            Computed deterministically by the backend (Phase 4). Not editable from the UI.
          </p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="border border-line bg-surface">
      <div className="border-b border-line px-4 py-2">
        <span className="font-mono text-micro tracking-widest text-ink-muted">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FieldRow({ label, value, mono = false, block = false }) {
  const display =
    value == null || (typeof value === 'string' && value.trim() === '')
      ? '—'
      : value;
  return (
    <div className={block ? 'block' : 'flex items-baseline gap-4'}>
      <dt
        className={`font-mono text-micro tracking-widest text-ink-muted ${
          block ? 'mb-1' : 'w-44 shrink-0'
        }`}
      >
        {label}
      </dt>
      <dd
        className={`text-body text-ink ${
          mono ? 'font-mono text-small break-all' : ''
        } ${display === '—' ? 'text-ink-muted/60' : ''}`}
      >
        {display}
      </dd>
    </div>
  );
}
