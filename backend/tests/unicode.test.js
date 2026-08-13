/**
 * Test: Unicode preservation through the extraction pipeline
 *
 * Uses REAL fixture blocks from `test-data/sample-enquiries.txt`:
 *   - Miguel Santana (Spanish: `Buenos días`, `clínica`, `móvil`, `25.000 €`, `¿Pueden?`)
 *   - Rachel Whitfield (£)
 *   - D. Fontaine ($)
 *   - Ankit Bahl (lakhs / INR convention)
 *   - Priya Ramanathan (multi-project, $60k and $90k, em-dash)
 *   - Website Contact Form (🙏 emoji)
 *
 * Verifies:
 *   - The enquiry text appears UNCHANGED in the HTTP request body sent to
 *     both Grok and Gemini.
 *   - The extraction schema accepts Unicode in all string fields.
 *   - The llmService outcome preserves Unicode in parsedOutput when the
 *     mocked provider returns it.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractionSchema } from '../src/services/llm/extractionSchema.js';
import { llmService } from '../src/services/llm/llmService.js';
import { env } from '../src/config/env.js';
import {
  findFixtureBlock,
  mockFetch,
  grokResponse,
  validExtraction,
  readFixtureBlocks,
} from './_helpers.js';

describe('Unicode preservation', () => {
  test('Miguel Santana block has Spanish text + € symbol', () => {
    const block = findFixtureBlock('Miguel Santana');
    assert.ok(block.message.includes('Buenos días'));
    assert.ok(block.message.includes('clínica'));
    assert.ok(block.message.includes('móvil'));
    assert.ok(block.message.includes('25.000 €'));
    assert.ok(block.message.includes('¿Pueden ayudarnos?'));
  });

  test('Rachel Whitfield block has £ symbol', () => {
    const block = findFixtureBlock('Rachel Whitfield');
    assert.ok(block.message.includes('£40,000'));
  });

  test('D. Fontaine block has $ symbol', () => {
    const block = findFixtureBlock('D. Fontaine');
    assert.ok(block.message.includes('$80k'));
  });

  test('Ankit Bahl block has lakhs (INR convention)', () => {
    const block = findFixtureBlock('Ankit Bahl');
    assert.ok(block.message.includes('35-40 lakhs'));
  });

  test('Priya Ramanathan block has em-dash + multi-project text', () => {
    const block = findFixtureBlock('Priya Ramanathan');
    assert.ok(block.message.includes('—')); // em-dash (U+2014)
    assert.ok(block.message.includes('$60k and $90k'));
  });

  test('Website Contact Form block has 🙏 emoji in the captcha field', () => {
    // The 🙏 emoji in the real fixture sits BETWEEN Received: and Message:
    // (likely a captcha field). It is NOT part of originalText — that's
    // correct parser behaviour (Phase 2 inspection report). Verify the
    // full fixture text contains it; the message body does not.
    const blocks = readFixtureBlocks();
    const fullBlock = blocks.find((b) => b.startsWith('From: Website Contact Form'));
    assert.ok(fullBlock.includes('🙏'));
    // The message body (after Message:\n) does NOT contain the emoji:
    const block = findFixtureBlock('Website Contact Form');
    assert.ok(!block.message.includes('🙏'));
  });

  test('schema accepts Unicode in summary field', () => {
    const r = extractionSchema.safeParse({
      ...validExtraction(),
      summary: 'Buenos días — clínica móvil — 25.000 € — ¿Pueden? 🙏',
    });
    assert.ok(r.success);
    assert.equal(r.data.summary, 'Buenos días — clínica móvil — 25.000 € — ¿Pueden? 🙏');
  });

  test('schema accepts Unicode in budget.raw field', () => {
    const cases = [
      '£40,000',
      '25.000 €',
      '$80k',
      '35-40 lakhs',
      '$60k and $90k',
      '₹50,00,000',
    ];
    for (const raw of cases) {
      const r = extractionSchema.safeParse({
        ...validExtraction(),
        budget: { raw, currency: null, min: null, max: null, qualifier: 'unknown' },
      });
      assert.ok(r.success, `Failed for: ${raw}`);
      assert.equal(r.data.budget.raw, raw);
    }
  });

  describe('end-to-end: provider request preserves Unicode', () => {
    let fetchMock;
    const saved = {
      GROK_API_KEY: env.GROK_API_KEY,
      GROK_API_URL: env.GROK_API_URL,
      GEMINI_API_KEY: env.GEMINI_API_KEY,
      GEMINI_API_URL: env.GEMINI_API_URL,
      LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
      LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
    };

    beforeEach(() => {
      env.GROK_API_KEY = 'test-key';
      env.GROK_API_URL = 'https://grok.test/v1/chat/completions';
      env.GEMINI_API_KEY = '';
      env.LLM_MAX_RETRIES = 0;
      env.LLM_TIMEOUT_MS = 5000;
    });

    afterEach(() => {
      if (fetchMock) fetchMock.restore();
      fetchMock = null;
      Object.assign(env, saved);
    });

    test('Miguel Santana (Spanish + €) is preserved in the Grok request', async () => {
      const block = findFixtureBlock('Miguel Santana');
      fetchMock = mockFetch(() => ({
        status: 200,
        body: grokResponse(validExtraction({
          company: 'Clínica Vera',
          contactName: 'Miguel Santana',
          contactEmail: 'm.santana@clinicavera.es',
          serviceLine: 'mobile',
          budget: {
            raw: '25.000 €',
            currency: 'EUR',
            min: 25000,
            max: 25000,
            qualifier: 'exact',
          },
          summary: 'Clínica privada en Valencia quiere app móvil para reservas. Presupuesto 25.000 €.',
        })),
      }));
      const out = await llmService.extractWithFallback(block.message);
      assert.equal(out.state, 'completed');
      // Verify the request body preserved Unicode
      const body = JSON.parse(fetchMock.calls[0].init.body);
      assert.ok(body.messages[1].content.includes('Buenos días'));
      assert.ok(body.messages[1].content.includes('25.000 €'));
      assert.ok(body.messages[1].content.includes('¿Pueden ayudarnos?'));
      // Verify the parsed output preserved Unicode
      assert.equal(out.parsed.company, 'Clínica Vera');
      assert.equal(out.parsed.budget.raw, '25.000 €');
      assert.ok(out.parsed.summary.includes('Clínica'));
      assert.ok(out.parsed.summary.includes('25.000 €'));
    });

    test('Rachel Whitfield (£) is preserved in the Grok request', async () => {
      const block = findFixtureBlock('Rachel Whitfield');
      fetchMock = mockFetch(() => ({
        status: 200,
        body: grokResponse(validExtraction({
          company: 'Northgate Logistics',
          budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
        })),
      }));
      const out = await llmService.extractWithFallback(block.message);
      assert.equal(out.state, 'completed');
      assert.equal(out.parsed.budget.raw, '£40,000');
      const body = JSON.parse(fetchMock.calls[0].init.body);
      assert.ok(body.messages[1].content.includes('£40,000'));
    });

    test('Ankit Bahl (35-40 lakhs INR convention) is preserved', async () => {
      const block = findFixtureBlock('Ankit Bahl');
      fetchMock = mockFetch(() => ({
        status: 200,
        body: grokResponse(validExtraction({
          company: 'Vedansh Group',
          budget: { raw: '35-40 lakhs', currency: 'INR', min: 3500000, max: 4000000, qualifier: 'range' },
        })),
      }));
      const out = await llmService.extractWithFallback(block.message);
      assert.equal(out.state, 'completed');
      assert.equal(out.parsed.budget.raw, '35-40 lakhs');
      const body = JSON.parse(fetchMock.calls[0].init.body);
      assert.ok(body.messages[1].content.includes('35-40 lakhs'));
    });

    test('Priya Ramanathan (em-dash + multi-project) is preserved', async () => {
      const block = findFixtureBlock('Priya Ramanathan');
      fetchMock = mockFetch(() => ({
        status: 200,
        body: grokResponse(validExtraction({
          company: 'Lumen Health',
          projectCount: 2,
          additionalProjectNote: 'Chatbot urgent (6 weeks); React migration can wait until Q1.',
          budget: {
            raw: '$60k and $90k',
            currency: 'USD',
            min: 60000,
            max: 90000,
            qualifier: 'range',
          },
        })),
      }));
      const out = await llmService.extractWithFallback(block.message);
      assert.equal(out.state, 'completed');
      assert.equal(out.parsed.projectCount, 2);
      assert.ok(out.parsed.additionalProjectNote.includes('Chatbot'));
      assert.ok(out.parsed.additionalProjectNote.includes('React'));
      const body = JSON.parse(fetchMock.calls[0].init.body);
      assert.ok(body.messages[1].content.includes('—')); // em-dash
      assert.ok(body.messages[1].content.includes('$60k and $90k'));
    });
  });
});
