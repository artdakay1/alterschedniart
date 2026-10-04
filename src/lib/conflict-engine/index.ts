// src/lib/conflict-engine/index.ts
// Single source of truth for AlterSched schedule validation.
// Pure TypeScript engine — no database or React dependencies.

import type {
  ScheduleEntryInput,
  ScheduleContext,
  Violation,
} from './types.ts';
import { checkHardRules } from './rules/hard-rules.ts';
import { checkSoftRules } from './rules/soft-rules.ts';

export * from './types.ts';
export * from './utils.ts';
export * from './time-slots.ts';
export { checkHardRules } from './rules/hard-rules.ts';
export { checkSoftRules, MAX_DAILY_HOURS } from './rules/soft-rules.ts';

/**
 * Runs the deterministic conflict engine against a candidate set of schedule entries.
 * Returns an array of hard violations (blocking) and soft advisories (warnings).
 *
 * @param entries Schedule entries to validate
 * @param context Academic context containing rooms, subjects, instructors, blocks, and fixed constraints
 */
export function checkSchedule(
  entries: ScheduleEntryInput[],
  context: ScheduleContext
): Violation[] {
  if (!entries || entries.length === 0) {
    return [];
  }

  const hardViolations = checkHardRules(entries, context);
  const softViolations = checkSoftRules(entries, context);

  return [...hardViolations, ...softViolations];
}
