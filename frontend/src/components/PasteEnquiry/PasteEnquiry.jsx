/**
 * PasteEnquiry — Phase 1 single-enquiry ingestion surface.
 *
 * Design (design.md §11 "Import Experience"): a compact "feed intake" strip,
 * NOT a giant drag-and-drop box. Phase 1 is paste-only; file upload lives in
 * Phase 2 and will sit beside this component.
 *
 * Behaviour:
 *   - Textarea bound to local state.
 *   - Optional sender name + email fields (small, secondary).
 *   - Submit disabled while pending or when text is empty/whitespace-only.
 *   - On success: shows a confirmation line + clears the textarea; App.jsx
 *     selects the new enquiry and renders OriginalMessage + EnquiryDetail.
 *   - On failure: shows the readable server message inline (no toast, per
 *     design.md §16 "Errors should appear close to the failed action").
 *
 * Local validation mirrors the backend (enquiryService.js): empty/whitespace-
 * only text is rejected client-side first so the round-trip is avoided.
 */
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { createEnquiry } from '../../features/enquiries/enquiryThunks';
import { clearCreateState } from '../../features/enquiries/enquirySlice';

const MAX_CHARS = 100_000; // mirror backend enquiryService.MAX_ORIGINAL_TEXT_CHARS

export default function PasteEnquiry() {
  const dispatch = useDispatch();
  const createStatus = useSelector((s) => s.enquiries.createStatus);
  const createError = useSelector((s) => s.enquiries.createError);

  const [text, setText] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [localError, setLocalError] = useState(null);

  const isPending = createStatus === 'pending';
  const trimmedLen = text.trim().length;
  const overLimit = text.length > MAX_CHARS;

  function handleSubmit(e) {
    e.preventDefault();
    if (isPending) return;

    setLocalError(null);

    if (trimmedLen === 0) {
      setLocalError('Enquiry text cannot be empty.');
      return;
    }
    if (overLimit) {
      setLocalError(`Enquiry text is too long (max ${MAX_CHARS.toLocaleString()} characters).`);
      return;
    }

    const sender =
      senderName.trim() || senderEmail.trim()
        ? {
            ...(senderName.trim() ? { name: senderName.trim() } : {}),
            ...(senderEmail.trim() ? { email: senderEmail.trim() } : {}),
          }
        : undefined;

    dispatch(
      createEnquiry({
        originalText: text, // verbatim — no trim, no normalise
        sender,
      }),
    );
  }

  function handleReset() {
    setText('');
    setSenderName('');
    setSenderEmail('');
    setLocalError(null);
    dispatch(clearCreateState());
  }

  const errorToShow = localError || (createStatus === 'failed' ? createError?.message : null);

  return (
    <section className="border border-line bg-surface">
      <div className="border-b border-line px-4 py-2 flex items-center justify-between">
        <span className="font-mono text-micro tracking-widest text-ink-muted">
          PASTE ENQUIRY
        </span>
        {createStatus === 'succeeded' && (
          <span className="font-mono text-micro text-success">SAVED</span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <label className="block">
          <span className="font-mono text-micro text-ink-muted block mb-1">
            ORIGINAL MESSAGE
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the full enquiry text here. The text is stored verbatim."
            rows={8}
            className="w-full font-mono text-body bg-surface-strong border border-line-strong px-3 py-2 focus:outline-none focus:border-accent resize-y"
            disabled={isPending}
            spellCheck={false}
          />
          <span className="flex justify-between mt-1 font-mono text-micro text-ink-muted">
            <span>{text.length.toLocaleString()} chars · whitespace preserved</span>
            <span>{trimmedLen === 0 ? 'EMPTY' : overLimit ? 'TOO LONG' : 'READY'}</span>
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="font-mono text-micro text-ink-muted block mb-1">SENDER NAME (optional)</span>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="w-full text-body bg-surface-strong border border-line-strong px-3 py-2 focus:outline-none focus:border-accent"
              disabled={isPending}
            />
          </label>
          <label className="block">
            <span className="font-mono text-micro text-ink-muted block mb-1">SENDER EMAIL (optional)</span>
            <input
              type="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              className="w-full font-mono text-body bg-surface-strong border border-line-strong px-3 py-2 focus:outline-none focus:border-accent"
              disabled={isPending}
            />
          </label>
        </div>

        {errorToShow && (
          <div className="border border-danger bg-danger-soft px-3 py-2">
            <p className="font-mono text-micro text-danger tracking-widest">
              {createStatus === 'failed' ? createError?.code || 'ERROR' : 'VALIDATION'}
            </p>
            <p className="text-body text-danger mt-1">{errorToShow}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending || trimmedLen === 0 || overLimit}
            className="px-4 py-2 text-small font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? 'SUBMITTING…' : 'SUBMIT ENQUIRY'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isPending}
            className="px-3 py-2 text-small font-medium border border-line-strong text-ink hover:bg-paper disabled:opacity-40"
          >
            CLEAR
          </button>
        </div>
      </form>
    </section>
  );
}
