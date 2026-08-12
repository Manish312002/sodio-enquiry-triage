/**
 * Health controller.
 *
 * GET /api/health returns:
 *   {
 *     status: 'ok' | 'degraded',
 *     db:     'connected' | 'connecting' | 'disconnected' | 'error',
 *     dbHost: string | null,
 *     uptime: number (seconds),
 *     version: string,
 *     env: 'development' | 'test' | 'production'
 *   }
 *
 * IMPORTANT: the response NEVER lies. If MongoDB is unreachable, `status`
 * becomes 'degraded' and `db` reflects the actual state. The endpoint still
 * returns 200 so monitoring tooling can fetch it; clients inspect `status`.
 */
import { env } from '../config/env.js';
import { getDbStatus, getConnectionHost } from '../config/db.js';
import { APP_VERSION } from '../utils/constants.js';

const startedAt = Date.now();

export function health(_req, res) {
  const db = getDbStatus();
  const dbHost = getConnectionHost();
  const uptimeSeconds = Math.round((Date.now() - startedAt) / 1000);
  const ok = db === 'connected';

  return res.status(200).json({
    status: ok ? 'ok' : 'degraded',
    db,
    dbHost,
    uptime: uptimeSeconds,
    version: APP_VERSION,
    env: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
}
