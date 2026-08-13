/**
 * Enquiry slice.
 *
 * Architechure.md §11 specified state shape:
 *   enquiries: { items, selectedId, filters, sort, loading, error, batch }
 *
 * Phase 1 additions:
 *   - items[] now populated via fetchEnquiries
 *   - selectedId + selected hold the currently viewed enquiry (fetchEnquiry)
 *   - createStatus tracks the paste-submission lifecycle (idle|pending|succeeded|failed)
 *   - createError holds a normalized { message, code, status } on failure
 *   - lastCreatedId kept in localStorage by App.jsx so a refresh can re-fetch
 *
 * Phase 0 `system` sub-state is retained for the health indicator.
 */
import { createSlice } from '@reduxjs/toolkit';
import {
  fetchHealth,
  createEnquiry,
  fetchEnquiry,
  fetchEnquiries,
} from './enquiryThunks';

const initialState = {
  // Phase 1 — enquiry queue
  items: [],
  listStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  listError: null,

  selectedId: null,
  selected: null,
  selectedStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  selectedError: null,

  // Phase 1 — paste submission
  createStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  createError: null,
  lastCreatedId: null,

  // Phase 5+ will populate filters/sort; declared now so the shape is stable.
  filters: { serviceLine: 'all', priority: 'all', status: 'all' },
  sort: { by: 'priority', dir: 'desc' },

  // Phase 0 — system health indicator (kept for App.jsx shell).
  system: {
    health: null,
    healthStatus: 'idle',
    healthError: null,
  },
};

const enquirySlice = createSlice({
  name: 'enquiries',
  initialState,
  reducers: {
    // --- selection / phase 5+ UI reducers will live here; for now a reset is enough ---
    clearCreateState(state) {
      state.createStatus = 'idle';
      state.createError = null;
    },
    setSelectedId(state, action) {
      state.selectedId = action.payload;
      state.selected = null;
      state.selectedStatus = 'idle';
      state.selectedError = null;
    },
    resetSelected(state) {
      state.selectedId = null;
      state.selected = null;
      state.selectedStatus = 'idle';
      state.selectedError = null;
    },
    resetSystem(state) {
      state.system = initialState.system;
    },
  },
  extraReducers: (builder) => {
    // --- health (Phase 0) ---
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
        state.system.healthError = action.payload?.message ?? 'Unknown error';
      });

    // --- create enquiry (Phase 1) ---
    builder
      .addCase(createEnquiry.pending, (state) => {
        state.createStatus = 'pending';
        state.createError = null;
      })
      .addCase(createEnquiry.fulfilled, (state, action) => {
        state.createStatus = 'succeeded';
        state.lastCreatedId = action.payload.id;
        // Prepend the new enquiry to the queue so the UI updates immediately.
        state.items = [action.payload, ...state.items.filter((e) => e.id !== action.payload.id)];
        // Also select it so the detail view shows it without an extra round-trip.
        state.selectedId = action.payload.id;
        state.selected = action.payload;
        state.selectedStatus = 'succeeded';
        state.selectedError = null;
      })
      .addCase(createEnquiry.rejected, (state, action) => {
        state.createStatus = 'failed';
        state.createError = action.payload ?? { message: 'Unknown error' };
      });

    // --- fetch single enquiry (Phase 1, used after refresh) ---
    builder
      .addCase(fetchEnquiry.pending, (state, action) => {
        state.selectedId = action.meta.arg;
        state.selectedStatus = 'pending';
        state.selectedError = null;
        state.selected = null;
      })
      .addCase(fetchEnquiry.fulfilled, (state, action) => {
        state.selectedStatus = 'succeeded';
        state.selected = action.payload;
        state.selectedId = action.payload.id;
        // Keep the queue in sync if the fetched enquiry is not yet listed.
        if (!state.items.some((e) => e.id === action.payload.id)) {
          state.items = [action.payload, ...state.items];
        }
      })
      .addCase(fetchEnquiry.rejected, (state, action) => {
        state.selectedStatus = 'failed';
        state.selectedError = action.payload ?? { message: 'Unknown error' };
      });

    // --- fetch list (Phase 1, basic) ---
    builder
      .addCase(fetchEnquiries.pending, (state) => {
        state.listStatus = 'pending';
        state.listError = null;
      })
      .addCase(fetchEnquiries.fulfilled, (state, action) => {
        state.listStatus = 'succeeded';
        state.items = action.payload.enquiries;
      })
      .addCase(fetchEnquiries.rejected, (state, action) => {
        state.listStatus = 'failed';
        state.listError = action.payload ?? { message: 'Unknown error' };
      });
  },
});

export const { clearCreateState, setSelectedId, resetSelected, resetSystem } = enquirySlice.actions;
export default enquirySlice.reducer;
