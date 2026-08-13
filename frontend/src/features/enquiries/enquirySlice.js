/**
 * Enquiry slice.
 *
 * Architechure.md §11 specified state shape:
 *   enquiries: { items, selectedId, filters, sort, loading, error, batch }
 *
 * Phase 5 additions:
 *   - filters { serviceLine, priority, status } now drive the fetchEnquiries
 *     thunk — selectors re-dispatch when filters change.
 *   - sort { by, dir } likewise. by ∈ 'priority' | 'receivedAt'; dir ∈ 'asc'|'desc'.
 *   - updateEnquiryStatus thunk updates the matching item in-place AND
 *     the selected enquiry if it matches.
 *   - statusUpdateStatus / statusUpdateError track the status-mutation
 *     lifecycle so the UI can show a per-row "saving…" / inline error.
 *
 * Phase 6 additions:
 *   - updateEnquiryField / clearEnquiryFieldOverride thunks handle inline
 *     field editing. On success they patch BOTH the selected enquiry AND
 *     the matching queue item (so the queue's priority badge reflects the
 *     new score without a refetch).
 *   - fieldUpdateStatus / fieldUpdateError / fieldUpdateId / fieldUpdateField
 *     track the per-field mutation lifecycle so the InlineField component
 *     can show "SAVING…" / inline error / disable the input while pending.
 *
 * Phase 1 retained:
 *   - items[], selectedId, selected, selectedStatus/Error
 *   - createStatus / createError / lastCreatedId
 *
 * Phase 0 retained:
 *   - system.health / healthStatus / healthError
 *
 * NO scoring logic lives here. Priority is read from enquiry.priority
 * as returned by the backend (Rules.md §9 / Phase 4 boundary). The
 * frontend never recomputes priority and never sets it directly — the
 * PATCH /fields/:field endpoint derives priority server-side.
 */
import { createSlice } from '@reduxjs/toolkit';
import {
  fetchHealth,
  createEnquiry,
  fetchEnquiry,
  fetchEnquiries,
  updateEnquiryStatus,
  updateEnquiryField,
  clearEnquiryFieldOverride,
} from './enquiryThunks';

const initialState = {
  // Enquiry queue
  items: [],
  listStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  listError: null,

  selectedId: null,
  selected: null,
  selectedStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  selectedError: null,

  // Paste submission (Phase 1)
  createStatus: 'idle',
  createError: null,
  lastCreatedId: null,

  // Phase 5 — filters + sort. These drive the fetchEnquiries thunk.
  // 'all' means "no filter" — the backend treats it as omission.
  filters: { serviceLine: 'all', priority: 'all', status: 'all' },
  sort: { by: 'receivedAt', dir: 'desc' },

  // Phase 5 — status mutation lifecycle
  statusUpdateStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  statusUpdateError: null,
  statusUpdateId: null, // which enquiry id is currently being updated

  // Phase 6 — field override mutation lifecycle.
  // Tracks the in-flight PATCH /fields/:field request so the InlineField
  // component can show "SAVING…", disable its input, and surface inline
  // errors. fieldUpdateField lets us know WHICH field on the enquiry is
  // being updated (so multiple fields don't all show "SAVING…").
  fieldUpdateStatus: 'idle', // 'idle' | 'pending' | 'succeeded' | 'failed'
  fieldUpdateError: null,
  fieldUpdateId: null, // enquiry id
  fieldUpdateField: null, // field name being updated

  // Phase 0 — system health
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
    // --- Phase 5 filter / sort reducers ---
    setServiceLineFilter(state, action) {
      state.filters.serviceLine = action.payload;
    },
    setPriorityFilter(state, action) {
      state.filters.priority = action.payload;
    },
    setStatusFilter(state, action) {
      state.filters.status = action.payload;
    },
    resetFilters(state) {
      state.filters = { serviceLine: 'all', priority: 'all', status: 'all' };
    },
    setSortBy(state, action) {
      state.sort.by = action.payload;
    },
    toggleSortDir(state) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    },
    setSortDir(state, action) {
      state.sort.dir = action.payload === 'asc' ? 'asc' : 'desc';
    },

    // --- selection / UI helpers ---
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
    clearStatusUpdateState(state) {
      state.statusUpdateStatus = 'idle';
      state.statusUpdateError = null;
      state.statusUpdateId = null;
    },
    // Phase 6 — clear the per-field mutation lifecycle state. Called by
    // the InlineField component after showing success/error feedback so
    // the next edit starts from a clean slate.
    clearFieldUpdateState(state) {
      state.fieldUpdateStatus = 'idle';
      state.fieldUpdateError = null;
      state.fieldUpdateId = null;
      state.fieldUpdateField = null;
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

    // --- fetch list (Phase 1 + Phase 5 filters/sort) ---
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

    // --- update status (Phase 5) ---
    builder
      .addCase(updateEnquiryStatus.pending, (state, action) => {
        state.statusUpdateStatus = 'pending';
        state.statusUpdateError = null;
        state.statusUpdateId = action.meta.arg.id;
      })
      .addCase(updateEnquiryStatus.fulfilled, (state, action) => {
        state.statusUpdateStatus = 'succeeded';
        const updated = action.payload;
        // Patch the matching queue item in-place.
        state.items = state.items.map((e) => (e.id === updated.id ? updated : e));
        // Patch the selected enquiry if it matches.
        if (state.selectedId === updated.id) {
          state.selected = updated;
        }
        // Clear the pending id after a short delay would be ideal, but to
        // keep the slice simple we leave it; the UI clears via the
        // clearStatusUpdateState action after showing feedback.
        state.statusUpdateId = null;
      })
      .addCase(updateEnquiryStatus.rejected, (state, action) => {
        state.statusUpdateStatus = 'failed';
        state.statusUpdateError = action.payload ?? { message: 'Unknown error' };
        state.statusUpdateId = null;
      });

    // --- field override (Phase 6) ---
    // updateEnquiryField and clearEnquiryFieldOverride share the same
    // lifecycle tracking because they share the same UI surface (the
    // InlineField component). Either thunk's pending/fulfilled/rejected
    // event updates fieldUpdateStatus / fieldUpdateId / fieldUpdateField.
    builder
      .addCase(updateEnquiryField.pending, (state, action) => {
        state.fieldUpdateStatus = 'pending';
        state.fieldUpdateError = null;
        state.fieldUpdateId = action.meta.arg.id;
        state.fieldUpdateField = action.meta.arg.field;
      })
      .addCase(updateEnquiryField.fulfilled, (state, action) => {
        state.fieldUpdateStatus = 'succeeded';
        const updated = action.payload;
        // Patch the matching queue item in-place so the priority badge
        // in the queue reflects the new score without a refetch.
        state.items = state.items.map((e) => (e.id === updated.id ? updated : e));
        // Patch the selected enquiry if it matches.
        if (state.selectedId === updated.id) {
          state.selected = updated;
        }
        state.fieldUpdateId = null;
        state.fieldUpdateField = null;
      })
      .addCase(updateEnquiryField.rejected, (state, action) => {
        state.fieldUpdateStatus = 'failed';
        state.fieldUpdateError = action.payload ?? { message: 'Unknown error' };
        state.fieldUpdateId = null;
        state.fieldUpdateField = null;
      });

    // clearEnquiryFieldOverride uses the same lifecycle as updateEnquiryField
    // (it's just updateEnquiryField with value=null under the hood). We
    // track it separately so the action types are unambiguous, but the
    // state mutations are identical.
    builder
      .addCase(clearEnquiryFieldOverride.pending, (state, action) => {
        state.fieldUpdateStatus = 'pending';
        state.fieldUpdateError = null;
        state.fieldUpdateId = action.meta.arg.id;
        state.fieldUpdateField = action.meta.arg.field;
      })
      .addCase(clearEnquiryFieldOverride.fulfilled, (state, action) => {
        state.fieldUpdateStatus = 'succeeded';
        const updated = action.payload;
        state.items = state.items.map((e) => (e.id === updated.id ? updated : e));
        if (state.selectedId === updated.id) {
          state.selected = updated;
        }
        state.fieldUpdateId = null;
        state.fieldUpdateField = null;
      })
      .addCase(clearEnquiryFieldOverride.rejected, (state, action) => {
        state.fieldUpdateStatus = 'failed';
        state.fieldUpdateError = action.payload ?? { message: 'Unknown error' };
        state.fieldUpdateId = null;
        state.fieldUpdateField = null;
      });
  },
});

export const {
  clearCreateState,
  setSelectedId,
  resetSelected,
  resetSystem,
  setServiceLineFilter,
  setPriorityFilter,
  setStatusFilter,
  resetFilters,
  setSortBy,
  toggleSortDir,
  setSortDir,
  clearStatusUpdateState,
  clearFieldUpdateState,
} = enquirySlice.actions;

export default enquirySlice.reducer;
