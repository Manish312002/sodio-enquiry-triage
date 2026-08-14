/**
 * BatchProgress — batch import + progress surface.
 *
 * Design "Import Experience" + §12 "Batch Progress"):
 *
 *   IMPORT ENQUIRIES
 *   Drop a source file here
 *   or choose file
 *
 *   20 DETECTED
 *   14 COMPLETE
 *   2 FAILED
 *   4 PROCESSING
 *
 *   ━━━━━━━━━━━━━━━━━━━━  14 / 20
 *
 *   14 completed · 2 failed · 4 processing
 *
 * The component:
 *   - Shows a compact file-input strip (NOT a giant drag-and-drop box).
 *   - On file select, dispatches importBatch. The backend parses +
 *     persists + creates a BatchJob + kicks off background extraction.
 *   - Polls GET /api/batches/:id every 2s while status === 'processing'.
 *   - Stops polling when the batch reaches a terminal state
 *     (completed | completed_with_errors | failed).
 *   - Shows the segmented progress bar + counts.
 *   - Lists failed items with a [Retry] button (dispatches the existing
 *     reExtractEnquiry thunk for the failed enquiry, then re-fetches
 *     the batch via refreshBatch).
 *
 * Architectural boundaries,:
 *   - No LLM calls from React — only REST.
 *   - No secrets in the component.
 *   - The component does NOT compute priority, parse files, or run
 *     extraction. It only dispatches thunks and renders state.
 *   - Polling is bounded: a single setInterval, cleared on terminal
 *     state or unmount. No duplicate polling loops.
 */
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  importBatch,
  fetchBatch,
  refreshBatch,
  reExtractEnquiry,
} from '../../features/enquiries/enquiryThunks';
import { clearBatch, setBatchPolling } from '../../features/enquiries/enquirySlice';

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed']);

export default function BatchProgress() {
  const dispatch = useDispatch();
  const fileInputRef = useRef(null);

  const batch = useSelector((s) => s.enquiries.batch);
  const importStatus = useSelector((s) => s.enquiries.batchImportStatus);
  const importError = useSelector((s) => s.enquiries.batchImportError);
  const fetchError = useSelector((s) => s.enquiries.batchFetchError);
  const polling = useSelector((s) => s.enquiries.batchPolling);

  // Track which enquiry ids have an in-flight retry so we can show
  // "RETRYING…" on just that row.
  const [retryingIds, setRetryingIds] = useState(new Set());

  // --- polling hook ---
  // Poll GET /api/batches/:id every POLL_INTERVAL_MS while the batch is
  // in 'processing' state. Stop polling when the batch reaches a terminal
  // state. The interval is stored in a ref so it can be cleared on
  // unmount or when the batch becomes terminal.
  useEffect(() => {
    if (!batch?.id) return;
    if (TERMINAL_STATUSES.has(batch.status)) {
      // Batch is terminal — ensure polling is stopped.
      if (polling) dispatch(setBatchPolling(false));
      return;
    }
    // Batch is still processing — start polling if not already.
    if (polling) return;
    dispatch(setBatchPolling(true));

    const intervalId = setInterval(() => {
      dispatch(fetchBatch(batch.id));
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      dispatch(setBatchPolling(false));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.id, batch?.status, dispatch]);

  // Stop polling when the batch transitions to terminal (the effect above
  // handles the cleanup, but we also explicitly clear the flag here so the
  // UI updates immediately).
  useEffect(() => {
    if (batch && TERMINAL_STATUSES.has(batch.status) && polling) {
      dispatch(setBatchPolling(false));
    }
  }, [batch, polling, dispatch]);

  // --- file input handler ---
  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Clear any previous batch state so the UI shows the new import.
    dispatch(clearBatch());
    dispatch(importBatch(file));
    // Reset the file input so the same file can be re-selected later.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // --- retry a failed enquiry ---
  function handleRetry(enquiryId) {
    setRetryingIds((prev) => new Set(prev).add(enquiryId));
    dispatch(reExtractEnquiry({ id: enquiryId }))
      .unwrap()
      .then(() => {
        // After the retry succeeds, refresh the batch counters so the
        // failed count drops and the status potentially upgrades to
        // 'completed'.
        if (batch?.id) dispatch(refreshBatch(batch.id));
      })
      .catch(() => {
        // Error is in Redux (reExtractError). The UI shows it inline on
        // the enquiry's ExtractionPanel.
      })
      .finally(() => {
        setRetryingIds((prev) => {
          const next = new Set(prev);
          next.delete(enquiryId);
          return next;
        });
      });
  }

  function handleDismiss() {
    dispatch(clearBatch());
  }

  function handleRefresh() {
    if (batch?.id) dispatch(refreshBatch(batch.id));
  }

  // --- render ---
  const isImporting = importStatus === 'pending';

  return (
    <section className="border border-line bg-surface">
      <div className="border-b border-line px-4 py-2 flex items-center justify-between">
        <span className="font-mono text-micro tracking-widest text-ink-muted">
          IMPORT ENQUIRIES
        </span>
        {batch && TERMINAL_STATUSES.has(batch.status) && (
          <button
            type="button"
            onClick={handleDismiss}
            className="font-mono text-micro text-ink-muted hover:text-ink underline-offset-2 hover:underline"
          >
            [dismiss]
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* File input strip — compact, not a giant drag-and-drop box */}
        <label className="block">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.text,.md,text/plain"
            onChange={handleFileChange}
            disabled={isImporting}
            className="block w-full text-small text-ink-muted file:mr-3 file:px-3 file:py-1.5 file:font-mono file:text-micro file:tracking-widest file:bg-accent file:text-white file:border-0 file:hover:bg-accent/90 file:disabled:opacity-40 file:cursor-pointer cursor-pointer"
          />
          <span className="mt-1 block font-mono text-micro text-ink-muted">
            Upload sample-enquiries.txt. The parser handles the file as-is.
          </span>
        </label>

        {/* Import error */}
        {importStatus === 'failed' && importError && (
          <div className="border border-danger bg-danger-soft px-3 py-2">
            <p className="font-mono text-micro text-danger tracking-widest">
              IMPORT FAILED: {importError.code || 'ERROR'}
            </p>
            <p className="text-body text-danger mt-1">{importError.message}</p>
          </div>
        )}

        {/* Fetch error (polling failure) */}
        {fetchError && batch && (
          <div className="border border-warning/60 bg-warning-soft/40 px-3 py-2">
            <p className="font-mono text-micro text-warning tracking-widest">
              PROGRESS FETCH FAILED: {fetchError.code || 'ERROR'}
            </p>
            <p className="text-body text-ink-muted mt-1">
              {fetchError.message} — the batch is still running in the
              background. [Refresh] to try again.
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              className="mt-1 font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface"
            >
              [Refresh]
            </button>
          </div>
        )}

        {/* Importing indicator — design.md §14: skeleton rows preserve
            structure, no full-screen spinner. Show a faint segmented bar
            + placeholder counts so the operator sees the progress shape
            even before the first batch poll resolves. */}
        {isImporting && (
          <div className="space-y-2">
            <p className="font-mono text-micro text-ink-muted tracking-widest animate-pulse">
              UPLOADING + PARSING…
            </p>
            <div className="flex items-center gap-0.5 h-3" aria-hidden>
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 bg-line animate-pulse"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
            <p className="font-mono text-micro text-ink-muted">
              The backend is splitting the file into individual enquiries.
            </p>
          </div>
        )}

        {/* Batch progress — the main surface */}
        {batch && (
          <BatchProgressDetail
            batch={batch}
            retryingIds={retryingIds}
            onRetry={handleRetry}
            onRefresh={handleRefresh}
          />
        )}
      </div>
    </section>
  );
}

/**
 * Render the batch progress detail: counts, segmented bar, status, and
 * the failed-items list with retry buttons.
 *
 * Extracted as a sub-component so the main BatchProgress component stays
 * readable. Not exported — internal to this file.
 */
function BatchProgressDetail({ batch, retryingIds, onRetry, onRefresh }) {
  const { total, pending, processing, completed, failed, status, failures } = batch;
  const processed = completed + failed;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  const statusLabel = {
    processing: 'PROCESSING',
    completed: 'COMPLETED',
    completed_with_errors: 'COMPLETED WITH ERRORS',
    failed: 'FAILED',
  }[status] || String(status).toUpperCase();

  const statusColor =
    status === 'completed'
      ? 'text-success'
      : status === 'completed_with_errors'
        ? 'text-warning'
        : status === 'failed'
          ? 'text-danger'
          : 'text-ink-muted';

  // Segmented bar: each enquiry is a thin vertical segment, coloured by
  // its state. This gives a denser, more operational feel than a single
  // fill bar — the operator can see at a glance how many items are in
  // each state.
  const segments = [];
  for (let i = 0; i < completed; i += 1) {
    segments.push(<div key={`c${i}`} className="flex-1 bg-success" title="completed" />);
  }
  for (let i = 0; i < failed; i += 1) {
    segments.push(<div key={`f${i}`} className="flex-1 bg-danger" title="failed" />);
  }
  for (let i = 0; i < processing; i += 1) {
    segments.push(
      <div key={`p${i}`} className="flex-1 bg-accent animate-pulse" title="processing" />,
    );
  }
  for (let i = 0; i < pending; i += 1) {
    segments.push(<div key={`n${i}`} className="flex-1 bg-line-strong" title="pending" />);
  }

  return (
    <div className="space-y-2">
      {/* Header line: count + status */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-micro text-ink-muted tracking-widest">
          {total} ENQUIRIES
        </span>
        <span className={`font-mono text-micro tracking-widest ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      {/* Segmented progress bar */}
      <div
        className="flex items-center gap-0.5 h-3"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {segments.length > 0 ? segments : <div className="flex-1 bg-line-strong" />}
      </div>

      {/* Counts line */}
      <div className="font-mono text-micro text-ink-muted">
        {processed} / {total} processed
      </div>

      {/* Counters grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-micro">
        <Counter label="COMPLETED" value={completed} color="text-success" />
        <Counter label="PROCESSING" value={processing} color="text-accent" />
        <Counter label="FAILED" value={failed} color="text-danger" />
        <Counter label="PENDING" value={pending} color="text-ink-muted" />
      </div>

      {/* Failed items list with retry buttons */}
      {Array.isArray(failures) && failures.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="font-mono text-micro text-danger tracking-widest mb-1">
            FAILED ITEMS
          </p>
          <ul className="space-y-1">
            {failures.map((f) => (
              <li key={f.enquiryId} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-micro text-ink-muted truncate">
                    {f.enquiryId}
                  </p>
                  <p className="font-mono text-micro text-danger">
                    {f.code}: {f.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRetry(f.enquiryId)}
                  disabled={retryingIds.has(f.enquiryId)}
                  className="shrink-0 font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface disabled:opacity-40 disabled:cursor-default"
                >
                  {retryingIds.has(f.enquiryId) ? 'RETRYING…' : '[Retry]'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Terminal-state actions */}
      {TERMINAL_STATUSES.has(status) && (
        <div className="mt-2 border-t border-line pt-2 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onRefresh}
            className="font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface"
          >
            [Refresh]
          </button>
          <span className="font-mono text-micro text-ink-muted">
            Recompute counters from live enquiry state (use after retrying items).
          </span>
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, color }) {
  return (
    <div className="border border-line bg-surface-strong px-2 py-1">
      <p className="text-ink-muted tracking-widest">{label}</p>
      <p className={`text-body ${color}`}>{value}</p>
    </div>
  );
}
