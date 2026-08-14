/**
 * Shared domain constants.
 *
 * IMPORTANT: priority thresholds and scoring rules live in scoringService.js.
 * This file only holds enumerated values used by multiple modules.
 */

/** Allowed service lines. */
export const SERVICE_LINES = Object.freeze([
  'ai',
  'blockchain',
  'web',
  'mobile',
  'game',
  'other',
]);

/** Allowed enquiry statuses. */
export const STATUSES = Object.freeze(['new', 'contacted', 'qualified', 'dropped']);

/** Allowed priority levels. */
export const PRIORITIES = Object.freeze(['high', 'medium', 'low']);

/** Allowed extraction states. */
export const EXTRACTION_STATES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'failed',
]);

/** Allowed budget qualifiers. */
export const BUDGET_QUALIFIERS = Object.freeze([
  'exact',
  'range',
  'flexible',
  'tbd',
  'unknown',
]);

/** Allowed batch job statuses. */
export const BATCH_STATUSES = Object.freeze([
  'processing',
  'completed',
  'completed_with_errors',
]);

/** Allowed enquiry sources. */
export const ENQUIRY_SOURCES = Object.freeze(['paste', 'file']);

/** Application version (single source of truth, mirrored in health endpoint). */
export const APP_VERSION = '0.1.0';
