/**
 * Express app composition.
 *
 * Phase 0 wiring:
 *   - cors (permissive in dev; tighten in Phase 9)
 *   - express.json with a sane body size limit
 *   - morgan request logging (tiny format)
 *   - /api/health mount point
 *   - 404 + centralized error handler
 *
 * Phase 1 additions:
 *   - /api/enquiries mount point (POST, GET /, GET /:id)
 *
 * Phase 9 additions (Security / AI Boundaries — see Docs/Phases.md §9):
 *   - helmet — security headers (X-Content-Type-Options, X-Frame-Options,
 *     Strict-Transport-Security, Content-Security-Policy fallback, etc.)
 *   - requestId — generates a UUID per request, attaches to req.id and
 *     echoes back via X-Request-Id response header (Rules.md §12 requires
 *     a correlation/request ID in every log line)
 *   - CORS — configurable allowed origins via env.CORS_ALLOWED_ORIGINS
 *     (default '*' for dev; production sets an explicit list)
 *
 * app.js exports the app WITHOUT calling listen(); server.js owns the socket
 * so the app can be imported in tests without binding a port.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import healthRoutes from './routes/healthRoutes.js';
import enquiryRoutes from './routes/enquiryRoutes.js';
import batchRoutes from './routes/batchRoutes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = express();

// --- Phase 9: global security middleware ---
// helmet MUST be first so security headers are set on every response,
// including error responses (the errorHandler runs after routes and
// inherits any headers set by middleware above it).
app.use(helmet());

// Request ID — generate (or honour incoming) X-Request-Id early so every
// downstream log line, including error logs, can be correlated.
app.use(requestId());

// CORS — configurable via env.CORS_ALLOWED_ORIGINS.
// Default '*' (permissive) preserves dev ergonomics. In production, set
// CORS_ALLOWED_ORIGINS to an explicit comma-separated list of trusted
// frontend origins.
const allowedOrigins = (env.CORS_ALLOWED_ORIGINS || '*').trim();
const corsOptions =
  allowedOrigins === '*' || allowedOrigins === ''
    ? { origin: true } // mirror the request origin (permissive)
    : {
        origin: (origin, cb) => {
          // Allow same-origin / no-origin (curl, server-to-server) requests.
          if (!origin) return cb(null, true);
          const list = allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
          if (list.includes(origin)) return cb(null, true);
          return cb(new Error(`Origin ${origin} not allowed by CORS`));
        },
      };
app.use(cors(corsOptions));

// Body limit raised to 5mb to accommodate the Phase 1 MAX_ORIGINAL_TEXT_CHARS
// (100k chars) with headroom for sender metadata + JSON overhead. Phase 2
// file uploads will use multipart, not JSON body.
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
if (env.NODE_ENV !== 'test') {
  // morgan 'tiny' format: :method :url :status :res[content-length] - :response-time ms
  // We do NOT log request bodies (could contain enquiry text / sender PII)
  // or authorization headers (none in this app, but defensive).
  app.use(morgan('tiny'));
}

// --- routes ---
app.get('/', (_req, res) => {
  res.json({
    name: 'Sodio Enquiry Triage API',
    version: '0.1.0',
    docs: '/api/health',
  });
});

app.use('/api/health', healthRoutes);
app.use('/api/enquiries', enquiryRoutes);
// Phase 8 — batch progress endpoints. Mounted under /api/batches per
// Architechure.md §8. The import endpoint that CREATES a batch lives under
// /api/enquiries/import (Phase 2); these routes only read/refresh batches.
app.use('/api/batches', batchRoutes);

// --- 404 + error handling (must be last) ---
app.use(notFoundHandler);
app.use(errorHandler);

// Log app boot
logger.info('Express app initialised', { env: env.NODE_ENV, port: env.PORT });

export default app;
