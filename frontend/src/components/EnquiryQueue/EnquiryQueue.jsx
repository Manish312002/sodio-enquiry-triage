/**
 * EnquiryQueue — Phase 1 minimal list.
 *
 * design.md §6 "Enquiry Row": compact operational record, not a card.
 * Phase 1 shows received time, contact, source, status, and a one-line
 * preview of the original text. Phase 5 will replace this with the full
 * filterable/sortable queue.
 */
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchEnquiries } from '../../features/enquiries/enquiryThunks';
import { setSelectedId } from '../../features/enquiries/enquirySlice';

export default function EnquiryQueue() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.enquiries.items);
  const listStatus = useSelector((s) => s.enquiries.listStatus);
  const listError = useSelector((s) => s.enquiries.listError);
  const selectedId = useSelector((s) => s.enquiries.selectedId);

  // Load the most recent enquiries once on mount.
  useEffect(() => {
    if (listStatus === 'idle') {
      dispatch(fetchEnquiries({ limit: 50 }));
    }
  }, [dispatch, listStatus]);

  if (listStatus === 'pending' && items.length === 0) {
    return (
      <section className="border border-line bg-surface">
        <Header />
        <div className="p-4">
          <p className="font-mono text-micro text-ink-muted tracking-widest">LOADING…</p>
        </div>
      </section>
    );
  }

  if (listStatus === 'failed') {
    return (
      <section className="border border-danger bg-danger-soft">
        <Header />
        <div className="p-4">
          <p className="font-mono text-micro text-danger tracking-widest">
            {listError?.code || 'ERROR'}
          </p>
          <p className="text-body text-danger mt-1">{listError?.message}</p>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="border border-line bg-surface">
        <Header count={0} />
        <div className="p-8 text-center">
          <p className="text-section text-ink-muted">NO SIGNAL YET</p>
          <p className="mt-2 text-body text-ink-muted">
            Paste an enquiry above. Your first item will appear here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="border border-line bg-surface">
      <Header count={items.length} />
      <ul className="divide-y divide-line">
        {items.map((e) => {
          const received = e.receivedAt ? new Date(e.receivedAt) : null;
          const time = received
            ? received.toLocaleString(undefined, {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
            : '—';
          const preview = (e.originalText || '').replace(/\s+/g, ' ').slice(0, 80);
          const isSelected = e.id === selectedId;
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => dispatch(setSelectedId(e.id))}
                className={`w-full text-left px-4 py-3 hover:bg-paper transition-colors ${
                  isSelected ? 'bg-paper border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-micro text-ink-muted">{time}</span>
                  <span className="font-mono text-micro text-ink-muted">
                    {e.source?.toUpperCase?.()} · {e.status?.toUpperCase?.()}
                  </span>
                </div>
                <p className="text-body text-ink mt-1 truncate">{preview || <span className="text-ink-muted">(empty)</span>}</p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Header({ count }) {
  return (
    <div className="border-b border-line px-4 py-2 flex items-center justify-between">
      <span className="font-mono text-micro tracking-widest text-ink-muted">ENQUIRY QUEUE</span>
      <span className="font-mono text-micro text-ink-muted">
        {typeof count === 'number' ? `${count} ITEM${count === 1 ? '' : 'S'}` : ''}
      </span>
    </div>
  );
}
