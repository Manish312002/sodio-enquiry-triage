/**
 * LLM service — provider-agnostic facade.
 *
 * Provider order (Rules.md §3):
 *   Grok (primary)
 *     ↓ recoverable provider/API failure
 *   Gemini (secondary/fallback)
 *     ↓ failure
 *   Extraction failed state
 *
 * Phase 0 contract:
 *   - Re-exports provider skeletons.
 *   - extractWithFallback() returns a structured failure result with code
 *     'NOT_IMPLEMENTED' so future controllers can verify the failure path
 *     without making real API calls.
 *
 * Phase 3 will replace the NOT_IMPLEMENTED stubs with real HTTP calls and
 * add provider error classification (transient vs. malformed output).
 */
import grokProvider, { extract as grokExtract } from './grokProvider.js';
import geminiProvider, { extract as geminiExtract } from './geminiProvider.js';
import { logger } from '../../utils/logger.js';

/**
 * @typedef {Object} LlmOutcome
 * @property {'completed'|'failed'} state
 * @property {string|null} provider        'grok' | 'gemini' | null
 * @property {string|null} model
 * @property {import('./extractionSchema.js').Extraction|null} parsed
 * @property {unknown|null} rawOutput
 * @property {string|null} errorCode
 * @property {string|null} errorMessage    Safe, short, user-facing.
 */

/**
 * Phase 0 stub: walks the provider chain but every provider throws
 * NOT_IMPLEMENTED, so the outcome is always a structured failure.
 *
 * Phase 3 will:
 *   - distinguish recoverable provider errors from invalid model output;
 *   - validate provider output against extractionSchema;
 *   - persist an ExtractionVersion record per attempt.
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
    };
  }

  /** @type {Array<{name: string, fn: (t: string) => Promise<unknown>, configured: boolean}>} */
  const chain = [
    { name: 'grok', fn: grokExtract, configured: grokProvider.isConfigured() },
    { name: 'gemini', fn: geminiExtract, configured: geminiProvider.isConfigured() },
  ];

  for (const provider of chain) {
    try {
      // Phase 0: this throws NOT_IMPLEMENTED. Real calls arrive in Phase 3.
      const result = await provider.fn(enquiryText);
      return {
        state: 'completed',
        provider: provider.name,
        model: result?.model || provider.name,
        parsed: result?.parsed || null,
        rawOutput: result?.rawOutput || null,
        errorCode: null,
        errorMessage: null,
      };
    } catch (err) {
      const code = err?.code || 'PROVIDER_ERROR';
      logger.warn(
        `llmService: provider "${provider.name}" failed (code=${code}, configured=${provider.configured})`,
        { message: err?.message },
      );
      // In Phase 3 we will distinguish:
      //   - NOT_IMPLEMENTED / network / timeout → try next provider
      //   - schema validation failure → DO NOT try next provider (Rules.md §3)
      // For Phase 0 we just walk to the next provider.
    }
  }

  return {
    state: 'failed',
    provider: null,
    model: null,
    parsed: null,
    rawOutput: null,
    errorCode: 'ALL_PROVIDERS_FAILED',
    errorMessage: 'Extraction failed. No provider produced a valid result.',
  };
}

export const llmService = {
  extractWithFallback,
  providers: { grok: grokProvider, gemini: geminiProvider },
};

export default llmService;
