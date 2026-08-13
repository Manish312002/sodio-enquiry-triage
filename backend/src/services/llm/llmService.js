/**
 * LLM service — provider-agnostic facade (Phase 3, SDK-based).
 *
 * Provider order (Rules.md §3):
 *   Groq (primary)
 *     ↓ recoverable provider/API failure
 *   Gemini (secondary/fallback)
 *     ↓ failure (recoverable OR non-recoverable)
 *   Extraction failed state
 *
 * Phase 3 contract:
 *   - Walks the provider chain in order.
 *   - For each provider, calls extract() and inspects the thrown error's
 *     `recoverable` flag:
 *       recoverable=true   → try the next provider
 *       recoverable=false  → STOP. Do not try the next provider.
 *                            (Rules.md §3: "do not automatically switch
 *                            providers for every validation error".)
 *   - On success: returns a structured outcome with provider/model/parsed/
 *     rawOutput and per-attempt durationMs.
 *   - On failure: returns a structured failure outcome with the LAST error
 *     code/message so the caller (extractionService) can persist an
 *     ExtractionVersion row with state='failed'.
 *
 * The caller is responsible for persisting outcomes (ExtractionVersion rows
 * and Enquiry.effectiveExtraction). This module is intentionally I/O-free
 * so it is trivially testable with mocked providers.
 *
 * SECURITY: This module never sees API keys (they live inside the provider
 * adapters). It never logs rawOutput unless explicitly asked — the provider
 * already logs a redacted summary.
 */
import groqProvider, { extract as groqExtract } from './groqProvider.js';
import geminiProvider, { extract as geminiExtract } from './geminiProvider.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {Object} ProviderAttempt
 * @property {string} provider        'groq' | 'gemini'
 * @property {string|null} model
 * @property {'completed'|'failed'} state
 * @property {unknown|null} rawOutput
 * @property {import('./extractionSchema.js').Extraction|null} parsed
 * @property {string|null} errorCode
 * @property {string|null} errorMessage
 * @property {number|null} durationMs
 */

/**
 * @typedef {Object} LlmOutcome
 * @property {'completed'|'failed'} state
 * @property {string|null} provider        The provider that succeeded (or null on total failure).
 * @property {string|null} model
 * @property {import('./extractionSchema.js').Extraction|null} parsed
 * @property {unknown|null} rawOutput
 * @property {string|null} errorCode
 * @property {string|null} errorMessage    Safe, short, user-facing.
 * @property {number|null} durationMs      Total wall-clock across all attempts.
 * @property {ProviderAttempt[]} attempts  Per-provider audit trail.
 */

/**
 * Walk the Groq → Gemini chain.
 *
 * @param {string} enquiryText
 * @returns {Promise<LlmOutcome>}
 */
export async function extractWithFallback(enquiryText) {
  if (typeof enquiryText !== 'string' || enquiryText.length === 0) {
    return {
      state: 'failed',
      provider: null,
      model: null,
      parsed: null,
      rawOutput: null,
      errorCode: 'EMPTY_INPUT',
      errorMessage: 'No enquiry text provided.',
      durationMs: 0,
      attempts: [],
    };
  }

  /** @type {Array<{name: string, fn: (t: string) => Promise<unknown>, configured: boolean}>} */
  const chain = [
    { name: 'groq', fn: groqExtract, configured: groqProvider.isConfigured() },
    { name: 'gemini', fn: geminiExtract, configured: geminiProvider.isConfigured() },
  ];

  const startedAt = Date.now();
  /** @type {ProviderAttempt[]} */
  const attempts = [];

  for (const provider of chain) {
    try {
      const result = await provider.fn(enquiryText);
      const attempt = /** @type {ProviderAttempt} */ ({
        provider: provider.name,
        model: result?.model || provider.name,
        state: 'completed',
        rawOutput: result?.rawOutput ?? null,
        parsed: result?.parsed ?? null,
        errorCode: null,
        errorMessage: null,
        durationMs: typeof result?.durationMs === 'number' ? result.durationMs : null,
      });
      attempts.push(attempt);

      return {
        state: 'completed',
        provider: provider.name,
        model: attempt.model,
        parsed: attempt.parsed,
        rawOutput: attempt.rawOutput,
        errorCode: null,
        errorMessage: null,
        durationMs: Date.now() - startedAt,
        attempts,
      };
    } catch (err) {
      const code = err?.code || 'PROVIDER_ERROR';
      const recoverable = err?.recoverable !== false; // default true
      const attempt = /** @type {ProviderAttempt} */ ({
        provider: provider.name,
        model: err?.model || null,
        state: 'failed',
        rawOutput: err?.rawOutput ?? null,
        parsed: null,
        errorCode: code,
        errorMessage: err?.message || 'Unknown provider error.',
        durationMs: typeof err?.durationMs === 'number' ? err.durationMs : null,
      });
      attempts.push(attempt);

      logger.warn('llmService: provider failed', {
        provider: provider.name,
        code,
        recoverable,
        configured: provider.configured,
        attemptDurationMs: attempt.durationMs,
        // NEVER log err.rawOutput here — it may contain provider response
        // payloads we do not want in default logs. extractionService persists
        // it in ExtractionVersion.rawOutput where the operator can inspect it.
      });

      // Non-recoverable (e.g. INVALID_OUTPUT) → STOP. Do NOT try next provider.
      // Rules.md §3: "do not automatically switch providers for every
      // validation error without distinguishing provider/API failure from
      // malformed model output."
      if (!recoverable) {
        return {
          state: 'failed',
          provider: null,
          model: attempt.model,
          parsed: null,
          rawOutput: attempt.rawOutput,
          errorCode: code,
          errorMessage: attempt.errorMessage,
          durationMs: Date.now() - startedAt,
          attempts,
        };
      }
      // Recoverable → fall through to next provider.
    }
  }

  // Both providers failed recoverably (or were NOT_CONFIGURED).
  const last = attempts[attempts.length - 1] || null;
  return {
    state: 'failed',
    provider: null,
    model: last?.model || null,
    parsed: null,
    rawOutput: last?.rawOutput || null,
    errorCode: last?.errorCode || 'ALL_PROVIDERS_FAILED',
    errorMessage:
      last?.errorMessage ||
      'Extraction failed. No provider produced a valid result.',
    durationMs: Date.now() - startedAt,
    attempts,
  };
}

export const llmService = {
  extractWithFallback,
  providers: { groq: groqProvider, gemini: geminiProvider },
};

export default llmService;
