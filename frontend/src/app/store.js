/**
 * Redux store.
 *
 *: only the `enquiries` slice is registered (with the fetchHealth
 * thunk). specifies the eventual shape; we add fields
 * to the slice and register new slices as later phases require.
 */
import { configureStore } from '@reduxjs/toolkit';
import enquiryReducer from '../features/enquiries/enquirySlice';

export const store = configureStore({
  reducer: {
    enquiries: enquiryReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware(),
  devTools: import.meta.env.DEV,
});

export default store;
