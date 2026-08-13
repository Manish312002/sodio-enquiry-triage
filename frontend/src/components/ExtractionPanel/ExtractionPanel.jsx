/**
 * ExtractionPanel — Phase 5 + Phase 6.
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
 * Phase 6 — inline editing:
 *   - Each extracted field is rendered via the InlineField component,
 *     which shows a MODEL chip (when no override is active) or a
 *     CONFIRMED chip + accent left border (when an override is active).
 *   - The operator can edit any of the 8 OVERRIDEABLE_FIELDS:
 *       company, contactName, contactEmail, serviceLine,
 *       budget, timeline, summary, isGenuineProjectEnquiry
 *   - Editing dispatches updateEnquiryField, which PATCHes
 *     /api/enquiries/:id/fields/:field. The backend recomputes the
 *     effective value and recalculates priority; the returned enquiry
 *     replaces the selected enquiry in Redux.
 *   - Clearing an override dispatches clearEnquiryFieldOverride, which
 *     PATCHes the same endpoint with value=null. The effective value
 *     falls back to the model extraction.
 *   - The PRIORITY block below the fields re-renders automatically when
 *     the enquiry's priority changes (it reads from enquiry.priority,
 *     which is updated by the slice on fulfilled).
 *
 * SECURITY: original enquiry text and extracted values are all rendered
 * via React's default text escaping. No dangerouslySetInnerHTML.
 * originalText is NEVER editable through this panel (it's in the SOURCE
 * panel and is immutable per Rules.md §14).
 */
import PriorityBadge from '../PriorityBadge/PriorityBadge';
import InlineField from '../InlineField/InlineField';

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

  // extractionState === 'completed' — render the inline-editable fields.
  return (
    <div className="space-y-4">
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-ink-muted tracking-widest mb-3">
          Edit any field to apply a human override. Priority recalculates automatically.
        </p>
        <dl className="space-y-2.5">
          <InlineField enquiry={enquiry} field="company" label="COMPANY" />
          <InlineField enquiry={enquiry} field="contactName" label="CONTACT" />
          <InlineField enquiry={enquiry} field="contactEmail" label="EMAIL" mono />
          <InlineField enquiry={enquiry} field="serviceLine" label="SERVICE" />
          <InlineField enquiry={enquiry} field="budget" label="BUDGET" />
          <InlineField enquiry={enquiry} field="timeline" label="TIMELINE" />
          <InlineField enquiry={enquiry} field="summary" label="SUMMARY" block />
          <InlineField enquiry={enquiry} field="isGenuineProjectEnquiry" label="GENUINE PROJECT ENQUIRY" />
        </dl>

        {/* projectCount + additionalProjectNote are NOT overrideable (Phase 6 boundary).
            They remain model-only display fields. */}
        {enquiry.effectiveExtraction.projectCount != null &&
          enquiry.effectiveExtraction.projectCount > 1 && (
            <div className="mt-3 pt-3 border-t border-line">
              <p className="font-mono text-micro text-ink-muted">
                PROJECT COUNT: {enquiry.effectiveExtraction.projectCount} (model-only, not editable)
              </p>
            </div>
          )}
        {enquiry.effectiveExtraction.additionalProjectNote && (
          <div className="mt-2">
            <p className="font-mono text-micro text-ink-muted">
              ADDITIONAL PROJECT NOTE:
            </p>
            <p className="text-body text-ink mt-1">
              {enquiry.effectiveExtraction.additionalProjectNote}
            </p>
          </div>
        )}
      </Section>

      {enquiry.priority && enquiry.priority.level != null && (
        <Section title="PRIORITY">
          <PriorityBadge priority={enquiry.priority} showReasons />
          <p className="mt-2 font-mono text-micro text-ink-muted">
            Computed deterministically by the backend from the effective extraction.
            Recalculated automatically after each human edit. Not directly editable.
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
