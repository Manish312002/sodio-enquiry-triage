/**
 * Extraction schema (zod) — the contract every LLM provider must satisfy.
 *
 * Source-of-truth: Rules.md §5 (extraction fields), §6 (budget), §7 (timeline).
 *
 * Phase 0: the schema exists so the contract is locked in early. Phase 3 will
 * use it to validate provider output before persisting.
 *
 * SECURITY NOTE: This schema intentionally does NOT contain a `priority` field.
 * Priority is computed by scoringService.js (Phase 4). The LLM is an extractor,
 * not an authority (Rules.md §3).
 */
import { z } from 'zod';
import { SERVICE_LINES, BUDGET_QUALIFIERS } from '../../utils/constants.js';

export const budgetSchema = z.object({
  raw: z.string().default(''),
  currency: z.string().nullable().default(null),
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  qualifier: z.enum(BUDGET_QUALIFIERS).default('unknown'),
}).strict();

export const timelineSchema = z.object({
  raw: z.string().default(''),
  // Open shape for normalized markers (urgency, duration, period) — filled
  // opportunistically without ever inventing dates (Rules.md §7).
  normalized: z.record(z.unknown()).nullable().default(null),
}).strict();

export const extractionSchema = z.object({
  company: z.string().nullable().default(null),
  contactName: z.string().nullable().default(null),
  contactEmail: z.string().email().nullable().or(z.literal('')).default(null),
  serviceLine: z.enum(SERVICE_LINES).default('other'),
  budget: budgetSchema.default({ raw: '', qualifier: 'unknown' }),
  timeline: timelineSchema.default({ raw: '' }),
  summary: z.string().default(''),
  isGenuineProjectEnquiry: z.boolean().default(false),

  // Recommended additional fields (PRD.md §5 FR-03).
  confidence: z.number().min(0).max(1).nullable().default(null),
  projectCount: z.number().int().min(1).default(1),
  additionalProjectNote: z.string().nullable().default(null),
  isModelInstructionAttempt: z.boolean().default(false),
}).strict();

/** @typedef {z.infer<typeof extractionSchema>} Extraction */
