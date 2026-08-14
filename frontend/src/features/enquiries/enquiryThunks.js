/**
 * Enquiry thunks (createAsyncThunk).
 *
 * surface:
 *   - createEnquiry({ originalText, sender? })  -> POST /api/enquiries
 *   - fetchEnquiry(id)                          -> GET  /api/enquiries/:id
 *   - fetchEnquiries({ limit? })                -> GET  /api/enquiries
 *
 * additions:
 *   - fetchEnquiries({ serviceLine, priority, status, sort, dir, limit })
 *       — query params are now passed to GET /api/enquiries (the backend
 *         applies the filters + sort server-side).
 *   - updateEnquiryStatus({ id, status })       -> PATCH /api/enquiries/:id/status
 *
 * additions:
 *   - updateEnquiryField({ id, field, value })  -> PATCH /api/enquiries/:id/fields/:field
 *       Applies a human override to a single extracted field. Pass
 *       `value: null` to clear the override (fall back to model extraction).
 *       The backend validates the field name against an allowlist and the
 *       value shape per-field. Priority is recalculated server-side and
 *       returned with the updated enquiry.
 *   - clearEnquiryFieldOverride({ id, field })  -> PATCH /api/enquiries/:id/fields/:field
 *       Convenience wrapper for updateEnquiryField with value=null. The
 *       intent is more readable at the call site.
 *
 * `fetchHealth` is kept for the connectivity indicator.
 *
 * Architectural rules:
 *   - No LLM calls from React — only REST.
 *   - No secrets in thunks.
 *   - LLM provider keys never live here; they are server-side only.
 *   - Priority is NEVER set directly by the client — it is always derived
 *     by the backend from the effective extraction.
 *
 * On rejection, thunks return a normalized payload `{ message, code?, status? }`
 * so the UI can render a readable error rather than a raw Error object.
 */
import { createAsyncThunk } from '@reduxjs/toolkit';
import apiClient from '../../services/api.js';

/**
 * @param {{ originalText: string, sender?: { name?: string, email?: string } }} payload
 * @returns {Promise<object>}  The enquiry response shape (see backend toApiResponse).
 */
export const createEnquiry = createAsyncThunk(
  'enquiries/createEnquiry',
  async (payload, { rejectWithValue }) => {
    try {
      const body = {
        source: 'paste',
        originalText: payload.originalText,
      };
      if (payload.sender && (payload.sender.name || payload.sender.email)) {
        body.sender = {
          ...(payload.sender.name ? { name: payload.sender.name } : {}),
          ...(payload.sender.email ? { email: payload.sender.email } : {}),
        };
      }
      const { data } = await apiClient.post('/enquiries', body);
      return data.enquiry;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * @param {string} id
 * @returns {Promise<object>}
 */
export const fetchEnquiry = createAsyncThunk(
  'enquiries/fetchEnquiry',
  async (id, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/enquiries/${id}`);
      return data.enquiry;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * extended to pass filter + sort query params to the backend.
 *
 * @param {{
 *   serviceLine?: 'all'|'ai'|'blockchain'|'web'|'mobile'|'game'|'other',
 *   priority?:    'all'|'high'|'medium'|'low',
 *   status?:      'all'|'new'|'contacted'|'qualified'|'dropped',
 *   sort?:        'priority'|'receivedAt',
 *   dir?:         'asc'|'desc',
 *   limit?:       number,
 * }} [arg]
 * @returns {Promise<{ enquiries: object[], count: number }>}
 */
export const fetchEnquiries = createAsyncThunk(
  'enquiries/fetchEnquiries',
  async (arg, { rejectWithValue }) => {
    try {
      const params = {};
      if (arg?.limit) params.limit = arg.limit;
      if (arg?.serviceLine && arg.serviceLine !== 'all') params.serviceLine = arg.serviceLine;
      if (arg?.priority && arg.priority !== 'all') params.priority = arg.priority;
      if (arg?.status && arg.status !== 'all') params.status = arg.status;
      if (arg?.sort) params.sort = arg.sort;
      if (arg?.dir) params.dir = arg.dir;
      const { data } = await apiClient.get('/enquiries', { params });
      return data;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * update enquiry workflow status.
 *
 * @param {{ id: string, status: 'new'|'contacted'|'qualified'|'dropped' }} payload
 * @returns {Promise<object>}  The updated enquiry response shape.
 */
export const updateEnquiryStatus = createAsyncThunk(
  'enquiries/updateEnquiryStatus',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(
        `/enquiries/${payload.id}/status`,
        { status: payload.status },
      );
      return data.enquiry;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * apply a human override to a single extracted field.
 *
 * Flow C: "Edit field → save override → recalculate
 * priority → return updated enquiry."
 *
 * The backend validates:
 *   - the field name is in OVERRIDEABLE_FIELDS (company, contactName,
 *     contactEmail, serviceLine, budget, timeline, summary,
 *     isGenuineProjectEnquiry). `priority`, `originalText`, etc. are
 *     rejected with INVALID_FIELD.
 *   - the value shape matches the field's expected type
 *     (INVALID_FIELD_VALUE on mismatch).
 *   - the enquiry exists (NOT_FOUND).
 *   - the id is a valid ObjectId (INVALID_ID).
 *
 * After the override is applied, the backend recomputes effectiveExtraction
 * (modelExtraction + humanOverrides) and recalculates priority via the
 * existing scoringService. The returned enquiry includes the new
 * effectiveExtraction, the preserved modelExtraction, the updated
 * humanOverrides, and the new priority.
 *
 * Pass `value: null` to CLEAR the override — the effective value falls
 * back to the model extraction, and priority is recalculated.
 *
 * @param {{ id: string, field: string, value: unknown }} payload
 * @returns {Promise<object>}  The updated enquiry response shape.
 */
export const updateEnquiryField = createAsyncThunk(
  'enquiries/updateEnquiryField',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(
        `/enquiries/${payload.id}/fields/${payload.field}`,
        { value: payload.value },
      );
      return data.enquiry;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * clear a human override on a single field.
 *
 * Convenience wrapper for updateEnquiryField with value=null. After
 * clearing, the effective value falls back to the latest successful model
 * extraction, and priority is recalculated.
 *
 * @param {{ id: string, field: string }} payload
 * @returns {Promise<object>}  The updated enquiry response shape.
 */
export const clearEnquiryFieldOverride = createAsyncThunk(
  'enquiries/clearEnquiryFieldOverride',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.patch(
        `/enquiries/${payload.id}/fields/${payload.field}`,
        { value: null },
      );
      return data.enquiry;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * re-extract an enquiry safely.
 *
 * Flow D: triggers a new LLM extraction (Groq → Gemini
 * fallback) and persists it as a NEW ExtractionVersion (append-only). The
 * existing human overrides are PRESERVED — the new model extraction is
 * stored in `modelExtraction` and merged with the existing overrides in
 * `effectiveExtraction` (overrides win).
 *
 * The response includes a `conflicts` array listing fields where the new
 * model value differs from an active human override. The UI surfaces these
 * so the operator can explicitly decide per field:
 *   - Keep the confirmed (human) value  → no API call (override stays)
 *   - Accept the new model value         → dispatch(acceptNewModelValue)
 *
 * Failure behaviour: if both Groq and Gemini fail, the existing
 * modelExtraction, effectiveExtraction, humanOverrides, and priority are
 * ALL preserved unchanged. Only extractionState transitions to 'failed'.
 *
 * The thunk returns the FULL response shape (not just the enquiry) so the
 * slice can store the conflicts array and the outcome metadata.
 *
 * @param {{ id: string }} payload
 * @returns {Promise<{ enquiry: object, versions: object[], outcome: object, conflicts: Array }>}
 */
export const reExtractEnquiry = createAsyncThunk(
  'enquiries/reExtractEnquiry',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(`/enquiries/${payload.id}/re-extract`);
      return data;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * accept the new model value for a conflicted field.
 *
 * After a re-extraction produces a model value that conflicts with an
 * active human override, the operator can explicitly accept the new model
 * value. This endpoint clears the override for that field, so the
 * effective value falls back to the new modelExtraction value (which was
 * updated by the most recent re-extraction). Priority is recalculated.
 *
 * IMPORTANT: This action is EXPLICIT. The system NEVER automatically
 * accepts a new model value merely because re-extraction succeeded.
 *
 * The "Keep confirmed" action does NOT require an API call — the override
 * is already preserved server-side. The frontend just clears the local
 * "conflict acknowledged" UI state.
 *
 * @param {{ id: string, field: string }} payload
 * @returns {Promise<object>}  The updated enquiry response shape.
 */
export const acceptNewModelValue = createAsyncThunk(
  'enquiries/acceptNewModelValue',
  async (payload, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(
        `/enquiries/${payload.id}/fields/${payload.field}/accept-model`,
      );
      return data;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * import a sample-enquiries file and start batch extraction.
 *
 * Flow B: Upload → POST /api/enquiries/import →
 * parse → persist enquiries → create batch job → bounded concurrent
 * extraction → GET /api/batches/:id → polling → batch progress UI.
 *
 * The backend parses the file, persists enquiries, creates a BatchJob,
 * and kicks off background extraction (NOT awaited by the HTTP handler).
 * The response includes a `batch` field with the batchId so the frontend
 * can start polling GET /api/batches/:id immediately.
 *
 * The thunk returns the FULL response shape (enquiries + failed + meta +
 * batch) so the slice can store the batchId and prepend the new enquiries
 * to the queue.
 *
 * @param {File} file The .txt file from the file input.
 * @returns {Promise<{enquiries: object[], failed: object[], meta: object, batch: object|null}>}
 */
export const importBatch = createAsyncThunk(
  'enquiries/importBatch',
  async (file, { rejectWithValue }) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await apiClient.post('/enquiries/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        // File uploads can take longer than the default 10s timeout.
        timeout: 60_000,
      });
      return data;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * fetch batch progress + counters.
 *
 * GET /api/batches/:id returns the current state of the batch: total,
 * pending, processing, completed, failed, status, failures[].
 *
 * The frontend polls this endpoint while status === 'processing' and stops
 * polling once status transitions to a terminal state (completed |
 * completed_with_errors | failed).
 *
 * @param {string} batchId
 * @returns {Promise<object>}  The batch response shape.
 */
export const fetchBatch = createAsyncThunk(
  'enquiries/fetchBatch',
  async (batchId, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get(`/batches/${batchId}`);
      return data.batch;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * refresh batch counters from live enquiry state.
 *
 * POST /api/batches/:id/refresh recomputes the pending/processing/
 * completed/failed counters from the enquiry documents. Useful after
 * the operator retries a failed item via reExtractEnquiry (which
 * bypasses batchService and leaves the counters stale).
 *
 * @param {string} batchId
 * @returns {Promise<object>}  The refreshed batch response shape.
 */
export const refreshBatch = createAsyncThunk(
  'enquiries/refreshBatch',
  async (batchId, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.post(`/batches/${batchId}/refresh`);
      return data.batch;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * Health connectivity thunk. Kept here so App.jsx has a single
 * import surface for system + enquiry thunks.
 */
export const fetchHealth = createAsyncThunk(
  'enquiries/fetchHealth',
  async (_arg, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get('/health');
      return data;
    } catch (err) {
      return rejectWithValue({ message: normalizeError(err).message });
    }
  },
);

/**
 * Normalize an axios error into a safe, UI-friendly payload.
 * Never exposes the request URL or auth headers.
 */
function normalizeError(err) {
  const status = err?.response?.status || null;
  const serverMsg = err?.response?.data?.error?.message;
  const code = err?.response?.data?.error?.code || err?.code || 'UNKNOWN';
  const message =
    serverMsg ||
    (err?.code === 'ECONNABORTED' ? 'Request timed out.' : null) ||
    err?.message ||
    'Unable to reach the backend.';
  return { message, code, status };
}
