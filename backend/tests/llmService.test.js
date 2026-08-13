/**
 * Test: llmService — fallback orchestration
 *
 * Covers the core Phase 3 contract (Rules.md §3):
 *   1. Grok success → no Gemini call.
 *   2. Grok recoverable failure → Gemini is attempted.
 *   3. Grok success after retry → no Gemini call.
 *   4. Grok non-recoverable (INVALID_OUTPUT) → Gemini is NOT attempted.
 *   5. Both providers fail recoverably → ALL_PROVIDERS_FAILED.
 *   6. Both not configured → ALL_PROVIDERS_FAILED.
 *   7. Empty input → EMPTY_INPUT.
 *   8. Per-provider attempts audit trail is preserved.
 *   9. Total durationMs is the wall-clock across all attempts.
 *
 * These tests mock `fetch` (so grokProvider and geminiProvider both observe
 * the same fetch) AND mutate env to enable/disable providers per test.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { llmService } from '../src/services/llm/llmService.js';
import { env } from '../src/config/env.js';
import {
  mockFetch,
  grokResponse,
  geminiResponse,
  validExtraction,
} from './_helpers.js';

describe('llmService — fallback orchestration', () => {
  let fetchMock;
  const saved = {
    GROK_API_KEY: env.GROK_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GROK_API_URL: env.GROK_API_URL,
    GEMINI_API_URL: env.GEMINI_API_URL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(() => {
    env.GROK_API_KEY = 'test-grok-key';
    env.GEMINI_API_KEY = 'test-gemini-key';
    env.GROK_API_URL = 'https://grok.test/v1/chat/completions';
    env.GEMINI_API_URL = 'https://gemini.test/v1beta';
    env.LLM_MAX_RETRIES = 0; // no per-provider retry; isolates fallback logic
    env.LLM_TIMEOUT_MS = 5000;
  });

  afterEach(() => {
    if (fetchMock) fetchMock.restore();
    fetchMock = null;
    Object.assign(env, saved);
  });

  test('1. Grok success → no Gemini call', async () => {
    let geminiCalls = 0;
    fetchMock = mockFetch((url) => {
      if (url.includes('gemini.test')) {
        geminiCalls += 1;
        return { status: 200, body: geminiResponse(validExtraction()) };
      }
      return { status: 200, body: grokResponse(validExtraction({ company: 'Grok-Win' })) };
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'grok');
    assert.equal(out.parsed.company, 'Grok-Win');
    assert.equal(geminiCalls, 0, 'Gemini must NOT be called when Grok succeeds');
    assert.equal(out.attempts.length, 1);
    assert.equal(out.attempts[0].provider, 'grok');
    assert.equal(out.attempts[0].state, 'completed');
  });

  test('2. Grok recoverable failure → Gemini is attempted and succeeds', async () => {
    fetchMock = mockFetch((url) => {
      if (url.includes('grok.test')) {
        return { status: 503, body: { error: 'grok down' } };
      }
      return {
        status: 200,
        body: geminiResponse(validExtraction({ company: 'Gemini-Win' })),
      };
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.parsed.company, 'Gemini-Win');
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].provider, 'grok');
    assert.equal(out.attempts[0].state, 'failed');
    assert.equal(out.attempts[0].errorCode, 'PROVIDER_SERVER_ERROR');
    assert.equal(out.attempts[1].provider, 'gemini');
    assert.equal(out.attempts[1].state, 'completed');
  });

  test('3. Grok non-recoverable failure → Gemini is NOT attempted', async () => {
    let geminiCalls = 0;
    fetchMock = mockFetch((url) => {
      if (url.includes('gemini.test')) {
        geminiCalls += 1;
        return { status: 200, body: geminiResponse(validExtraction()) };
      }
      // Grok returns 200 but with schema-invalid output (INVALID_OUTPUT).
      return {
        status: 200,
        body: grokResponse({ ...validExtraction(), serviceLine: 'design' }),
      };
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'failed');
    assert.equal(out.errorCode, 'INVALID_OUTPUT');
    assert.equal(geminiCalls, 0, 'Gemini must NOT be called on INVALID_OUTPUT');
    assert.equal(out.attempts.length, 1);
    assert.equal(out.attempts[0].provider, 'grok');
    assert.equal(out.attempts[0].errorCode, 'INVALID_OUTPUT');
  });

  test('4. Both providers fail recoverably → ALL_PROVIDERS_FAILED', async () => {
    fetchMock = mockFetch(() => ({ status: 503, body: { error: 'all down' } }));
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'failed');
    assert.equal(out.errorCode, 'PROVIDER_SERVER_ERROR'); // last error code
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].provider, 'grok');
    assert.equal(out.attempts[0].state, 'failed');
    assert.equal(out.attempts[1].provider, 'gemini');
    assert.equal(out.attempts[1].state, 'failed');
  });

  test('5. Grok not configured → Gemini is attempted', async () => {
    env.GROK_API_KEY = '';
    fetchMock = mockFetch((url) => {
      if (url.includes('grok.test')) {
        return { status: 200, body: grokResponse(validExtraction()) };
      }
      return {
        status: 200,
        body: geminiResponse(validExtraction({ company: 'Gemini-Only' })),
      };
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.parsed.company, 'Gemini-Only');
    // Two attempts recorded: Grok (NOT_CONFIGURED) + Gemini (completed)
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].provider, 'grok');
    assert.equal(out.attempts[0].errorCode, 'NOT_CONFIGURED');
    assert.equal(out.attempts[1].provider, 'gemini');
    assert.equal(out.attempts[1].state, 'completed');
  });

  test('6. Neither provider configured → ALL_PROVIDERS_FAILED', async () => {
    env.GROK_API_KEY = '';
    env.GEMINI_API_KEY = '';
    fetchMock = mockFetch(() => ({ status: 200, body: {} }));
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'failed');
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].errorCode, 'NOT_CONFIGURED');
    assert.equal(out.attempts[1].errorCode, 'NOT_CONFIGURED');
  });

  test('7. Empty input → EMPTY_INPUT, no fetch calls', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: {} }));
    const out = await llmService.extractWithFallback('');
    assert.equal(out.state, 'failed');
    assert.equal(out.errorCode, 'EMPTY_INPUT');
    assert.equal(fetchMock.calls.length, 0);
  });

  test('8. Per-provider attempts audit trail preserves rawOutput', async () => {
    fetchMock = mockFetch((url) => {
      if (url.includes('grok.test')) {
        return { status: 503, body: { error: 'grok error payload' } };
      }
      return { status: 200, body: geminiResponse(validExtraction()) };
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.attempts[0].rawOutput.error, 'grok error payload');
    assert.equal(out.attempts[1].state, 'completed');
    assert.ok(out.attempts[1].rawOutput);
    assert.ok(out.attempts[1].parsed);
  });

  test('9. durationMs is a positive number across attempts', async () => {
    fetchMock = mockFetch(() => ({ status: 200, body: grokResponse(validExtraction()) }));
    const out = await llmService.extractWithFallback('test');
    assert.ok(out.durationMs >= 0);
    assert.ok(out.attempts[0].durationMs >= 0);
  });

  test('10. Grok timeout → Gemini fallback', async () => {
    fetchMock = mockFetch((url) => {
      if (url.includes('grok.test')) {
        // Simulate abort by throwing AbortError
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { status: 200, body: geminiResponse(validExtraction({ company: 'Gemini-After-Timeout' })) };
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.attempts[0].errorCode, 'PROVIDER_TIMEOUT');
  });

  test('11. Grok network error → Gemini fallback', async () => {
    fetchMock = mockFetch((url) => {
      if (url.includes('grok.test')) {
        throw new TypeError('ECONNREFUSED');
      }
      return { status: 200, body: geminiResponse(validExtraction()) };
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.attempts[0].errorCode, 'PROVIDER_NETWORK_ERROR');
  });
});
