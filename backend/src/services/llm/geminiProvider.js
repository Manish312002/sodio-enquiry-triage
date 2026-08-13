/**
 * Gemini provider — SECONDARY / FALLBACK LLM adapter (Phase 3 implementation).
 *
 * Same contract as grokProvider. Only invoked when grokProvider.extract()
 * throws a RECOVERABLE provider/API failure (Rules.md §3, Architechure.md §5).
 *
 * HTTP integration:
 *   Uses Google's `generateContent` REST endpoint via native `fetch`.
 *   No SDK — direct HTTP keeps the abstraction clean and avoids an extra
 *   dependency (Rules.md §2).
 *
 * Endpoint shape (v1beta):
 *   POST {GEMINI_API_URL}/models/{model}:generateContent?key={API_KEY}
 *
 * Request body uses Gemini's `contents` array with role-tagged parts.
 * The system instruction is sent via `systemInstruction` so it stays in
 * the developer/system role, separate from the user-supplied enquiry
 * (Rules.md §4 — prompt injection boundary).
 *
 * To get strict JSON, we set `responseMimeType: 'application/json'` and
 * `responseSchema` (Gemini's structured-output feature). This makes the
 * model emit JSON conforming to our schema, which we then re-validate
 * with zod for defence in depth.
 *
 * Error classification mirrors grokProvider (see that file for rationale).
 *
 * SECURITY: API key is sent as a query parameter (?key=...) because that
 * is the documented REST convention for the v1beta endpoint. It is never
 * logged, never returned to the client, and `rawOutput` returned to the
 * service layer contains ONLY the response body.
 */
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
 * Build the Gemini `generateContent` request body.
 *
 * The `responseSchema` uses Gemini's OpenAPI 3.0 subset schema syntax.
 * Enums are constrained so the model cannot emit an out-of-range value.
 *
 * @param {string} enquiryText
 * @returns {object}
 */
function buildRequestBody(enquiryText) {
  return {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildUserMessage(enquiryText) }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
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
      },
    },
  };
}

/**
 * Build the full Gemini endpoint URL. The API key is sent as ?key= per
 * the v1beta REST convention.
 */
function buildEndpointUrl() {
  const base = env.GEMINI_API_URL.replace(/\/+$/, '');
  return `${base}/models/${env.GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;
}

/**
 * Classify a fetch/HTTP error into a stable error code.
 * Mirrors grokProvider's classifier for consistency.
 */
function classifyError(err) {
  if (err instanceof TypeError) {
    return {
      code: 'PROVIDER_NETWORK_ERROR',
      recoverable: true,
      message: 'Network error contacting Gemini.',
    };
  }
  if (err?.name === 'AbortError') {
    return {
      code: 'PROVIDER_TIMEOUT',
      recoverable: true,
      message: 'Gemini request timed out.',
    };
  }
  const status = err?.status;
  if (typeof status === 'number') {
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
  return {
    code: 'PROVIDER_ERROR',
    recoverable: true,
    message: err?.message || 'Unknown Gemini error.',
  };
}

/**
 * Send one HTTP request to Gemini and return the raw response body.
 */
async function callGemini(enquiryText, opts = {}) {
  const res = await fetch(buildEndpointUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildRequestBody(enquiryText)),
    signal: opts.signal,
  });
  const rawText = await res.text();
  let body = null;
  try {
    body = rawText.length > 0 ? JSON.parse(rawText) : null;
  } catch {
    body = rawText;
  }
  return { status: res.status, body, rawText };
}

/**
 * Extract the model's text content from a Gemini `generateContent` response.
 *
 * @param {unknown} body
 * @returns {string|null}
 */
function extractContent(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = body.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  const parts = first?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  // Concatenate all text parts (Gemini may split JSON across parts).
  const text = parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
  return text.length > 0 ? text : null;
}

/**
 * Run one extraction attempt against Gemini.
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

  const startedAt = Date.now();
  const maxAttempts = 1 + Math.max(0, env.LLM_MAX_RETRIES);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), env.LLM_TIMEOUT_MS);
    try {
      const { status, body, rawText } = await callGemini(enquiryText, {
        signal: ac.signal,
      });

      if (status < 200 || status >= 300) {
        const cls = classifyError({ status });
        const err = new Error(cls.message);
        err.code = cls.code;
        err.recoverable = cls.recoverable;
        err.provider = PROVIDER_NAME;
        err.model = env.GEMINI_MODEL;
        err.rawOutput = body ?? rawText ?? null;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        lastError = err;
        logger.warn('geminiProvider: non-2xx', {
          status,
          code: cls.code,
          attempt,
        });
        if (cls.recoverable && attempt < maxAttempts) continue;
        throw err;
      }

      const content = extractContent(body);
      if (!content) {
        const err = new Error('Gemini returned an empty or malformed response.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GEMINI_MODEL;
        err.rawOutput = body ?? rawText ?? null;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        throw err;
      }

      let parsedJson;
      try {
        parsedJson = JSON.parse(content);
      } catch (parseErr) {
        const err = new Error('Gemini response was not valid JSON.');
        err.code = 'INVALID_OUTPUT';
        err.recoverable = false;
        err.provider = PROVIDER_NAME;
        err.model = env.GEMINI_MODEL;
        err.rawOutput = content;
        err.durationMs = Date.now() - startedAt;
        err.attempt = attempt;
        throw err;
      }

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
        wrapped.model = env.GEMINI_MODEL;
        wrapped.rawOutput = null;
        wrapped.durationMs = Date.now() - startedAt;
        wrapped.attempt = attempt;
        wrapped.cause = err?.message;
        lastError = wrapped;
        logger.warn('geminiProvider: transport error', {
          code: cls.code,
          attempt,
          cause: err?.message,
        });
        if (cls.recoverable && attempt < maxAttempts) continue;
        throw wrapped;
      }
      throw err;
    } finally {
      clearTimeout(to);
    }
  }

  throw lastError || new Error('Gemini extraction failed.');
}

export const promptContract = { SYSTEM_PROMPT, buildUserMessage, extractionSchema };

const geminiProvider = { name: PROVIDER_NAME, isConfigured, extract };
export default geminiProvider;
