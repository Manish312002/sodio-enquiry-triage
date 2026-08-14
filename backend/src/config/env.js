/**
 * Environment configuration.
 *
 * Loads .env, validates variables with zod, and exports an `env` object.
 * Fails fast on missing/invalid configuration rather than starting a half-broken
 * server.
 *
 * rule: LLM API keys may be empty (no real LLM calls are made).
 * MONGODB_URI must be a non-empty string, but connectivity is verified at
 * startup, not here.
 *
 * note: `env` is intentionally NOT frozen. Application code treats
 * it as read-only at runtime (we never write to `env.X` in services). Tests
 * may mutate it per-test to exercise configured / not-configured paths
 * without re-importing modules. The previous `Object.freeze` made this
 * impossible because mock attempts threw "Cannot assign to read only property".
 *
 * SDK migration: provider vars renamed from GROK_* to GROQ_* (the
 * primary provider is now Groq, not xAI/Grok). Both providers use official
 * SDKs (`openai` and `@google/genai`) so the provider endpoint URLs are
 * no longer configurable — they're baked into the SDK defaults
 * (https://api.groq.com/openai/v1 for Groq via the OpenAI SDK's baseURL,
 * and the Gemini SDK's default endpoint).
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

  // --- Groq (primary) ---
  // Uses the official `openai` npm package pointed at Groq's OpenAI-compatible
  // endpoint. GROQ_BASE_URL is configurable (defaults to the documented
  // Groq endpoint) so tests can point at a mock HTTP server.
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('openai/gpt-oss-20b'),
  GROQ_BASE_URL: z
    .string()
    .url()
    .default('https://api.groq.com/openai/v1'),

  // --- Gemini (fallback) ---
  // Uses the official `@google/genai` SDK. The SDK constructor handles
  // the endpoint URL internally; we only need the API key + model name.
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.6-flash'),

  // --- LLM behaviour ---
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(1),

  // --- Batch processing ---
  BATCH_CONCURRENCY: z.coerce.number().int().positive().default(3),

  // --- ---
  // CORS_ALLOWED_ORIGINS — comma-separated list of allowed origins for
  // browser requests. '*' (the default in development) allows any origin.
  // In production, set this to the explicit origin(s) of the deployed
  // frontend, e.g. `https://triage.example.com,https://staging.triage.example.com`.
  // Empty string is treated as '*' (permissive).
  CORS_ALLOWED_ORIGINS: z.string().default('*'),
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
 * @property {string} GROQ_API_KEY
 * @property {string} GROQ_MODEL
 * @property {string} GROQ_BASE_URL
 * @property {string} GEMINI_API_KEY
 * @property {string} GEMINI_MODEL
 * @property {number} LLM_TIMEOUT_MS
 * @property {number} LLM_MAX_RETRIES
 * @property {number} BATCH_CONCURRENCY
 * @property {string} CORS_ALLOWED_ORIGINS
 */
export const env = { ...parsed.data };
