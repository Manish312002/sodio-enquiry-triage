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
 * app.js exports the app WITHOUT calling listen(); server.js owns the socket
 * so the app can be imported in tests without binding a port.
 */
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import healthRoutes from './routes/healthRoutes.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = express();

// --- global middleware ---
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
if (env.NODE_ENV !== 'test') {
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

// --- 404 + error handling (must be last) ---
app.use(notFoundHandler);
app.use(errorHandler);

// Log app boot
logger.info('Express app initialised', { env: env.NODE_ENV, port: env.PORT });

export default app;
