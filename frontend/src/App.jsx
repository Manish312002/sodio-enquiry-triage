/**
 * App shell — Triage Console.
 *
 * Three-zone desktop layout:
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
 * detail opens below.
 *
 * Wiring:
 *   - On mount + whenever filters/sort change → dispatch(fetchEnquiries({…}))
 *   - PasteEnquiry is still available above the queue (collapsible strip)
 *   - Health indicator in header
 *
 * Architectural boundaries:
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
import BatchProgress from './components/BatchProgress/BatchProgress';
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

  // Health indicator on mount.
  useEffect(() => {
    dispatch(fetchHealth());
  }, [dispatch]);

  // Refetch whenever filters or sort change.
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

  // Refresh retrieval: if we have no selection on mount, restore the
  // last-created id from localStorage.
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
  <div className="min-h-screen bg-paper">
    <header className="border-b border-line bg-surface-strong">
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-micro tracking-widest text-ink-muted">
            SODIO
          </span>

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
            <span
              className={`h-2 w-2 rounded-full ${dotClass}`}
              aria-hidden
            />

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

    <main className="w-full">
      <div className="px-6 py-4 space-y-4">

        {/* Paste enquiry */}
        <PasteEnquiry />

        {/* Import enquiries */}
        <BatchProgress />

        {/* Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(360px,1fr)_minmax(480px,1.5fr)] gap-4 items-start">

          {/* Filter rail */}
          <div className="min-w-0">
            <FilterRail />
          </div>

          {/* Queue */}
          <div className="min-w-0 min-h-[400px]">
            <EnquiryQueue />
          </div>

          {/* Detail */}
          <div className="min-w-0 min-h-[400px]">
            <EnquiryDetail />
          </div>

        </div>
      </div>
    </main>
  </div>
);
}
