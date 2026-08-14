/**
 * EnquiryDetail —.
 *
 * "Detail View": split evidence layout.
 *   LEFT  — SOURCE:    paper-like surface with the immutable original message
 *   RIGHT — EXTRACTED: structured fields with MODEL / CONFIRMED distinction
 *
 * Plus a STATUS strip below the SOURCE panel showing the workflow state
 * track.
 *
 * States handled:
 *   - loading (fetchEnquiry pending)
 *   - error   (fetchEnquiry rejected)
 *   - no selection (initial idle state)
 *   - selected enquiry with extraction pending / processing / failed / completed
 *
 * explicitly does NOT implement:
 *   - inline field editing
 *   - human override storage
 *   - re-extraction
 *   - extraction version comparison
 *
 * Therefore no value is ever shown as CONFIRMED in this phase — all
 * rendered extracted values are labelled MODEL. The visual distinction
 * is prepared via the `MODEL` chip on each field row.
 *
 * this component now dispatches `fetchEnquiry(selectedId)`
 * when `selectedId` is set but `selected` cannot be resolved from the
 * queue `items` (e.g. restored from localStorage on a fresh page load,
 * or when the queue hasn't been fetched yet). This ensures the detail
 * panel always has a full enquiry object to render, regardless of how
 * `selectedId` was set. Redux remains the authoritative selection state;
 * this effect only triggers a fetch to populate `selected`, it does NOT
 * introduce local selection state.
 */
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import OriginalMessage from '../OriginalMessage/OriginalMessage';
import ExtractionPanel from '../ExtractionPanel/ExtractionPanel';
import StatusTrack from '../StatusTrack/StatusTrack';
import { fetchEnquiry } from '../../features/enquiries/enquiryThunks';

export default function EnquiryDetail() {
  const dispatch = useDispatch();
  const selected = useSelector((s) => s.enquiries.selected);
  const selectedId = useSelector((s) => s.enquiries.selectedId);
  const selectedStatus = useSelector((s) => s.enquiries.selectedStatus);
  const selectedError = useSelector((s) => s.enquiries.selectedError);
  const items = useSelector((s) => s.enquiries.items);

  // if selectedId is set but `selected` is null (because the
  // enquiry isn't in the queue `items`), trigger a fetchEnquiry to load
  // the full enquiry object. This handles:
  //   - localStorage restore on page load (before fetchEnquiries resolves)
  //   - direct navigation / deep link to a specific enquiry
  //   - any case where selectedId points to an enquiry not in the current
  //     filtered/sorted queue
  //
  // Guard against duplicate fetches: only dispatch when selectedStatus is
  // 'idle' (not already pending/succeeded/failed) AND the enquiry is NOT
  // in items (if it IS in items, setSelectedId already resolved it).
  useEffect(() => {
    if (!selectedId) return;
    if (selectedStatus === 'pending') return; // already fetching
    if (selected) return; // already have the enquiry
    const inItems = items.some((e) => e.id === selectedId);
    if (inItems) return; // setSelectedId will have resolved it
    // selectedId is set, selected is null, not in items, not pending → fetch.
    dispatch(fetchEnquiry(selectedId));
  }, [dispatch, selectedId, selected, selectedStatus, items]);

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
      <section className="border border-line bg-surface p-10 text-center">
        <p className="font-mono text-micro text-ink-muted/60 tracking-widest">DETAIL</p>
        <p className="mt-2 text-section text-ink-muted">NO ENQUIRY SELECTED</p>
        <p className="mt-2 text-body text-ink-muted">
          Select one from the queue on the left.
          <br />
          The original message and extracted fields will appear here.
        </p>
        <p className="mt-4 font-mono text-micro text-ink-muted/60">
          tip: use ↑ / ↓ to move through the queue without leaving the keyboard
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status strip — horizontal state track */}
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
      <div className="p-4 space-y-2.5" aria-busy="true">
        <div className="h-3 w-1/3 bg-line animate-pulse" />
        <div className="h-3 w-2/3 bg-line/70 animate-pulse" />
        <div className="h-3 w-1/2 bg-line/60 animate-pulse" />
        <div className="h-3 w-3/4 bg-line/50 animate-pulse" />
        <div className="h-3 w-2/5 bg-line/60 animate-pulse" />
      </div>
    </section>
  );
}
