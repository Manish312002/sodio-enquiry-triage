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
    <div className="h-screen flex flex-col overflow-hidden bg-paper">
      <header className="shrink-0 border-b border-line bg-surface-strong">
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

      <main className="flex-1 min-h-0 w-full overflow-y-auto lg:overflow-hidden">
        <div className="px-6 py-4 space-y-4 lg:h-full lg:flex lg:flex-col lg:min-h-0 lg:overflow-hidden">
          {/* Compact paste strip — "feed intake" zone. */}
          <div className="shrink-0">
            <PasteEnquiry />
          </div>

          {/* Batch import + progress. Sits beside the paste strip so the
              operator has a single "intake" zone. Polls the backend while a
              batch is processing; shows a segmented progress bar + per-item
              retry. */}
          <div className="shrink-0">
            <BatchProgress />
          </div>

          {/* Three-zone desktop layout.
              At lg+ the grid fills the remaining viewport height and each
              workspace column gets its own independent scroll container.
              `lg:grid-rows-1` constrains the row to the grid container's
              height (minmax(0,1fr)) so each column scrolls instead of the
              row growing past the viewport and getting clipped.
              Below lg the layout collapses to a single column and the page
              scrolls naturally via <main>. */}
          <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(360px,1fr)_minmax(480px,1.5fr)] lg:grid-rows-1 gap-4 lg:flex-1 lg:min-h-0">
            {/* Filter rail — collapses below lg.
                lg:h-full makes the wrapper fill the grid cell; lg:overflow-y-auto
                scrolls the rail if it ever grows taller than the viewport. */}
            <div className="lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden">
              <FilterRail />
            </div>

            {/* Queue — independent vertical scroll at lg+ when the list is long.
                overflow-x-hidden keeps long sender names / subjects from
                forcing a horizontal page scrollbar. */}
            <div className="min-w-0 min-h-[300px] lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden">
              <EnquiryQueue />
            </div>

            {/* Detail workspace — independent vertical scroll at lg+.
                This is the ONE primary scroll area for STATUS + SOURCE +
                EXTRACTED + PRIORITY. overflow-x-hidden prevents long values
                from forcing a horizontal page scrollbar. */}
            <div className="min-w-0 min-h-[300px] lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden">
              <EnquiryDetail />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
