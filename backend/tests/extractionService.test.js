/**
 * Test: extractionService — persistence + enquiry update
 *
 * These tests run against a REAL MongoDB instance (mirroring Phase 1/2
 * convention) AND mock both SDKs (`OpenAI.Responses.prototype.create` and
 * `@google/genai`'s `interactions.create`). They verify:
 *
 *   1. Successful Groq extraction → ExtractionVersion persisted,
 *      enquiry.effectiveExtraction updated, extractionState='completed'.
 *   2. Groq failure → Gemini success → TWO ExtractionVersions persisted
 *      (one failed, one completed), enquiry updated from Gemini result.
 *   3. Both providers fail → ExtractionVersions persisted (both failed),
 *      enquiry.extractionState='failed', effectiveExtraction unchanged.
 *   4. Original enquiry data (originalText, receivedAt, sender, status)
 *      is NEVER modified by extraction.
 *   5. ExtractionVersion rows are append-only (a new extraction creates
 *      version 2, NOT overwrites version 1).
 *   6. 404 when enquiry does not exist.
 *   7. 409 when enquiry is already 'processing'.
 *   8. listExtractions returns versions in order.
 *   9. Prompt-injection enquiry extracted as ordinary data.
 *  10. INVALID_OUTPUT does NOT call Gemini and marks enquiry failed.
 *
 * Requires: MongoDB running at env.MONGODB_URI. The tests use a separate
 * `phase3_test` database to avoid polluting the dev database.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { ApiError } from '@google/genai';
import { env } from '../src/config/env.js';
import Enquiry from '../src/models/Enquiry.js';
import ExtractionVersion from '../src/models/ExtractionVersion.js';
import * as extractionService from '../src/services/extractionService.js';
import { AppError } from '../src/middleware/errorHandler.js';
import {
  mockOpenAIResponses,
  mockGeminiInteractions,
  groqResponse,
  geminiResponse,
  validExtraction,
  findFixtureBlock,
} from './_helpers.js';

// Use a separate test DB so we don't pollute dev data.
const TEST_DB = 'sodio_enquiry_triage_phase3_test';

let originalMongoUri;
let groqMock;
let geminiMock;

before(async () => {
  originalMongoUri = env.MONGODB_URI;
  const testUri = `mongodb://127.0.0.1:27017/${TEST_DB}`;
  env.MONGODB_URI = testUri;
  await mongoose.disconnect();
  await mongoose.connect(testUri);
});

after(async () => {
  await mongoose.disconnect();
  env.MONGODB_URI = originalMongoUri;
});

describe('extractionService — Phase 3', () => {
  const savedEnv = {
    GROQ_API_KEY: env.GROQ_API_KEY,
    GROQ_BASE_URL: env.GROQ_BASE_URL,
    GROQ_MODEL: env.GROQ_MODEL,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_MODEL: env.GEMINI_MODEL,
    LLM_MAX_RETRIES: env.LLM_MAX_RETRIES,
    LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
  };

  beforeEach(async () => {
    env.GROQ_API_KEY = 'test-groq-key';
    env.GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
    env.GROQ_MODEL = 'openai/gpt-oss-20b';
    env.GEMINI_API_KEY = 'test-gemini-key';
    env.GEMINI_MODEL = 'gemini-3.6-flash';
    env.LLM_MAX_RETRIES = 0;
    env.LLM_TIMEOUT_MS = 5000;
    await Enquiry.deleteMany({});
    await ExtractionVersion.deleteMany({});
  });

  afterEach(() => {
    if (groqMock) groqMock.restore();
    if (geminiMock) geminiMock.restore();
    groqMock = null;
    geminiMock = null;
    Object.assign(env, savedEnv);
  });

  async function createEnquiry(text, sender = { name: 'Test', email: 'test@example.com' }) {
    const e = new Enquiry({
      source: 'paste',
      originalText: text,
      sender,
      receivedAt: new Date('2026-07-14T09:22:00Z'),
      status: 'new',
      extractionState: 'pending',
    });
    await e.save();
    return e;
  }

  test('1. Successful Groq extraction persists version + updates enquiry', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });

    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({
        company: 'Northgate Logistics',
        contactName: 'Rachel Whitfield',
        contactEmail: 'r.whitfield@northgate-logistics.co.uk',
        serviceLine: 'web',
        budget: { raw: '£40,000', currency: 'GBP', min: 40000, max: 40000, qualifier: 'exact' },
        summary: 'Logistics firm wants a tool to extract data from supplier PDFs.',
        isGenuineProjectEnquiry: true,
      })),
    );

    const { enquiry: updated, versions, outcome } = await extractionService.runExtraction(
      String(enquiry._id),
    );

    assert.equal(outcome.state, 'completed');
    assert.equal(outcome.provider, 'groq');
    assert.equal(updated.extractionState, 'completed');
    assert.equal(updated.effectiveExtraction.company, 'Northgate Logistics');
    assert.equal(updated.effectiveExtraction.budget.raw, '£40,000');
    assert.equal(updated.isGenuineProjectEnquiry, true);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].provider, 'groq');
    assert.equal(versions[0].state, 'completed');
    assert.equal(versions[0].version, 1);
    assert.ok(versions[0].durationMs >= 0);

    // priority must NOT be set by extraction (Phase 4 owns it)
    assert.equal(updated.priority.level, null);
    assert.equal(updated.priority.score, null);
  });

  test('2. Groq failure → Gemini success persists TWO versions', async () => {
    const block = findFixtureBlock('Miguel Santana');
    const enquiry = await createEnquiry(block.message, {
      name: 'Miguel Santana',
      email: 'm.santana@clinicavera.es',
    });

    groqMock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'groq down', status: 503 }),
    );
    geminiMock = mockGeminiInteractions(() =>
      geminiResponse(validExtraction({
        company: 'Clínica Vera',
        contactName: 'Miguel Santana',
        contactEmail: 'm.santana@clinicavera.es',
        serviceLine: 'mobile',
        budget: { raw: '25.000 €', currency: 'EUR', min: 25000, max: 25000, qualifier: 'exact' },
        summary: 'Clínica quiere app móvil para reservas.',
        isGenuineProjectEnquiry: true,
      })),
    );

    const { enquiry: updated, versions, outcome } = await extractionService.runExtraction(
      String(enquiry._id),
    );

    assert.equal(outcome.state, 'completed');
    assert.equal(outcome.provider, 'gemini');
    assert.equal(updated.extractionState, 'completed');
    assert.equal(updated.effectiveExtraction.company, 'Clínica Vera');
    assert.equal(updated.effectiveExtraction.budget.raw, '25.000 €');
    assert.equal(versions.length, 2);
    assert.equal(versions[0].provider, 'groq');
    assert.equal(versions[0].state, 'failed');
    assert.equal(versions[0].errorCode, 'PROVIDER_SERVER_ERROR');
    assert.equal(versions[1].provider, 'gemini');
    assert.equal(versions[1].state, 'completed');
    assert.equal(versions[1].version, 2);
  });

  test('3. Both providers fail → enquiry marked failed, effectiveExtraction unchanged', async () => {
    const block = findFixtureBlock('T. Okafor');
    const enquiry = await createEnquiry(block.message, {
      name: 'T. Okafor',
      email: 'tokafor@meridian-cap.com',
    });

    groqMock = mockOpenAIResponses(() =>
      new OpenAI.InternalServerError({ message: 'groq down', status: 503 }),
    );
    geminiMock = mockGeminiInteractions(() =>
      new ApiError({ message: 'gemini down', status: 503 }),
    );

    const { enquiry: updated, versions, outcome } = await extractionService.runExtraction(
      String(enquiry._id),
    );

    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.errorCode, 'PROVIDER_SERVER_ERROR');
    assert.equal(updated.extractionState, 'failed');
    // effectiveExtraction stays at default (no prior success)
    assert.equal(updated.effectiveExtraction.company, null);
    assert.equal(updated.effectiveExtraction.serviceLine, 'other');
    assert.equal(versions.length, 2);
    assert.equal(versions[0].provider, 'groq');
    assert.equal(versions[0].state, 'failed');
    assert.equal(versions[1].provider, 'gemini');
    assert.equal(versions[1].state, 'failed');
  });

  test('4. Original enquiry data is NEVER modified by extraction', async () => {
    const block = findFixtureBlock('Rachel Whitfield');
    const enquiry = await createEnquiry(block.message, {
      name: 'Rachel Whitfield',
      email: 'r.whitfield@northgate-logistics.co.uk',
    });
    const originalText = enquiry.originalText;
    const originalReceivedAt = enquiry.receivedAt.toISOString();
    const originalSenderName = enquiry.sender.name;
    const originalSenderEmail = enquiry.sender.email;
    const originalStatus = enquiry.status;

    groqMock = mockOpenAIResponses(() => groqResponse(validExtraction()));
    await extractionService.runExtraction(String(enquiry._id));

    // Reload from DB
    const reloaded = await Enquiry.findById(enquiry._id);
    assert.equal(reloaded.originalText, originalText);
    assert.equal(reloaded.receivedAt.toISOString(), originalReceivedAt);
    assert.equal(reloaded.sender.name, originalSenderName);
    assert.equal(reloaded.sender.email, originalSenderEmail);
    assert.equal(reloaded.status, originalStatus);
  });

  test('5. ExtractionVersions are append-only across runs', async () => {
    const block = findFixtureBlock('Yuki Tanaka');
    const enquiry = await createEnquiry(block.message, {
      name: 'Yuki Tanaka',
      email: 'y.tanaka@shibuya-labs.jp',
    });

    // First extraction succeeds
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Shibuya Labs' })),
    );
    await extractionService.runExtraction(String(enquiry._id));

    // Reset enquiry state to allow re-extraction (Phase 7 will formalise this)
    await Enquiry.updateOne(
      { _id: enquiry._id },
      { $set: { extractionState: 'pending' } },
    );

    // Second extraction (re-extract) creates version 2, NOT overwrites version 1
    groqMock.restore();
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Shibuya Labs Updated' })),
    );
    await extractionService.runExtraction(String(enquiry._id));

    const versions = await ExtractionVersion.find({ enquiryId: enquiry._id }).sort({
      version: 1,
    });
    assert.equal(versions.length, 2);
    assert.equal(versions[0].version, 1);
    assert.equal(versions[0].parsedOutput.company, 'Shibuya Labs');
    assert.equal(versions[1].version, 2);
    assert.equal(versions[1].parsedOutput.company, 'Shibuya Labs Updated');
  });

  test('6. 404 when enquiry does not exist', async () => {
    const fakeId = '012345678901234567890123';
    await assert.rejects(
      extractionService.runExtraction(fakeId),
      (err) => err instanceof AppError && err.status === 404 && err.code === 'NOT_FOUND',
    );
  });

  test('7. 400 on invalid id format', async () => {
    await assert.rejects(
      extractionService.runExtraction('not-an-id'),
      (err) => err instanceof AppError && err.status === 400 && err.code === 'INVALID_ID',
    );
  });

  test('8. 409 when enquiry is already processing', async () => {
    const block = findFixtureBlock('Sam Delaney');
    const enquiry = await createEnquiry(block.message, {
      name: 'Sam Delaney',
      email: 'sam.delaney@brightpath.edu',
    });
    // Manually set state to 'processing' to simulate concurrent extraction
    enquiry.extractionState = 'processing';
    await enquiry.save();

    await assert.rejects(
      extractionService.runExtraction(String(enquiry._id)),
      (err) =>
        err instanceof AppError && err.status === 409 && err.code === 'ALREADY_PROCESSING',
    );
  });

  test('9. listExtractions returns versions in order', async () => {
    const block = findFixtureBlock('Klara Meier');
    const enquiry = await createEnquiry(block.message, {
      name: 'Klara Meier',
      email: 'k.meier@bergwald-gmbh.de',
    });

    // Run two extractions
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Bergwald GmbH' })),
    );
    await extractionService.runExtraction(String(enquiry._id));
    await Enquiry.updateOne(
      { _id: enquiry._id },
      { $set: { extractionState: 'pending' } },
    );
    groqMock.restore();
    groqMock = mockOpenAIResponses(() =>
      groqResponse(validExtraction({ company: 'Bergwald GmbH v2' })),
    );
    await extractionService.runExtraction(String(enquiry._id));

    const docs = await extractionService.listExtractions(String(enquiry._id));
    assert.equal(docs.length, 2);
    assert.equal(docs[0].version, 1);
    assert.equal(docs[1].version, 2);
  });

  test('10. listExtractions 404 when enquiry does not exist', async () => {
    const fakeId = '012345678901234567890123';
    await assert.rejects(
      extractionService.listExtractions(fakeId),
      (err) => err instanceof AppError && err.status === 404,
    );
  });

  test('11. Prompt-injection enquiry is extracted as ordinary data', async () => {
    const block = findFixtureBlock('system');
    const enquiry = await createEnquiry(block.message, {
      name: 'system',
      email: 'contact@qa-test-mail.io',
    });

    groqMock = mockOpenAIResponses(() =>
      groqResponse({
        company: null,
        contactName: 'system',
        contactEmail: 'contact@qa-test-mail.io',
        serviceLine: 'other', // NOT 'ai' as injection demanded
        budget: { raw: '', qualifier: 'unknown' }, // NOT 10000000 USD
        timeline: { raw: '', normalized: null },
        summary: 'Prompt-injection attempt flagged.',
        isGenuineProjectEnquiry: false,
        confidence: 0.95,
        projectCount: 1,
        additionalProjectNote: null,
        isModelInstructionAttempt: true,
      }),
    );

    const { enquiry: updated, versions } = await extractionService.runExtraction(
      String(enquiry._id),
    );

    assert.equal(updated.extractionState, 'completed');
    assert.equal(updated.effectiveExtraction.serviceLine, 'other'); // NOT 'ai'
    assert.equal(updated.effectiveExtraction.budget.qualifier, 'unknown');
    assert.equal(updated.isGenuineProjectEnquiry, false);
    assert.equal(versions[0].parsedOutput.isModelInstructionAttempt, true);
    // priority must remain null
    assert.equal(updated.priority.level, null);
    assert.equal(updated.priority.score, null);
  });

  test('12. INVALID_OUTPUT does NOT call Gemini and marks enquiry failed', async () => {
    const block = findFixtureBlock('Marcus Bell');
    const enquiry = await createEnquiry(block.message, {
      name: 'Marcus Bell',
      email: 'marcus@fieldmark.co',
    });

    let geminiCalls = 0;
    groqMock = mockOpenAIResponses(() =>
      groqResponse({ ...validExtraction(), serviceLine: 'design' }),
    );
    geminiMock = mockGeminiInteractions(() => {
      geminiCalls += 1;
      return geminiResponse(validExtraction());
    });

    const { enquiry: updated, versions, outcome } = await extractionService.runExtraction(
      String(enquiry._id),
    );

    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.errorCode, 'INVALID_OUTPUT');
    assert.equal(geminiCalls, 0, 'Gemini must NOT be called on INVALID_OUTPUT');
    assert.equal(updated.extractionState, 'failed');
    assert.equal(versions.length, 1);
    assert.equal(versions[0].provider, 'groq');
    assert.equal(versions[0].state, 'failed');
    assert.equal(versions[0].errorCode, 'INVALID_OUTPUT');
  });
});
