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
    <div className="min-h-full flex flex-col lg:h-full">
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

      <main className="flex-1 w-full px-6 py-4 space-y-4 lg:flex lg:flex-col lg:min-h-0">
        {/* Compact paste strip — design.md §11 "feed intake" */}
        <div className="shrink-0">
          <PasteEnquiry />
        </div>

        {/* Phase 8 — batch import + progress. Sits beside the paste strip
            so the operator has a single "intake" zone. Polls the backend
            while a batch is processing; shows a segmented progress bar +
            per-item retry. */}
        <div className="shrink-0">
          <BatchProgress />
        </div>

        {/* Three-zone desktop layout.
            At lg+ the grid fills the remaining viewport height (lg:flex-1 lg:min-h-0)
            and each workspace column gets its own independent scroll container
            (lg:overflow-y-auto). This keeps the EXTRACTED panel inside the
            visible viewport instead of pushing the whole page taller than the
            screen. Below lg the layout collapses to a single column and the
            page scrolls naturally via <body> (no lg: classes apply). */}
        <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_minmax(0,1.5fr)] gap-4 items-start lg:items-stretch lg:flex-1 lg:min-h-0">
          {/* Filter rail collapses below lg.
              lg:self-start keeps the rail at its natural (short) height so it
              does not stretch and leave a large empty block beside the queue. */}
          <div className="lg:self-start lg:min-h-0">
            <FilterRail />
          </div>

          {/* Queue — independent vertical scroll at lg+ when the list is long. */}
          <div className="lg:min-h-0 lg:overflow-y-auto">
            <EnquiryQueue />
          </div>

          {/* Detail workspace — independent vertical scroll at lg+.
              This is the ONE primary scroll area for STATUS + SOURCE + EXTRACTED
              + PRIORITY. overflow-x-hidden prevents long values from forcing a
              horizontal page scrollbar. */}
          <div className="lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden">
            <EnquiryDetail />
          </div>
        </div>

        {/* Footer — shrink-0 so the grid (lg:flex-1) never pushes it out of
            the viewport. At lg+ main is a flex column with min-h-0, so the
            grid takes all remaining space after PasteEnquiry + BatchProgress +
            this footer. The footer is always visible at the bottom. */}
        <p className="mt-6 text-small text-ink-muted shrink-0">
          Stack: React + Vite · Tailwind CSS · Redux Toolkit (createAsyncThunk) ·
          Express · MongoDB + Mongoose · JavaScript only. Phase 10 — UX Polish + Verification.
        </p>
      </main>
    </div>
  );
}
