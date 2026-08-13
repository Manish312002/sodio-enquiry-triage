/**
 * Enquiry thunks (createAsyncThunk).
 *
 * Phase 1 surface:
 *   - createEnquiry({ originalText, sender? })  -> POST /api/enquiries
 *   - fetchEnquiry(id)                          -> GET  /api/enquiries/:id
 *   - fetchEnquiries({ limit? })                -> GET  /api/enquiries
 *
 * Phase 5 additions:
 *   - fetchEnquiries({ serviceLine, priority, status, sort, dir, limit })
 *       — query params are now passed to GET /api/enquiries (the backend
 *         applies the filters + sort server-side).
 *   - updateEnquiryStatus({ id, status })       -> PATCH /api/enquiries/:id/status
 *
 * Phase 6 additions:
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
 * `fetchHealth` from Phase 0 is kept for the connectivity indicator.
 *
 * Architectural rules (Architechure.md §14):
 *   - No LLM calls from React — only REST.
 *   - No secrets in thunks.
 *   - LLM provider keys never live here; they are server-side only.
 *   - Priority is NEVER set directly by the client — it is always derived
 *     by the backend from the effective extraction (Rules.md §9).
 *
 * On rejection, thunks return a normalized payload `{ message, code?, status? }`
 * so the UI can render a readable error rather than a raw Error object.
 */
import { createAsyncThunk } from '@reduxjs/toolkit';
import apiClient from '../../services/api';

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
 * Phase 5 — extended to pass filter + sort query params to the backend.
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
 * Phase 5 — update enquiry workflow status.
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
 * Phase 6 — apply a human override to a single extracted field.
 *
 * Architechure.md §4 Flow C: "Edit field → save override → recalculate
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
 * existing Phase 4 scoringService. The returned enquiry includes the new
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
 * Phase 6 — clear a human override on a single field.
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
 * Health connectivity thunk (Phase 0). Kept here so App.jsx has a single
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
