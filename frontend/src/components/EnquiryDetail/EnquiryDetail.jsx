/**
 * EnquiryDetail — Phase 5.
 *
 * design.md §7 "Detail View": split evidence layout.
 *   LEFT  — SOURCE:    paper-like surface with the immutable original message
 *   RIGHT — EXTRACTED: structured fields with MODEL / CONFIRMED distinction
 *
 * Plus a STATUS strip below the SOURCE panel showing the workflow state
 * track (design.md §9).
 *
 * States handled:
 *   - loading (fetchEnquiry pending)
 *   - error   (fetchEnquiry rejected)
 *   - no selection (initial idle state)
 *   - selected enquiry with extraction pending / processing / failed / completed
 *
 * Phase 5 explicitly does NOT implement:
 *   - inline field editing (Phase 6)
 *   - human override storage (Phase 6)
 *   - re-extraction (Phase 7)
 *   - extraction version comparison (Phase 7)
 *
 * Therefore no value is ever shown as CONFIRMED in this phase — all
 * rendered extracted values are labelled MODEL. The visual distinction
 * is prepared for Phase 6 via the `MODEL` chip on each field row.
 */
import { useSelector } from 'react-redux';
import OriginalMessage from '../OriginalMessage/OriginalMessage';
import ExtractionPanel from '../ExtractionPanel/ExtractionPanel';
import StatusTrack from '../StatusTrack/StatusTrack';

export default function EnquiryDetail() {
  const selected = useSelector((s) => s.enquiries.selected);
  const selectedStatus = useSelector((s) => s.enquiries.selectedStatus);
  const selectedError = useSelector((s) => s.enquiries.selectedError);

  if (selectedStatus === 'pending') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonPanel label="SOURCE" />
        <SkeletonPanel label="EXTRACTED" />
      </div>
    );
  }

  if (selectedStatus === 'failed') {
    return (
      <section className="border border-danger bg-danger-soft p-4">
        <p className="font-mono text-micro text-danger tracking-widest">
          {selectedError?.code || 'ERROR'}
        </p>
        <p className="text-body text-danger mt-1">{selectedError?.message}</p>
        <p className="mt-2 font-mono text-micro text-ink-muted">
          The enquiry may have been deleted, or the request failed. Select
          another enquiry from the queue.
        </p>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="border border-line bg-surface p-8 text-center">
        <p className="text-section text-ink-muted">NO ENQUIRY SELECTED</p>
        <p className="mt-2 text-body text-ink-muted">
          Select one from the queue on the left.
          <br />
          The original message and extracted fields will appear here.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status strip — design.md §9 horizontal state track */}
      <section className="border border-line bg-surface">
        <div className="border-b border-line px-4 py-2 flex items-center justify-between">
          <span className="font-mono text-micro tracking-widest text-ink-muted">STATUS</span>
          <span className="font-mono text-micro text-ink-muted">
            id {selected.id?.slice(-8)}
          </span>
        </div>
        <div className="px-4 py-3">
          <StatusTrack enquiryId={selected.id} currentStatus={selected.status} />
        </div>
      </section>

      {/* Split evidence: SOURCE | EXTRACTED */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OriginalMessage enquiry={selected} />
        <ExtractionPanel enquiry={selected} />
      </div>
    </div>
  );
}

function SkeletonPanel({ label }) {
  return (
    <section className="border border-line bg-surface">
      <div className="border-b border-line px-4 py-2">
        <span className="font-mono text-micro tracking-widest text-ink-muted">{label}</span>
      </div>
      <div className="p-4 space-y-2">
        <div className="h-3 w-1/3 bg-line animate-pulse" />
        <div className="h-3 w-2/3 bg-line/70 animate-pulse" />
        <div className="h-3 w-1/2 bg-line/60 animate-pulse" />
      </div>
    </section>
  );
}
