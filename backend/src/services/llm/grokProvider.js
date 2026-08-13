/**
 * Grok provider — PRIMARY LLM adapter (Phase 3 implementation).
 *
 * Architechure.md §5 (provider rules):
 *   1. Grok is attempted first.
 *   2. If Grok fails because of a recoverable provider/API failure, Gemini is attempted.
 *   3. If both fail, the enquiry remains stored with an extraction failure state.
 *   4. Provider failures must not destroy the original enquiry.
 *   5. Provider API keys remain server-side.
 *   6. Provider SDK details are isolated inside this file.
 *
 * HTTP integration:
 *   We use Node's native `fetch` (Node 18+) to call xAI's OpenAI-compatible
 *   chat-completions endpoint. No SDK is added — the request/response shapes
 *   are simple enough that a direct HTTP call keeps the provider abstraction
 *   cleaner and avoids an unnecessary dependency (Rules.md §2, project rule §10).
 *
 * Error classification (Rules.md §3 — "distinguish provider/API failure from
 * malformed model output"):
 *   - NOT_CONFIGURED         : empty API key → recoverable (try next provider)
 *   - PROVIDER_NETWORK_ERROR : fetch threw TypeError/ECONNRESET/etc. → recoverable
 *   - PROVIDER_TIMEOUT       : AbortController fired → recoverable
 *   - PROVIDER_RATE_LIMIT    : HTTP 429 → recoverable
 *   - PROVIDER_SERVER_ERROR  : HTTP 5xx → recoverable
 *   - PROVIDER_AUTH_ERROR    : HTTP 401/403 → recoverable (key may be invalid;
 *                              falling back to Gemini is the right move)
 *   - PROVIDER_HTTP_ERROR    : other 4xx → recoverable (defensive default)
 *   - INVALID_OUTPUT         : response parsed as JSON but failed schema
 *                              validation OR was not valid JSON → NOT recoverable
 *                              (model quality issue, not provider availability;
 *                              do NOT fall back per Rules.md §3)
 *
 * SECURITY:
 *   - API key is read from env at call time, never logged, never returned to
 *     the client, never sent to React.
 *   - The API key is sent ONLY to GROK_API_URL via the Authorization header.
 *   - `rawOutput` returned to the service layer contains ONLY the response
 *     body (parsed JSON or string); it never contains request headers.
 */
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { SYSTEM_PROMPT, buildUserMessage } from './extractionPrompt.js';
import { extractionSchema } from './extractionSchema.js';

export const PROVIDER_NAME = 'grok';

/**
 * @typedef {import('./extractionSchema.js').Extraction} Extraction
 * @typedef {{ provider: string, model: string, rawOutput: unknown, parsed: Extraction, durationMs: number }} ExtractionResult
 */

/**
 * @returns {boolean} true if a non-empty API key is configured.
 */
export function isConfigured() {
  return Boolean(env.GROK_API_KEY && env.GROK_API_KEY.trim());
}

/**
 * Build the OpenAI-compatible chat-completions request body.
 * Uses `response_format: { type: 'json_object' }` to nudge Grok toward JSON.
 *
 * @param {string} enquiryText
 * @returns {object}
 */
function buildRequestBody(enquiryText) {
  return {
    model: env.GROK_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(enquiryText) },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  };
}

/**
 * Classify a fetch/HTTP error into a stable error code.
 *
 * @param {Error|{status:number}} err
 * @returns {{code: string, recoverable: boolean, message: string}}
 */
function classifyError(err) {
  // Network / DNS / connection refused — fetch throws TypeError
  if (err instanceof TypeError) {
    return {
      code: 'PROVIDER_NETWORK_ERROR',
      recoverable: true,
      message: 'Network error contacting Grok.',
    };
  }
  // AbortError — timeout
  if (err?.name === 'AbortError') {
    return {
      code: 'PROVIDER_TIMEOUT',
      recoverable: true,
      message: 'Grok request timed out.',
    };
  }
  const status = err?.status;
  if (typeof status === 'number') {
    if (status === 429) {
      return {
        code: 'PROVIDER_RATE_LIMIT',
        recoverable: true,
        message: 'Grok rate limit exceeded.',
      };
    }
    if (status >= 500) {
      return {
        code: 'PROVIDER_SERVER_ERROR',
        recoverable: true,
        message: `Grok server error (HTTP ${status}).`,
      };
    }
    if (status === 401 || status === 403) {
      return {
        code: 'PROVIDER_AUTH_ERROR',
        recoverable: true,
        message: 'Grok authentication failed.',
      };
    }
    if (status >= 400 && status < 500) {
      // Other 4xx — defensive default; treat as recoverable so we fall back
      // to Gemini rather than failing the whole extraction.
      return {
        code: 'PROVIDER_HTTP_ERROR',
        recoverable: true,
        message: `Grok HTTP ${status}.`,
      };
    }
  }
  return {
    code: 'PROVIDER_ERROR',
    recoverable: true,
    message: err?.message || 'Unknown Grok error.',
  };
}

/**
 * Send one HTTP request to Grok and return the raw response body.
 *
 * @param {string} enquiryText
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<{status: number, body: unknown, rawText: string}>}
 */
async function callGrok(enquiryText, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.GROK_API_KEY}`,
  };
  const res = await fetch(env.GROK_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildRequestBody(enquiryText)),
    signal: opts.signal,
  });
  const rawText = await res.text();
  let body = null;
  try {
    body = rawText.length > 0 ? JSON.parse(rawText) : null;
  } catch {
    body = rawText; // keep the raw string for diagnosis
  }
  return { status: res.status, body, rawText };
}

/**
 * Extract the model's text content from an OpenAI-compatible response body.
 *
 * @param {unknown} body
 * @returns {string|null}
 */
function extractContent(body) {
  if (!body || typeof body !== 'object') return null;
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  const content = first?.message?.content;
  return typeof content === 'string' ? content : null;
}

/**
 * Run one extraction attempt against Grok.
 *
 * Retries: `LLM_MAX_RETRIES` additional attempts on RECOVERABLE errors
 * (network/timeout/5xx/429). No retry on INVALID_OUTPUT — the model
 * returned a response, it was just bad; retrying the same prompt against
 * the same model is unlikely to help and burns quota.
 *
 * @param {string} enquiryText
 * @returns {Promise<ExtractionResult>}
 * @throws {Error} with `.code`, `.recoverable`, `.provider`, `.model`,
 *                 `.rawOutput`, `.durationMs` set.
 *                 - `recoverable=true`  → llmService should try Gemini.
 *                 - `recoverable=false` → llmService should NOT try Gemini.
 */
export async function extract(enquiryText) {
  if (!isConfigured()) {
    const err = new Error('Grok API key is not configured.');
    err.code = 'NOT_CONFIGURED';
    err.recoverable = true; // skip → try next provider
    err.provider = PROVIDER_NAME;
    err.model = env.GROK_MODEL;
    err.rawOutput = null;
    err.durationMs = 0;
    throw err;
  }

  const startedAt = Date.now();
  const maxAttempts = 1 + Math.max(0, env.LLM_MAX_RETRIES);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), env.LLM_TIMEOUT_MS);
    try {
      const { status, body, rawText } = await callGrok(enquiryText, {
        signal: ac.signal,
      });

      // Non-2xx → classify and possibly retry.
      if (status < 200 || status >= 300) {
        const cls = classifyError({ status });
        const err = new Error(cls.message);
        err.code = cls.code;
        err.recoverable = cls.recoverable;
        err.provider = PROVIDER_NAME;
        err.model = env.GROK_MODEL;
        err.rawOutput = body ?? rawText ?? null;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        lastError = err;
        logger.warn('grokProvider: non-2xx', {
          status,
          code: cls.code,
          attempt,
        });
        if (cls.recoverable && attempt < maxAttempts) continue;
        throw err;
      }

      // 2xx — extract content string.
      const content = extractContent(body);
      if (!content) {
        // Provider responded 2xx but with no usable content. Treat as
        // INVALID_OUTPUT (not recoverable) — retrying won't help.
        const err = new Error('Grok returned an empty or malformed response.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GROK_MODEL;
        err.rawOutput = body ?? rawText ?? null;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        throw err;
      }

      // Try to parse the content as JSON.
      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseErr) {
        const err = new Error('Grok response was not valid JSON.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GROK_MODEL;
        err.rawOutput = content; // keep the raw string for diagnosis
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        throw err;
      }

      // Validate against the extraction schema (zod).
      const validation = extractionSchema.safeParse(parsedJson);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
          .join('; ');
        const err = new Error(`Grok output failed schema validation: ${issues}`);
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GROK_MODEL;
        err.rawOutput = parsedJson;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        err.zodIssues = validation.error.issues;
        throw err;
      }

      // Success.
      const durationMs = Date.now() - startedAt;
      logger.info('grokProvider: extraction succeeded', {
        model: env.GROK_MODEL,
        attempt,
        durationMs,
      });
      return {
        provider: PROVIDER_NAME,
        model: env.GROK_MODEL,
        rawOutput: parsedJson,
        parsed: validation.data,
        durationMs,
      };
    } catch (err) {
      // AbortError / TypeError → classify and possibly retry.
      if (
        err?.name === 'AbortError' ||
        err instanceof TypeError ||
        err?.name === 'FetchError'
      ) {
        const cls = classifyError(err);
        const wrapped = new Error(cls.message);
        wrapped.code = cls.code;
        wrapped.recoverable = cls.recoverable;
        wrapped.provider = PROVIDER_NAME;
        wrapped.model = env.GROK_MODEL;
        wrapped.rawOutput = null;
        wrapped.durationMs = Date.now() - startedAt;
        wrapped.attempt = attempt;
        wrapped.cause = err?.message;
        lastError = wrapped;
        logger.warn('grokProvider: transport error', {
          code: cls.code,
          attempt,
          cause: err?.message,
        });
        if (cls.recoverable && attempt < maxAttempts) continue;
        throw wrapped;
      }
      // INVALID_OUTPUT or any other thrown error — re-throw as-is.
      throw err;
    } finally {
      clearTimeout(to);
    }
  }

  // Should not reach here, but defensive.
  throw lastError || new Error('Grok extraction failed.');
}

export const promptContract = { SYSTEM_PROMPT, buildUserMessage, extractionSchema };

const grokProvider = { name: PROVIDER_NAME, isConfigured, extract };
export default grokProvider;
