/**
 * Minimal structured logger.
 *
 * Safety contract (Rules.md §12 "Developer-facing"):
 *   - Never logs API keys, authorization headers, or full sensitive payloads.
 *   - Always includes a timestamp and a level.
 *
 * Phase 0 implementation: writes to stdout/stderr with JSON-ish formatting.
 * Phase 9 (security hardening) will add correlation IDs and richer redaction.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];
const CURRENT_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

function shouldLog(level) {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(CURRENT_LEVEL);
}

function format(level, message, extra) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] ${message}`;
  if (!extra) return base;
  try {
    return `${base} ${JSON.stringify(redact(extra))}`;
  } catch {
    return `${base} [unserializable extra]`;
  }
}

const REDACT_KEYS = [
  'password',
  'apiKey',
  'api_key',
  'authorization',
  'token',
  'secret',
  'mongouri',
  'mongodb_uri',
  'uri',
];

function redact(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT_KEYS.includes(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {...any} extras
 */
export function log(level, message, ...extras) {
  if (!shouldLog(level)) return;
  const flattened = extras.length === 0 ? null : extras.length === 1 ? extras[0] : extras;
  const line = format(level, message, flattened);
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

export const logger = {
  debug: (msg, ...xs) => log('debug', msg, ...xs),
  info: (msg, ...xs) => log('info', msg, ...xs),
  warn: (msg, ...xs) => log('warn', msg, ...xs),
  error: (msg, ...xs) => log('error', msg, ...xs),
};
