/**
 * Enquiry slice — Phase 0 placeholder.
 *
 * Architechure.md §11 specifies the eventual shape:
 *   enquiries: { items, selectedId, filters, sort, loading, error, batch }
 *
 * Phase 0 only includes:
 *   - an empty items array (so selectors compile and the queue renders an
 *     "empty" state);
 *   - a small `system` sub-state for the Phase 0 health/connectivity thunk.
 *
 * The real enquiry feature (createAsyncThunk for fetchEnquiries,
 * createEnquiry, importEnquiries, updateField, reExtract, etc.) lands in
 * Phase 1+ — NOT here.
 */
import { createSlice } from '@reduxjs/toolkit';
import { fetchHealth } from './enquiryThunks';

const initialState = {
  // Phase 1+ will populate this. Phase 0 leaves it empty on purpose.
  items: [],
  selectedId: null,
  filters: { serviceLine: 'all', priority: 'all', status: 'all' },
  sort: { by: 'priority', dir: 'desc' },
  loading: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  error: null,

  // Phase 0 system state — proves Redux + createAsyncThunk wiring.
  system: {
    health: null, // { status, db, dbHost, uptime, version, env, timestamp }
    healthStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
    healthError: null,
  },
};

const enquirySlice = createSlice({
  name: 'enquiries',
  initialState,
  reducers: {
    // Phase 1+ reducers (setSelected, setFilter, setSort, etc.) will live here.
    // Intentionally empty for Phase 0.
    resetSystem(state) {
      state.system = initialState.system;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchHealth.pending, (state) => {
        state.system.healthStatus = 'pending';
        state.system.healthError = null;
      })
      .addCase(fetchHealth.fulfilled, (state, action) => {
        state.system.healthStatus = 'succeeded';
        state.system.health = action.payload;
      })
      .addCase(fetchHealth.rejected, (state, action) => {
        state.system.healthStatus = 'failed';
        state.system.healthError = action.payload ?? action.error?.message ?? 'Unknown error';
      });
  },
});

export const { resetSystem } = enquirySlice.actions;
export default enquirySlice.reducer;
