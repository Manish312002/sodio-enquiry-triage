/**
 * FilterRail —.
 *
 * The left-side filter column. Three filter groups:
 *   - SERVICE LINE (All / AI / Blockchain / Web / Mobile / Game / Other)
 *   - PRIORITY (All / HIGH / MEDIUM / LOW)
 *   - STATUS (All / New / Contacted / Qualified / Dropped)
 *
 * Plus a "Clear filters" action that resets all three to 'all'.
 *
 * The filters are stored in the Redux slice and read by App.jsx's effect
 * to dispatch fetchEnquiries with the right query params. The rail itself
 * only fires setServiceLineFilter / setPriorityFilter / setStatusFilter
 * actions — it does not directly trigger API calls (single source of
 * truth: App.jsx's filter-driven effect).
 */
import { useDispatch, useSelector } from 'react-redux';
import {
  setServiceLineFilter,
  setPriorityFilter,
  setStatusFilter,
  resetFilters,
} from '../../features/enquiries/enquirySlice';

const SERVICE_GROUPS = [
  { value: 'all', label: 'All' },
  { value: 'ai', label: 'AI' },
  { value: 'blockchain', label: 'Blockchain' },
  { value: 'web', label: 'Web' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'game', label: 'Game' },
  { value: 'other', label: 'Other' },
];

const PRIORITY_GROUPS = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const STATUS_GROUPS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'dropped', label: 'Dropped' },
];

export default function FilterRail() {
  const dispatch = useDispatch();
  const filters = useSelector((s) => s.enquiries.filters);
  const hasActiveFilter =
    filters.serviceLine !== 'all' ||
    filters.priority !== 'all' ||
    filters.status !== 'all';

  return (
    <aside className="border border-line bg-surface">
      <div className="border-b border-line px-4 py-2 flex items-center justify-between">
        <span className="font-mono text-micro tracking-widest text-ink-muted">FILTERS</span>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => dispatch(resetFilters())}
            className="font-mono text-micro text-ink-muted hover:text-ink underline-offset-2 hover:underline"
          >
            clear
          </button>
        )}
      </div>

      <div className="p-4 space-y-5">
        <FilterGroup
          label="SERVICE LINE"
          options={SERVICE_GROUPS}
          value={filters.serviceLine}
          onChange={(v) => dispatch(setServiceLineFilter(v))}
        />
        <FilterGroup
          label="PRIORITY"
          options={PRIORITY_GROUPS}
          value={filters.priority}
          onChange={(v) => dispatch(setPriorityFilter(v))}
        />
        <FilterGroup
          label="STATUS"
          options={STATUS_GROUPS}
          value={filters.status}
          onChange={(v) => dispatch(setStatusFilter(v))}
        />
      </div>
    </aside>
  );
}

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div>
      <p className="font-mono text-micro tracking-widest text-ink-muted mb-2">{label}</p>
      <ul className="space-y-0.5">
        {options.map((opt) => {
          const isActive = value === opt.value;
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => onChange(opt.value)}
                className={`w-full text-left px-2 py-1 text-body transition-colors duration-150 ${
                  isActive
                    ? 'bg-accent-soft text-ink border-l-2 border-l-accent -ml-px'
                    : 'text-ink-muted hover:bg-paper hover:text-ink border-l-2 border-l-transparent'
                }`}
                aria-pressed={isActive}
              >
                {opt.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
