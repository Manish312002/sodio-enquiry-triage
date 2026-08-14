/**
 * StatusTrack — Phase 5.
 *
 * Renders the four-state workflow as a compact horizontal state track
 * (design.md §9). Clicking a node dispatches updateEnquiryStatus, which
 * PATCHes the backend (Rules.md §14: status changes are validated).
 *
 *   NEW ──── CONTACTED ──── QUALIFIED ──── DROPPED
 *
 * Linear order is NOT enforced by the backend — the operator may jump
 * between any two states. We simply highlight the current node.
 *
 * `disabled` prop is honoured (e.g. during a pending PATCH) so a second
 * click on the same node does not queue duplicate requests.
 */
import { useDispatch, useSelector } from 'react-redux';
import { updateEnquiryStatus } from '../../features/enquiries/enquiryThunks';

const STATES = [
  { key: 'new', label: 'NEW' },
  { key: 'contacted', label: 'CONTACTED' },
  { key: 'qualified', label: 'QUALIFIED' },
  { key: 'dropped', label: 'DROPPED' },
];

/**
 * @param {object} props
 * @param {string} props.enquiryId
 * @param {string} props.currentStatus  'new'|'contacted'|'qualified'|'dropped'
 */
export default function StatusTrack({ enquiryId, currentStatus }) {
  const dispatch = useDispatch();
  const statusUpdateStatus = useSelector((s) => s.enquiries.statusUpdateStatus);
  const statusUpdateId = useSelector((s) => s.enquiries.statusUpdateId);
  const statusUpdateError = useSelector((s) => s.enquiries.statusUpdateError);

  const isPending = statusUpdateStatus === 'pending' && statusUpdateId === enquiryId;
  const currentIndex = STATES.findIndex((s) => s.key === currentStatus);

  async function handleClick(targetStatus) {
    if (targetStatus === currentStatus || isPending) return;
    dispatch(updateEnquiryStatus({ id: enquiryId, status: targetStatus }));
  }

  return (
    <div>
      <div className="flex items-center gap-1.5" role="group" aria-label="status workflow">
        {STATES.map((s, idx) => {
          const isCurrent = idx === currentIndex;
          const isPast = currentIndex >= 0 && idx < currentIndex;
          const dotClass = isCurrent
            ? 'bg-accent ring-2 ring-accent/30'
            : isPast
              ? 'bg-ink-muted'
              : 'bg-line-strong';
          const labelClass = isCurrent
            ? 'text-ink'
            : isPast
              ? 'text-ink-muted'
              : 'text-ink-muted/60';
          const buttonClass = isCurrent
            ? 'cursor-default'
            : 'cursor-pointer hover:text-ink transition-colors duration-150';
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleClick(s.key)}
                disabled={isCurrent || isPending}
                className={`group inline-flex items-center gap-1.5 ${buttonClass} disabled:cursor-default disabled:opacity-60`}
                aria-label={`set status ${s.label.toLowerCase()}`}
                aria-current={isCurrent ? 'status' : undefined}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} aria-hidden />
                <span className={`font-mono text-micro tracking-widest ${labelClass}`}>
                  {s.label}
                </span>
              </button>
              {idx < STATES.length - 1 && (
                <span className="w-5 h-px bg-line-strong" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
      {isPending && (
        <p className="mt-1.5 font-mono text-micro text-ink-muted">SAVING…</p>
      )}
      {statusUpdateStatus === 'failed' && statusUpdateId === enquiryId && (
        <p className="mt-1.5 font-mono text-micro text-danger">
          {statusUpdateError?.code || 'ERROR'}: {statusUpdateError?.message}
        </p>
      )}
    </div>
  );
}
