/**
 * Re-extraction service — Phase 7.
 *
 * Source-of-truth: Rules.md §11 ("Re-Extraction Rules"), Architechure.md §4
 * Flow D ("Re-extraction"), Architechure.md §7 ("Effective Value Resolution"),
 * PRD.md FR-09 ("Re-extraction").
 *
 * The critical invariant (Phase 7 objective):
 *
 *   A new model extraction MUST NEVER silently destroy an existing
 *   human override.
 *
 * Re-extraction flow (Architechure.md §4 Flow D):
 *
 *   User clicks Re-extract
 *      ↓
 *   POST /api/enquiries/:id/re-extract
 *      ↓
 *   Create new extraction version
 *      ↓
 *   Grok → failure → Gemini
 *      ↓
 *   Validate new extraction
 *      ↓
 *   Compare with human overrides  ← conflictService.detectConflicts
 *      ↓
 *   Keep human-controlled fields  ← reapplyOverrides (existing Phase 6 logic)
 *      ↓
 *   Expose model conflicts         ← returned in API response
 *      ↓
 *   Recalculate priority           ← applyPriorityToEnquiry (existing Phase 4)
 *      ↓
 *   Return effective enquiry + conflicts
 *
 * ARCHITECTURAL BOUNDARIES (Phase 7):
 *   - Does NOT create a second LLM implementation. Reuses the existing
 *     `extractionService.runExtraction` which in turn reuses `llmService`
 *     (Groq → Gemini fallback) and the existing extraction schema.
 *   - Does NOT modify originalText, receivedAt, sender, status, batchId.
 *   - Does NOT delete or overwrite historical ExtractionVersion rows
 *     (Rules.md §14: "Extraction versions are append-only").
 *   - Does NOT clear or modify existing human overrides. The override
 *     remains authoritative until the operator explicitly accepts the
 *     new model value via POST /fields/:field/accept-model.
 *   - Does NOT compute priority directly. Reuses `applyPriorityToEnquiry`
 *     from Phase 4 scoringService.
 *   - The client cannot specify provider, model, version, or timestamp —
 *     the server controls all of these.
 *
 * FAILURE BEHAVIOR (Rules.md §12):
 *   If re-extraction fails:
 *     - existing model extraction remains intact (modelExtraction unchanged)
 *     - existing extraction versions remain intact (history append-only)
 *     - human overrides remain intact
 *     - effective extraction remains intact
 *     - priority remains intact
 *     - extractionState transitions to 'failed'
 *   The operator can retry. A failed re-extraction does NOT destroy
 *   successful previous extraction data.
 *
 * If Groq fails and Gemini succeeds, the successful Gemini version is
 * preserved (with provider metadata) and used as the new model extraction.
 */
import { runExtraction } from './extractionService.js';
import { detectConflicts } from './conflictService.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

/**
 * Re-run LLM extraction for an enquiry, preserving all human overrides.
 *
 * Steps:
 *   1. Validate enquiry id (400 INVALID_ID on bad format).
 *   2. Call existing `extractionService.runExtraction(enquiryId)` which:
 *        - Loads the enquiry (404 NOT_FOUND if missing).
 *        - Refuses if already 'processing' (409 ALREADY_PROCESSING).
 *        - Transitions extractionState to 'processing'.
 *        - Calls llmService.extractWithFallback(originalText).
 *        - Persists one ExtractionVersion per provider attempt (append-only).
 *        - On success: updates modelExtraction + effectiveExtraction
 *          (reapplyOverrides preserves existing human overrides) +
 *          recalculates priority via applyPriorityToEnquiry.
 *        - On failure: marks extractionState='failed'; does NOT touch
 *          modelExtraction, effectiveExtraction, humanOverrides, or priority.
 *   3. On success: detect conflicts between active human overrides and
 *      the new model output. Return them in the response so the UI can
 *      surface the operator decision (keep confirmed / accept new model).
 *   4. On failure: return empty conflicts (no new model output to compare).
 *
 * The returned `enquiry` is the persisted document (reloaded by
 * extractionService after the save). The `versions` array is the new
 * ExtractionVersion rows created by this re-extraction. The `outcome`
 * is the structured LLM outcome. The `conflicts` array is the list of
 * fields where the new model value differs from an active human override.
 *
 * @param {string} enquiryId
 * @returns {Promise<{
 *   enquiry: import('../models/Enquiry.js').default,
 *   versions: import('../models/ExtractionVersion.js').default[],
 *   outcome: import('./llm/llmService.js').LlmOutcome,
 *   conflicts: import('./conflictService.js').FieldConflict[],
 * }>}
 * @throws {AppError} 400 INVALID_ID; 404 NOT_FOUND; 409 ALREADY_PROCESSING;
 *                     502 EXTRACTION_UNEXPECTED_ERROR.
 */
export async function reExtract(enquiryId) {
  // 1. Validate id format BEFORE calling extractionService so we return
  //    a clean 400 rather than relying on extractionService's regex.
  if (!enquiryId || !/^[a-fA-F0-9]{24}$/.test(String(enquiryId))) {
    throw new AppError({
      message: 'Invalid enquiry id.',
      status: 400,
      code: 'INVALID_ID',
    });
  }

  // 2. Delegate to the existing extractionService. This reuses the entire
  //    Groq → Gemini fallback chain, the ExtractionVersion append-only
  //    persistence, the reapplyOverrides logic, and the priority
  //    recalculation. Phase 7 does NOT duplicate any of this.
  const { enquiry, versions, outcome } = await runExtraction(enquiryId);

  // 3. Detect conflicts between active human overrides and the new model
  //    output. Only populated on success — on failure, outcome.parsed is
  //    null and conflicts is empty.
  let conflicts = [];
  if (outcome.state === 'completed' && outcome.parsed) {
    conflicts = detectConflicts(enquiry.humanOverrides, outcome.parsed);

    logger.info('reExtractService: completed', {
      enquiryId: String(enquiry._id),
      provider: outcome.provider,
      model: outcome.model,
      newVersionCount: versions.length,
      conflictCount: conflicts.length,
      conflictFields: conflicts.map((c) => c.field),
      durationMs: outcome.durationMs,
    });
  } else {
    logger.warn('reExtractService: failed — existing data preserved', {
      enquiryId: String(enquiry._id),
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      attempts: outcome.attempts.length,
      durationMs: outcome.durationMs,
    });
  }

  return { enquiry, versions, outcome, conflicts };
}

export default { reExtract };
