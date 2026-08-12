/**
 * Environment configuration.
 *
 * Loads .env, validates variables with zod, and exports a frozen `env` object.
 * Fails fast on missing/invalid configuration rather than starting a half-broken
 * server.
 *
 * Phase 0 rule: LLM API keys may be empty (no real LLM calls are made).
 * MONGODB_URI must be a non-empty string, but connectivity is verified at
 * startup, not here.
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

  // LLM provider keys — Phase 0 allows empty (skeletons only).
  GROK_API_KEY: z.string().default(''),
  GROK_MODEL: z.string().default('grok-2-latest'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),

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
 * @property {string} GEMINI_API_KEY
 * @property {string} GEMINI_MODEL
 * @property {number} LLM_TIMEOUT_MS
 * @property {number} LLM_MAX_RETRIES
 * @property {number} BATCH_CONCURRENCY
 */
export const env = Object.freeze({ ...parsed.data });
