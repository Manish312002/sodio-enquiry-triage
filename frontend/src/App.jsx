/**
 * App shell — Phase 1.
 *
 * Layout (design.md §5, three-zone desktop composition simplified for Phase 1):
 *   ┌────────────────────────────────────────────────────┐
 *   │  HEADER  (SODIO / INBOX SIGNALS · health dot)      │
 *   ├──────────────────────┬─────────────────────────────┤
 *   │  PASTE ENQUIRY       │  DETAIL (SOURCE | EXTRACTED)│
 *   │  ENQUIRY QUEUE       │                             │
 *   └──────────────────────┴─────────────────────────────┘
 *
 * Phase 1 features wired here:
 *   - PasteEnquiry submits via createEnquiry thunk → POST /api/enquiries
 *   - EnquiryQueue lists recent items via fetchEnquiries thunk
 *   - EnquiryDetail shows the selected enquiry (SOURCE + EXTRACTION PENDING)
 *   - After page refresh, if localStorage has a lastCreatedId, fetchEnquiry
 *     re-loads that record so the operator sees what they last submitted
 *
 * Phase 0 health indicator is preserved in the header.
 */
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchHealth,
  fetchEnquiry,
  fetchEnquiries,
} from './features/enquiries/enquiryThunks';
import PasteEnquiry from './components/PasteEnquiry/PasteEnquiry';
import EnquiryQueue from './components/EnquiryQueue/EnquiryQueue';
import EnquiryDetail from './components/EnquiryDetail/EnquiryDetail';

const LAST_CREATED_KEY = 'sodio:lastCreatedId';

export default function App() {
  const dispatch = useDispatch();
  const system = useSelector((s) => s.enquiries.system);
  const lastCreatedId = useSelector((s) => s.enquiries.lastCreatedId);
  const selectedId = useSelector((s) => s.enquiries.selectedId);

  // Phase 0 — health indicator on mount.
  useEffect(() => {
    dispatch(fetchHealth());
  }, [dispatch]);

  // Phase 1 — initial queue load.
  useEffect(() => {
    dispatch(fetchEnquiries({ limit: 50 }));
  }, [dispatch]);

  // Phase 1 — refresh retrieval: if we have no selection on mount, restore
  // the last-created id from localStorage so the operator sees their last
  // paste after a refresh. Runs exactly once on mount.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_CREATED_KEY) : null;
    if (stored && !selectedId) {
      dispatch(fetchEnquiry(stored));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist lastCreatedId to localStorage whenever it changes.
  useEffect(() => {
    if (lastCreatedId && typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_CREATED_KEY, lastCreatedId);
    }
  }, [lastCreatedId]);

  const health = system.health;
  const status = system.healthStatus;

  const dotClass =
    status === 'succeeded' && health?.status === 'ok'
      ? 'bg-success'
      : status === 'succeeded' && health?.status === 'degraded'
        ? 'bg-warning'
        : status === 'pending'
          ? 'bg-ink-muted animate-pulse'
          : 'bg-danger';

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line bg-surface-strong">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-micro tracking-widest text-ink-muted">SODIO</span>
            <span className="text-ink-muted">/</span>
            <span className="font-mono text-micro tracking-widest text-ink-muted">INBOX SIGNALS</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${dotClass}`} aria-hidden />
            <span className="font-mono text-micro text-ink-muted">
              {status === 'pending'
                ? 'CHECKING…'
                : status === 'succeeded'
                  ? `${health?.status?.toUpperCase?.()} · DB ${health?.db?.toUpperCase?.()}`
                  : status === 'failed'
                    ? 'OFFLINE'
                    : 'IDLE'}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <div className="space-y-4">
            <PasteEnquiry />
            <EnquiryQueue />
          </div>
          <EnquiryDetail />
        </div>

        <p className="mt-6 text-small text-ink-muted">
          Stack: React + Vite · Tailwind CSS · Redux Toolkit (createAsyncThunk) ·
          Express · MongoDB + Mongoose · JavaScript only. Phase 1 — single
          enquiry ingestion.
        </p>
      </main>
    </div>
  );
}
