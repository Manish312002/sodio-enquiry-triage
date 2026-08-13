/**
 * Test: geminiProvider — Phase 3 HTTP integration with mocked fetch.
 *
 * Mirrors grokProvider.test.js but for Gemini-specific shapes:
 *   - endpoint URL contains ?key=<API_KEY>
 *   - request body uses Gemini's `contents`/`systemInstruction` shape
 *   - response body uses `candidates[0].content.parts[0].text`
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_NAME,
  isConfigured,
  extract,
} from '../src/services/llm/geminiProvider.js';
import { env } from '../src/config/env.js';
import {
  mockFetch,
  geminiResponse,
  validExtraction,
} from './_helpers.js';

describe('geminiProvider — Phase 3', () => {
  let fetchMock;
  const saved = {
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
    GEMINI_API_URL: env.GEMINI_API_URL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(() => {
    env.GEMINI_API_KEY = 'test-gemini-key';
    env.GEMINI_MODEL = 'gemini-2.0-flash';
    env.GEMINI_API_URL = 'https://generativelanguage.test/v1beta';
    env.LLM_MAX_RETRIES = 1;
    env.LLM_TIMEOUT_MS = 5000;
  });

  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
    Object.assign(env, saved);
  });

  test('PROVIDER_NAME is "gemini"', () => {
    assert.equal(PROVIDER_NAME, 'gemini');
  });

  test('isConfigured() reflects env.GEMINI_API_KEY presence', () => {
    env.GEMINI_API_KEY = 'some-key';
    assert.equal(isConfigured(), true);
    env.GEMINI_API_KEY = '';
    assert.equal(isConfigured(), false);
  });

  test('NOT_CONFIGURED when API key is empty', async () => {
    env.GEMINI_API_KEY = '';
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'NOT_CONFIGURED' && err.recoverable === true,
    );
  });

  test('successful extraction returns parsed object + provider metadata', async () => {
    fetchMock = mockFetch(() => ({
      status: 200,
      body: geminiResponse(validExtraction({ company: 'Gemini Co' })),
    }));
    const result = await extract('test enquiry');
    assert.equal(result.provider, 'gemini');
    assert.equal(result.parsed.company, 'Gemini Co');
    assert.ok(typeof result.durationMs === 'number');
  });

  test('endpoint URL contains the API key as ?key=', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: geminiResponse(validExtraction()) }));
    await extract('test');
    const url = fetchMock.calls[0].url;
    assert.ok(url.includes(`key=${env.GEMINI_API_KEY}`));
    assert.ok(url.includes(`/models/${env.GEMINI_MODEL}:generateContent`));
  });

  test('request body uses Gemini contents + systemInstruction shape', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: geminiResponse(validExtraction()) }));
    await extract('test');
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.ok(body.systemInstruction);
    assert.ok(body.systemInstruction.parts[0].text);
    assert.ok(Array.isArray(body.contents));
    assert.equal(body.contents[0].role, 'user');
    assert.ok(body.contents[0].parts[0].text.includes('===ENQUIRY BEGIN==='));
  });

  test('uses responseMimeType: application/json + responseSchema', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: geminiResponse(validExtraction()) }));
    await extract('test');
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(body.generationConfig.responseSchema);
    assert.ok(body.generationConfig.responseSchema.properties);
  });

  test('HTTP 5xx → PROVIDER_SERVER_ERROR, recoverable=true', async () => {
    fetchMock = mockFetch(() => ({ status: 503, body: { error: 'down' } }));
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

  test('network error → PROVIDER_NETWORK_ERROR, recoverable=true', async () => {
    fetchMock = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_NETWORK_ERROR' && err.recoverable === true,
    );
  });

  test('malformed JSON response → INVALID_OUTPUT, recoverable=false', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: 'not json' }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('schema-invalid response → INVALID_OUTPUT, recoverable=false', async () => {
    fetchMock = mockFetch(() => ({
      status: 200,
      body: geminiResponse({ ...validExtraction(), serviceLine: 'design' }),
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('empty candidate content → INVALID_OUTPUT', async () => {
    fetchMock = mockFetch(() => ({
      status: 200,
      body: { candidates: [{ content: { parts: [{ text: '' }] } }] },
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT',
    );
  });

  test('retry on recoverable error then succeed', async () => {
    let calls = 0;
    fetchMock = mockFetch(() => {
      calls += 1;
      if (calls === 1) return { status: 500, body: { error: 'down' } };
      return { status: 200, body: geminiResponse(validExtraction()) };
    });
    const result = await extract('test');
    assert.equal(calls, 2);
    assert.equal(result.parsed.company, 'Test Co');
  });

  test('no retry on INVALID_OUTPUT', async () => {
    let calls = 0;
    fetchMock = mockFetch(() => {
      calls += 1;
      return {
        status: 200,
        body: geminiResponse({ ...validExtraction(), serviceLine: 'design' }),
      };
    });
    await assert.rejects(extract('test'), (err) => err.code === 'INVALID_OUTPUT');
    assert.equal(calls, 1);
  });

  test('Unicode content preserved in request body', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: geminiResponse(validExtraction()) }));
    const enquiry = 'Buenos días — 25.000 € — ¿Pueden? 🙏';
    await extract(enquiry);
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.ok(body.contents[0].parts[0].text.includes(enquiry));
  });
});
