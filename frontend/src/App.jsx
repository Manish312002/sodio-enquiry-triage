/**
 * App shell — Phase 5 Triage Console.
 *
 * Three-zone desktop layout (design.md §5):
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  HEADER  (SODIO / INBOX SIGNALS · count · health dot)    │
 *   ├─────────────┬──────────────────────┬─────────────────────┤
 *   │ FILTER RAIL │ ENQUIRY QUEUE        │ DETAIL              │
 *   │             │                      │  STATUS strip       │
 *   │ service     │  row row row …       │  SOURCE | EXTRACTED │
 *   │ priority    │                      │                     │
 *   │ status      │                      │                     │
 *   └─────────────┴──────────────────────┴─────────────────────┘
 *
 * At narrow widths: filter rail collapses, queue becomes primary,
 * detail opens below (design.md §17).
 *
 * Phase 5 wiring:
 *   - On mount + whenever filters/sort change → dispatch(fetchEnquiries({…}))
 *   - PasteEnquiry is still available above the queue (collapsible strip)
 *   - Health indicator in header (Phase 0)
 *
 * Architectural boundaries (Rules.md §9, Architechure.md §14):
 *   - No priority calculation in React — only display.
 *   - No direct LLM/MongoDB access — REST only.
 *   - Filters + sort are passed as query params to the backend.
 */
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  fetchHealth,
  fetchEnquiry,
  fetchEnquiries,
} from './features/enquiries/enquiryThunks';
import PasteEnquiry from './components/PasteEnquiry/PasteEnquiry';
import FilterRail from './components/FilterRail/FilterRail';
import EnquiryQueue from './components/EnquiryQueue/EnquiryQueue';
import EnquiryDetail from './components/EnquiryDetail/EnquiryDetail';

const LAST_CREATED_KEY = 'sodio:lastCreatedId';

export default function App() {
  const dispatch = useDispatch();
  const system = useSelector((s) => s.enquiries.system);
  const lastCreatedId = useSelector((s) => s.enquiries.lastCreatedId);
  const selectedId = useSelector((s) => s.enquiries.selectedId);
  const filters = useSelector((s) => s.enquiries.filters);
  const sort = useSelector((s) => s.enquiries.sort);
  const itemCount = useSelector((s) => s.enquiries.items.length);

  // Phase 0 — health indicator on mount.
  useEffect(() => {
    dispatch(fetchHealth());
  }, [dispatch]);

  // Phase 5 — refetch whenever filters or sort change.
  // This is the single source of truth for queue state; FilterRail / SortBar
  // only dispatch reducer actions, they do not call the API directly.
  useEffect(() => {
    dispatch(
      fetchEnquiries({
        serviceLine: filters.serviceLine,
        priority: filters.priority,
        status: filters.status,
        sort: sort.by,
        dir: sort.dir,
        limit: 100,
      }),
    );
  }, [dispatch, filters, sort]);

  // Phase 1 — refresh retrieval: if we have no selection on mount, restore
  // the last-created id from localStorage.
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
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-micro tracking-widest text-ink-muted">SODIO</span>
            <span className="text-ink-muted">/</span>
            <span className="font-mono text-micro tracking-widest text-ink-muted">
              INBOX SIGNALS
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-micro text-ink-muted">
              {itemCount} ENQUIRI{itemCount === 1 ? 'Y' : 'ES'}
            </span>
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
        </div>
      </header>

      <main className="flex-1 w-full px-6 py-4 space-y-4">
        {/* Compact paste strip — design.md §11 "feed intake" */}
        <PasteEnquiry />

        {/* Three-zone desktop layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1.5fr)] gap-4 items-start">
          {/* Filter rail collapses below lg */}
          <div className="lg:sticky lg:top-4">
            <FilterRail />
          </div>

          {/* Queue */}
          <EnquiryQueue />

          {/* Detail */}
          <EnquiryDetail />
        </div>

        <p className="mt-6 text-small text-ink-muted">
          Stack: React + Vite · Tailwind CSS · Redux Toolkit (createAsyncThunk) ·
          Express · MongoDB + Mongoose · JavaScript only. Phase 5 — Triage Console.
        </p>
      </main>
    </div>
  );
}
