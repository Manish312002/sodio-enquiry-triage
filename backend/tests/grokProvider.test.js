/**
 * Test: grokProvider — Phase 3 HTTP integration with mocked fetch.
 *
 * Covers:
 *   - successful extraction (2xx, valid JSON, schema-valid)
 *   - not configured (empty API key → NOT_CONFIGURED, recoverable)
 *   - HTTP 5xx → PROVIDER_SERVER_ERROR, recoverable
 *   - HTTP 429 → PROVIDER_RATE_LIMIT, recoverable
 *   - HTTP 401 → PROVIDER_AUTH_ERROR, recoverable
 *   - network error (TypeError) → PROVIDER_NETWORK_ERROR, recoverable
 *   - malformed JSON in response → INVALID_OUTPUT, NOT recoverable
 *   - schema-invalid response → INVALID_OUTPUT, NOT recoverable
 *   - retries on recoverable errors (LLM_MAX_RETRIES=1 → 2 attempts)
 *   - no retry on INVALID_OUTPUT
 *   - API key is sent via Authorization header, never logged
 *
 * NOTE: env is intentionally NOT frozen (see env.js Phase 3 note) so tests
 * can mutate env.GROK_API_KEY per-test.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_NAME,
  isConfigured,
  extract,
} from '../src/services/llm/grokProvider.js';
import { env } from '../src/config/env.js';
import {
  mockFetch,
  grokResponse,
  validExtraction,
} from './_helpers.js';

describe('grokProvider — Phase 3', () => {
  let fetchMock;
  const saved = {
    GROK_API_KEY: env.GROK_API_KEY,
    GROK_MODEL: env.GROK_MODEL,
    GROK_API_URL: env.GROK_API_URL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(() => {
    env.GROK_API_KEY = 'test-grok-key';
    env.GROK_MODEL = 'grok-2-latest';
    env.GROK_API_URL = 'https://api.x.ai.test/v1/chat/completions';
    env.LLM_MAX_RETRIES = 1;
    env.LLM_TIMEOUT_MS = 5000;
  });

  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
    Object.assign(env, saved);
  });

  test('PROVIDER_NAME is "grok"', () => {
    assert.equal(PROVIDER_NAME, 'grok');
  });

  test('isConfigured() reflects env.GROK_API_KEY presence', () => {
    env.GROK_API_KEY = 'some-key';
    assert.equal(isConfigured(), true);
    env.GROK_API_KEY = '';
    assert.equal(isConfigured(), false);
    env.GROK_API_KEY = '   ';
    assert.equal(isConfigured(), false);
  });

  test('NOT_CONFIGURED when API key is empty', async () => {
    env.GROK_API_KEY = '';
    await assert.rejects(
      extract('test'),
      (err) =>
        err.code === 'NOT_CONFIGURED' &&
        err.recoverable === true &&
        err.provider === 'grok',
    );
  });

  test('successful extraction returns parsed object + provider metadata', async () => {
    fetchMock = mockFetch(() => ({
      status: 200,
      body: grokResponse(validExtraction({ company: 'Acme Ltd' })),
    }));
    const result = await extract('We want a website, budget £40k.');
    assert.equal(result.provider, 'grok');
    assert.equal(result.model, env.GROK_MODEL);
    assert.equal(result.parsed.company, 'Acme Ltd');
    assert.equal(result.parsed.serviceLine, 'web');
    assert.ok(typeof result.durationMs === 'number');
    assert.equal(fetchMock.calls.length, 1);
  });

  test('sends Authorization: Bearer <key> header', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: grokResponse(validExtraction()) }));
    await extract('test');
    const init = fetchMock.calls[0].init;
    assert.equal(init.headers.Authorization, `Bearer ${env.GROK_API_KEY}`);
  });

  test('sends system prompt + user message as separate roles', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: grokResponse(validExtraction()) }));
    await extract('test');
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].role, 'user');
    assert.ok(body.messages[0].content.length > 0);
    assert.ok(body.messages[1].content.includes('===ENQUIRY BEGIN==='));
  });

  test('uses response_format: json_object', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: grokResponse(validExtraction()) }));
    await extract('test');
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.deepEqual(body.response_format, { type: 'json_object' });
  });

  test('HTTP 5xx → PROVIDER_SERVER_ERROR, recoverable=true', async () => {
    fetchMock = mockFetch(() => ({ status: 503, body: { error: 'unavailable' } }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_SERVER_ERROR' && err.recoverable === true,
    );
  });

  test('HTTP 429 → PROVIDER_RATE_LIMIT, recoverable=true', async () => {
    fetchMock = mockFetch(() => ({ status: 429, body: { error: 'rate limit' } }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_RATE_LIMIT' && err.recoverable === true,
    );
  });

  test('HTTP 401 → PROVIDER_AUTH_ERROR, recoverable=true', async () => {
    fetchMock = mockFetch(() => ({ status: 401, body: { error: 'bad key' } }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_AUTH_ERROR' && err.recoverable === true,
    );
  });

  test('network error (TypeError) → PROVIDER_NETWORK_ERROR, recoverable=true', async () => {
    fetchMock = mockFetch(() => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_NETWORK_ERROR' && err.recoverable === true,
    );
  });

  test('malformed JSON response → INVALID_OUTPUT, recoverable=false', async () => {
    fetchMock = mockFetch(() => ({
      status: 200,
      body: 'this is not json {',
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('schema-invalid response → INVALID_OUTPUT, recoverable=false', async () => {
    fetchMock = mockFetch(() => ({
      status: 200,
      body: grokResponse({
        ...validExtraction(),
        serviceLine: 'design', // out of enum
      }),
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('empty content in response → INVALID_OUTPUT', async () => {
    fetchMock = mockFetch(() => ({
      status: 200,
      body: { choices: [{ message: { content: '' } }] },
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT',
    );
  });

  test('retry on recoverable error then succeed (LLM_MAX_RETRIES=1)', async () => {
    let calls = 0;
    fetchMock = mockFetch(() => {
      calls += 1;
      if (calls === 1) return { status: 503, body: { error: 'down' } };
      return { status: 200, body: grokResponse(validExtraction()) };
    });
    const result = await extract('test');
    assert.equal(calls, 2);
    assert.equal(result.parsed.company, 'Test Co');
  });

  test('no retry on INVALID_OUTPUT (model quality issue)', async () => {
    let calls = 0;
    fetchMock = mockFetch(() => {
      calls += 1;
      return {
        status: 200,
        body: grokResponse({ ...validExtraction(), serviceLine: 'design' }),
      };
    });
    await assert.rejects(extract('test'), (err) => err.code === 'INVALID_OUTPUT');
    assert.equal(calls, 1, 'must NOT retry on INVALID_OUTPUT');
  });

  test('rawOutput on failure contains the response body, not request headers', async () => {
    fetchMock = mockFetch(() => ({
      status: 503,
      body: { error: 'service unavailable' },
    }));
    await assert.rejects(
      extract('test'),
      (err) => {
        assert.ok(err.rawOutput);
        assert.deepEqual(err.rawOutput, { error: 'service unavailable' });
        const serialized = JSON.stringify(err.rawOutput);
        assert.ok(!serialized.includes('Bearer'));
        assert.ok(!serialized.includes(env.GROK_API_KEY));
        return true;
      },
    );
  });

  test('Unicode content (Spanish, currency, emoji) is preserved in the request body', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: grokResponse(validExtraction()) }));
    const enquiry = 'Buenos días — 25.000 € — ¿Pueden? 🙏';
    await extract(enquiry);
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.ok(body.messages[1].content.includes(enquiry));
  });
});
