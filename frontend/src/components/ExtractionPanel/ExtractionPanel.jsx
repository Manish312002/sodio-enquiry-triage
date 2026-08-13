/**
 * ExtractionPanel — Phase 5 + Phase 6 + Phase 7.
 *
 * Renders the EXTRACTED block on the right side of the detail view
 * (design.md §7). Handles all extraction states explicitly:
 *
 *   - extractionState === 'pending'    → "EXTRACTION PENDING" placeholder
 *   - extractionState === 'processing' → "EXTRACTING…" placeholder
 *   - extractionState === 'failed'     → "EXTRACTION FAILED" + retry CTA
 *                                         (Phase 7 adds a Re-extract button)
 *   - extractionState === 'completed'  → field-by-field render of the
 *                                         effectiveExtraction subdocument.
 *
 * Phase 6 — inline editing:
 *   - Each extracted field is rendered via the InlineField component,
 *     which shows a MODEL chip (when no override is active) or a
 *     CONFIRMED chip + accent left border (when an override is active).
 *   - The operator can edit any of the 8 OVERRIDEABLE_FIELDS.
 *
 * Phase 7 — re-extraction safety:
 *   - A "Re-extract" button is shown at the top of the panel. Clicking it
 *     dispatches the reExtractEnquiry thunk, which POSTs to
 *     /api/enquiries/:id/re-extract.
 *   - During re-extraction, the panel shows "EXTRACTION PROCESSING".
 *   - After a successful re-extraction, the panel shows "NEW MODEL AVAILABLE"
 *     if no conflicts, or "CONFLICT" indicators on the conflicted fields
 *     (rendered by InlineField).
 *   - If re-extraction fails, an inline error is shown but all existing
 *     data (modelExtraction, effectiveExtraction, humanOverrides, priority)
 *     is preserved — the operator can retry.
 *
 * SECURITY: original enquiry text and extracted values are all rendered
 * via React's default text escaping. No dangerouslySetInnerHTML.
 * originalText is NEVER editable through this panel (it's in the SOURCE
 * panel and is immutable per Rules.md §14).
 */
import { useDispatch, useSelector } from 'react-redux';
import PriorityBadge from '../PriorityBadge/PriorityBadge';
import InlineField from '../InlineField/InlineField';
import { reExtractEnquiry } from '../../features/enquiries/enquiryThunks';
import { clearReExtractState } from '../../features/enquiries/enquirySlice';

/**
 * @param {object} props
 * @param {object} props.enquiry  Enquiry response shape (see backend toApiResponse).
 */
export default function ExtractionPanel({ enquiry }) {
  const dispatch = useDispatch();
  const state = enquiry?.extractionState;

  // Phase 7 — re-extraction lifecycle state.
  const reExtractStatus = useSelector((s) => s.enquiries.reExtractStatus);
  const reExtractError = useSelector((s) => s.enquiries.reExtractError);
  const reExtractId = useSelector((s) => s.enquiries.reExtractId);
  const reExtractConflicts = useSelector((s) => s.enquiries.reExtractConflicts);

  const isReExtracting =
    reExtractStatus === 'pending' && reExtractId === enquiry?.id;
  const reExtractFailed =
    reExtractStatus === 'failed' && reExtractId === enquiry?.id;
  const reExtractSucceeded =
    reExtractStatus === 'succeeded' && reExtractConflicts.length > 0;

  function handleReExtract() {
    dispatch(reExtractEnquiry({ id: enquiry.id }))
      .unwrap()
      .then(() => {
        // Success — the slice stores the conflicts array. The InlineField
        // components will render the CONFLICT UI for each conflicted field.
      })
      .catch(() => {
        // Error is in Redux; the panel renders the inline error.
      });
  }

  function handleDismissReExtractError() {
    dispatch(clearReExtractState());
  }

  // --- States ---

  // Phase 7 — during re-extraction, show the processing state REGARDLESS
  // of the enquiry's extractionState (which transitions to 'processing'
  // server-side, but we want the UI to reflect the re-extract intent).
  if (isReExtracting) {
    return (
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-accent tracking-widest">
          EXTRACTION PROCESSING
        </p>
        <p className="mt-2 text-body text-ink-muted">
          Re-running LLM extraction (Grok primary → Gemini fallback). The
          original message, existing human overrides, and current priority
          are all preserved. A new extraction version will be appended to
          the history.
        </p>
      </Section>
    );
  }

  if (state === 'pending' || state === 'processing') {
    return (
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-ink-muted tracking-widest">
          {state === 'processing' ? 'EXTRACTING…' : 'EXTRACTION PENDING'}
        </p>
        <p className="mt-2 text-body text-ink-muted">
          {state === 'processing'
            ? 'The backend is currently running LLM extraction for this enquiry.'
            : 'This enquiry has not been extracted yet. Click Re-extract to run LLM extraction.'}
        </p>
        {state === 'pending' && (
          <button
            type="button"
            onClick={handleReExtract}
            className="mt-3 font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface"
          >
            [Re-extract]
          </button>
        )}
      </Section>
    );
  }

  if (state === 'failed') {
    return (
      <Section title="EXTRACTED">
        <p className="font-mono text-micro text-danger tracking-widest">EXTRACTION FAILED</p>
        <p className="mt-2 text-body text-ink-muted">
          The LLM provider did not return a valid structured extraction for
          this enquiry. The original message is preserved unchanged. You can
          retry extraction — a new version will be appended to the history.
        </p>
        {reExtractFailed && reExtractError && (
          <p className="mt-2 font-mono text-micro text-danger">
            {reExtractError.code || 'ERROR'}: {reExtractError.message}
          </p>
        )}
        <button
          type="button"
          onClick={handleReExtract}
          className="mt-3 font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface"
        >
          [Re-extract]
        </button>
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
        {/* Phase 7 — Re-extract button + status indicators */}
        <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
          <p className="font-mono text-micro text-ink-muted tracking-widest">
            Edit any field to apply a human override. Priority recalculates automatically.
          </p>
          <button
            type="button"
            onClick={handleReExtract}
            disabled={isReExtracting}
            className="font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface disabled:opacity-40 disabled:cursor-default"
            aria-label="re-run LLM extraction"
          >
            [Re-extract]
          </button>
        </div>

        {/* Phase 7 — re-extraction error (inline, dismissible) */}
        {reExtractFailed && reExtractError && (
          <div className="mb-3 border border-danger/50 bg-danger-soft/40 p-2 flex items-start justify-between gap-2">
            <p className="font-mono text-micro text-danger">
              RE-EXTRACTION FAILED: {reExtractError.code || 'ERROR'} — {reExtractError.message}
              <br />
              <span className="text-ink-muted">
                Existing extraction, overrides, and priority are preserved.
              </span>
            </p>
            <button
              type="button"
              onClick={handleDismissReExtractError}
              className="shrink-0 font-mono text-micro text-ink-muted hover:text-ink underline-offset-2 hover:underline"
            >
              [dismiss]
            </button>
          </div>
        )}

        {/* Phase 7 — NEW MODEL AVAILABLE indicator (when re-extraction
            succeeded with no conflicts, the new model values silently
            became effective for non-overridden fields) */}
        {reExtractStatus === 'succeeded' && reExtractConflicts.length === 0 && (
          <div className="mb-3 border border-success/40 bg-success-soft/30 p-2">
            <p className="font-mono text-micro text-success tracking-widest">
              NEW MODEL AVAILABLE
            </p>
            <p className="mt-1 font-mono text-micro text-ink-muted">
              Re-extraction succeeded. Non-overridden fields now reflect the
              new model values. No conflicts detected — your confirmed
              overrides (if any) were preserved.
            </p>
          </div>
        )}

        {/* Phase 7 — conflict summary (when re-extraction succeeded with conflicts) */}
        {reExtractSucceeded && (
          <div className="mb-3 border border-warning/60 bg-warning-soft/40 p-2">
            <p className="font-mono text-micro text-warning tracking-widest">
              CONFLICT — {reExtractConflicts.length} FIELD{reExtractConflicts.length === 1 ? '' : 'S'}
            </p>
            <p className="mt-1 font-mono text-micro text-ink-muted">
              Re-extraction produced new model values that differ from your
              confirmed overrides below. Review each conflict and decide
              explicitly: [Keep confirmed] or [Accept new model]. The system
              does NOT auto-accept new model values.
            </p>
          </div>
        )}

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
            Recalculated automatically after each human edit or re-extraction.
            Not directly editable.
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
