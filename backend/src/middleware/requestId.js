/**
 * Request ID middleware (Phase 9 — Security / AI Boundaries).
 *
 * Rules.md §12 ("Developer-facing") requires logging a correlation/request ID
 * for every request so an operator can trace a single user-visible failure
 * back to the exact log lines that explain it.
 *
 * Behaviour:
 *   1. If the incoming request has an `X-Request-Id` header, honour it
 *      (capped at 128 chars to prevent log-injection via absurdly long IDs).
 *      This lets upstream proxies / gateways propagate their own correlation
 *      IDs through our stack.
 *   2. Otherwise generate a fresh UUID v4 via `crypto.randomUUID()`
 *      (Node ≥ 19 has this as a global; we are on Node ≥ 18 per
 *      backend/package.json engines, and the actual runtime in this
 *      project is Node 20+, so the global is always present).
 *   3. Attach the ID to `req.id` so downstream handlers and the error
 *      handler can read it.
 *   4. Echo the ID back to the client via the `X-Request-Id` response
 *      header so the operator can paste it into a support ticket / log
 *      search.
 *
 * SECURITY:
 *   - The ID is generated server-side; clients cannot forge one to pollute
 *     logs in a meaningful way (they can submit a header, but it's still
 *     just an opaque correlation key — never trusted as an auth token).
 *   - The ID is included in errorHandler's log context so every error log
 *     line is correlated to a request.
 *   - The ID is never used as a database key, auth credential, or input
 *     to any security decision.
 *
 * Usage:
 *   app.use(requestId());   // mount early, before routes
 */
import { randomUUID } from 'node:crypto';

const MAX_INCOMING_ID_LENGTH = 128;
const HEADER_NAME = 'x-request-id';

/**
 * Validate that an incoming X-Request-Id header value is safe to honour.
 *
 * We accept any printable ASCII string up to 128 chars. We do NOT accept
 * newlines, control characters, or non-ASCII (which could break log
 * parsers). If the incoming value fails validation, we generate a fresh
 * UUID instead.
 *
 * @param {string} raw
 * @returns {string|null} the cleaned ID, or null if invalid
 */
function cleanIncomingId(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_INCOMING_ID_LENGTH) return null;
  // Printable ASCII only (0x20-0x7E). Reject anything else.
  if (!/^[\x20-\x7E]+$/.test(raw)) return null;
  return raw;
}

/**
 * Express middleware factory.
 *
 * @returns {import('express').RequestHandler}
 */
export function requestId() {
  return (req, res, next) => {
    const incoming = req.headers[HEADER_NAME];
    const cleaned = cleanIncomingId(
      Array.isArray(incoming) ? incoming[0] : incoming,
    );
    const id = cleaned || randomUUID();

    // Attach to req so handlers + errorHandler can read it.
    // Express has built-in `req.id` support but does not populate it by
    // default; assigning it directly is the documented pattern.
    req.id = id;

    // Echo back to the client so the operator can correlate.
    res.setHeader('X-Request-Id', id);

    next();
  };
}

export default requestId;
