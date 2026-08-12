/**
 * Grok provider — PRIMARY LLM adapter (skeleton).
 *
 * Phase 0 contract:
 *   - Implements the LlmProvider interface.
 *   - Reads GROK_API_KEY + GROK_MODEL from env.
 *   - extract() throws NOT_IMPLEMENTED.
 *
 * Phase 3 will replace extract() with a real HTTP call to the Grok API,
 * keeping all SDK/HTTP details inside this file so the rest of the backend
 * never imports the Grok client directly (Architechure.md §5, §14).
 *
 * SECURITY: API key stays server-side. It is read from env at call-time and
 * is never logged, never returned to the client, and never sent to React.
 */
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { SYSTEM_PROMPT, buildUserMessage } from './extractionPrompt.js';
import { extractionSchema } from './extractionSchema.js';

export const PROVIDER_NAME = 'grok';

/**
 * @typedef {import('./extractionSchema.js').Extraction} Extraction
 * @typedef {{ provider: string, model: string, rawOutput: unknown, parsed: Extraction }} ExtractionResult
 */

/**
 * @returns {boolean} true if a non-empty API key is configured.
 */
export function isConfigured() {
  return Boolean(env.GROK_API_KEY && env.GROK_API_KEY.trim());
}

/**
 * Phase 0 skeleton — real implementation lands in Phase 3.
 *
 * @param {string} _enquiryText
 * @returns {Promise<ExtractionResult>}
 * @throws {Error} NOT_IMPLEMENTED
 */
export async function extract(_enquiryText) {
  logger.warn('grokProvider.extract called in Phase 0 — NOT_IMPLEMENTED');
  const err = new Error('Grok provider is not implemented (Phase 3)');
  err.code = 'NOT_IMPLEMENTED';
  err.provider = PROVIDER_NAME;
  err.model = env.GROK_MODEL;
  throw err;
}

// Re-exported so callers can introspect the prompt without importing it elsewhere.
export const promptContract = { SYSTEM_PROMPT, buildUserMessage, extractionSchema };

const grokProvider = { name: PROVIDER_NAME, isConfigured, extract };
export default grokProvider;
