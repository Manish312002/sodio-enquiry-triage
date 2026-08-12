import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // Forward all API calls to the Express backend so the browser only ever
      // talks to one origin. LLM provider keys live server-side; React never
      // calls Grok or Gemini directly (Architechure.md §14).
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
