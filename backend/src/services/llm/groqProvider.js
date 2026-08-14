/**
 * Groq provider — PRIMARY LLM adapter (Phase 3, SDK-based).
 *
 * Uses the official `openai` npm package pointed at Groq's OpenAI-compatible
 * endpoint. The `client.responses.create()` API is used per the operator
 * specification (verified to exist in `openai@7.4.0`).
 *
 * Architechure.md §5 (provider rules):
 *   1. Groq is attempted first.
 *   2. If Groq fails because of a recoverable provider/API failure, Gemini
 *      is attempted.
 *   3. If both fail, the enquiry remains stored with an extraction failure
 *      state.
 *   4. Provider failures must not destroy the original enquiry.
 *   5. Provider API keys remain server-side.
 *   6. Provider SDK details are isolated inside this file.
 *
 * Error classification (Rules.md §3 — "distinguish provider/API failure
 * from malformed model output"):
 *   - NOT_CONFIGURED         : empty API key → recoverable (try next provider)
 *   - PROVIDER_NETWORK_ERROR : SDK threw a connection error → recoverable
 *   - PROVIDER_TIMEOUT       : SDK threw APITimeoutError → recoverable
 *   - PROVIDER_RATE_LIMIT    : SDK threw RateLimitError (HTTP 429) → recoverable
 *   - PROVIDER_SERVER_ERROR  : SDK threw InternalServerError (HTTP 5xx) → recoverable
 *   - PROVIDER_AUTH_ERROR    : SDK threw AuthenticationError (401/403) → recoverable
 *   - PROVIDER_HTTP_ERROR    : other 4xx → recoverable (defensive default)
 *   - INVALID_OUTPUT         : response parsed as JSON but failed schema
 *                              validation OR was not valid JSON → NOT recoverable
 *                              (model quality issue, not provider availability;
 *                              do NOT fall back per Rules.md §3)
 *
 * SECURITY:
 *   - API key is read from env at call time, never logged, never returned to
 *     the client, never sent to React.
 *   - The OpenAI client is constructed lazily per-call so test code can
 *     mutate `env.GROQ_API_KEY` between tests and the new value takes
 *     effect immediately.
 *   - `rawOutput` returned to the service layer contains ONLY the SDK
 *     response (the parsed object); it never contains request headers or
 *     the API key.
 */
import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { SYSTEM_PROMPT, buildUserMessage } from './extractionPrompt.js';
import { extractionSchema } from './extractionSchema.js';
import { GROQ_TEXT_FORMAT } from './extractionJsonSchema.js';

export const PROVIDER_NAME = 'groq';

/**
 * @typedef {import('./extractionSchema.js').Extraction} Extraction
 * @typedef {{ provider: string, model: string, rawOutput: unknown, parsed: Extraction, durationMs: number }} ExtractionResult
 */

/**
 * @returns {boolean} true if a non-empty API key is configured.
 */
export function isConfigured() {
  return Boolean(env.GROQ_API_KEY && env.GROQ_API_KEY.trim());
}

/**
 * Build a lazily-constructed OpenAI client pointed at Groq.
 *
 * The client is constructed per-call rather than at module load so:
 *   - tests can mutate `env.GROQ_API_KEY` between tests
 *   - the client picks up the latest env config at call time
 *
 * @returns {import('openai').OpenAI}
 */
function buildClient() {
  return new OpenAI({
    apiKey: env.GROQ_API_KEY,
    baseURL: env.GROQ_BASE_URL,
    timeout: env.LLM_TIMEOUT_MS,
    maxRetries: 0, // we handle retries ourselves so we can classify errors
  });
}

/**
 * Classify an SDK error into a stable error code.
 *
 * The `openai` package exposes typed error classes (APIConnectionError,
 * APITimeoutError, RateLimitError, InternalServerError,
 * AuthenticationError, BadRequestError, etc.). We map each to one of our
 * stable codes and decide whether it's recoverable.
 *
 * @param {Error} err
 * @returns {{code: string, recoverable: boolean, message: string}}
 */
function classifyError(err) {
  // NOTE: order matters here. APIConnectionTimeoutError extends
  // APIConnectionError, so the timeout check must come FIRST.
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      code: 'PROVIDER_TIMEOUT',
      recoverable: true,
      message: 'Groq request timed out.',
    };
  }
  // Connection / DNS / TLS — the SDK could not reach Groq
  if (err instanceof OpenAI.APIConnectionError) {
    return {
      code: 'PROVIDER_NETWORK_ERROR',
      recoverable: true,
      message: 'Network error contacting Groq.',
    };
  }
  if (err instanceof OpenAI.RateLimitError) {
    return {
      code: 'PROVIDER_RATE_LIMIT',
      recoverable: true,
      message: 'Groq rate limit exceeded.',
    };
  }
  if (err instanceof OpenAI.InternalServerError) {
    return {
      code: 'PROVIDER_SERVER_ERROR',
      recoverable: true,
      message: `Groq server error (HTTP ${err.status ?? 500}).`,
    };
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return {
      code: 'PROVIDER_AUTH_ERROR',
      recoverable: true,
      message: 'Groq authentication failed.',
    };
  }
  if (err instanceof OpenAI.BadRequestError) {
    // 4xx other than auth — defensive default. Treat as recoverable so we
    // fall back to Gemini rather than failing the whole extraction.
    return {
      code: 'PROVIDER_HTTP_ERROR',
      recoverable: true,
      message: `Groq HTTP ${err.status ?? 400}.`,
    };
  }
  if (err instanceof OpenAI.APIError) {
    // Catch-all for other APIError subclasses (PermissionDeniedError,
    // ConflictError, NotFoundError, etc.)
    const status = err.status ?? 0;
    if (status >= 500) {
      return {
        code: 'PROVIDER_SERVER_ERROR',
        recoverable: true,
        message: `Groq server error (HTTP ${status}).`,
      };
    }
    if (status >= 400) {
      return {
        code: 'PROVIDER_HTTP_ERROR',
        recoverable: true,
        message: `Groq HTTP ${status}.`,
      };
    }
  }
  return {
    code: 'PROVIDER_ERROR',
    recoverable: true,
    message: err?.message || 'Unknown Groq error.',
  };
}

/**
 * Run one extraction attempt against Groq via the OpenAI SDK.
 *
 * Retries: `LLM_MAX_RETRIES` additional attempts on RECOVERABLE errors
 * (network/timeout/5xx/429). No retry on INVALID_OUTPUT — the model
 * returned a response, it was just bad; retrying the same prompt against
 * the same model is unlikely to help and burns quota.
 *
 * Uses `client.responses.create()` (the Responses API) per the operator
 * specification. The response shape exposes `output_text` (concatenated
 * text from the model), which we then parse as JSON and validate against
 * the extraction schema.
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
    const err = new Error('Groq API key is not configured.');
    err.code = 'NOT_CONFIGURED';
    err.recoverable = true; // skip → try next provider
    err.provider = PROVIDER_NAME;
    err.model = env.GROQ_MODEL;
    err.rawOutput = null;
    err.durationMs = 0;
    throw err;
  }

  const client = buildClient();
  const startedAt = Date.now();
  const maxAttempts = 1 + Math.max(0, env.LLM_MAX_RETRIES);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // Use the Responses API per the operator specification.
      // `instructions` is the trusted system prompt (separate from user
      // input — preserves the prompt-injection boundary, Rules.md §4).
      // `input` is the user message that wraps the untrusted enquiry in
      // a literal data fence (see extractionPrompt.buildUserMessage).
      //
      // `text.format` requests STRUCTURED OUTPUT via the OpenAI-compatible
      // `json_schema` format (openai@7.4.0 SDK supports this on the
      // Responses API). The canonical schema is the SAME contract enforced
      // by Zod post-response (extractionSchema.js) and documented in the
      // system prompt (extractionPrompt.js). All three are kept
      // hand-aligned via extractionJsonSchema.js.
      //
      // `strict:false` is intentional: OpenAI strict mode requires
      // `additionalProperties:false` on every object, but our
      // `timeline.normalized` field is intentionally open-shaped
      // (Rules.md §7 — opportunistic urgency/duration/period markers).
      // See extractionJsonSchema.js header for the full rationale.
      const response = await client.responses.create({
        model: env.GROQ_MODEL,
        instructions: SYSTEM_PROMPT,
        input: buildUserMessage(enquiryText),
        temperature: 0,
        text: GROQ_TEXT_FORMAT,
      });

      const content = response.output_text;
      if (!content || typeof content !== 'string' || content.length === 0) {
        // Provider responded 2xx but with no usable content. Treat as
        // INVALID_OUTPUT (not recoverable) — retrying won't help.
        const err = new Error('Groq returned an empty or malformed response.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GROQ_MODEL;
        err.rawOutput = response ?? null;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        throw err;
      }

      // Try to parse the content as JSON.
      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseErr) {
        const err = new Error('Groq response was not valid JSON.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GROQ_MODEL;
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
        const err = new Error(`Groq output failed schema validation: ${issues}`);
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GROQ_MODEL;
        err.rawOutput = parsedJson;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        err.zodIssues = validation.error.issues;
        throw err;
      }

      // Success.
      const durationMs = Date.now() - startedAt;
      logger.info('groqProvider: extraction succeeded', {
        model: env.GROQ_MODEL,
        attempt,
        durationMs,
      });
      return {
        provider: PROVIDER_NAME,
        model: env.GROQ_MODEL,
        rawOutput: parsedJson,
        parsed: validation.data,
        durationMs,
      };
    } catch (err) {
      // If it's already one of our INVALID_OUTPUT errors, re-throw as-is
      // (do NOT retry, do NOT fall through to classification).
      if (err?.code === 'INVALID_OUTPUT') {
        throw err;
      }

      // Otherwise it's a provider/SDK error → classify.
      const cls = classifyError(err);
      const wrapped = new Error(cls.message);
      wrapped.code = cls.code;
      wrapped.recoverable = cls.recoverable;
      wrapped.provider = PROVIDER_NAME;
      wrapped.model = env.GROQ_MODEL;
      // SDK errors may carry .response / .request — do NOT propagate them
      // in rawOutput (they could include headers). Keep only safe metadata.
      wrapped.rawOutput = null;
      wrapped.durationMs = Date.now() - startedAt;
      wrapped.attempt = attempt;
      wrapped.cause = err?.message;
      wrapped.httpStatus = err?.status ?? null;
      lastError = wrapped;
      logger.warn('groqProvider: SDK error', {
        code: cls.code,
        attempt,
        cause: err?.message,
        httpStatus: err?.status ?? null,
      });
      if (cls.recoverable && attempt < maxAttempts) continue;
      throw wrapped;
    }
  }

  // Should not reach here, but defensive.
  throw lastError || new Error('Groq extraction failed.');
}

export const promptContract = {
  SYSTEM_PROMPT,
  buildUserMessage,
  extractionSchema,
  textFormat: GROQ_TEXT_FORMAT,
};

const groqProvider = { name: PROVIDER_NAME, isConfigured, extract };
export default groqProvider;
