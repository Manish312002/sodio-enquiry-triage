/**
 * Extraction service — orchestrates one LLM extraction attempt against a
 * persisted enquiry, and persists the outcome (success OR failure) as an
 * ExtractionVersion row.
 *
 * Architechure.md §5 (provider flow):
 *   Enquiry
 *     ↓
 *   ExtractionService.runExtraction(enquiryId)
 *     ↓
 *   llmService.extractWithFallback(originalText)
 *     ├── Grok success → persist version, update enquiry.effectiveExtraction
 *     ├── Grok recoverable failure → Gemini
 *     │     ├── Gemini success → persist BOTH versions, update enquiry
 *     │     └── Gemini failure → persist BOTH versions, mark enquiry failed
 *     └── Grok non-recoverable failure (INVALID_OUTPUT) → persist version,
 *           mark enquiry failed, DO NOT try Gemini
 *
 * Data integrity rules (Rules.md §14):
 *   - originalText is IMMUTABLE. We never write to it.
 *   - receivedAt is IMMUTABLE.
 *   - ExtractionVersions are APPEND-ONLY. We never update an existing row.
 *   - extractionState transitions: pending → processing → completed|failed
 *
 * Scope (Phase 3 + Phase 4):
 *   - Single-enquiry extraction. No batch orchestration (Phase 8).
 *   - After a successful extraction, deterministic priority is computed and
 *     persisted on enquiry.priority (Phase 4 — scoringService).
 *   - No human override merging (Phase 6/7). effectiveExtraction is set
 *     directly from the model output.
 *
 * Failure model (Rules.md §12):
 *   - A failed extraction does NOT corrupt the enquiry. originalText,
 *     receivedAt, sender, status are all untouched.
 *   - The enquiry's extractionState transitions to 'failed' and the
 *     effectiveExtraction is NOT updated (it stays at its default empty
 *     object, or retains the previous successful extraction if one
 *     exists — Phase 7's re-extraction flow will formalise this).
 */
import Enquiry from '../models/Enquiry.js';
import ExtractionVersion from '../models/ExtractionVersion.js';
import { llmService } from './llm/llmService.js';
import { applyPriorityToEnquiry } from './scoringService.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Run extraction for a single persisted enquiry.
 *
 * Steps:
 *   1. Load the enquiry by id. 404 if not found.
 *   2. Atomically transition extractionState: pending|failed → processing.
 *      (If already 'processing', refuse — prevents concurrent double-extract.)
 *   3. Call llmService.extractWithFallback(originalText).
 *   4. Persist one ExtractionVersion per provider attempt (success AND
 *      failure) so the audit trail is complete.
 *   5. On success: update enquiry.effectiveExtraction with the validated
 *      model output; set extractionState='completed'; set
 *      isGenuineProjectEnquiry from the model output.
 *   6. On failure: set extractionState='failed'; do NOT touch
 *      effectiveExtraction (preserve any prior success — Phase 7 will
 *      formalise the re-extract-conflict semantics).
 *   7. Return the persisted ExtractionVersion rows + the updated enquiry.
 *
 * @param {string} enquiryId
 * @returns {Promise<{enquiry: import('../models/Enquiry.js').default, versions: import('../models/ExtractionVersion.js').default[], outcome: import('./llm/llmService.js').LlmOutcome}>}
 * @throws {AppError} 404 if enquiry not found; 409 if already processing.
 */
export async function runExtraction(enquiryId) {
  // 1. Load enquiry
  if (!enquiryId || !/^[a-fA-F0-9]{24}$/.test(String(enquiryId))) {
    throw new AppError({
      message: 'Invalid enquiry id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }
  const enquiry = await Enquiry.findById(enquiryId);
  if (!enquiry) {
    throw new AppError({
      message: `Enquiry ${enquiryId} not found.`,
      status: 404,
      code: 'NOT_FOUND',
    });
  }

  // 2. Refuse concurrent double-extraction.
  if (enquiry.extractionState === 'processing') {
    throw new AppError({
      message: 'Enquiry is already being processed. Wait for the current extraction to finish.',
      status: 409,
      code: 'ALREADY_PROCESSING',
    });
  }

  // Transition to 'processing' BEFORE the LLM call so a concurrent request
  // is rejected. We persist this state change immediately.
  enquiry.extractionState = 'processing';
  await enquiry.save();

  // 3. Call the LLM service. This is the only place we use the enquiry's
  //    originalText — and we ONLY read it. We never write to it.
  let outcome;
  try {
    outcome = await llmService.extractWithFallback(enquiry.originalText);
  } catch (err) {
    // Defensive: llmService is supposed to return a structured failure,
    // not throw. If it does throw, we still want to leave the enquiry in
    // a recoverable state.
    logger.error('extractionService: llmService threw unexpectedly', {
      enquiryId: String(enquiry._id),
      message: err?.message,
    });
    enquiry.extractionState = 'failed';
    await enquiry.save();
    throw new AppError({
      message: 'Extraction failed unexpectedly.',
      status: 502,
      code: 'EXTRACTION_UNEXPECTED_ERROR',
      context: { enquiryId: String(enquiry._id) },
    });
  }

  // 4. Persist one ExtractionVersion per provider attempt.
  //    Version numbers are per-enquiry and monotonically increasing.
  const baseVersion = await ExtractionVersion.countDocuments({
    enquiryId: enquiry._id,
  });
  const versions = [];
  for (let i = 0; i < outcome.attempts.length; i += 1) {
    const a = outcome.attempts[i];
    const v = await ExtractionVersion.create({
      enquiryId: enquiry._id,
      version: baseVersion + i + 1,
      provider: a.provider,
      model: a.model || a.provider,
      rawOutput: a.rawOutput,
      parsedOutput: a.parsed,
      state: a.state,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      durationMs: a.durationMs,
    });
    versions.push(v);
  }

  // 5/6. Update the enquiry based on the outcome.
  if (outcome.state === 'completed' && outcome.parsed) {
    // Success — copy the validated model output into effectiveExtraction.
    // We do NOT touch humanOverrides (Phase 6/7 owns that).
    enquiry.effectiveExtraction = {
      company: outcome.parsed.company ?? null,
      contactName: outcome.parsed.contactName ?? null,
      contactEmail: outcome.parsed.contactEmail ?? null,
      serviceLine: outcome.parsed.serviceLine ?? 'other',
      budget: outcome.parsed.budget ?? { raw: '', qualifier: 'unknown' },
      timeline: outcome.parsed.timeline ?? { raw: '' },
      summary: outcome.parsed.summary ?? '',
      projectCount: outcome.parsed.projectCount ?? 1,
      additionalProjectNote: outcome.parsed.additionalProjectNote ?? null,
    };
    enquiry.isGenuineProjectEnquiry = Boolean(outcome.parsed.isGenuineProjectEnquiry);

    // Phase 4: compute deterministic priority from the effective extraction.
    // Per Architechure.md §4 Flow A, scoring runs AFTER extraction persists
    // effectiveExtraction and BEFORE enquiry.save(). This keeps priority
    // derived from the same effective values the operator sees, and makes
    // re-scoring trivial (Phase 6 human edits will call the same path).
    const priority = applyPriorityToEnquiry(enquiry);

    enquiry.extractionState = 'completed';
    await enquiry.save();

    logger.info('extractionService: completed', {
      enquiryId: String(enquiry._id),
      provider: outcome.provider,
      model: outcome.model,
      versionCount: versions.length,
      isGenuineProjectEnquiry: enquiry.isGenuineProjectEnquiry,
      priorityLevel: priority.level,
      priorityScore: priority.score,
      durationMs: outcome.durationMs,
    });
  } else {
    // Failure — mark the enquiry failed but do NOT overwrite any prior
    // effectiveExtraction. If there was no prior success, the default
    // empty effectiveExtraction remains (which is fine — the operator
    // sees extractionState='failed' and can retry).
    enquiry.extractionState = 'failed';
    await enquiry.save();

    logger.warn('extractionService: failed', {
      enquiryId: String(enquiry._id),
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      attempts: outcome.attempts.length,
      durationMs: outcome.durationMs,
    });
  }

  return { enquiry, versions, outcome };
}

/**
 * List all extraction versions for an enquiry, ordered by version number.
 *
 * @param {string} enquiryId
 * @returns {Promise<import('../models/ExtractionVersion.js').default[]>}
 * @throws {AppError} 400 on invalid id; 404 if enquiry does not exist.
 */
export async function listExtractions(enquiryId) {
  if (!enquiryId || !/^[a-fA-F0-9]{24}$/.test(String(enquiryId))) {
    throw new AppError({
      message: 'Invalid enquiry id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }
  const exists = await Enquiry.exists({ _id: enquiryId });
  if (!exists) {
    throw new AppError({
      message: `Enquiry ${enquiryId} not found.`,
      status: 404,
      code: 'NOT_FOUND',
    });
  }
  return ExtractionVersion.find({ enquiryId })
    .sort({ version: 1 })
    .lean()
    .exec();
}

export default { runExtraction, listExtractions };
