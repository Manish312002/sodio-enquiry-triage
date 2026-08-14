/**
 * Test: geminiProvider — Phase 3 SDK integration with mocked @google/genai.
 *
 * Mirrors groqProvider.test.js but for Gemini SDK-specific shapes:
 *   - request params use `model`, `input`, `system_instruction`,
 *     `response_format`, `generation_config`
 *   - response object uses `output_text`
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@google/genai';
import {
  PROVIDER_NAME,
  isConfigured,
  extract,
} from '../src/services/llm/geminiProvider.js';
import { env } from '../src/config/env.js';
import {
  mockGeminiInteractions,
  geminiResponse,
  validExtraction,
} from './_helpers.js';

describe('geminiProvider — Phase 3 (@google/genai SDK)', () => {
  let mock;
  const saved = {
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(() => {
    env.GEMINI_API_KEY = 'test-gemini-key';
    env.GEMINI_MODEL = 'gemini-3.6-flash';
    env.LLM_MAX_RETRIES = 1;
    env.LLM_TIMEOUT_MS = 5000;
  });

  afterEach(() => {
    if (mock) mock.restore();
    mock = null;
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
    mock = mockGeminiInteractions(() =>
      geminiResponse(validExtraction({ company: 'Gemini Co' })),
    );
    const result = await extract('test enquiry');
    assert.equal(result.provider, 'gemini');
    assert.equal(result.parsed.company, 'Gemini Co');
    assert.ok(typeof result.durationMs === 'number');
  });

  test('request uses ai.interactions.create() with model + input + system_instruction', async () => {
    mock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
    await extract('test');
    const params = mock.calls[0].params;
    assert.equal(params.model, env.GEMINI_MODEL);
    assert.ok(typeof params.input === 'string');
    assert.ok(typeof params.system_instruction === 'string');
    assert.ok(params.input.includes('===ENQUIRY BEGIN==='));
    // Critical: the untrusted enquiry text must NOT be in system_instruction.
    assert.ok(!params.system_instruction.includes('===ENQUIRY'));
    assert.ok(!params.system_instruction.includes('test'));
  });

  test('response_format is the canonical extraction JSON Schema (same contract as Groq)', async () => {
    mock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
    await extract('test');
    const params = mock.calls[0].params;
    assert.ok(params.response_format);
    assert.equal(params.response_format.type, 'object');
    assert.equal(params.response_format.additionalProperties, false);
    assert.ok(params.response_format.properties);
    // Verify enum constraints are set
    assert.ok(params.response_format.properties.serviceLine.enum);
    assert.ok(params.response_format.properties.budget.properties.qualifier.enum);
    // Verify ALL canonical field names appear in the schema handed to the model
    const expectedFields = [
      'company', 'contactName', 'contactEmail', 'serviceLine',
      'budget', 'timeline', 'summary', 'isGenuineProjectEnquiry',
      'confidence', 'projectCount', 'additionalProjectNote',
      'isModelInstructionAttempt',
    ];
    for (const f of expectedFields) {
      assert.ok(
        params.response_format.properties[f],
        `canonical field "${f}" must be in the response_format handed to Gemini`,
      );
    }
    // Verify priority is NOT in the schema
    assert.equal(
      params.response_format.properties.priority,
      undefined,
      'priority must NOT be in the response_format handed to Gemini',
    );
    // Verify the canonical unknown-budget object shape is documented
    assert.ok(params.response_format.properties.budget.properties.raw);
    assert.ok(params.response_format.properties.budget.properties.qualifier);
    // Verify the canonical unknown-timeline object shape is documented
    assert.ok(params.response_format.properties.timeline.properties.raw);
    assert.ok(params.response_format.properties.timeline.properties.normalized);
    // Verify budget is required (NOT nullable as a whole)
    assert.ok(params.response_format.required.includes('budget'));
    assert.ok(params.response_format.required.includes('timeline'));
  });

  test('request includes generation_config with temperature=0', async () => {
    mock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
    await extract('test');
    const params = mock.calls[0].params;
    assert.ok(params.generation_config);
    assert.equal(params.generation_config.temperature, 0);
  });

  test('HTTP 5xx → PROVIDER_SERVER_ERROR, recoverable=true', async () => {
    mock = mockGeminiInteractions(() => {
      const err = new ApiError({ message: 'down', status: 503 });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_SERVER_ERROR' && err.recoverable === true,
    );
  });

  test('HTTP 429 → PROVIDER_RATE_LIMIT, recoverable=true', async () => {
    mock = mockGeminiInteractions(() => {
      const err = new ApiError({ message: 'rate limited', status: 429 });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_RATE_LIMIT' && err.recoverable === true,
    );
  });

  test('HTTP 401 → PROVIDER_AUTH_ERROR, recoverable=true', async () => {
    mock = mockGeminiInteractions(() => {
      const err = new ApiError({ message: 'auth failed', status: 401 });
      return err;
    });
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'PROVIDER_AUTH_ERROR' && err.recoverable === true,
    );
  });

  test('malformed JSON in output_text → INVALID_OUTPUT, recoverable=false', async () => {
    mock = mockGeminiInteractions(() => ({
      id: 'interaction_test',
      output_text: 'not json',
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('schema-invalid response → INVALID_OUTPUT, recoverable=false', async () => {
    mock = mockGeminiInteractions(() =>
      geminiResponse({ ...validExtraction(), serviceLine: 'design' }),
    );
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT' && err.recoverable === false,
    );
  });

  test('empty output_text → INVALID_OUTPUT', async () => {
    mock = mockGeminiInteractions(() => ({
      id: 'interaction_test',
      output_text: '',
    }));
    await assert.rejects(
      extract('test'),
      (err) => err.code === 'INVALID_OUTPUT',
    );
  });

  test('retry on recoverable error then succeed', async () => {
    let calls = 0;
    mock = mockGeminiInteractions(() => {
      calls += 1;
      if (calls === 1) {
        return new ApiError({ message: 'down', status: 500 });
      }
      return geminiResponse(validExtraction());
    });
    const result = await extract('test');
    assert.equal(calls, 2);
    assert.equal(result.parsed.company, 'Test Co');
  });

  test('no retry on INVALID_OUTPUT', async () => {
    let calls = 0;
    mock = mockGeminiInteractions(() => {
      calls += 1;
      return geminiResponse({ ...validExtraction(), serviceLine: 'design' });
    });
    await assert.rejects(extract('test'), (err) => err.code === 'INVALID_OUTPUT');
    assert.equal(calls, 1);
  });

  test('SDK errors do NOT leak the API key in rawOutput', async () => {
    mock = mockGeminiInteractions(() =>
      new ApiError({ message: 'down', status: 503 }),
    );
    await assert.rejects(
      extract('test'),
      (err) => {
        assert.equal(err.rawOutput, null);
        assert.ok(!err.cause?.includes(env.GEMINI_API_KEY));
        return true;
      },
    );
  });

  test('Unicode content preserved in request input', async () => {
    mock = mockGeminiInteractions(() => geminiResponse(validExtraction()));
    const enquiry = 'Buenos días — 25.000 € — ¿Pueden? 🙏';
    await extract(enquiry);
    const params = mock.calls[0].params;
    assert.ok(params.input.includes(enquiry));
  });
});
