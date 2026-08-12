/**
 * Centralized error handler.
 *
 * Contract (Rules.md §12):
 *   - Never expose raw stack traces to the client.
 *   - User-facing messages are short and readable.
 *   - Developer details are logged server-side with safe context.
 *
 * Mount as the LAST middleware in app.js (after all routes).
 */
import { logger } from '../utils/logger.js';

/**
 * Wrap an async route handler so thrown errors flow into next(err).
 * Usage: router.get('/x', asyncHandler(async (req, res) => { ... }))
 *
 * @template T
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<T>} fn
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>}
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Normalised application error.
 * Carries a safe user-facing message + a category for logging.
 */
export class AppError extends Error {
  /**
   * @param {object} opts
   * @param {string} opts.message   User-facing message (safe to expose).
   * @param {number} [opts.status]  HTTP status (default 500).
   * @param {string} [opts.code]    Stable error code (e.g. 'EXTRACTION_FAILED').
   * @param {object} [opts.context] Extra safe context for logging (no secrets).
   */
  constructor({ message, status = 500, code = 'INTERNAL_ERROR', context = {} }) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.context = context;
  }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
  const code = err?.code || 'INTERNAL_ERROR';
  const safeMessage =
    err?.message && status < 500
      ? err.message
      : 'Something went wrong. Please try again.';

  // Safe context only — never include the raw Error object (which may contain
  // env-derived data) in client responses.
  const logContext = {
    method: req.method,
    path: req.path,
    code,
    status,
    ...(err.context || {}),
  };

  if (status >= 500) {
    logger.error('Unhandled error:', err.message, logContext, err.stack || '');
  } else {
    logger.warn('Client error:', err.message, logContext);
  }

  res.status(status).json({
    error: {
      code,
      message: safeMessage,
    },
  });
}

/**
 * 404 handler — kept here so unknown routes return JSON, not HTML.
 */
// eslint-disable-next-line no-unused-vars
export function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
    },
  });
}
