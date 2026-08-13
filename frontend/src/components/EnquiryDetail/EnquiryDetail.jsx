/**
 * EnquiryDetail — Phase 1 minimal detail panel.
 *
 * design.md §7 specifies a split evidence layout (SOURCE | EXTRACTED). Phase 1
 * has no extracted data yet (LLM extraction is Phase 3), so the right panel
 * shows a clear "EXTRACTION PENDING" placeholder + the enquiry metadata.
 *
 * The full extracted-fields editor (with inline editing, CONFIRMED markers,
 * conflict resolution) lands in Phase 6.
 */
import { useSelector } from 'react-redux';
import OriginalMessage from '../OriginalMessage/OriginalMessage';

export default function EnquiryDetail() {
  const selected = useSelector((s) => s.enquiries.selected);
  const selectedStatus = useSelector((s) => s.enquiries.selectedStatus);
  const selectedError = useSelector((s) => s.enquiries.selectedError);

  if (selectedStatus === 'pending') {
    return (
      <section className="border border-line bg-surface p-8 text-center">
        <p className="font-mono text-micro text-ink-muted tracking-widest">LOADING…</p>
      </section>
    );
  }

  if (selectedStatus === 'failed') {
    return (
      <section className="border border-danger bg-danger-soft p-4">
        <p className="font-mono text-micro text-danger tracking-widest">
          {selectedError?.code || 'ERROR'}
        </p>
        <p className="text-body text-danger mt-1">{selectedError?.message}</p>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="border border-line bg-surface p-8 text-center">
        <p className="text-section text-ink-muted">NO ENQUIRY SELECTED</p>
        <p className="mt-2 text-body text-ink-muted">
          Paste an enquiry above, or select one from the queue.
        </p>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <OriginalMessage enquiry={selected} />

      <section className="border border-line bg-surface">
        <div className="border-b border-line px-4 py-2">
          <span className="font-mono text-micro tracking-widest text-ink-muted">EXTRACTED</span>
        </div>
        <div className="p-4">
          <p className="font-mono text-micro text-ink-muted tracking-widest">
            EXTRACTION PENDING
          </p>
          <p className="mt-2 text-body text-ink-muted">
            LLM extraction is wired in Phase 3. This enquiry&apos;s record has been
            stored with <span className="font-mono">extractionState = &quot;pending&quot;</span>.
          </p>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-small mt-6 border-t border-line pt-4">
            <dt className="text-ink-muted">id</dt>
            <dd className="break-all">{selected.id}</dd>

            <dt className="text-ink-muted">receivedAt</dt>
            <dd>{selected.receivedAt}</dd>

            <dt className="text-ink-muted">status</dt>
            <dd>{selected.status}</dd>

            <dt className="text-ink-muted">extractionState</dt>
            <dd>{selected.extractionState}</dd>

            <dt className="text-ink-muted">createdAt</dt>
            <dd className="text-ink-muted">{selected.createdAt}</dd>

            <dt className="text-ink-muted">updatedAt</dt>
            <dd className="text-ink-muted">{selected.updatedAt}</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
