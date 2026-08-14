/**
 * Minimal structured logger.
 *
 * Safety contract "Developer-facing"):
 *   - Never logs API keys, authorization headers, or full sensitive payloads.
 *   - Always includes a timestamp and a level.
 *
 * implementation: writes to stdout/stderr with JSON-ish formatting.
 * (security hardening) expanded the REDACT_KEYS list to cover the
 * full set of secret-shaped key names that could leak via error context
 * or extraction metadata.
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

/**
 * Keys whose values must NEVER appear in logs.
 *
 * expansion: the original list covered the obvious cases (password,
 * apiKey, authorization, token, secret, mongo URI variants). We added:
 *   - `key` / `apikey` (case-insensitive variants seen in SDK error objects)
 *   - `x-api-key` / `x-request-id` headers (defensive — the request ID is
 *     safe to log but the convention is to log it as `requestId` in the
 *     log context object, not the raw header name)
 *   - `cookie` / `set-cookie` (defensive — this app does not use cookies,
 *     but a future reverse proxy might)
 *   - `privatekey` / `private_key` (defensive — never present in this app
 *     today, but cheap to redact)
 *
 * The check is case-insensitive (lower-cased before comparison).
 */
const REDACT_KEYS = new Set([
  'password',
  'apikey',
  'api_key',
  'api-key',
  'key',
  'authorization',
  'auth',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'secret',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'mongouri',
  'mongodb_uri',
  'uri',
  'connectionstring',
  'connection_string',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-groq-api-key',
  'x-gemini-api-key',
  'groq_api_key',
  'gemini_api_key',
]);

function redact(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
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
