/**
 * Axios client for the backend API.
 *
 * - baseURL comes from VITE_API_BASE_URL (defaults to '/api', which the Vite
 *   dev server proxies to http://localhost:3001).
 * - No auth headers are sent (no authentication in this project, per PRD.md §6).
 * - LLM provider keys never live here — they are server-side only.
 */
import axios from 'axios';

// `import.meta.env` is a Vite-specific global. In Node (e.g. when the
// slice is imported by unit tests), `import.meta.env` is undefined, so
// we guard against that and fall back to '/api'. This doesn't affect
// runtime behaviour because the tests never make real HTTP calls —
// they only test the pure reducer logic.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const baseURL = env.VITE_API_BASE_URL || '/api';

export const apiClient = axios.create({
  baseURL,
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default apiClient;
