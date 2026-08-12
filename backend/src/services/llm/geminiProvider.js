/**
 * Gemini provider — SECONDARY / FALLBACK LLM adapter (skeleton).
 *
 * Same contract as grokProvider. Only invoked when grokProvider.extract()
 * throws a recoverable provider/API failure (Rules.md §3, Architechure.md §5).
 *
 * Phase 0 contract:
 *   - Implements the LlmProvider interface.
 *   - Reads GEMINI_API_KEY + GEMINI_MODEL from env.
 *   - extract() throws NOT_IMPLEMENTED.
 */
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { SYSTEM_PROMPT, buildUserMessage } from './extractionPrompt.js';
import { extractionSchema } from './extractionSchema.js';

export const PROVIDER_NAME = 'gemini';

/**
 * @returns {boolean} true if a non-empty API key is configured.
 */
export function isConfigured() {
  return Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim());
}

/**
 * Phase 0 skeleton — real implementation lands in Phase 3.
 *
 * @param {string} _enquiryText
 * @returns {Promise<import('./extractionSchema.js').Extraction>}
 * @throws {Error} NOT_IMPLEMENTED
 */
export async function extract(_enquiryText) {
  logger.warn('geminiProvider.extract called in Phase 0 — NOT_IMPLEMENTED');
  const err = new Error('Gemini provider is not implemented (Phase 3)');
  err.code = 'NOT_IMPLEMENTED';
  err.provider = PROVIDER_NAME;
  err.model = env.GEMINI_MODEL;
  throw err;
}

export const promptContract = { SYSTEM_PROMPT, buildUserMessage, extractionSchema };

const geminiProvider = { name: PROVIDER_NAME, isConfigured, extract };
export default geminiProvider;
