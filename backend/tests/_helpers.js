/**
 * Shared test helpers for Phase 3 tests.
 *
 * - `mockFetch(responder)` patches global.fetch for the duration of a test
 *   and restores it in afterEach. The responder is a function that takes
 *   (url, init) and returns `{ status, body }` or throws.
 *
 * - `captureLog()` patches the logger's underlying console.log/error so we
 *   can assert on log output without polluting test output.
 *
 * - `loadFixtureBlock(name)` reads a single enquiry block from the real
 *   sample-enquiries.txt fixture so tests use real operator data, not
 *   invented strings.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../test-data/sample-enquiries.txt', import.meta.url),
);

/**
 * Read the real fixture file and split into blocks. Returns the full set
 * so tests can pick a specific block by index or by sender name.
 */
export function readFixtureBlocks() {
  const text = readFileSync(FIXTURE_PATH, 'utf-8');
  // Split on 80-dash separators (the real fixture uses exactly 80 dashes).
  // The first chunk is the preamble ("SAMPLE ENQUIRIES — Sodio Task").
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
 * Patch global.fetch with a responder for the duration of a test.
 *
 * @param {(url: string, init: object) => Promise<{status: number, body: unknown}> | {status: number, body: unknown}} responder
 * @returns {{restore: () => void, calls: Array<{url: string, init: object}>}}
 */
export function mockFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    const callRecord = { url: String(url), init };
    calls.push(callRecord);
    const result = await responder(String(url), init);
    const status = result.status ?? 200;
    const bodyText =
      typeof result.body === 'string'
        ? result.body
        : JSON.stringify(result.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => bodyText,
      json: async () => JSON.parse(bodyText),
    };
  };
  const m = mock.method(globalThis, 'fetch', fn);
  return {
    restore: () => m.mock.restore(),
    get calls() {
      // Also clear our local `calls` array on restore so subsequent tests
      // don't see stale data.
      return calls;
    },
  };
}

/**
 * Build a valid Grok-shaped response body.
 * @param {object} extraction
 */
export function grokResponse(extraction) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [
      {
        message: { role: 'assistant', content: JSON.stringify(extraction) },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

/**
 * Build a valid Gemini-shaped response body.
 * @param {object} extraction
 */
export function geminiResponse(extraction) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(extraction) }],
          role: 'model',
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
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
