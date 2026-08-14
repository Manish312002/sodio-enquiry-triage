/**
 * Shared test helpers for Phase 3 tests.
 *
 * - `mockOpenAIResponses(responder)` patches the `openai` package's
 *   `client.responses.create` method using `node:test`'s mock capabilities.
 *
 * - `mockGeminiInteractions(responder)` patches the `@google/genai`
 *   package's `Interactions.prototype.create` method.
 *
 * - `loadFixtureBlock(name)` reads a single enquiry block from the real
 *   sample-enquiries.txt fixture so tests use real operator data, not
 *   invented strings.
 *
 * Mocking strategy: we mock at the SDK method level (not at the `fetch`
 * level). This makes tests independent of the SDK's internal HTTP
 * implementation and lets us test our provider adapters' SDK-usage
 * patterns directly.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../test-data/sample-enquiries.txt', import.meta.url),
);

/**
 * Read the real fixture file and split into blocks. Returns the full set
 * so tests can pick a specific block by index or by sender name.
 */
export function readFixtureBlocks() {
  const text = readFileSync(FIXTURE_PATH, 'utf-8');
  const parts = text.split(/^-{3,}[ \t]*\r?\n/m);
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Extract just the message body from a fixture block (the part after
 * `Message:\n`). This is what `parserService` would store as `originalText`.
 */
export function extractMessageBody(block) {
  const idx = block.search(/Message:\s*\r?\n/);
  if (idx === -1) return block;
  return block.slice(idx).replace(/^Message:\s*\r?\n/, '');
}

/**
 * Find a fixture block by the sender's `From:` name.
 *
 * @param {string} name  e.g. 'Rachel Whitfield', 'Miguel Santana'
 * @returns {{from: string, email: string, received: string, message: string}}
 */
export function findFixtureBlock(name) {
  const blocks = readFixtureBlocks();
  const block = blocks.find((b) => b.startsWith(`From: ${name}`));
  if (!block) {
    throw new Error(`Fixture block with From: ${name} not found`);
  }
  const from = block.match(/^From:\s*(.+)$/m)?.[1] || '';
  const email = block.match(/^Email:\s*(.+)$/m)?.[1] || '';
  const received = block.match(/^Received:\s*(.+)$/m)?.[1] || '';
  const message = extractMessageBody(block);
  return { from, email, received, message };
}

/**
 * Patch `OpenAI.Responses.prototype.create` with a responder.
 *
 * The responder is called with the request params (the object passed to
 * `client.responses.create()`) and returns either:
 *   - an object with `output_text` (string) — simulates a 2xx success
 *   - an Error to throw — simulates a provider failure
 *
 * @param {(params: object) => {output_text: string} | Promise<{output_text: string}>} responder
 * @returns {{restore: () => void, calls: Array<{params: object}>}}
 */
export function mockOpenAIResponses(responder) {
  const calls = [];
  const original = OpenAI.Responses.prototype.create;
  OpenAI.Responses.prototype.create = async function (params) {
    calls.push({ params });
    const result = await responder(params);
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    restore: () => {
      OpenAI.Responses.prototype.create = original;
    },
    get calls() {
      return calls;
    },
  };
}

/**
 * Patch the Gemini SDK's `Interactions.prototype.create` with a responder.
 *
 * We discover the Interactions prototype by constructing a throwaway
 * GoogleGenAI instance and grabbing `Object.getPrototypeOf(ai.interactions)`.
 *
 * @param {(params: object) => {output_text: string} | Promise<{output_text: string}>} responder
 * @returns {{restore: () => void, calls: Array<{params: object}>}}
 */
export function mockGeminiInteractions(responder) {
  const calls = [];
  const fakeAi = new GoogleGenAI({ apiKey: 'fake' });
  const InteractionsProto = Object.getPrototypeOf(fakeAi.interactions);
  const original = InteractionsProto.create;
  InteractionsProto.create = async function (params) {
    calls.push({ params });
    const result = await responder(params);
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    restore: () => {
      InteractionsProto.create = original;
    },
    get calls() {
      return calls;
    },
  };
}

/**
 * Build a valid Groq/OpenAI Responses-API-shaped response object.
 * The SDK exposes `response.output_text` as a top-level string property.
 *
 * @param {object} extraction  The extraction object to be JSON-stringified
 *                             and returned as `output_text`.
 */
export function groqResponse(extraction) {
  return {
    id: 'resp_test',
    object: 'response',
    model: 'openai/gpt-oss-20b',
    output_text: JSON.stringify(extraction),
    output: [],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/**
 * Build a valid Gemini Interactions-API-shaped response object.
 * The SDK exposes `interaction.output_text` as a top-level string property.
 *
 * @param {object} extraction
 */
export function geminiResponse(extraction) {
  return {
    id: 'interaction_test',
    model: 'gemini-3.6-flash',
    status: 'COMPLETED',
    output_text: JSON.stringify(extraction),
    usage: { promptTokenCount: 100, candidatesTokenCount: 50 },
  };
}

/**
 * A complete, schema-valid extraction object for tests.
 */
export function validExtraction(overrides = {}) {
  return {
    company: 'Test Co',
    contactName: 'Test Person',
    contactEmail: 'test@example.com',
    serviceLine: 'web',
    budget: {
      raw: '£40,000',
      currency: 'GBP',
      min: 40000,
      max: 40000,
      qualifier: 'exact',
    },
    timeline: { raw: 'September', normalized: { period: 'relative' } },
    summary: 'A test enquiry.',
    isGenuineProjectEnquiry: true,
    confidence: 0.9,
    projectCount: 1,
    additionalProjectNote: null,
    isModelInstructionAttempt: false,
    ...overrides,
  };
}

export const FIXTURE_PATH_URL = new URL(`file://${FIXTURE_PATH}`).href;
