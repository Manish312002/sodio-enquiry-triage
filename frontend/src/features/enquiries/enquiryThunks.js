/**
 * Enquiry thunks (createAsyncThunk).
 *
 * Phase 1 surface:
 *   - createEnquiry({ originalText, sender? })  -> POST /api/enquiries
 *   - fetchEnquiry(id)                          -> GET  /api/enquiries/:id
 *   - fetchEnquiries({ limit? })                -> GET  /api/enquiries
 *
 * `fetchHealth` from Phase 0 is kept for the connectivity indicator.
 *
 * Architectural rules (Architechure.md §14):
 *   - No LLM calls from React — only REST.
 *   - No secrets in thunks.
 *   - LLM provider keys never live here; they are server-side only.
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
 * @param {{ limit?: number }} [arg]
 * @returns {Promise<{ enquiries: object[], count: number }>}
 */
export const fetchEnquiries = createAsyncThunk(
  'enquiries/fetchEnquiries',
  async (arg, { rejectWithValue }) => {
    try {
      const params = {};
      if (arg?.limit) params.limit = arg.limit;
      const { data } = await apiClient.get('/enquiries', { params });
      return data;
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
