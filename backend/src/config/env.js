/**
 * Environment configuration.
 *
 * Loads .env, validates variables with zod, and exports an `env` object.
 * Fails fast on missing/invalid configuration rather than starting a half-broken
 * server.
 *
 * Phase 0 rule: LLM API keys may be empty (no real LLM calls are made).
 * MONGODB_URI must be a non-empty string, but connectivity is verified at
 * startup, not here.
 *
 * Phase 3 note: `env` is intentionally NOT frozen. Application code treats
 * it as read-only at runtime (we never write to `env.X` in services). Tests
 * may mutate it per-test to exercise configured / not-configured paths
 * without re-importing modules. The previous `Object.freeze` made this
 * impossible because mock attempts threw "Cannot assign to read only property".
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI must be set (see .env.example)'),

  // LLM provider keys — Phase 3 makes real HTTP calls when keys are present.
  // Empty string means "not configured" → provider is skipped (NOT a failure).
  GROK_API_KEY: z.string().default(''),
  GROK_MODEL: z.string().default('grok-2-latest'),
  GROK_API_URL: z
    .string()
    .url()
    .default('https://api.x.ai/v1/chat/completions'),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  GEMINI_API_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta'),

  // LLM behaviour
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(1),

  // Batch processing
  BATCH_CONCURRENCY: z.coerce.number().int().positive().default(3),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[env] Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

/**
 * @typedef {Object} Env
 * @property {'development'|'test'|'production'} NODE_ENV
 * @property {number} PORT
 * @property {string} MONGODB_URI
 * @property {string} GROK_API_KEY
 * @property {string} GROK_MODEL
 * @property {string} GROK_API_URL
 * @property {string} GEMINI_API_KEY
 * @property {string} GEMINI_MODEL
 * @property {string} GEMINI_API_URL
 * @property {number} LLM_TIMEOUT_MS
 * @property {number} LLM_MAX_RETRIES
 * @property {number} BATCH_CONCURRENCY
 */
export const env = { ...parsed.data };
