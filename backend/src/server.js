/**
 * Server bootstrap.
 *
 * Order of operations:
 *   1. Try to connect to MongoDB (5s serverSelectionTimeoutMS).
 *   2. If MongoDB is unreachable, log a clear BLOCKER and continue starting
 *      the HTTP server anyway — so /api/health can report the real state.
 *   3. Bind the HTTP listener on env.PORT.
 *   4. Wire graceful shutdown on SIGINT / SIGTERM.
 *
 * The health endpoint will never lie about DB state (see healthController.js).
 */
import app from './app.js';
import { env } from './config/env.js';
import { connectDb, closeDb } from './config/db.js';
import { logger } from './utils/logger.js';
import { APP_VERSION } from './utils/constants.js';

let server = null;

async function start() {
  logger.info(`Sodio Enquiry Triage API v${APP_VERSION} starting…`);

  // --- MongoDB ---
  try {
    await connectDb();
  } catch (err) {
    // Report blocker, do NOT crash. The health endpoint will surface this.
    logger.error(
      'BLOCKER: MongoDB connection failed at startup.',
      {
        message: err.message,
        // NEVER log the URI itself.
        hint: 'Check MONGODB_URI in your .env (see .env.example).',
      },
    );
  }

  // --- HTTP ---
  server = app.listen(env.PORT, () => {
    logger.info(`HTTP server listening on http://localhost:${env.PORT}`);
    logger.info(`Health check:  http://localhost:${env.PORT}/api/health`);
  });

  server.on('error', (err) => {
    logger.error('HTTP server error:', err.message);
    process.exit(1);
  });
}

async function shutdown(signal) {
  logger.info(`Received ${signal}; shutting down…`);
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed.');
    });
  }
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err.message, err.stack || '');
  process.exit(1);
});

start().catch((err) => {
  logger.error('Fatal startup error:', err.message);
  process.exit(1);
});
