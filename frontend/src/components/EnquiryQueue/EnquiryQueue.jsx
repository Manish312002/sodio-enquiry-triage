/**
 * EnquiryQueue — Phase 5.
 *
 * design.md §6 "Enquiry Row": compact operational record, not a card.
 * Each row shows:
 *   - received time
 *   - contact name + company
 *   - service line
 *   - budget
 *   - timeline
 *   - priority marker (left priority rail)
 *   - status
 *   - one-line summary
 *
 * States handled:
 *   - loading (skeleton rows)
 *   - empty queue
 *   - no matching filters (different empty message)
 *   - API error
 *   - normal list
 *   - extraction pending / failed (rendered inline in the row, not hidden)
 *
 * The queue is rendered as a <ul> of <li> buttons for keyboard navigation
 * (design.md §16). The currently-selected enquiry gets an accent left rail.
 *
 * Data source: Redux `enquiries.items`, populated by App.jsx's filter-driven
 * fetchEnquiries effect. This component does NOT dispatch fetchEnquiries
 * directly — App.jsx is the single source of truth for when to refetch.
 */
import { useSelector, useDispatch } from 'react-redux';
import { setSelectedId } from '../../features/enquiries/enquirySlice';
import SortBar from '../SortBar/SortBar';
import PriorityBadge from '../PriorityBadge/PriorityBadge';
import {
  formatBudgetShort,
  formatTimelineShort,
  priorityRailClass,
  hasActiveFilter,
  extractionStateLabel,
} from '../../features/enquiries/format';

export default function EnquiryQueue() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.enquiries.items);
  const listStatus = useSelector((s) => s.enquiries.listStatus);
  const listError = useSelector((s) => s.enquiries.listError);
  const selectedId = useSelector((s) => s.enquiries.selectedId);
  const filters = useSelector((s) => s.enquiries.filters);
  const activeFilter = hasActiveFilter(filters);

  // Loading — render skeleton rows so the queue structure is preserved.
  if (listStatus === 'pending' && items.length === 0) {
    return (
      <QueueShell count="…">
        <ul className="divide-y divide-line">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="px-4 py-3">
              <div className="h-3 w-1/2 bg-line animate-pulse" />
              <div className="mt-2 h-2.5 w-3/4 bg-line/60 animate-pulse" />
            </li>
          ))}
        </ul>
      </QueueShell>
    );
  }

  // API error — surface a readable message, never a stack trace.
  if (listStatus === 'failed') {
    return (
      <QueueShell count="">
        <div className="p-4">
          <p className="font-mono text-micro text-danger tracking-widest">
            {listError?.code || 'ERROR'}
          </p>
          <p className="text-body text-danger mt-1">{listError?.message}</p>
          <p className="mt-2 font-mono text-micro text-ink-muted">
            The backend may be offline. Check the health indicator in the header.
          </p>
        </div>
      </QueueShell>
    );
  }

  // Empty queue — differentiate "no enquiries at all" from "no matches".
  if (items.length === 0) {
    return (
      <QueueShell count={0}>
        <div className="p-8 text-center">
          {activeFilter ? (
            <>
              <p className="text-section text-ink-muted">NO MATCHES</p>
              <p className="mt-2 text-body text-ink-muted">
                The current filter combination returned nothing.
                <br />
                Clear one filter to widen the queue.
              </p>
            </>
          ) : (
            <>
              <p className="text-section text-ink-muted">NO SIGNAL YET</p>
              <p className="mt-2 text-body text-ink-muted">
                Paste an enquiry above or import a source file.
                <br />
                Your first item will appear here.
              </p>
            </>
          )}
        </div>
      </QueueShell>
    );
  }

  return (
    <QueueShell count={items.length}>
      <ul className="divide-y divide-line">
        {items.map((e) => (
          <QueueRow
            key={e.id}
            enquiry={e}
            isSelected={e.id === selectedId}
            onSelect={() => dispatch(setSelectedId(e.id))}
          />
        ))}
      </ul>
    </QueueShell>
  );
}

function QueueShell({ count, children }) {
  return (
    <section className="border border-line bg-surface flex flex-col">
      <div className="border-b border-line px-4 py-2 flex items-center justify-between gap-2">
        <span className="font-mono text-micro tracking-widest text-ink-muted">ENQUIRY QUEUE</span>
        <div className="flex items-center gap-3">
          <SortBar />
          {typeof count === 'number' && (
            <span className="font-mono text-micro text-ink-muted">
              {count} ITEM{count === 1 ? '' : 'S'}
            </span>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function QueueRow({ enquiry, isSelected, onSelect }) {
  const received = enquiry.receivedAt ? new Date(enquiry.receivedAt) : null;
  const time = received
    ? received.toLocaleString(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const eff = enquiry.effectiveExtraction;
  const hasExtraction = enquiry.extractionState === 'completed' && eff;
  const company = hasExtraction ? eff.company : null;
  const contactName = hasExtraction ? eff.contactName : enquiry.sender?.name;
  const serviceLine = hasExtraction ? eff.serviceLine : null;
  const budget = hasExtraction ? formatBudgetShort(eff.budget) : null;
  const timeline = hasExtraction ? formatTimelineShort(eff.timeline) : null;
  const summary = hasExtraction ? eff.summary : null;

  const priorityLevel = enquiry.priority?.level || null;
  const railColor = priorityRailClass(priorityLevel);

  const stateLabel = extractionStateLabel(enquiry.extractionState);

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full text-left flex items-stretch ${
          isSelected ? 'bg-paper' : 'hover:bg-paper'
        } transition-colors`}
        aria-pressed={isSelected}
      >
        {/* Priority rail */}
        <span className={`w-1 shrink-0 ${railColor}`} aria-hidden />

        <div className="flex-1 px-4 py-2.5 min-w-0">
          {/* Row 1: time · contact · company · status */}
          <div className="flex items-baseline justify-between gap-3 min-w-0">
            <div className="flex items-baseline gap-2 min-w-0 truncate">
              <span className="font-mono text-micro text-ink-muted shrink-0">{time}</span>
              <span className="text-body text-ink truncate">
                {contactName || '(unknown contact)'}
                {company && (
                  <span className="text-ink-muted"> · {company}</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {enquiry.priority?.level && (
                <PriorityBadge priority={enquiry.priority} compact />
              )}
              <span
                className={`font-mono text-micro tracking-widest ${
                  enquiry.status === 'dropped'
                    ? 'text-danger'
                    : enquiry.status === 'qualified'
                      ? 'text-success'
                      : 'text-ink-muted'
                }`}
              >
                {enquiry.status?.toUpperCase?.()}
              </span>
            </div>
          </div>

          {/* Row 2: service line · budget · timeline · extraction state */}
          <div className="mt-1 flex items-center gap-3 font-mono text-micro text-ink-muted min-w-0">
            {serviceLine && (
              <span className="text-ink">{serviceLine.toUpperCase()}</span>
            )}
            {budget && <span>{budget}</span>}
            {timeline && <span>{timeline}</span>}
            {stateLabel && (
              <span className="text-warning">{stateLabel}</span>
            )}
            {!hasExtraction && !stateLabel && (
              <span className="text-ink-muted/60">no extraction</span>
            )}
          </div>

          {/* Row 3: one-line summary (truncated) */}
          {summary && (
            <p className="mt-1 text-body text-ink-muted truncate">
              {summary}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}
