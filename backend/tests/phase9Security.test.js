/**
 * Phase 9 — Security + AI Boundaries (Docs/Phases.md §9, Docs/Rules.md §12/§13)
 *
 * This test suite audits every Phase 9 build requirement as a single
 * consolidated security gate. Each `describe` block maps 1:1 to a Phase 9
 * build item:
 *
 *   1. Server-only API keys
 *   2. Prompt injection boundary
 *   3. Input validation
 *   4. File limits
 *   5. Safe error responses
 *   6. Safe logs
 *   7. Provider timeout          (Groq via SDK `timeout`; Gemini via withTimeout)
 *   8. No client-to-provider direct calls
 *
 * Acceptance Criteria (Phases.md §9):
 *   "The model-directed sample enquiry is treated as ordinary data and
 *    cannot override extraction instructions."
 *
 *   This is enforced by promptInjection.test.js (covered separately) AND
 *   by the schema/prompt/provider invariants audited here. We do NOT
 *   duplicate the end-to-end injection test — we verify the structural
 *   invariants that make the injection test pass.
 *
 * No network calls are made. All provider interactions use the existing
 * mockOpenAIResponses / mockGeminiInteractions helpers from _helpers.js.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';

import { env } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { AppError, errorHandler } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import {
  uploadSingleEnquiryFile,
  handleUploadErrors,
} from '../src/middleware/uploadMiddleware.js';
import uploadMiddleware from '../src/middleware/uploadMiddleware.js';
import { SYSTEM_PROMPT, buildUserMessage } from '../src/services/llm/extractionPrompt.js';
import { extractionSchema } from '../src/services/llm/extractionSchema.js';
import * as geminiProvider from '../src/services/llm/geminiProvider.js';
import {
  mockGeminiInteractions,
  geminiResponse,
  validExtraction,
} from './_helpers.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FRONTEND_SRC = join(ROOT, 'frontend', 'src');

// ---------------------------------------------------------------------------
// 1. Server-only API keys
// ---------------------------------------------------------------------------
describe('Phase 9 §1 — Server-only API keys', () => {
  test('backend/.env is gitignored (root .gitignore contains .env)', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf-8');
    assert.ok(/(^|\n)\.env(\n|$)/.test(gitignore), '.gitignore must list .env');
    assert.ok(/\*\.env/.test(gitignore), '.gitignore must list *.env');
  });

  test('.env.example does NOT contain real API key values', () => {
    const envExample = readFileSync(join(ROOT, '.env.example'), 'utf-8');
    // Empty value after `=` is allowed (placeholder).
    // A real key would have a long non-empty string after `GROQ_API_KEY=` etc.
    const groqLine = envExample.match(/^GROQ_API_KEY=(.*)$/m);
    const geminiLine = envExample.match(/^GEMINI_API_KEY=(.*)$/m);
    assert.ok(groqLine, 'GROQ_API_KEY must be in .env.example');
    assert.ok(geminiLine, 'GEMINI_API_KEY must be in .env.example');
    assert.equal(groqLine[1].trim(), '', 'GROQ_API_KEY must be empty in .env.example');
    assert.equal(geminiLine[1].trim(), '', 'GEMINI_API_KEY must be empty in .env.example');
  });

  test('env.js loads keys from process.env (server-side only)', () => {
    // env is already loaded; verify keys live on the server-side env object.
    assert.ok(typeof env.GROQ_API_KEY === 'string');
    assert.ok(typeof env.GEMINI_API_KEY === 'string');
  });

  test('frontend source tree contains NO LLM SDK imports', () => {
    // Scan every .js / .jsx file under frontend/src for forbidden imports.
    const forbiddenPatterns = [
      /from\s+['"]openai['"]/,
      /from\s+['"]@google\/genai['"]/,
      /from\s+['"]@anthropic-ai\/sdk['"]/,
      /require\s*\(\s*['"]openai['"]\s*\)/,
      /require\s*\(\s*['"]@google\/genai['"]\s*\)/,
    ];
    const violations = [];
    function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
        } else if (/\.(js|jsx)$/.test(entry)) {
          const src = readFileSync(full, 'utf-8');
          for (const re of forbiddenPatterns) {
            if (re.test(src)) violations.push(`${full}: matches ${re}`);
          }
        }
      }
    }
    walk(FRONTEND_SRC);
    assert.deepEqual(violations, [], 'frontend must not import any LLM SDK');
  });

  test('frontend source tree contains NO references to API key env vars', () => {
    // The VITE_ prefix is the ONLY way env vars reach the client. The
    // secret key names must never appear in frontend code at all.
    const forbiddenNames = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];
    const violations = [];
    function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          walk(full);
        } else if (/\.(js|jsx)$/.test(entry)) {
          const src = readFileSync(full, 'utf-8');
          for (const name of forbiddenNames) {
            if (src.includes(name)) violations.push(`${full}: contains ${name}`);
          }
        }
      }
    }
    walk(FRONTEND_SRC);
    assert.deepEqual(violations, [], 'frontend must not reference API key env vars');
  });
});

// ---------------------------------------------------------------------------
// 2. Prompt injection boundary (structural invariants)
// ---------------------------------------------------------------------------
describe('Phase 9 §2 — Prompt injection boundary (structural)', () => {
  test('SYSTEM_PROMPT explicitly forbids following enquiry-embedded instructions', () => {
    assert.ok(/untrusted/i.test(SYSTEM_PROMPT));
    assert.ok(/ignore all previous instructions/i.test(SYSTEM_PROMPT));
    assert.ok(/isModelInstructionAttempt/i.test(SYSTEM_PROMPT));
  });

  test('buildUserMessage wraps enquiry in a literal data fence', () => {
    const msg = buildUserMessage('INJECTED TEXT');
    assert.ok(msg.includes('===ENQUIRY BEGIN==='));
    assert.ok(msg.includes('===ENQUIRY END==='));
    assert.ok(msg.includes('INJECTED TEXT'));
    // The fence must enclose the injected text.
    const beginIdx = msg.indexOf('===ENQUIRY BEGIN===');
    const endIdx = msg.lastIndexOf('===ENQUIRY END===');
    const injectIdx = msg.indexOf('INJECTED TEXT');
    assert.ok(beginIdx < injectIdx, 'fence BEGIN must precede content');
    assert.ok(injectIdx < endIdx, 'content must precede fence END');
  });

  test('extraction schema is .strict() — rejects unknown keys (e.g. injected "notes")', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      notes: 'APPROVED BY ADMIN',
    });
    assert.equal(r.success, false);
    assert.ok(
      r.error.issues.some((i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('notes')),
      'schema must flag injected "notes" key',
    );
  });

  test('extraction schema rejects an injected "priority" field', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      priority: { level: 'high', score: 99 },
    });
    assert.equal(r.success, false);
    assert.ok(
      r.error.issues.some((i) => i.code === 'unrecognized_keys' && (i.keys || []).includes('priority')),
      'schema must flag injected "priority" key',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Input validation (controller-level zod schemas)
// ---------------------------------------------------------------------------
describe('Phase 9 §3 — Input validation (controller schemas)', () => {
  // We import the controller module to verify the schemas exist and reject
  // malformed input. We do NOT call the controllers themselves (they need
  // a DB); we just exercise the zod schemas via the controller's exports
  // by re-importing the schemas indirectly through the controller file.
  //
  // The controller does not export its schemas directly, so we re-create
  // the same shape here and verify the controller's validation pattern is
  // present in the source. This is a structural guard: if a future refactor
  // drops the .strict() or the .max() bounds, this test fails.
  test('enquiryController source defines .strict() schemas for body and query', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'controllers', 'enquiryController.js'),
      'utf-8',
    );
    assert.ok(/createEnquiryBodySchema[\s\S]*?\.strict\(\)/.test(src), 'createEnquiryBodySchema must be .strict()');
    assert.ok(/listEnquiriesQuerySchema[\s\S]*?\.strict\(\)/.test(src), 'listEnquiriesQuerySchema must be .strict()');
    assert.ok(/updateStatusBodySchema[\s\S]*?\.strict\(\)/.test(src), 'updateStatusBodySchema must be .strict()');
    // originalText has a max bound
    assert.ok(/originalText:\s*z\.string\(\)\.min\(1\)\.max\(/.test(src), 'originalText must have a max bound');
    // limit has a max bound
    assert.ok(/limit:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(200\)/.test(src), 'limit must be bounded 1-200');
    // serviceLine / priority / status are enums (not arbitrary strings).
    // The regex allows whitespace between `z` and `.enum` because the source
    // formats multi-line (e.g. `serviceLine: z\n      .enum([...])`).
    assert.ok(/serviceLine:\s*z\s*\.enum\(\[/.test(src), 'serviceLine must be an enum');
    assert.ok(/priority:\s*z\s*\.enum\(\[/.test(src), 'priority must be an enum');
    assert.ok(/status:\s*z\s*\.enum\(\[/.test(src), 'status must be an enum');
  });

  test('enquiryController validates :field against OVERRIDEABLE_FIELDS allowlist', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'controllers', 'enquiryController.js'),
      'utf-8',
    );
    // Both PATCH /:id/fields/:field and POST /:id/fields/:field/accept-model
    // must reject unknown field names early.
    const updateFieldBlock = src.match(/export const updateField[\s\S]*?res\.status\(200\)\.json/);
    const acceptModelBlock = src.match(/export const acceptNewModelValue[\s\S]*?res\.status\(200\)\.json/);
    assert.ok(updateFieldBlock, 'updateField handler must exist');
    assert.ok(acceptModelBlock, 'acceptNewModelValue handler must exist');
    assert.ok(
      /OVERRIDEABLE_FIELDS\.includes\(field\)/.test(updateFieldBlock[0]),
      'updateField must check field against OVERRIDEABLE_FIELDS allowlist',
    );
    assert.ok(
      /OVERRIDEABLE_FIELDS\.includes\(field\)/.test(acceptModelBlock[0]),
      'acceptNewModelValue must check field against OVERRIDEABLE_FIELDS allowlist',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. File limits
// ---------------------------------------------------------------------------
describe('Phase 9 §4 — File limits', () => {
  test('MAX_UPLOAD_BYTES is 5 MiB and exposed for ops inspection', () => {
    const MAX_UPLOAD_BYTES = uploadMiddleware.MAX_UPLOAD_BYTES;
    assert.equal(MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
  });

  test('uploadSingleEnquiryFile enforces fileSize + files + fileFilter', () => {
    // Inspect the multer config object directly.
    const cfg = uploadSingleEnquiryFile;
    assert.ok(cfg, 'uploadSingleEnquiryFile must be exported');
    // The multer instance stores its config in internal fields; we verify
    // by reading the source instead.
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'middleware', 'uploadMiddleware.js'),
      'utf-8',
    );
    assert.ok(/fileSize:\s*MAX_UPLOAD_BYTES/.test(src), 'fileSize limit must be set');
    assert.ok(/files:\s*1/.test(src), 'files limit must be 1');
    assert.ok(/ALLOWED_EXT\s*=/.test(src), 'allowed extensions must be defined');
    assert.ok(/ALLOWED_MIME\s*=/.test(src), 'allowed MIME types must be defined');
  });

  test('handleUploadErrors maps LIMIT_FILE_SIZE to 413 FILE_TOO_LARGE', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'middleware', 'uploadMiddleware.js'),
      'utf-8',
    );
    assert.ok(/LIMIT_FILE_SIZE[\s\S]*?413[\s\S]*?FILE_TOO_LARGE/.test(src));
  });

  test('handleUploadErrors maps LIMIT_UNEXPECTED_FILE to 400 UNEXPECTED_FIELD', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'middleware', 'uploadMiddleware.js'),
      'utf-8',
    );
    assert.ok(/LIMIT_UNEXPECTED_FILE[\s\S]*?400[\s\S]*?UNEXPECTED_FIELD/.test(src));
  });

  test('express.json body limit is set in app.js', () => {
    const src = readFileSync(join(ROOT, 'backend', 'src', 'app.js'), 'utf-8');
    assert.ok(/express\.json\(\s*\{\s*limit:/.test(src), 'express.json must have a limit');
    assert.ok(/express\.urlencoded\([\s\S]*?limit:/.test(src), 'express.urlencoded must have a limit');
  });
});

// ---------------------------------------------------------------------------
// 5. Safe error responses
// ---------------------------------------------------------------------------
describe('Phase 9 §5 — Safe error responses', () => {
  test('errorHandler redacts stack trace for 5xx (only safe message exposed)', () => {
    const err = new Error('DB connection blew up at mongodb://user:pass@host:27017');
    err.stack = 'Error: DB connection blew up\n    at /secrets/db.js:42';
    const req = { method: 'POST', path: '/api/enquiries', id: 'req-123' };
    const res = {
      status: (code) => {
        assert.equal(code, 500);
        return res;
      },
      json: (body) => {
        // The raw error message must NOT be in the response body.
        const json = JSON.stringify(body);
        assert.ok(!json.includes('mongodb://user:pass'));
        assert.ok(!json.includes('DB connection blew up'));
        assert.ok(!json.includes('/secrets/db.js'));
        assert.equal(body.error.message, 'Something went wrong. Please try again.');
        assert.equal(body.error.code, 'INTERNAL_ERROR');
        assert.equal(body.error.requestId, 'req-123');
      },
    };
    errorHandler(err, req, res, () => {});
  });

  test('errorHandler exposes the original message only for 4xx (safe client errors)', () => {
    const err = new AppError({
      message: 'Budget must be an object with raw, currency, min, max, qualifier.',
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    const req = { method: 'PATCH', path: '/api/enquiries/abc/fields/budget', id: 'req-456' };
    const res = {
      status: (code) => {
        assert.equal(code, 400);
        return res;
      },
      json: (body) => {
        assert.equal(body.error.message, 'Budget must be an object with raw, currency, min, max, qualifier.');
        assert.equal(body.error.code, 'VALIDATION_ERROR');
        assert.equal(body.error.requestId, 'req-456');
      },
    };
    errorHandler(err, req, res, () => {});
  });

  test('errorHandler includes requestId in every error response', () => {
    const err = new Error('boom');
    const req = { method: 'GET', path: '/api/enquiries', id: 'abc-uuid-123' };
    let captured = null;
    const res = {
      status: () => res,
      json: (body) => {
        captured = body;
      },
    };
    errorHandler(err, req, res, () => {});
    assert.equal(captured.error.requestId, 'abc-uuid-123');
  });

  test('errorHandler tolerates missing req.id (falls back to null)', () => {
    const err = new Error('boom');
    const req = { method: 'GET', path: '/api/enquiries' }; // no .id
    let captured = null;
    const res = {
      status: () => res,
      json: (body) => {
        captured = body;
      },
    };
    errorHandler(err, req, res, () => {});
    assert.equal(captured.error.requestId, null);
  });
});

// ---------------------------------------------------------------------------
// 6. Safe logs (logger redaction)
// ---------------------------------------------------------------------------
describe('Phase 9 §6 — Safe logs (redaction)', () => {
  // Capture console output to verify redaction.
  let originalConsoleLog;
  let captured;

  beforeEach(() => {
    captured = [];
    originalConsoleLog = console.log;
    console.log = (...args) => captured.push(args.join(' '));
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  test('logger redacts apiKey / api_key / authorization / token / secret', () => {
    logger.info('test', {
      apiKey: 'sk-real-key',
      api_key: 'sk-real-key',
      authorization: 'Bearer xyz',
      token: 'abc',
      secret: 'shhh',
      safe: 'kept',
    });
    const line = captured.join('');
    assert.ok(line.includes('[REDACTED]'), 'redacted placeholder must appear');
    assert.ok(!line.includes('sk-real-key'), 'api key value must NOT appear');
    assert.ok(!line.includes('Bearer xyz'), 'authorization value must NOT appear');
    assert.ok(!line.includes('shhh'), 'secret value must NOT appear');
    assert.ok(line.includes('"safe":"kept"'), 'non-sensitive fields must remain');
  });

  test('logger redacts MongoDB connection strings', () => {
    const mongoUri = 'mongodb+srv://user:pass@cluster.example.com/db';
    logger.info('test', {
      mongoUri,
      mongodb_uri: mongoUri,
      connectionString: mongoUri,
    });
    const line = captured.join('');
    assert.ok(!line.includes('user:pass'), 'mongo credentials must NOT appear');
    assert.ok(!line.includes('cluster.example.com'), 'mongo host must NOT appear');
  });

  test('logger redacts nested keys (deep object)', () => {
    logger.info('test', {
      outer: {
        apiKey: 'nested-key',
        inner: { token: 'nested-token' },
      },
    });
    const line = captured.join('');
    assert.ok(!line.includes('nested-key'), 'nested api key must NOT appear');
    assert.ok(!line.includes('nested-token'), 'nested token must NOT appear');
  });

  test('logger redacts GROQ_API_KEY / GEMINI_API_KEY named keys', () => {
    logger.info('test', {
      GROQ_API_KEY: 'gsk_real_key',
      GEMINI_API_KEY: 'AIza_real_key',
    });
    const line = captured.join('');
    assert.ok(!line.includes('gsk_real_key'), 'groq key must NOT appear');
    assert.ok(!line.includes('AIza_real_key'), 'gemini key must NOT appear');
  });
});

// ---------------------------------------------------------------------------
// 7. Provider timeout
// ---------------------------------------------------------------------------
describe('Phase 9 §7 — Provider timeout', () => {
  describe('Groq (via OpenAI SDK `timeout` client option)', () => {
    test('groqProvider source configures client timeout from env.LLM_TIMEOUT_MS', () => {
      const src = readFileSync(
        join(ROOT, 'backend', 'src', 'services', 'llm', 'groqProvider.js'),
        'utf-8',
      );
      assert.ok(
        /timeout:\s*env\.LLM_TIMEOUT_MS/.test(src),
        'OpenAI client must be constructed with timeout: env.LLM_TIMEOUT_MS',
      );
    });
  });

  describe('Gemini (via withTimeout wrapper)', () => {
    const saved = {
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      GROQ_API_KEY: env.GROQ_API_KEY,
      LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
      LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    };

    beforeEach(() => {
      env.GEMINI_API_KEY = 'test-key';
      env.GROQ_API_KEY = ''; // disable Groq so llmService jumps to Gemini
      env.LLM_TIMEOUT_MS = 50; // very short — must fire on a 200ms mock delay
      env.LLM_MAX_RETRIES = 0;
    });

    afterEach(() => {
      Object.assign(env, saved);
    });

    test('geminiProvider source uses withTimeout() around the SDK call', () => {
      const src = readFileSync(
        join(ROOT, 'backend', 'src', 'services', 'llm', 'geminiProvider.js'),
        'utf-8',
      );
      assert.ok(/function withTimeout/.test(src), 'withTimeout helper must be defined');
      assert.ok(
        /await withTimeout\(\s*client\.interactions\.create/.test(src),
        'SDK call must be wrapped in withTimeout()',
      );
    });

    test('a hung Gemini call is aborted and classified as PROVIDER_TIMEOUT', async () => {
      const mock = mockGeminiInteractions(
        () =>
          new Promise((resolve) => {
            // Never resolves within the 50ms timeout.
            setTimeout(() => resolve(geminiResponse(validExtraction())), 2000);
          }),
      );
      try {
        await geminiProvider.extract('test enquiry text');
        assert.fail('extract() should have thrown PROVIDER_TIMEOUT');
      } catch (err) {
        assert.equal(err.code, 'PROVIDER_TIMEOUT');
        assert.equal(err.recoverable, true);
        assert.equal(err.provider, 'gemini');
      } finally {
        mock.restore();
      }
    });

    test('a fast Gemini call still succeeds (withTimeout does not interfere)', async () => {
      const mock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
      try {
        const result = await geminiProvider.extract('test enquiry text');
        assert.equal(result.provider, 'gemini');
        assert.equal(result.parsed.company, 'Test Co');
      } finally {
        mock.restore();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 8. No client-to-provider direct calls
// ---------------------------------------------------------------------------
describe('Phase 9 §8 — No client-to-provider direct calls', () => {
  test('frontend package.json declares NO LLM SDK dependencies', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'frontend', 'package.json'), 'utf-8'),
    );
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    const forbidden = ['openai', '@google/genai', '@anthropic-ai/sdk', 'groq-sdk'];
    const present = forbidden.filter((name) => name in allDeps);
    assert.deepEqual(present, [], 'frontend must not declare LLM SDK dependencies');
  });

  test('frontend api.js only talks to the backend (no provider URLs)', () => {
    const apiSrc = readFileSync(join(ROOT, 'frontend', 'src', 'services', 'api.js'), 'utf-8');
    assert.ok(!/api\.groq\.com/.test(apiSrc), 'api.js must not reference api.groq.com');
    assert.ok(!/generativelanguage\.googleapis\.com/.test(apiSrc), 'api.js must not reference Gemini endpoint');
    // Must use the backend proxy via VITE_API_BASE_URL.
    assert.ok(/VITE_API_BASE_URL/.test(apiSrc), 'api.js must use VITE_API_BASE_URL');
  });
});

// ---------------------------------------------------------------------------
// Phase 9 middleware: requestId + helmet
// ---------------------------------------------------------------------------
describe('Phase 9 — requestId middleware', () => {
  test('generates a UUID v4 when no incoming header is present', () => {
    const mw = requestId();
    const req = { headers: {} };
    const res = {
      headers: {},
      setHeader: (k, v) => {
        res.headers[k] = v;
      },
    };
    mw(req, res, () => {});
    assert.ok(typeof req.id === 'string');
    assert.match(req.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(res.headers['X-Request-Id'], req.id);
  });

  test('honours a valid incoming X-Request-Id header', () => {
    const mw = requestId();
    const incoming = 'my-correlation-id-123';
    const req = { headers: { 'x-request-id': incoming } };
    const res = {
      headers: {},
      setHeader: (k, v) => {
        res.headers[k] = v;
      },
    };
    mw(req, res, () => {});
    assert.equal(req.id, incoming);
    assert.equal(res.headers['X-Request-Id'], incoming);
  });

  test('rejects an incoming header with control characters (generates fresh UUID)', () => {
    const mw = requestId();
    const malicious = 'id\nwith\nnewlines';
    const req = { headers: { 'x-request-id': malicious } };
    const res = {
      headers: {},
      setHeader: (k, v) => {
        res.headers[k] = v;
      },
    };
    mw(req, res, () => {});
    assert.notEqual(req.id, malicious);
    assert.match(req.id, /^[0-9a-f-]+$/i, 'must be a fresh UUID');
  });

  test('rejects an incoming header longer than 128 chars (generates fresh UUID)', () => {
    const mw = requestId();
    const tooLong = 'a'.repeat(200);
    const req = { headers: { 'x-request-id': tooLong } };
    const res = {
      headers: {},
      setHeader: (k, v) => {
        res.headers[k] = v;
      },
    };
    mw(req, res, () => {});
    assert.notEqual(req.id, tooLong);
    assert.match(req.id, /^[0-9a-f-]+$/i);
  });
});

describe('Phase 9 — Helmet security headers', () => {
  test('app.js mounts helmet() before routes', () => {
    const src = readFileSync(join(ROOT, 'backend', 'src', 'app.js'), 'utf-8');
    // helmet must be imported and used.
    assert.ok(/import helmet from ['"]helmet['"]/.test(src));
    assert.ok(/app\.use\(helmet\(\)\)/.test(src));
    // helmet must appear BEFORE the first app.use(routes) line so it sets
    // headers on error responses too.
    const helmetIdx = src.indexOf('app.use(helmet())');
    const routesIdx = src.indexOf("app.use('/api/health'");
    assert.ok(helmetIdx > -1 && routesIdx > -1);
    assert.ok(helmetIdx < routesIdx, 'helmet must be mounted before routes');
  });

  test('app.js mounts requestId() before routes', () => {
    const src = readFileSync(join(ROOT, 'backend', 'src', 'app.js'), 'utf-8');
    assert.ok(/import \{ requestId \} from ['"].*requestId\.js['"]/.test(src));
    assert.ok(/app\.use\(requestId\(\)\)/.test(src));
    const requestIdIdx = src.indexOf('app.use(requestId())');
    const routesIdx = src.indexOf("app.use('/api/health'");
    assert.ok(requestIdIdx > -1 && routesIdx > -1);
    assert.ok(requestIdIdx < routesIdx, 'requestId must be mounted before routes');
  });

  test('CORS is configurable via env.CORS_ALLOWED_ORIGINS', () => {
    const src = readFileSync(join(ROOT, 'backend', 'src', 'app.js'), 'utf-8');
    assert.ok(/CORS_ALLOWED_ORIGINS/.test(src), 'app.js must read CORS_ALLOWED_ORIGINS');
    // Must have an allowlist branch (non-'*').
    assert.ok(/origin:\s*\(origin,\s*cb\)/.test(src), 'app.js must have an origin-allowlist branch');
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — env config
// ---------------------------------------------------------------------------
describe('Phase 9 — env config', () => {
  test('env.js exports CORS_ALLOWED_ORIGINS (default "*")', () => {
    assert.ok(typeof env.CORS_ALLOWED_ORIGINS === 'string');
  });

  test('.env.example documents CORS_ALLOWED_ORIGINS', () => {
    const envExample = readFileSync(join(ROOT, '.env.example'), 'utf-8');
    assert.ok(/CORS_ALLOWED_ORIGINS/.test(envExample));
  });

  test('LLM_TIMEOUT_MS is a positive integer', () => {
    assert.ok(Number.isInteger(env.LLM_TIMEOUT_MS));
    assert.ok(env.LLM_TIMEOUT_MS > 0);
  });
});
