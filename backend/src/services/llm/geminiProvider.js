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
import { SERVICE_LINES, BUDGET_QUALIFIERS } from '../../utils/constants.js';

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
 * @returns {GoogleGenAI}
 */
function buildClient() {
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
}

/**
 * Build the response_format schema for `ai.interactions.create()`.
 *
 * Uses Gemini's JSON-schema dialect (subset of OpenAPI 3.0).
 * Enums are constrained so the model cannot emit out-of-range values.
 */
function buildResponseFormat() {
  return {
    type: 'object',
    properties: {
      company: { type: 'string', nullable: true },
      contactName: { type: 'string', nullable: true },
      contactEmail: { type: 'string', nullable: true },
      serviceLine: { type: 'string', enum: SERVICE_LINES },
      budget: {
        type: 'object',
        properties: {
          raw: { type: 'string' },
          currency: { type: 'string', nullable: true },
          min: { type: 'number', nullable: true },
          max: { type: 'number', nullable: true },
          qualifier: { type: 'string', enum: BUDGET_QUALIFIERS },
        },
      },
      timeline: {
        type: 'object',
        properties: {
          raw: { type: 'string' },
          normalized: { type: 'object', nullable: true },
        },
      },
      summary: { type: 'string' },
      isGenuineProjectEnquiry: { type: 'boolean' },
      confidence: { type: 'number', nullable: true },
      projectCount: { type: 'integer' },
      additionalProjectNote: { type: 'string', nullable: true },
      isModelInstructionAttempt: { type: 'boolean' },
    },
    required: [
      'company',
      'contactName',
      'contactEmail',
      'serviceLine',
      'budget',
      'timeline',
      'summary',
      'isGenuineProjectEnquiry',
      'confidence',
      'projectCount',
      'additionalProjectNote',
      'isModelInstructionAttempt',
    ],
  };
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
  // AbortError — timeout (we don't currently set an explicit timeout via
  // the SDK, but defensive classification)
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
      const interaction = await client.interactions.create({
        model: env.GEMINI_MODEL,
        input: buildUserMessage(enquiryText),
        system_instruction: SYSTEM_PROMPT,
        // Force JSON output conforming to our schema.
        response_format: buildResponseFormat(),
        // Generation config: deterministic extraction
        generation_config: {
          temperature: 0,
        },
      });

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

export const promptContract = { SYSTEM_PROMPT, buildUserMessage, extractionSchema };

const geminiProvider = { name: PROVIDER_NAME, isConfigured, extract };
export default geminiProvider;
