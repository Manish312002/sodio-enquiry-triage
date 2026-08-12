/**
 * App shell — Phase 0.
 *
 * Deliberately minimal: proves React + Tailwind + Redux + createAsyncThunk +
 * API connectivity work together. The full Signal Desk dashboard (queue,
 * filters, detail view, etc.) is built in Phase 5+.
 *
 * The shell dispatches fetchHealth() on mount so a single page load exercises
 * the entire chain: React component → thunk → axios → Vite proxy → Express →
 * MongoDB connection check → JSON response → Redux state → re-render.
 */
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchHealth } from './features/enquiries/enquiryThunks';

function App() {
  const dispatch = useDispatch();
  const system = useSelector((s) => s.enquiries.system);

  useEffect(() => {
    dispatch(fetchHealth());
  }, [dispatch]);

  const health = system.health;
  const status = system.healthStatus;

  // Visual status indicator (Phase 0 only — Phase 5+ will use design.md §15).
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
      {/* Top bar — Signal Desk header (design.md §5) */}
      <header className="border-b border-line bg-surface-strong">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-micro tracking-widest text-ink-muted">
              SODIO
            </span>
            <span className="text-ink-muted">/</span>
            <span className="font-mono text-micro tracking-widest text-ink-muted">
              INBOX SIGNALS
            </span>
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

      {/* Main — Phase 0 placeholder content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10">
        <h1 className="text-title text-ink">
          Phase 0 — Project Foundation
        </h1>
        <p className="mt-2 text-body text-ink-muted max-w-2xl">
          Skeleton verification surface. The full Signal Desk console is built
          in later phases. This page exists to prove the stack is wired:
          React + Vite + Tailwind + Redux Toolkit + createAsyncThunk + Express
          + MongoDB.
        </p>

        <section className="mt-8 border border-line bg-surface">
          <div className="border-b border-line px-4 py-2">
            <span className="font-mono text-micro tracking-widest text-ink-muted">
              BACKEND HEALTH
            </span>
          </div>
          <div className="p-4">
            {status === 'pending' && (
              <p className="text-body text-ink-muted">Contacting /api/health…</p>
            )}
            {status === 'failed' && (
              <div className="text-body text-danger">
                <p className="font-semibold">Could not reach backend.</p>
                <p className="mt-1 text-ink-muted font-mono text-small">
                  {system.healthError}
                </p>
                <button
                  type="button"
                  onClick={() => dispatch(fetchHealth())}
                  className="mt-3 px-3 py-1 text-small font-medium border border-line-strong hover:bg-paper"
                >
                  Retry
                </button>
              </div>
            )}
            {status === 'succeeded' && health && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-small">
                <dt className="text-ink-muted">status</dt>
                <dd className={health.status === 'ok' ? 'text-success' : 'text-warning'}>
                  {health.status}
                </dd>

                <dt className="text-ink-muted">db</dt>
                <dd className={health.db === 'connected' ? 'text-success' : 'text-danger'}>
                  {health.db}
                </dd>

                <dt className="text-ink-muted">dbHost</dt>
                <dd>{health.dbHost ?? '—'}</dd>

                <dt className="text-ink-muted">uptime</dt>
                <dd>{health.uptime}s</dd>

                <dt className="text-ink-muted">version</dt>
                <dd>{health.version}</dd>

                <dt className="text-ink-muted">env</dt>
                <dd>{health.env}</dd>

                <dt className="text-ink-muted">timestamp</dt>
                <dd className="text-ink-muted">{health.timestamp}</dd>
              </dl>
            )}
            {status === 'idle' && (
              <p className="text-body text-ink-muted">No health check has run yet.</p>
            )}
          </div>
        </section>

        <section className="mt-6 border border-line bg-surface">
          <div className="border-b border-line px-4 py-2">
            <span className="font-mono text-micro tracking-widest text-ink-muted">
              ENQUIRY QUEUE
            </span>
          </div>
          <div className="p-8 text-center">
            <p className="text-section text-ink-muted">NO SIGNAL YET</p>
            <p className="mt-2 text-body text-ink-muted">
              Phase 1 adds single enquiry ingestion. Phase 2 adds file import.
            </p>
          </div>
        </section>

        <p className="mt-8 text-small text-ink-muted">
          Stack: React + Vite · Tailwind CSS · Redux Toolkit (createAsyncThunk) ·
          Express · MongoDB + Mongoose · JavaScript only.
        </p>
      </main>
    </div>
  );
}

export default App;
