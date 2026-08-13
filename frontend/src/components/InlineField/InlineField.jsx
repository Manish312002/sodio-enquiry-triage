/**
 * InlineField — Phase 6.
 *
 * Reusable inline-editing component for a single extracted field.
 *
 * Visual states (design.md §7 "Detail View — Right — Extraction" + §8
 * "Human vs Model Visual Language"):
 *
 *   1. MODEL (no override active):
 *      [MODEL chip] LABEL  value  [Edit]
 *      Neutral background, subtle MODEL label.
 *
 *   2. CONFIRMED (override active, not editing):
 *      [CONFIRMED chip] LABEL  value  [Edit] [Clear]
 *      Accent left border, accent CONFIRMED chip.
 *
 *   3. EDITING (operator clicked Edit):
 *      [MODEL/CONFIRMED chip] LABEL  [input] [Save] [Cancel]
 *      Input is focused; Enter saves, Esc cancels (design.md §16).
 *
 *   4. SAVING (PATCH /fields/:field in flight):
 *      [chip] LABEL  [input disabled] SAVING…
 *      Input disabled; SAVING indicator.
 *
 *   5. ERROR (PATCH rejected):
 *      [chip] LABEL  [input] [Save] [Cancel]
 *      ERROR: <message>
 *      Inline error message; input retains the operator's entered value
 *      so they can fix and retry. We do NOT optimistically destroy the
 *      existing value (Rules.md §12).
 *
 * Per-field input variants:
 *   - text     : company, contactName, contactEmail, summary
 *   - select   : serviceLine (enum)
 *   - boolean  : isGenuineProjectEnquiry (true/false only)
 *   - budget   : structured form (raw, currency, min, max, qualifier)
 *   - timeline : raw text input (normalized preserved as-is from model)
 *
 * SECURITY: originalText is NEVER editable. The InlineField component is
 * only instantiated for fields in OVERRIDEABLE_FIELDS (ExtractionPanel
 * controls this).
 */
import { useState, useEffect, useRef, forwardRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateEnquiryField, clearEnquiryFieldOverride, acceptNewModelValue } from '../../features/enquiries/enquiryThunks';
import { clearFieldUpdateState, clearAcceptModelState, acknowledgeConflict } from '../../features/enquiries/enquirySlice';
import {
  hasOverride,
  getModelValue,
  getEffectiveValue,
  formatFieldValue,
  hasConflict,
  getNewModelValue,
} from '../../features/enquiries/format';

const SERVICE_LINE_OPTIONS = [
  { value: 'ai', label: 'AI' },
  { value: 'blockchain', label: 'BLOCKCHAIN' },
  { value: 'web', label: 'WEB' },
  { value: 'mobile', label: 'MOBILE' },
  { value: 'game', label: 'GAME' },
  { value: 'other', label: 'OTHER' },
];

const BUDGET_QUALIFIER_OPTIONS = [
  { value: 'exact', label: 'EXACT' },
  { value: 'range', label: 'RANGE' },
  { value: 'flexible', label: 'FLEXIBLE' },
  { value: 'tbd', label: 'TBD' },
  { value: 'unknown', label: 'UNKNOWN' },
];

/**
 * @param {object} props
 * @param {object} props.enquiry  Enquiry response shape (see backend toApiResponse).
 * @param {string} props.field  One of OVERRIDEABLE_FIELDS.
 * @param {string} props.label  Display label (e.g. "COMPANY").
 * @param {boolean} [props.block=false]  Render as a block (multi-line) instead of inline.
 * @param {boolean} [props.mono=false]  Render the value with monospace font.
 */
export default function InlineField({ enquiry, field, label, block = false, mono = false }) {
  const dispatch = useDispatch();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  const fieldUpdateStatus = useSelector((s) => s.enquiries.fieldUpdateStatus);
  const fieldUpdateId = useSelector((s) => s.enquiries.fieldUpdateId);
  const fieldUpdateField = useSelector((s) => s.enquiries.fieldUpdateField);
  const fieldUpdateError = useSelector((s) => s.enquiries.fieldUpdateError);

  // Phase 7 — re-extraction conflict state.
  const reExtractConflicts = useSelector((s) => s.enquiries.reExtractConflicts);
  const acceptModelStatus = useSelector((s) => s.enquiries.acceptModelStatus);
  const acceptModelId = useSelector((s) => s.enquiries.acceptModelId);
  const acceptModelField = useSelector((s) => s.enquiries.acceptModelField);
  const acceptModelError = useSelector((s) => s.enquiries.acceptModelError);

  const overridden = hasOverride(enquiry?.humanOverrides, field);
  const effectiveValue = getEffectiveValue(enquiry, field);
  const modelValue = getModelValue(enquiry, field);

  // Phase 7 — check if this specific field has an active conflict.
  // We read from the Redux conflicts array (populated by the re-extract
  // response) rather than recomputing locally, because the conflicts array
  // represents the operator's pending decisions. Once the operator resolves
  // a conflict (accept or keep), it's removed from the array.
  const conflict = reExtractConflicts.find((c) => c.field === field);
  const hasActiveConflict = Boolean(conflict);
  const newModelValue = conflict?.newModelValue;

  const isThisPending =
    fieldUpdateStatus === 'pending' && fieldUpdateId === enquiry?.id && fieldUpdateField === field;
  const isThisFailed =
    fieldUpdateStatus === 'failed' && fieldUpdateId === enquiry?.id && fieldUpdateField === field;

  // Phase 7 — accept-model lifecycle for this specific field.
  const isThisAccepting =
    acceptModelStatus === 'pending' && acceptModelId === enquiry?.id && acceptModelField === field;
  const isThisAcceptFailed =
    acceptModelStatus === 'failed' && acceptModelId === enquiry?.id && acceptModelField === field;

  // Local draft state for the input. Initialised from the effective value
  // when editing starts. Updated by the input's onChange handler. Sent to
  // the backend on Save.
  const [draft, setDraft] = useState(null);

  // When editing starts, initialise the draft from the current effective value.
  useEffect(() => {
    if (editing && draft === null) {
      setDraft(normaliseForEdit(effectiveValue, field));
    }
    if (!editing && draft !== null) {
      setDraft(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, effectiveValue, field]);

  // Focus the input when editing starts.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  // Auto-clear the field-update lifecycle state shortly after a succeeded/
  // failed result so the next edit starts from a clean slate. We use a
  // short timeout so the operator still sees the success/error feedback.
  useEffect(() => {
    if (fieldUpdateStatus === 'succeeded' || fieldUpdateStatus === 'failed') {
      const tid = setTimeout(() => {
        dispatch(clearFieldUpdateState());
      }, 1500);
      return () => clearTimeout(tid);
    }
    return undefined;
  }, [fieldUpdateStatus, dispatch]);

  // Phase 7 — auto-clear the accept-model lifecycle state shortly after
  // a succeeded/failed result.
  useEffect(() => {
    if (acceptModelStatus === 'succeeded' || acceptModelStatus === 'failed') {
      const tid = setTimeout(() => {
        dispatch(clearAcceptModelState());
      }, 1500);
      return () => clearTimeout(tid);
    }
    return undefined;
  }, [acceptModelStatus, dispatch]);

  function handleStartEdit() {
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setDraft(null);
    dispatch(clearFieldUpdateState());
  }

  function handleSave() {
    const value = denormaliseForSave(draft, field);
    dispatch(updateEnquiryField({ id: enquiry.id, field, value }))
      .unwrap()
      .then(() => {
        setEditing(false);
        setDraft(null);
      })
      .catch(() => {
        // The error is already in Redux via the rejected handler.
        // We leave `editing=true` so the operator can fix the input and retry.
      });
  }

  function handleClear() {
    // Clearing is an explicit action — we don't need to enter edit mode.
    dispatch(clearEnquiryFieldOverride({ id: enquiry.id, field }))
      .unwrap()
      .then(() => {
        // No state to reset — the slice already cleared the field-update tracking.
      })
      .catch(() => {
        // Error is in Redux; the InlineField will render the inline error.
      });
  }

  // Phase 7 — Accept the new model value for a conflicted field.
  // This dispatches the acceptNewModelValue thunk, which POSTs to
  // /fields/:field/accept-model. The backend clears the override, so
  // the effective value falls back to the new modelExtraction value
  // (which was updated by the most recent re-extraction). Priority is
  // recalculated server-side.
  function handleAcceptModel() {
    dispatch(acceptNewModelValue({ id: enquiry.id, field }))
      .unwrap()
      .then(() => {
        // The slice removes this field from reExtractConflicts on fulfilled.
        // No local state to reset.
      })
      .catch(() => {
        // Error is in Redux; the InlineField will render the inline error.
      });
  }

  // Phase 7 — Keep the confirmed (human) value for a conflicted field.
  // This is a CLIENT-SIDE ONLY action — no API call is needed because the
  // override is already preserved server-side. We just remove the field
  // from the local reExtractConflicts array so the CONFLICT UI disappears.
  // The override remains authoritative; the new model value is still
  // available in the extraction history (ExtractionVersion rows) for
  // future reference.
  function handleKeepConfirmed() {
    dispatch(acknowledgeConflict(field));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }

  // --- Render ---

  if (!enquiry) return null;

  // The chip reflects the SOURCE of the displayed value.
  // When editing, we keep the chip showing the pre-edit source (MODEL or
  // CONFIRMED) so the operator knows what they're about to change.
  const chip = overridden ? (
    <span className="font-mono text-micro tracking-widest text-accent border border-accent/40 bg-accent-soft px-1.5 py-0.5">
      CONFIRMED
    </span>
  ) : (
    <span className="font-mono text-micro tracking-widest text-ink-muted border border-line bg-surface px-1.5 py-0.5">
      MODEL
    </span>
  );

  // Accent left border when overridden (design.md §8).
  const rowBorderClass = overridden
    ? 'border-l-2 border-l-accent pl-2'
    : 'border-l-2 border-l-transparent pl-2';

  return (
    <div className={block ? `${rowBorderClass} block` : `${rowBorderClass} flex items-baseline gap-3`}>
      {/* Label + chip */}
      <div className={block ? 'mb-1' : 'w-44 shrink-0'}>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-micro tracking-widest text-ink-muted">{label}</span>
          {chip}
        </div>
      </div>

      {/* Value / input */}
      <div className="flex-1 min-w-0">
        {!editing ? (
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={`text-body text-ink ${
                mono ? 'font-mono text-small break-all' : ''
              } ${effectiveValue == null || effectiveValue === '' ? 'text-ink-muted/60' : ''} ${
                block ? 'break-words' : 'truncate'
              }`}
            >
              {formatFieldValue(effectiveValue, field)}
            </span>
            {/* Edit button */}
            <button
              type="button"
              onClick={handleStartEdit}
              disabled={isThisPending}
              className="shrink-0 font-mono text-micro text-ink-muted hover:text-ink underline-offset-2 hover:underline disabled:opacity-40 disabled:cursor-default"
              aria-label={`edit ${label.toLowerCase()}`}
            >
              [edit]
            </button>
            {/* Clear button — only shown when an override is active */}
            {overridden && (
              <button
                type="button"
                onClick={handleClear}
                disabled={isThisPending}
                className="shrink-0 font-mono text-micro text-ink-muted hover:text-danger underline-offset-2 hover:underline disabled:opacity-40 disabled:cursor-default"
                aria-label={`clear override on ${label.toLowerCase()}`}
              >
                [clear]
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {renderInput(field, draft, setDraft, inputRef, handleKeyDown, isThisPending, mono, block)}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={isThisPending}
                className="font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface disabled:opacity-40 disabled:cursor-default"
              >
                {isThisPending ? 'SAVING…' : 'SAVE'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isThisPending}
                className="font-mono text-micro text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-default"
              >
                CANCEL
              </button>
            </div>
          </div>
        )}

        {/* Inline error */}
        {isThisFailed && fieldUpdateError && (
          <p className="mt-1 font-mono text-micro text-danger">
            {fieldUpdateError.code || 'ERROR'}: {fieldUpdateError.message}
          </p>
        )}

        {/* MODEL comparison — only shown when an override is active and not editing.
            When a Phase 7 conflict is active, we suppress this line because the
            conflict UI below shows the NEW MODEL value (which is more relevant
            than the modelExtraction value, since modelExtraction was just updated
            to the new model output by the re-extraction). */}
        {overridden && !editing && !hasActiveConflict && (
          <p className="mt-1 font-mono text-micro text-ink-muted">
            MODEL: {formatFieldValue(modelValue, field)}
          </p>
        )}

        {/* Phase 7 — CONFLICT UI.
            Shown when this field has an active conflict (the new model value
            differs from the active human override). The operator must
            explicitly decide: keep the confirmed value or accept the new
            model value. The system NEVER auto-accepts. */}
        {hasActiveConflict && !editing && (
          <div className="mt-2 border border-warning/60 bg-warning-soft/40 p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-micro tracking-widest text-warning border border-warning/40 bg-surface px-1.5 py-0.5">
                CONFLICT
              </span>
              <span className="font-mono text-micro text-ink-muted">
                New model value differs from the confirmed override.
              </span>
            </div>
            <div className="flex items-baseline gap-3 pl-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-micro tracking-widest text-accent">CONFIRMED</p>
                <p className="text-body text-ink break-words">
                  {formatFieldValue(effectiveValue, field)}
                </p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-micro tracking-widest text-ink-muted">NEW MODEL</p>
                <p className="text-body text-ink-muted break-words">
                  {formatFieldValue(newModelValue, field)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-2 pt-1">
              <button
                type="button"
                onClick={handleKeepConfirmed}
                disabled={isThisAccepting}
                className="font-mono text-micro text-ink border border-line bg-surface-strong px-2 py-0.5 hover:bg-surface disabled:opacity-40 disabled:cursor-default"
                aria-label={`keep confirmed value for ${label.toLowerCase()}`}
              >
                [Keep confirmed]
              </button>
              <button
                type="button"
                onClick={handleAcceptModel}
                disabled={isThisAccepting}
                className="font-mono text-micro text-accent border border-accent/40 bg-accent-soft px-2 py-0.5 hover:bg-accent hover:text-surface-strong disabled:opacity-40 disabled:cursor-default"
                aria-label={`accept new model value for ${label.toLowerCase()}`}
              >
                {isThisAccepting ? 'ACCEPTING…' : '[Accept new model]'}
              </button>
            </div>
            {isThisAcceptFailed && acceptModelError && (
              <p className="pl-2 font-mono text-micro text-danger">
                {acceptModelError.code || 'ERROR'}: {acceptModelError.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Input renderers ------------------------------------------------------

function renderInput(field, draft, setDraft, ref, onKeyDown, disabled, mono, block) {
  switch (field) {
    case 'company':
    case 'contactName':
    case 'contactEmail':
    case 'summary':
      return (
        <input
          ref={ref}
          type="text"
          value={typeof draft === 'string' ? draft : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          maxLength={2000}
          className={`w-full border border-line bg-surface-strong px-2 py-1 text-body text-ink focus:outline-none focus:border-accent disabled:opacity-60 ${
            mono ? 'font-mono text-small' : ''
          } ${field === 'summary' || block ? 'h-20 resize-y' : ''}`}
          aria-label={`edit ${field}`}
        />
      );

    case 'serviceLine':
      return (
        <select
          ref={ref}
          value={typeof draft === 'string' ? draft : 'other'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="border border-line bg-surface-strong px-2 py-1 text-body text-ink focus:outline-none focus:border-accent disabled:opacity-60"
          aria-label="edit service line"
        >
          {SERVICE_LINE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'isGenuineProjectEnquiry':
      return (
        <div className="flex items-center gap-3" ref={ref}>
          <label className="font-mono text-micro text-ink-muted flex items-center gap-1">
            <input
              type="radio"
              name={`genuine-${field}`}
              checked={draft === true}
              onChange={() => setDraft(true)}
              onKeyDown={onKeyDown}
              disabled={disabled}
              className="accent-accent"
            />
            YES (genuine)
          </label>
          <label className="font-mono text-micro text-ink-muted flex items-center gap-1">
            <input
              type="radio"
              name={`genuine-${field}`}
              checked={draft === false}
              onChange={() => setDraft(false)}
              onKeyDown={onKeyDown}
              disabled={disabled}
              className="accent-accent"
            />
            NO (not genuine)
          </label>
        </div>
      );

    case 'budget':
      return (
        <BudgetInput
          draft={draft}
          setDraft={setDraft}
          ref={ref}
          onKeyDown={onKeyDown}
          disabled={disabled}
        />
      );

    case 'timeline':
      return (
        <input
          ref={ref}
          type="text"
          value={typeof draft === 'string' ? draft : ''}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          maxLength={500}
          className="w-full border border-line bg-surface-strong px-2 py-1 text-body text-ink focus:outline-none focus:border-accent disabled:opacity-60"
          aria-label="edit timeline raw"
        />
      );

    default:
      return null;
  }
}

/**
 * BudgetInput — structured form for editing the 5 budget sub-fields.
 *
 * Preserves the existing budget structure (Rules.md §6):
 *   raw, currency, min, max, qualifier
 *
 * The operator can edit any subset of these. The `normalized` field is
 * not part of the budget subdocument (it's only on timeline), so we
 * don't expose it here.
 */
const BudgetInput = forwardRef(function BudgetInput({ draft, setDraft, onKeyDown, disabled }, ref) {
  const b = draft && typeof draft === 'object' ? draft : {};

  function update(patch) {
    setDraft({ ...b, ...patch });
  }

  return (
    <div className="grid grid-cols-2 gap-2 border border-line bg-surface p-2" ref={ref}>
      <label className="block">
        <span className="font-mono text-micro text-ink-muted block mb-0.5">RAW</span>
        <input
          type="text"
          value={typeof b.raw === 'string' ? b.raw : ''}
          onChange={(e) => update({ raw: e.target.value })}
          onKeyDown={onKeyDown}
          disabled={disabled}
          maxLength={500}
          className="w-full border border-line bg-surface-strong px-1.5 py-0.5 text-small text-ink focus:outline-none focus:border-accent disabled:opacity-60"
        />
      </label>
      <label className="block">
        <span className="font-mono text-micro text-ink-muted block mb-0.5">CURRENCY</span>
        <input
          type="text"
          value={typeof b.currency === 'string' ? b.currency : ''}
          onChange={(e) => update({ currency: e.target.value || null })}
          onKeyDown={onKeyDown}
          disabled={disabled}
          maxLength={20}
          placeholder="GBP, USD, EUR, £, $, €…"
          className="w-full border border-line bg-surface-strong px-1.5 py-0.5 text-small text-ink focus:outline-none focus:border-accent disabled:opacity-60"
        />
      </label>
      <label className="block">
        <span className="font-mono text-micro text-ink-muted block mb-0.5">MIN</span>
        <input
          type="number"
          value={typeof b.min === 'number' ? b.min : ''}
          onChange={(e) => update({ min: e.target.value === '' ? null : Number(e.target.value) })}
          onKeyDown={onKeyDown}
          disabled={disabled}
          min="0"
          step="1"
          className="w-full border border-line bg-surface-strong px-1.5 py-0.5 text-small text-ink focus:outline-none focus:border-accent disabled:opacity-60"
        />
      </label>
      <label className="block">
        <span className="font-mono text-micro text-ink-muted block mb-0.5">MAX</span>
        <input
          type="number"
          value={typeof b.max === 'number' ? b.max : ''}
          onChange={(e) => update({ max: e.target.value === '' ? null : Number(e.target.value) })}
          onKeyDown={onKeyDown}
          disabled={disabled}
          min="0"
          step="1"
          className="w-full border border-line bg-surface-strong px-1.5 py-0.5 text-small text-ink focus:outline-none focus:border-accent disabled:opacity-60"
        />
      </label>
      <label className="block col-span-2">
        <span className="font-mono text-micro text-ink-muted block mb-0.5">QUALIFIER</span>
        <select
          value={typeof b.qualifier === 'string' ? b.qualifier : 'unknown'}
          onChange={(e) => update({ qualifier: e.target.value })}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="w-full border border-line bg-surface-strong px-1.5 py-0.5 text-small text-ink focus:outline-none focus:border-accent disabled:opacity-60"
        >
          {BUDGET_QUALIFIER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
});

// --- Value normalisation --------------------------------------------------

/**
 * Convert the effective value into a draft suitable for the input.
 * For text fields, this is just the string. For budget, it's the budget
 * object. For timeline, it's the raw string (we don't expose normalized
 * in the editor). For isGenuineProjectEnquiry, it's the boolean.
 */
function normaliseForEdit(value, field) {
  if (field === 'timeline') {
    // Edit only the raw wording. normalized is preserved as-is from the
    // model (or from a prior override) — we send the full timeline object
    // back on Save so the backend doesn't lose it.
    return value && typeof value === 'object' && typeof value.raw === 'string' ? value.raw : '';
  }
  if (field === 'budget') {
    // Edit the full budget subdocument.
    if (value && typeof value === 'object') {
      return {
        raw: typeof value.raw === 'string' ? value.raw : '',
        currency: typeof value.currency === 'string' ? value.currency : '',
        min: typeof value.min === 'number' ? value.min : null,
        max: typeof value.max === 'number' ? value.max : null,
        qualifier: typeof value.qualifier === 'string' ? value.qualifier : 'unknown',
      };
    }
    return { raw: '', currency: '', min: null, max: null, qualifier: 'unknown' };
  }
  // Text / select / boolean — pass through.
  return value ?? '';
}

/**
 * Convert the draft back into the value to send to the backend.
 * For timeline, we send { raw: draft } — the backend accepts a partial
 * timeline object (validateTimelineValue allows normalized to be omitted).
 * For budget, we send the full budget object with currency coerced from
 * '' to null. For isGenuineProjectEnquiry, the radio input already
 * produces a strict boolean.
 */
function denormaliseForSave(draft, field) {
  if (field === 'timeline') {
    return { raw: typeof draft === 'string' ? draft : '' };
  }
  if (field === 'budget') {
    const b = draft && typeof draft === 'object' ? draft : {};
    return {
      raw: typeof b.raw === 'string' ? b.raw : '',
      currency: typeof b.currency === 'string' && b.currency !== '' ? b.currency : null,
      min: typeof b.min === 'number' && Number.isFinite(b.min) ? b.min : null,
      max: typeof b.max === 'number' && Number.isFinite(b.max) ? b.max : null,
      qualifier: typeof b.qualifier === 'string' ? b.qualifier : 'unknown',
    };
  }
  // For isGenuineProjectEnquiry, the backend expects a strict boolean.
  // The radio input only produces true/false, so draft is already correct.
  // For text fields, draft is a string (possibly empty — that's a valid
  // override meaning "explicitly cleared").
  return draft;
}
