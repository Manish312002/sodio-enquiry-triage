/**
 * SortBar — Phase 5.
 *
 * Compact sort controls above the enquiry queue. Two sort keys (priority
 * or receivedAt) + an asc/desc toggle. design.md §16 says keyboard-
 * friendly controls; these are simple <button> elements with aria-pressed.
 *
 * Default sort: receivedAt desc (most recent first). When the operator
 * switches to priority desc, the queue shows HIGH → MEDIUM → LOW, with
 * pending/failed (no priority) sinking to the bottom.
 */
import { useDispatch, useSelector } from 'react-redux';
import { setSortBy, toggleSortDir } from '../../features/enquiries/enquirySlice';

const SORT_OPTIONS = [
  { value: 'receivedAt', label: 'DATE' },
  { value: 'priority', label: 'PRIORITY' },
];

export default function SortBar() {
  const dispatch = useDispatch();
  const sortBy = useSelector((s) => s.enquiries.sort.by);
  const sortDir = useSelector((s) => s.enquiries.sort.dir);

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-micro tracking-widest text-ink-muted">SORT</span>
      <div className="flex items-center gap-0.5">
        {SORT_OPTIONS.map((opt) => {
          const isActive = sortBy === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => dispatch(setSortBy(opt.value))}
              aria-pressed={isActive}
              className={`px-2 py-0.5 font-mono text-micro tracking-widest transition-colors ${
                isActive
                  ? 'bg-ink text-paper'
                  : 'text-ink-muted hover:bg-paper hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => dispatch(toggleSortDir())}
        className="px-2 py-0.5 font-mono text-micro tracking-widest border border-line text-ink-muted hover:bg-paper hover:text-ink"
        aria-label={`sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
        title={`Currently ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
      >
        {sortDir === 'asc' ? '↑ ASC' : '↓ DESC'}
      </button>
    </div>
  );
}
