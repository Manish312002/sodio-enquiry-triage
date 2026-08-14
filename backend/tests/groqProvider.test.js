/**
 * Test: groqProvider — Phase 3 SDK integration with mocked OpenAI client.
 *
 * Covers:
 *   - successful extraction (valid output_text, schema-valid)
 *   - not configured (empty API key → NOT_CONFIGURED, recoverable)
 *   - HTTP 5xx → PROVIDER_SERVER_ERROR, recoverable
 *   - HTTP 429 → PROVIDER_RATE_LIMIT, recoverable
 *   - HTTP 401 → PROVIDER_AUTH_ERROR, recoverable
 *   - network error → PROVIDER_NETWORK_ERROR, recoverable
 *   - malformed JSON in response → INVALID_OUTPUT, NOT recoverable
 *   - schema-invalid response → INVALID_OUTPUT, NOT recoverable
 *   - retries on recoverable errors (LLM_MAX_RETRIES=1 → 2 attempts)
 *   - no retry on INVALID_OUTPUT
 *   - API key is passed via the OpenAI client constructor, never logged
 *
 * NOTE: env is intentionally NOT frozen (see env.js Phase 3 note) so tests
 * can mutate env.GROQ_API_KEY per-test.
 *
 * NOTE: We mock at the SDK method level (`OpenAI.Responses.prototype.create`)
 * rather than at the `fetch` level. This makes tests independent of the
 * SDK's internal HTTP implementation and lets us test our provider
 * adapter's SDK-usage patterns directly.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {
  PROVIDER_NAME,
  isConfigured,
  extract,
} from '../src/services/llm/groqProvider.js';
import { env } from '../src/config/env.js';
import {
  mockOpenAIResponses,
  groqResponse,
  validExtraction,
} from './_helpers.js';

describe('groqProvider — Phase 3 (OpenAI SDK + Groq baseURL)', () => {
  let mock;
  const saved = {
    GROQ_API_KEY: env.GROQ_API_KEY,
    GROQ_MODEL: env.GROQ_MODEL,
    GROQ_BASE_URL: env.GROQ_BASE_URL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(() => {
    env.GROQ_API_KEY = 'test-groq-key';
    env.GROQ_MODEL = 'openai/gpt-oss-20b';
    env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
    env.LLM_MAX_RETRIES = 1;
    env.LLM_TIMEOUT_MS = 5000;
  });

  afterEach(() => {
    if (mock) mock.restore();
    mock = null;
    Object.assign(env, saved);
  });

  test('PROVIDER_NAME is "groq"', () => {
    assert.equal(PROVIDER_NAME, 'groq');
  });

  test('isConfigured() reflects env.GROQ_API_KEY presence', () => {
    env.GROQ_API_KEY = 'some-key';
    assert.equal(isConfigured(), true);
    env.GROQ_API_KEY = '';
    assert.equal(isConfigured(), false);
    env.GROQ_API_KEY = '   ';
    assert.equal(isConfigured(), false);
  });

  test('NOT_CONFIGURED when API key is empty', async () => {
    env.GROQ_API_KEY = '';
    await assert.rejects(
      extract('test'),
      (err) =>
        err.code === 'NOT_CONFIGURED' &&
        err.recoverable === true &&
        err.provider === 'groq',
    );
  });

  test('successful extraction returns parsed object + provider metadata', async () => {
    mock = mockOpenAIResponses(() => groqResponse(validExtraction({ company: 'Acme Ltd' })));
    const result = await extract('We want a website, budget £40k.');
    assert.equal(result.provider, 'groq');
    assert.equal(result.model, env.GROQ_MODEL);
    assert.equal(result.parsed.company, 'Acme Ltd');
    assert.equal(result.parsed.serviceLine, 'web');
    assert.ok(typeof result.durationMs === 'number');
    assert.equal(mock.calls.length, 1);
  });

  test('sends trusted instructions + untrusted user input as separate fields', async () => {
    mock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    await extract('test');
    const params = mock.calls[0].params;
    assert.equal(params.model, env.GROQ_MODEL);
    assert.ok(typeof params.instructions === 'string');
    assert.ok(params.instructions.length > 0);
    assert.ok(typeof params.input === 'string');
    assert.ok(params.input.includes('===ENQUIRY BEGIN==='));
    // Critical: the untrusted enquiry text must NOT be in `instructions`.
    assert.ok(!params.instructions.includes('===ENQUIRY'));
    assert.ok(!params.instructions.includes('test'));
  });

  test('uses text.format: json_schema with the canonical extraction schema (structured output)', async () => {
    mock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    await extract('test');
    const params = mock.calls[0].params;
    // CRITICAL: the request must hand the model the canonical extraction
    // schema (not just generic json_object mode). This is the fix for the
    // canonical-contract regression where gpt-oss-120b was emitting
    // snake_case + budget:null + timeline:null.
    assert.ok(params.text, 'params.text must be present');
    assert.ok(params.text.format, 'params.text.format must be present');
    assert.equal(params.text.format.type, 'json_schema');
    assert.equal(params.text.format.name, 'extraction');
    assert.ok(params.text.format.schema, 'params.text.format.schema must be present');
    // strict:false is intentional — see extractionJsonSchema.js header.
    // (timeline.normalized is intentionally open-shaped per Rules.md §7.)
    assert.equal(params.text.format.strict, false);
    // Verify the canonical field names appear in the schema handed to the model
    const schema = params.text.format.schema;
    const expectedFields = [
      'company', 'contactName', 'contactEmail', 'serviceLine',
      'budget', 'timeline', 'summary', 'isGenuineProjectEnquiry',
      'confidence', 'projectCount', 'additionalProjectNote',
      'isModelInstructionAttempt',
    ];
    for (const f of expectedFields) {
      assert.ok(
        schema.properties && schema.properties[f],
        `canonical field "${f}" must be in the JSON Schema handed to the model`,
      );
    }
    // Verify enum constraints are present
    assert.ok(schema.properties.serviceLine.enum, 'serviceLine must be an enum');
    assert.ok(
      schema.properties.budget.properties.qualifier.enum,
      'budget.qualifier must be an enum',
    );
    // Verify priority is NOT in the schema
    assert.equal(
      schema.properties.priority,
      undefined,
      'priority must NOT be in the JSON Schema handed to the model',
    );
    // Verify the schema is closed at the top level
    assert.equal(schema.additionalProperties, false);
  });

  test('HTTP 5xx → PROVIDER_SERVER_ERROR, recoverable=true', async () => {
    mock = mockOpenAIResponses(() => {
      const err = new OpenAI.InternalServerError({
        message: 'Groq server down',
        status: 503,
      });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_SERVER_ERROR' && err.recoverable === true,
    );
  });

  test('HTTP 429 → PROVIDER_RATE_LIMIT, recoverable=true', async () => {
    mock = mockOpenAIResponses(() => {
      const err = new OpenAI.RateLimitError({
        message: 'rate limited',
        status: 429,
      });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_RATE_LIMIT' && err.recoverable === true,
    );
  });

  test('HTTP 401 → PROVIDER_AUTH_ERROR, recoverable=true', async () => {
    mock = mockOpenAIResponses(() => {
      const err = new OpenAI.AuthenticationError({
        message: 'bad key',
        status: 401,
      });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_AUTH_ERROR' && err.recoverable === true,
    );
  });

  test('network error → PROVIDER_NETWORK_ERROR, recoverable=true', async () => {
    mock = mockOpenAIResponses(() => {
      const err = new OpenAI.APIConnectionError({ message: 'fetch failed: ECONNREFUSED' });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_NETWORK_ERROR' && err.recoverable === true,
    );
  });

  test('timeout → PROVIDER_TIMEOUT, recoverable=true', async () => {
    mock = mockOpenAIResponses(() => {
      const err = new OpenAI.APIConnectionTimeoutError({ message: 'request timed out' });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_TIMEOUT' && err.recoverable === true,
    );
  });

  test('malformed JSON in output_text → INVALID_OUTPUT, recoverable=false', async () => {
    mock = mockOpenAIResponses(() => ({
      id: 'resp_test',
      output_text: 'this is not json {',
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('schema-invalid response → INVALID_OUTPUT, recoverable=false', async () => {
    mock = mockOpenAIResponses(() =>
      groqResponse({ ...validExtraction(), serviceLine: 'design' }),
    );
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('empty output_text → INVALID_OUTPUT', async () => {
    mock = mockOpenAIResponses(() => ({
      id: 'resp_test',
      output_text: '',
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT',
    );
  });

  test('retry on recoverable error then succeed (LLM_MAX_RETRIES=1)', async () => {
    let calls = 0;
    mock = mockOpenAIResponses(() => {
      calls += 1;
      if (calls === 1) {
        return new OpenAI.InternalServerError({
          message: 'down',
          status: 503,
        });
      }
      return groqResponse(validExtraction());
    });
    const result = await extract('test');
    assert.equal(calls, 2);
    assert.equal(result.parsed.company, 'Test Co');
  });

  test('no retry on INVALID_OUTPUT (model quality issue)', async () => {
    let calls = 0;
    mock = mockOpenAIResponses(() => {
      calls += 1;
      return groqResponse({ ...validExtraction(), serviceLine: 'design' });
    });
    await assert.rejects(extract('test'), (err) => err.code === 'INVALID_OUTPUT');
    assert.equal(calls, 1, 'must NOT retry on INVALID_OUTPUT');
  });

  test('rawOutput on failure contains the response body, not request headers', async () => {
    mock = mockOpenAIResponses(() => ({
      id: 'resp_test',
      output_text: 'malformed json',
    }));
    await assert.rejects(
      extract('test'),
      (err) => {
        // On malformed JSON, rawOutput is the raw output_text string.
        assert.equal(err.rawOutput, 'malformed json');
        const serialized = JSON.stringify(err.rawOutput);
        assert.ok(!serialized.includes('Bearer'));
        assert.ok(!serialized.includes(env.GROQ_API_KEY));
        return true;
      },
    );
  });

  test('SDK errors do NOT leak the API key in rawOutput or cause', async () => {
    mock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'down', status: 503 }),
    );
    await assert.rejects(
      extract('test'),
      (err) => {
        assert.equal(err.rawOutput, null);
        assert.ok(!err.cause?.includes(env.GROQ_API_KEY));
        return true;
      },
    );
  });

  test('Unicode content (Spanish, currency, emoji) is preserved in the request input', async () => {
    mock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    const enquiry = 'Buenos días — 25.000 € — ¿Pueden? 🙏';
    await extract(enquiry);
    const params = mock.calls[0].params;
    assert.ok(params.input.includes(enquiry));
  });
});
