/**
 * OriginalMessage — paper-like surface that renders the immutable source text.
 *
 * design.md §7 "Detail View — Left — Original":
 *   "A paper/document-like surface ... This section is immutable and visually
 *    labelled SOURCE."
 *
 * design.md acceptance (Phase 10): "original text remains visually prominent".
 * Phase 10 polish: stronger SOURCE label + IMMUTABLE pill + paper-tone
 * background + visual breathing room around the <pre>.
 *
 * Phase 1: renders the enquiry's `originalText` verbatim inside a <pre> with
 * monospace font. Whitespace, newlines, tabs, special characters, and
 * prompt-injection-style text are all preserved exactly as stored.
 *
 * SECURITY: we render with React's default text escaping (no dangerouslySetInnerHTML).
 * A enquiry that contains "Ignore all previous instructions" is shown as literal
 * text — it cannot execute.
 */
export default function OriginalMessage({ enquiry }) {
  if (!enquiry) return null;

  const received = enquiry.receivedAt ? new Date(enquiry.receivedAt) : null;
  const receivedLabel = received
    ? received.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

  const charCount = enquiry.originalText?.length ?? 0;

  return (
    <section className="border border-line-strong bg-surface-strong">
      <div className="border-b border-line-strong px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-micro tracking-widest text-ink">SOURCE</span>
          <span
            className="font-mono text-micro tracking-widest text-ink-muted border border-line bg-paper px-1.5 py-0.5"
            title="The original enquiry text is stored verbatim and can never be edited through the UI"
          >
            IMMUTABLE
          </span>
        </div>
        <span className="font-mono text-micro text-ink-muted">
          {enquiry.source?.toUpperCase?.()}
        </span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-small mb-3">
          <span className="text-ink-muted">received</span>
          <span>{receivedLabel}</span>
          {enquiry.sender?.name && (
            <>
              <span className="text-ink-muted">from</span>
              <span>{enquiry.sender.name}</span>
            </>
          )}
          {enquiry.sender?.email && (
            <>
              <span className="text-ink-muted">email</span>
              <span>{enquiry.sender.email}</span>
            </>
          )}
          <span className="text-ink-muted">status</span>
          <span>{enquiry.status?.toUpperCase?.()}</span>
          <span className="text-ink-muted">extraction</span>
          <span>{enquiry.extractionState?.toUpperCase?.()}</span>
        </div>

        <pre className="font-mono text-body text-ink whitespace-pre-wrap break-words border-t border-line pt-3 mt-2 leading-relaxed">
{enquiry.originalText}
        </pre>

        <p className="font-mono text-micro text-ink-muted mt-3">
          {charCount.toLocaleString()} chars · preserved verbatim · immutable
        </p>
      </div>
    </section>
  );
}
