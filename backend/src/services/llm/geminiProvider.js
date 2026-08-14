/**
 * Gemini provider — SECONDARY / FALLBACK LLM adapter (Phase 3, SDK-based).
 *
 * Uses Google's official `@google/genai` SDK per the operator specification.
 * The `ai.interactions.create()` API is used (verified to exist in
 * `@google/genai@2.17.0`). Model `gemini-3.6-flash` is used (verified
 * available since Jul 21, 2026 per blog.google and ai.google.dev).
 *
 * Same contract as groqProvider. Only invoked when groqProvider.extract()
 * throws a RECOVERABLE provider/API failure (Rules.md §3, Architechure.md §5).
 *
 * Prompt injection boundary (Rules.md §4):
 *   The trusted system instruction is sent via `system_instruction` (a
 *   top-level parameter on `ai.interactions.create()`, separate from the
 *   user `input`). The untrusted enquiry text is wrapped in a literal
 *   data fence (see extractionPrompt.buildUserMessage) and sent as `input`.
 *   The enquiry content is NEVER concatenated into the system instruction.
 *
 * Structured output:
 *   `response_format` is set to enforce JSON output conforming to our
 *   schema. The SDK passes this through to the model. We then re-validate
 *   with zod for defence in depth (Rules.md §5).
 *
 * Error classification mirrors groqProvider (see that file for rationale).
 *
 * SECURITY: API key is read from env at call time. The SDK constructor
 * accepts `apiKey` explicitly; we never rely on auto-discovery from
 * environment variables (which could pick up unintended keys in some
 * deployment contexts). The key is never logged, never in `rawOutput`.
 */
import { GoogleGenAI, ApiError } from '@google/genai';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { SYSTEM_PROMPT, buildUserMessage } from './extractionPrompt.js';
import { extractionSchema } from './extractionSchema.js';
import { EXTRACTION_JSON_SCHEMA } from './extractionJsonSchema.js';

export const PROVIDER_NAME = 'gemini';

/**
 * @returns {boolean} true if a non-empty API key is configured.
 */
export function isConfigured() {
  return Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim());
}

/**
 * Build a lazily-constructed GoogleGenAI client.
 *
 * Constructed per-call (not at module load) so:
 *   - tests can mutate `env.GEMINI_API_KEY` between tests
 *   - the client picks up the latest env config at call time
 *
 * Phase 9 — the @google/genai SDK does not expose a per-request timeout
 * parameter on `interactions.create()` (unlike the OpenAI SDK's `timeout`
 * client option). We enforce a timeout EXTERNALLY via `withTimeout()` which
 * races the SDK promise against an AbortController-driven timeout. This
 * guarantees that a hung Gemini request cannot block the extraction chain
 * indefinitely (Rules.md §12 — provider timeout is a Phase 9 requirement).
 *
 * @returns {GoogleGenAI}
 */
function buildClient() {
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
}

/**
 * Race a promise against a timeout. Resolves/rejectes with the original
 * promise's outcome if it settles before `ms`; otherwise rejects with an
 * AbortError-like Error so classifyError() maps it to PROVIDER_TIMEOUT.
 *
 * The AbortController is used purely as a signal carrier — the @google/genai
 * SDK does not currently accept an AbortSignal on `interactions.create()`,
 * so we cannot actually abort the underlying HTTP request. The dangling
 * promise resolves/rejects in the background and is ignored. This is the
 * same pattern Node's built-in `Promise.race` callers use when the
 * underlying SDK lacks first-class timeout support.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  let timer;
  const timeoutErr = new Error(`Gemini request timed out after ${ms}ms.`);
  timeoutErr.name = 'AbortError';
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutErr), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * Return the canonical extraction JSON Schema for Gemini's `response_format`.
 *
 * Gemini's `@google/genai` SDK accepts a JSON-schema-dialect object directly
 * as `response_format` (no OpenAI-style `{ type: 'json_schema', name, schema }`
 * wrapper). We hand it the SAME canonical schema used by Groq
 * (`EXTRACTION_JSON_SCHEMA`), so both providers receive identical field
 * contracts. Zod remains the authoritative post-response validator.
 *
 * The schema is frozen and reused across calls — no per-call allocation.
 *
 * @returns {{ [key: string]: unknown }}
 */
function buildResponseFormat() {
  return EXTRACTION_JSON_SCHEMA;
}

/**
 * Classify an SDK error into a stable error code.
 *
 * `@google/genai` throws `ApiError` for HTTP-level failures and plain
 * `Error` for client-side failures (e.g. AbortError on timeout).
 *
 * @param {Error} err
 * @returns {{code: string, recoverable: boolean, message: string}}
 */
function classifyError(err) {
  // ApiError carries an HTTP status code
  if (err instanceof ApiError) {
    const status = err?.status ?? 0;
    if (status === 429) {
      return {
        code: 'PROVIDER_RATE_LIMIT',
        recoverable: true,
        message: 'Gemini rate limit exceeded.',
      };
    }
    if (status >= 500) {
      return {
        code: 'PROVIDER_SERVER_ERROR',
        recoverable: true,
        message: `Gemini server error (HTTP ${status}).`,
      };
    }
    if (status === 401 || status === 403) {
      return {
        code: 'PROVIDER_AUTH_ERROR',
        recoverable: true,
        message: 'Gemini authentication failed.',
      };
    }
    if (status >= 400 && status < 500) {
      return {
        code: 'PROVIDER_HTTP_ERROR',
        recoverable: true,
        message: `Gemini HTTP ${status}.`,
      };
    }
  }
  // AbortError — timeout (Phase 9: withTimeout() in extract() rejects with
  // an AbortError-named error when the SDK call exceeds env.LLM_TIMEOUT_MS).
  if (err?.name === 'AbortError') {
    return {
      code: 'PROVIDER_TIMEOUT',
      recoverable: true,
      message: 'Gemini request timed out.',
    };
  }
  // Network errors — typically TypeError or a fetch-wrapped error
  if (err instanceof TypeError || err?.name === 'FetchError') {
    return {
      code: 'PROVIDER_NETWORK_ERROR',
      recoverable: true,
      message: 'Network error contacting Gemini.',
    };
  }
  return {
    code: 'PROVIDER_ERROR',
    recoverable: true,
    message: err?.message || 'Unknown Gemini error.',
  };
}

/**
 * Run one extraction attempt against Gemini via the @google/genai SDK.
 *
 * Uses `ai.interactions.create()` (per operator specification) with:
 *   - `model: env.GEMINI_MODEL` (default 'gemini-3.6-flash')
 *   - `input: buildUserMessage(enquiryText)` (untrusted enquiry in a fence)
 *   - `system_instruction: SYSTEM_PROMPT` (trusted instructions, separate role)
 *   - `response_format: buildResponseFormat()` (enforces JSON schema)
 *
 * Retries: `LLM_MAX_RETRIES` additional attempts on RECOVERABLE errors.
 * No retry on INVALID_OUTPUT.
 *
 * @param {string} enquiryText
 * @returns {Promise<{provider: string, model: string, rawOutput: unknown, parsed: import('./extractionSchema.js').Extraction, durationMs: number}>}
 * @throws {Error} with `.code`, `.recoverable`, `.provider`, `.model`,
 *                 `.rawOutput`, `.durationMs` set.
 */
export async function extract(enquiryText) {
  if (!isConfigured()) {
    const err = new Error('Gemini API key is not configured.');
    err.code = 'NOT_CONFIGURED';
    err.recoverable = true; // nothing to try next if this is the last provider
    err.provider = PROVIDER_NAME;
    err.model = env.GEMINI_MODEL;
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
      // Phase 9 — wrap the SDK call in withTimeout() so a hung Gemini
      // request cannot block the extraction chain indefinitely. The
      // timeout error is shaped to look like an AbortError so the
      // existing classifyError() path maps it to PROVIDER_TIMEOUT.
      const interaction = await withTimeout(
        client.interactions.create({
          model: env.GEMINI_MODEL,
          input: buildUserMessage(enquiryText),
          system_instruction: SYSTEM_PROMPT,
          // Force JSON output conforming to our schema.
          response_format: buildResponseFormat(),
          // Generation config: deterministic extraction
          generation_config: {
            temperature: 0,
          },
        }),
        env.LLM_TIMEOUT_MS,
      );

      const content = interaction.output_text;
      if (!content || typeof content !== 'string' || content.length === 0) {
        const err = new Error('Gemini returned an empty or malformed response.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GEMINI_MODEL;
        err.rawOutput = interaction ?? null;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        throw err;
      }

      // Try to parse the content as JSON.
      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseErr) {
        const err = new Error('Gemini response was not valid JSON.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GEMINI_MODEL;
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
        const err = new Error(`Gemini output failed schema validation: ${issues}`);
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GEMINI_MODEL;
        err.rawOutput = parsedJson;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        err.zodIssues = validation.error.issues;
        throw err;
      }

      const durationMs = Date.now() - startedAt;
      logger.info('geminiProvider: extraction succeeded', {
        model: env.GEMINI_MODEL,
        attempt,
        durationMs,
      });
      return {
        provider: PROVIDER_NAME,
        model: env.GEMINI_MODEL,
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
      wrapped.model = env.GEMINI_MODEL;
      wrapped.rawOutput = null;
      wrapped.durationMs = Date.now() - startedAt;
      wrapped.attempt = attempt;
      wrapped.cause = err?.message;
      wrapped.httpStatus = err?.status ?? null;
      lastError = wrapped;
      logger.warn('geminiProvider: SDK error', {
        code: cls.code,
        attempt,
        cause: err?.message,
        httpStatus: err?.status ?? null,
      });
      if (cls.recoverable && attempt < maxAttempts) continue;
      throw wrapped;
    }
  }

  throw lastError || new Error('Gemini extraction failed.');
}

export const promptContract = {
  SYSTEM_PROMPT,
  buildUserMessage,
  extractionSchema,
  responseFormat: EXTRACTION_JSON_SCHEMA,
};

const geminiProvider = { name: PROVIDER_NAME, isConfigured, extract };
export default geminiProvider;
