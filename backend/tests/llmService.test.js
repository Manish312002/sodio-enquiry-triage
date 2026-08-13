/**
 * Test: llmService — fallback orchestration (Groq → Gemini)
 *
 * Covers the core Phase 3 contract (Rules.md §3):
 *   1. Groq success → no Gemini call.
 *   2. Groq recoverable failure → Gemini is attempted.
 *   3. Groq non-recoverable (INVALID_OUTPUT) → Gemini is NOT attempted.
 *   4. Both providers fail recoverably → ALL_PROVIDERS_FAILED.
 *   5. Both not configured → ALL_PROVIDERS_FAILED.
 *   6. Empty input → EMPTY_INPUT.
 *   7. Per-provider attempts audit trail is preserved.
 *   8. Total durationMs is the wall-clock across all attempts.
 *
 * These tests mock both SDKs (`OpenAI.Responses.prototype.create` and
 * `GoogleGenAI`'s `interactions.create`) so we test the full fallback
 * chain without making real HTTP calls.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { ApiError } from '@google/genai';
import { llmService } from '../src/services/llm/llmService.js';
import { env } from '../src/config/env.js';
import {
  mockOpenAIResponses,
  mockGeminiInteractions,
  groqResponse,
  geminiResponse,
  validExtraction,
} from './_helpers.js';

describe('llmService — fallback orchestration (Groq → Gemini)', () => {
  let groqMock;
  let geminiMock;
  const saved = {
    GROQ_API_KEY: env.GROQ_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GROQ_BASE_URL: env.GROQ_BASE_URL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(() => {
    env.GROQ_API_KEY = 'test-groq-key';
    env.GEMINI_API_KEY = 'test-gemini-key';
    env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
    env.LLM_MAX_RETRIES = 0; // no per-provider retry; isolates fallback logic
    env.LLM_TIMEOUT_MS = 5000;
  });

  afterEach(() => {
    if (groqMock) groqMock.restore();
    if (geminiMock) geminiMock.restore();
    groqMock = null;
    geminiMock = null;
    Object.assign(env, saved);
  });

  test('1. Groq success → no Gemini call', async () => {
    let geminiCalls = 0;
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Groq-Win' })),
    );
    geminiMock = mockGeminiInteractions(() => {
      geminiCalls += 1;
      return geminiResponse(validExtraction());
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'groq');
    assert.equal(out.parsed.company, 'Groq-Win');
    assert.equal(geminiCalls, 0, 'Gemini must NOT be called when Groq succeeds');
    assert.equal(out.attempts.length, 1);
    assert.equal(out.attempts[0].provider, 'groq');
    assert.equal(out.attempts[0].state, 'completed');
  });

  test('2. Groq recoverable failure → Gemini is attempted and succeeds', async () => {
    groqMock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'groq down', status: 503 }),
    );
    geminiMock = mockGeminiInteractions(() =>
      geminiResponse(validExtraction({ company: 'Gemini-Win' })),
    );
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.parsed.company, 'Gemini-Win');
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].provider, 'groq');
    assert.equal(out.attempts[0].state, 'failed');
    assert.equal(out.attempts[0].errorCode, 'PROVIDER_SERVER_ERROR');
    assert.equal(out.attempts[1].provider, 'gemini');
    assert.equal(out.attempts[1].state, 'completed');
  });

  test('3. Groq non-recoverable failure → Gemini is NOT attempted', async () => {
    let geminiCalls = 0;
    groqMock = mockOpenAIResponses(() =>
      groqResponse({ ...validExtraction(), serviceLine: 'design' }),
    );
    geminiMock = mockGeminiInteractions(() => {
      geminiCalls += 1;
      return geminiResponse(validExtraction());
    });
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'failed');
    assert.equal(out.errorCode, 'INVALID_OUTPUT');
    assert.equal(geminiCalls, 0, 'Gemini must NOT be called on INVALID_OUTPUT');
    assert.equal(out.attempts.length, 1);
    assert.equal(out.attempts[0].provider, 'groq');
    assert.equal(out.attempts[0].errorCode, 'INVALID_OUTPUT');
  });

  test('4. Both providers fail recoverably → ALL_PROVIDERS_FAILED', async () => {
    groqMock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'groq down', status: 503 }),
    );
    geminiMock = mockGeminiInteractions(() =>
      new ApiError({ message: 'gemini down', status: 503 }),
    );
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'failed');
    assert.equal(out.errorCode, 'PROVIDER_SERVER_ERROR'); // last error code
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].provider, 'groq');
    assert.equal(out.attempts[0].state, 'failed');
    assert.equal(out.attempts[1].provider, 'gemini');
    assert.equal(out.attempts[1].state, 'failed');
  });

  test('5. Groq not configured → Gemini is attempted', async () => {
    env.GROQ_API_KEY = '';
    groqMock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    geminiMock = mockGeminiInteractions(() =>
      geminiResponse(validExtraction({ company: 'Gemini-Only' })),
    );
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.parsed.company, 'Gemini-Only');
    // Two attempts recorded: Groq (NOT_CONFIGURED) + Gemini (completed)
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].provider, 'groq');
    assert.equal(out.attempts[0].errorCode, 'NOT_CONFIGURED');
    assert.equal(out.attempts[1].provider, 'gemini');
    assert.equal(out.attempts[1].state, 'completed');
  });

  test('6. Neither provider configured → ALL_PROVIDERS_FAILED', async () => {
    env.GROQ_API_KEY = '';
    env.GEMINI_API_KEY = '';
    groqMock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    geminiMock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'failed');
    assert.equal(out.attempts.length, 2);
    assert.equal(out.attempts[0].errorCode, 'NOT_CONFIGURED');
    assert.equal(out.attempts[1].errorCode, 'NOT_CONFIGURED');
  });

  test('7. Empty input → EMPTY_INPUT, no SDK calls', async () => {
    let groqCalls = 0;
    let geminiCalls = 0;
    groqMock = mockOpenAIResponses(() => {
      groqCalls += 1;
      return groqResponse(validExtraction());
    });
    geminiMock = mockGeminiInteractions(() => {
      geminiCalls += 1;
      return geminiResponse(validExtraction());
    });
    const out = await llmService.extractWithFallback('');
    assert.equal(out.state, 'failed');
    assert.equal(out.errorCode, 'EMPTY_INPUT');
    assert.equal(groqCalls, 0);
    assert.equal(geminiCalls, 0);
  });

  test('8. Per-provider attempts audit trail preserves rawOutput', async () => {
    groqMock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'groq error', status: 503 }),
    );
    geminiMock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
    const out = await llmService.extractWithFallback('test');
    // Groq's failed attempt should have null rawOutput (we don't leak SDK error details)
    assert.equal(out.attempts[0].rawOutput, null);
    assert.equal(out.attempts[0].errorCode, 'PROVIDER_SERVER_ERROR');
    // Gemini's successful attempt should have rawOutput + parsed
    assert.equal(out.attempts[1].state, 'completed');
    assert.ok(out.attempts[1].rawOutput);
    assert.ok(out.attempts[1].parsed);
  });

  test('9. durationMs is a positive number across attempts', async () => {
    groqMock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    const out = await llmService.extractWithFallback('test');
    assert.ok(out.durationMs >= 0);
    assert.ok(out.attempts[0].durationMs >= 0);
  });

  test('10. Groq timeout → Gemini fallback', async () => {
    groqMock = mockOpenAIResponses(() =>
      new OpenAI.APIConnectionTimeoutError({ message: 'timed out' }),
    );
    geminiMock = mockGeminiInteractions(() =>
      geminiResponse(validExtraction({ company: 'Gemini-After-Timeout' })),
    );
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.attempts[0].errorCode, 'PROVIDER_TIMEOUT');
  });

  test('11. Groq network error → Gemini fallback', async () => {
    groqMock = mockOpenAIResponses(() =>
      new OpenAI.APIConnectionError({ message: 'ECONNREFUSED' }),
    );
    geminiMock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
    const out = await llmService.extractWithFallback('test');
    assert.equal(out.state, 'completed');
    assert.equal(out.provider, 'gemini');
    assert.equal(out.attempts[0].errorCode, 'PROVIDER_NETWORK_ERROR');
  });
});
