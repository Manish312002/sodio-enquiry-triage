/**
 * Deterministic priority scoring service.
 *
 *
 *
 * scope:
 *   - Compute a deterministic priority score from the *effective* structured
 *     extraction fields (NOT from the raw enquiry text).
 *   - Produce an explainable result: { score, level, reasons }.
 *   - Provide an `applyPriorityToEnquiry` mutator used by extractionService
 *     after a successful extraction, and a `recalculatePriorityForEnquiry`
 *     loader used by the recalculate-priority endpoint (and later
 *     human-edit flows).
 *
 * Architectural boundaries:
 *   - The LLM is an extractor, NOT an authority. Priority is computed by
 *     application code only. scoringService reads effectiveExtraction; it
 *     NEVER reads originalText and NEVER consults any LLM field that claims
 *     to be a priority.
 *   - `computePriority` is PURE: same input → same output, no I/O, no
 *     side-effects, no Date.now() drift, no Math.random().
 *   - `computePriority` does NOT use zod. Defensive plain-JS validation
 *     handles null / missing / malformed input. The authorisation
 *     explicitly forbids introducing zod here; existing zod usage in Phase
 *     0/1/3 (env, controller, extractionSchema, validateRequest) is left
 *     untouched.
 *   - MongoDB access is confined to `recalculatePriorityForEnquiry`, which
 *     delegates to Enquiry + applyPriorityToEnquiry. `computePriority`
 *     itself has zero DB coupling so it can be unit-tested in isolation.
 *
 * Scoring rule summary (mirrors — do NOT invent alternatives):
 *
 *   base 0
 *   genuine project         +4
 *   not genuine             -5
 *   budget ≥ 100,000        +4   (major currency only: USD, GBP, EUR)
 *   budget 25,000–99,999    +3   (major currency only)
 *   budget < 25,000         +1   (major currency only)
 *   budget flexible/tbd     +1   (qualifier-based; no fabricated number)
 *   no budget 0
 *   timeline immediate      +3   (ASAP / today / next week / ≤1 week)
 *   timeline ≤ 6 weeks      +3
 *   timeline 1–3 months     +2
 *   timeline longer/Q1/3m+  +1
 *   timeline unknown 0
 *   service fit (bespoke)   +1   (ai|blockchain|web|mobile|game)
 *   service other/unclear 0
 *   existing client         +1   (keyword signal in summary/notes)
 *
 *   high score ≥ 8
 *   medium score 4–7
 *   low score ≤ 3
 *
 * Currency caution closing note):
 *   "For currencies with very different purchasing power, do not pretend
 *    numeric thresholds are economically equivalent."
 *   We only apply numeric thresholds when the currency is unambiguously a
 *   "major" currency (USD, GBP, EUR). For INR (lakhs), unknown currencies,
 *   or missing currency, we fall back to the conservative non-numeric score
 *   (+1 when a budget is present) so a spam message with a large-looking
 *   number cannot become high priority simply because the model extracted
 *   a budget figure.
 */
import Enquiry from '../models/Enquiry.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

// --- Public scoring thresholds -------------------------------

export const PRIORITY_THRESHOLDS = Object.freeze({
  HIGH_MIN: 8,
  MEDIUM_MIN: 4,
  // low: score <= 3
});

export const PRIORITY_LEVELS = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});

/**
 * Currencies for which the numeric thresholds in §9 are economically
 * meaningful. INR (lakhs), IDR, etc. are intentionally excluded —
 * explicitly warns against pretending numeric thresholds
 * are equivalent across currencies with very different purchasing power.
 *
 * Matching is case-insensitive. We accept both ISO codes (USD, GBP, EUR)
 * and common currency symbols ($, £, €).
 */
const MAJOR_CURRENCIES = new Set(['USD', 'GBP', 'EUR', '$', '£', '€']);

/**
 * Service lines that count as a positive service-fit signal:
 * "AI, blockchain, bespoke web/platform, mobile, or game project: +1").
 * `other` yields 0.
 */
const BESPOKE_SERVICE_LINES = new Set(['ai', 'blockchain', 'web', 'mobile', 'game']);

// --- Internal helpers ------------------------------------------------------

/**
 * Coerce any value to a finite number, or return null.
 * Rejects NaN, Infinity, non-numeric strings, etc.
 *
 * @param {unknown} v
 * @returns {number|null}
 */
function toFiniteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // Allow strings like "40000", "40,000", "40 000". Reject "flexible", "".
    const cleaned = v.replace(/[,\s]/g, '');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Determine whether a currency string/symbol is a "major" currency for which
 * the numeric budget thresholds in are economically meaningful.
 *
 * @param {unknown} currency
 * @returns {boolean}
 */
function isMajorCurrency(currency) {
  if (typeof currency !== 'string') return false;
  const upper = currency.trim().toUpperCase();
  if (upper === '') return false;
  // Direct ISO match ($, £, € already uppercased = themselves)
  if (MAJOR_CURRENCIES.has(upper)) return true;
  if (MAJOR_CURRENCIES.has(currency.trim())) return true;
  // Common unambiguous spellings
  if (upper === 'US$' || upper === 'USD' || upper === 'US DOLLAR' || upper === 'US DOLLARS') return true;
  if (upper === 'GBP' || upper === '£' || upper === 'POUND' || upper === 'POUNDS' || upper === 'STERLING') return true;
  if (upper === 'EUR' || upper === '€' || upper === 'EURO' || upper === 'EUROS') return true;
  return false;
}

/**
 * Detect whether a currency string refers to Indian Rupees (lakhs convention).
 * Used to *avoid* applying numeric thresholds to a currency where 100,000 means
 * something very different economically than 100,000 USD.
 *
 * @param {unknown} currency
 * @returns {boolean}
 */
function isInrLike(currency) {
  if (typeof currency !== 'string') return false;
  const upper = currency.trim().toUpperCase();
  return upper === 'INR' || upper === '₹' || upper === 'RS' || upper === 'RUPEE' || upper === 'RUPEES';
}

/**
 * Lowercase a string defensively. Returns '' for non-strings.
 *
 * @param {unknown} v
 * @returns {string}
 */
function safeLower(v) {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

/**
 * Extract a usable numeric magnitude from a budget object.
 * Returns { amount, useNumeric } where:
 *   - amount: a representative number (max if range, else min) or null
 *   - useNumeric: true only when the currency is a major currency AND
 *     we actually have a number. For INR-like or unknown currencies we
 *     return useNumeric=false so the caller falls back to the conservative
 *     non-numeric score closing note).
 *
 * @param {object|null|undefined} budget
 * @returns {{amount: number|null, useNumeric: boolean, currencyKnown: boolean}}
 */
function resolveBudgetMagnitude(budget) {
  if (!budget || typeof budget !== 'object') {
    return { amount: null, useNumeric: false, currencyKnown: false };
  }
  const currency = budget.currency;
  const min = toFiniteNumber(budget.min);
  const max = toFiniteNumber(budget.max);
  // Prefer max (upper bound of a range) as the representative magnitude,
  // matching the spirit of §9 ("explicit budget ≥ 100,000").
  const amount = max != null ? max : min;
  const currencyKnown = isMajorCurrency(currency) || isInrLike(currency);
  const useNumeric = isMajorCurrency(currency) && amount != null;
  return { amount, useNumeric, currencyKnown };
}

/**
 * Score the budget dimension .
 *
 * Returns { score, reasons }.
 *
 * @param {object|null|undefined} budget
 * @returns {{score: number, reasons: string[]}}
 */
function scoreBudget(budget) {
  const reasons = [];
  if (!budget || typeof budget !== 'object') {
    return { score: 0, reasons };
  }
  const qualifier = typeof budget.qualifier === 'string' ? budget.qualifier : 'unknown';
  const { amount, useNumeric, currencyKnown } = resolveBudgetMagnitude(budget);

  if (useNumeric && amount != null) {
    // Major currency with a real number — apply the numeric thresholds.
    if (amount >= 100_000) {
      reasons.push(`budget: explicit ≥ 100,000 in major currency (${amount})`);
      return { score: 4, reasons };
    }
    if (amount >= 25_000) {
      reasons.push(`budget: explicit 25,000–99,999 in major currency (${amount})`);
      return { score: 3, reasons };
    }
    reasons.push(`budget: explicit < 25,000 in major currency (${amount})`);
    return { score: 1, reasons };
  }

  // Non-numeric budget signals — apply the conservative +1 bucket.
  if (qualifier === 'flexible' || qualifier === 'tbd') {
    reasons.push(`budget: ${qualifier} (no fabricated numeric amount)`);
    return { score: 1, reasons };
  }
  if (qualifier === 'range' || qualifier === 'exact') {
    // Range/exact qualifier but no usable number, OR currency is not major
    // (e.g. INR lakhs).: "use the numeric value only when the
    // currency/scale is sufficiently clear; otherwise award the conservative
    // non-numeric score." So +1, never the numeric thresholds.
    if (currencyKnown && !useNumeric) {
      reasons.push(`budget: present in non-major currency (conservative +1)`);
    } else {
      reasons.push(`budget: ${qualifier} qualifier with no usable major-currency number (conservative +1)`);
    }
    return { score: 1, reasons };
  }
  if (qualifier === 'unknown') {
    // A budget.raw string may still be present even if qualifier is unknown
    // (model was unsure). If raw is non-empty, treat as "budget present,
    // unstructured" → +1. Otherwise 0.
    if (typeof budget.raw === 'string' && budget.raw.trim() !== '') {
      reasons.push('budget: present but unstructured (conservative +1)');
      return { score: 1, reasons };
    }
    return { score: 0, reasons };
  }
  return { score: 0, reasons };
}

/**
 * Score the timeline dimension / §9.
 *
 * The extraction layer stores `timeline.normalized` as an open Mixed object
 * so the model can opportunistically mark urgency/duration/period without us
 * inventing dates. We read those markers when present; otherwise we fall back
 * to scanning `timeline.raw` for keyword signals.
 *
 * Returns { score, reasons }.
 *
 * @param {object|null|undefined} timeline
 * @returns {{score: number, reasons: string[]}}
 */
function scoreTimeline(timeline) {
  const reasons = [];
  if (!timeline || typeof timeline !== 'object') {
    return { score: 0, reasons };
  }
  const raw = safeLower(timeline.raw);
  const normalized =
    timeline.normalized && typeof timeline.normalized === 'object' ? timeline.normalized : null;

  // 1) Prefer explicit normalised markers if the model provided them.
  if (normalized) {
    const urgency = safeLower(normalized.urgency);
    const durationWeeks = toFiniteNumber(normalized.durationWeeks);
    const durationMonths = toFiniteNumber(normalized.durationMonths);
    const period = safeLower(normalized.period);

    if (urgency === 'immediate' || urgency === 'asap' || urgency === 'urgent') {
      reasons.push(`timeline: immediate/ASAP (urgency=${urgency})`);
      return { score: 3, reasons };
    }
    if (durationWeeks != null && durationWeeks >= 0 && durationWeeks <= 6) {
      reasons.push(`timeline: ≤ 6 weeks (durationWeeks=${durationWeeks})`);
      return { score: 3, reasons };
    }
    if (durationMonths != null) {
      if (durationMonths >= 1 && durationMonths <= 3) {
        reasons.push(`timeline: 1–3 months (durationMonths=${durationMonths})`);
        return { score: 2, reasons };
      }
      if (durationMonths > 3) {
        reasons.push(`timeline: > 3 months (durationMonths=${durationMonths})`);
        return { score: 1, reasons };
      }
    }
    if (period === 'relative' || period === 'quarter' || period === 'longer') {
      // Ambiguous relative period — score 1 unless raw provides a sharper signal.
      // Fall through to raw scan; if raw also yields nothing, return 1.
    }
  }

  // 2) Fall back to keyword scan of the raw timeline text.
  if (raw === '') {
    return { score: 0, reasons };
  }

  // Immediate signals.
  if (/\b(asap|today|tonight|right away|immediately|immediate|urgent|this week|next week)\b/.test(raw)) {
    reasons.push(`timeline: immediate signal in raw ("${raw.slice(0, 40)}")`);
    return { score: 3, reasons };
  }
  // ≤ 6 weeks.
  const weekMatch = raw.match(/(\d+)\s*(?:wk|week|weeks)/);
  if (weekMatch) {
    const w = Number(weekMatch[1]);
    if (w >= 0 && w <= 6) {
      reasons.push(`timeline: ≤ 6 weeks (raw=${w}w)`);
      return { score: 3, reasons };
    }
    if (w > 6 && w <= 12) {
      reasons.push(`timeline: 1–3 months (raw=${w}w)`);
      return { score: 2, reasons };
    }
    if (w > 12) {
      reasons.push(`timeline: > 3 months (raw=${w}w)`);
      return { score: 1, reasons };
    }
  }
  // 1–3 months.
  const monthMatch = raw.match(/(\d+)\s*(?:mo|month|months)/);
  if (monthMatch) {
    const m = Number(monthMatch[1]);
    if (m >= 1 && m <= 3) {
      reasons.push(`timeline: 1–3 months (raw=${m}mo)`);
      return { score: 2, reasons };
    }
    if (m > 3) {
      reasons.push(`timeline: > 3 months (raw=${m}mo)`);
      return { score: 1, reasons };
    }
  }
  // Longer / quarter / 3+ months keywords.
  if (/\b(q[1-4]|quarter|next year|next quarter|3\+ months|months\+)\b/.test(raw)) {
    reasons.push(`timeline: longer/Q1 signal in raw`);
    return { score: 1, reasons };
  }
  // "before <festival>" type relative markers — example
  // ("before Diwali"). Treat as relative → +1.
  if (/\b(before|by|prior to)\b/.test(raw)) {
    reasons.push(`timeline: relative marker in raw ("${raw.slice(0, 40)}")`);
    return { score: 1, reasons };
  }

  // Raw text present but no recognisable signal.
  reasons.push(`timeline: present but no recognisable signal`);
  return { score: 0, reasons };
}

/**
 * Score the service-fit dimension .
 *
 * Returns { score, reasons }.
 *
 * @param {string|null|undefined} serviceLine
 * @returns {{score: number, reasons: string[]}}
 */
function scoreServiceFit(serviceLine) {
  const reasons = [];
  const sl = typeof serviceLine === 'string' ? serviceLine.toLowerCase() : 'other';
  if (BESPOKE_SERVICE_LINES.has(sl)) {
    reasons.push(`serviceLine: ${sl} (bespoke project signal)`);
    return { score: 1, reasons };
  }
  // 'other' or anything unexpected → 0
  return { score: 0, reasons };
}

/**
 * Score the relationship / follow-up dimension .
 *
 * We scan the summary and any additional-project note for explicit
 * follow-up / existing-client language. This is intentionally narrow —
 * it only fires on clear signals, not on every polite greeting.
 *
 * Returns { score, reasons }.
 *
 * @param {object} opts
 * @param {string|null|undefined} opts.summary
 * @param {string|null|undefined} opts.additionalProjectNote
 */
function scoreRelationship({ summary, additionalProjectNote } = {}) {
  const reasons = [];
  const haystack = `${safeLower(summary)} ${safeLower(additionalProjectNote)}`;
  if (haystack.trim() === '') {
    reasons.push('relationship: no summary/note to evaluate');
    return { score: 0, reasons };
  }

  const followUpSignal =
    /\b(follow(?:ing)?[- ]?up|following up on my earlier|as discussed|as we discussed|our previous|our earlier|existing client|repeat client|per our call|per our conversation|continuing our|trusted partner|we've worked before|we have worked before|onboarding again)\b/;
  if (followUpSignal.test(haystack)) {
    reasons.push('relationship: explicit follow-up / existing-client signal (+1)');
    return { score: 1, reasons };
  }
  // Always emit a reason for audit clarity — even when there is no signal,
  // the operator should see that the relationship dimension was evaluated.
  reasons.push('relationship: no explicit follow-up / existing-client signal');
  return { score: 0, reasons };
}

/**
 * Map a numeric score to a priority level thresholds.
 *
 * @param {number} score
 * @returns {'high'|'medium'|'low'}
 */
export function scoreToLevel(score) {
  const n = toFiniteNumber(score);
  if (n == null) return PRIORITY_LEVELS.LOW;
  if (n >= PRIORITY_THRESHOLDS.HIGH_MIN) return PRIORITY_LEVELS.HIGH;
  if (n >= PRIORITY_THRESHOLDS.MEDIUM_MIN) return PRIORITY_LEVELS.MEDIUM;
  return PRIORITY_LEVELS.LOW;
}

// --- Public API ------------------------------------------------------------

/**
 * Compute a deterministic priority from the effective extraction fields.
 *
 * PURE FUNCTION — no I/O, no side-effects, no zod. Same input always
 * produces the same output.
 *
 * @param {object|null|undefined} effectiveExtraction The enquiry's
 *   `effectiveExtraction` subdocument (or any object shaped like it).
 *   May be null/undefined/empty — handled defensively.
 * @param {boolean|null|undefined} isGenuineProjectEnquiry
 * @returns {{score: number, level: 'high'|'medium'|'low', reasons: string[]}}
 */
export function computePriority(effectiveExtraction, isGenuineProjectEnquiry) {
  const reasons = [];
  let score = 0;

  // --- Project legitimacy --------------------------------
  // isGenuineProjectEnquiry is stored as Mixed on the Enquiry model, so we
  // must defend against strings, undefined, etc. Only an explicit true/false
  // counts; anything else is treated as "unknown" (no score, no penalty).
  const genuine =
    isGenuineProjectEnquiry === true ||
    isGenuineProjectEnquiry === 'true' ||
    (typeof isGenuineProjectEnquiry === 'string' &&
      isGenuineProjectEnquiry.toLowerCase() === 'true');
  const notGenuine =
    isGenuineProjectEnquiry === false ||
    isGenuineProjectEnquiry === 'false' ||
    (typeof isGenuineProjectEnquiry === 'string' &&
      isGenuineProjectEnquiry.toLowerCase() === 'false');

  if (genuine) {
    score += 4;
    reasons.push('legitimacy: genuine project enquiry (+4)');
  } else if (notGenuine) {
    score += -5;
    reasons.push('legitimacy: not a genuine project enquiry (-5)');
  } else {
    reasons.push('legitimacy: unknown (no score, no penalty)');
  }

  // Defensive extraction object access.
  const eff =
    effectiveExtraction && typeof effectiveExtraction === 'object' ? effectiveExtraction : {};

  // --- Budget -----------------------------------------
  const budget = scoreBudget(eff.budget);
  score += budget.score;
  reasons.push(...budget.reasons);

  // --- Timeline ---------------------------------------
  const timeline = scoreTimeline(eff.timeline);
  score += timeline.score;
  reasons.push(...timeline.reasons);

  // --- Service fit ----------------------------------------
  const service = scoreServiceFit(eff.serviceLine);
  score += service.score;
  reasons.push(...service.reasons);

  // --- Relationship / follow-up --------------------------
  const relationship = scoreRelationship({
    summary: eff.summary,
    additionalProjectNote: eff.additionalProjectNote,
  });
  score += relationship.score;
  reasons.push(...relationship.reasons);

  // Clamp: score is allowed to go negative (e.g. -5 for spam), but the level
  // thresholds treat any score ≤ 3 as 'low' so a negative score still maps to
  // 'low' correctly. We do not clamp the numeric value itself — the audit
  // trail should show the real computed number.
  const level = scoreToLevel(score);

  return { score, level, reasons };
}

/**
 * Apply computed priority to a Mongoose Enquiry document in place.
 *
 * Used by extractionService after a successful extraction, and by the
 * recalculate-priority endpoint. The caller is responsible for calling
 * `enquiry.save()`.
 *
 * This function does NOT throw on malformed extraction — it computes a
 * conservative priority and records the reasons. A failed/partial extraction
 * still yields a deterministic, explainable priority (typically 'low').
 *
 * @param {import('../models/Enquiry.js').default} enquiry A Mongoose Enquiry
 *   document (must have effectiveExtraction + isGenuineProjectEnquiry
 *   populated, even if to defaults).
 * @returns {{score: number, level: 'high'|'medium'|'low', reasons: string[]}}
 *   The priority that was applied (also returned for logging / response).
 */
export function applyPriorityToEnquiry(enquiry) {
  if (!enquiry) {
    throw new Error('applyPriorityToEnquiry: enquiry document is required');
  }
  const priority = computePriority(enquiry.effectiveExtraction, enquiry.isGenuineProjectEnquiry);
  enquiry.priority = {
    level: priority.level,
    score: priority.score,
    reasons: priority.reasons,
  };
  return priority;
}

/**
 * Recalculate and persist priority for a single enquiry.
 *
 * Loads the enquiry by id, applies `applyPriorityToEnquiry`, and saves.
 * Used by the POST /api/enquiries/:id/recalculate-priority endpoint and,
 * in later phases, by the human-edit flow: "immediately
 * recalculate priority" after a correction).
 *
 * This is the ONLY function in scoringService that touches MongoDB.
 *
 * @param {string} enquiryId
 * @returns {Promise<{enquiry: import('../models/Enquiry.js').default, priority: {score: number, level: 'high'|'medium'|'low', reasons: string[]}}>}
 * @throws {AppError} 400 on invalid id; 404 if enquiry not found.
 */
export async function recalculatePriorityForEnquiry(enquiryId) {
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

  const priority = applyPriorityToEnquiry(enquiry);
  await enquiry.save();

  logger.info('scoringService: priority recalculated', {
    enquiryId: String(enquiry._id),
    level: priority.level,
    score: priority.score,
    reasonCount: priority.reasons.length,
  });

  return { enquiry, priority };
}

export default {
  computePriority,
  applyPriorityToEnquiry,
  recalculatePriorityForEnquiry,
  scoreToLevel,
  PRIORITY_THRESHOLDS,
  PRIORITY_LEVELS,
};
