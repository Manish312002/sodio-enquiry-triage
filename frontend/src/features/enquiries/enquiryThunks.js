/**
 * createAsyncThunk wrappers for enquiry API workflows.
 *
 * Phase 0 scope: only `fetchHealth` exists. It calls GET /api/health and
 * returns the parsed JSON. This proves:
 *   - Redux Toolkit is wired;
 *   - createAsyncThunk works (pending/fulfilled/rejected);
 *   - the Vite proxy → Express backend path is healthy end-to-end;
 *   - the health endpoint reflects real MongoDB state, not a faked value.
 *
 * Phase 1+ will add: fetchEnquiries, createEnquiry, importEnquiries,
 * updateStatus, updateField, reExtract, fetchBatchProgress.
 */
import { createAsyncThunk } from '@reduxjs/toolkit';
import apiClient from '../../services/api';

/**
 * @returns {Promise<{
 *   status: 'ok'|'degraded',
 *   db: 'connected'|'connecting'|'disconnected'|'error',
 *   dbHost: string|null,
 *   uptime: number,
 *   version: string,
 *   env: string,
 *   timestamp: string,
 * }>}
 */
export const fetchHealth = createAsyncThunk(
  'enquiries/fetchHealth',
  async (_arg, { rejectWithValue }) => {
    try {
      const { data } = await apiClient.get('/health');
      return data;
    } catch (err) {
      // Normalize the error so the UI can render a clean message.
      const message =
        err?.response?.data?.error?.message ||
        err?.message ||
        'Unable to reach backend /api/health';
      return rejectWithValue(message);
    }
  },
);
