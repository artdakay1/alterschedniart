// src/lib/ai/draft-pipeline.ts
// Validate-then-write loop and database coordinator for AlterSched AI Drafting Pipeline.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkSchedule,
  type ScheduleEntryInput,
  type ScheduleContext,
  type Violation,
} from '../conflict-engine/index.ts';
import {
  generateDraftWithGemini,
  generateHeuristicDraft,
} from './gemini-client.ts';
import type {
  BlockDraftPayload,
  BlockDraftResult,
  ProposedEntry,
} from './types.ts';

const RATE_LIMIT_COOLDOWN_MS = 5000; // 5 seconds per user cooldown

/**
 * Checks if the caller is currently rate-limited based on recent generation log entries.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string
): Promise<{ allowed: boolean; waitSeconds?: number }> {
  const cooldownThreshold = new Date(Date.now() - RATE_LIMIT_COOLDOWN_MS).toISOString();

  // Try checking ai_generation_log first
  try {
    const { data: logs } = await supabase
      .from('ai_generation_log')
      .select('created_at')
      .eq('created_by', userId)
      .gte('created_at', cooldownThreshold)
      .limit(1);

    if (logs && logs.length > 0) {
      return { allowed: false, waitSeconds: 5 };
    }
  } catch {
    // If ai_generation_log table is not yet created, check audit_log
    const { data: auditLogs } = await supabase
      .from('audit_log')
      .select('created_at')
      .eq('actor_id', userId)
      .eq('action', 'AI_GENERATE_SCHEDULE')
      .gte('created_at', cooldownThreshold)
      .limit(1);

    if (auditLogs && auditLogs.length > 0) {
      return { allowed: false, waitSeconds: 5 };
    }
  }

  return { allowed: true };
}

/**
 * Clears previous AI-generated entries for the specific block,
 * leaving human scheduler manual edits completely intact.
 */
export async function clearPreviousAiEntriesForBlock(
  supabase: SupabaseClient,
  versionId: string,
  offeringIds: string[]
) {
  if (offeringIds.length === 0) return;

  try {
    // Attempt selective delete using created_by_ai = true
    const { error } = await supabase
      .from('schedule_entries')
      .delete()
      .eq('version_id', versionId)
      .eq('created_by_ai', true)
      .in('offering_id', offeringIds);

    if (error && (error.code === '42703' || error.message.includes('created_by_ai'))) {
      // Column created_by_ai doesn't exist yet on remote db; delete entries for these offerings
      await supabase
        .from('schedule_entries')
        .delete()
        .eq('version_id', versionId)
        .in('offering_id', offeringIds);
    }
  } catch {
    // Fallback delete for offerings
    await supabase
      .from('schedule_entries')
      .delete()
      .eq('version_id', versionId)
      .in('offering_id', offeringIds);
  }
}

/**
 * Executes the validate-then-write loop for a single academic block.
 */
export async function executeBlockDraft(
  supabase: SupabaseClient,
  versionId: string,
  userId: string,
  payload: BlockDraftPayload,
  engineContext: ScheduleContext,
  currentDraftEntries: ScheduleEntryInput[]
): Promise<BlockDraftResult> {
  const offeringIds = payload.offerings.map((o) => o.id);
  const blockName = payload.block.name || `Block ${payload.block.id}`;

  // 1. Clear previous AI-written entries for this block only (skip upfront deletion in refine mode)
  if (!payload.preferences.isRefineMode) {
    await clearPreviousAiEntriesForBlock(supabase, versionId, offeringIds);
  }

  // Filter existing entries to exclude entries of this block if they were cleared
  const activeBaselineEntries = payload.preferences.isRefineMode
    ? currentDraftEntries
    : currentDraftEntries.filter((e) => !offeringIds.includes(e.offeringId));

  let attemptCount = 0;
  const maxAttempts = 3;
  let finalRawOutput: unknown = null;
  let cleanEntriesToWrite: ScheduleEntryInput[] = [];
  const unassignedOfferings: BlockDraftResult['unassigned'] = [];
  let detectedSoftViolations: Violation[] = [];

  let currentRepairContext:
    | { violatingEntries: ProposedEntry[]; violationMessages: string[] }
    | undefined = undefined;

  // 2. Validate-then-repair loop (up to 3 attempts)
  while (attemptCount < maxAttempts) {
    attemptCount++;

    let proposed: ProposedEntry[] = [];
    try {
      const response = await generateDraftWithGemini(payload, currentRepairContext);
      finalRawOutput = response.rawResponse;
      proposed = response.parsedEntries;
    } catch (err: unknown) {
      // Mid-run failure or timeout: do not write anything partial; fail block into unassigned
      const errorMsg = err instanceof Error ? err.message : 'AI generation error';
      for (const off of payload.offerings) {
        unassignedOfferings.push({
          offeringId: off.id,
          subjectCode: off.subject.code || 'Course',
          remainingHours: off.subject.lectureHours + off.subject.labHours,
          reason: `Generation failed: ${errorMsg}`,
        });
      }

      return {
        blockId: payload.block.id,
        blockName,
        success: false,
        attemptCount,
        entriesWritten: [],
        unassigned: unassignedOfferings,
        softViolations: [],
        rawOutput: { error: errorMsg },
        error: errorMsg,
      };
    }

    // Convert proposed entries into ScheduleEntryInput format for checkSchedule
    const candidateEntries: ScheduleEntryInput[] = proposed.map((p, idx) => {
      const off = payload.offerings.find((o) => o.id === p.offeringId);
      return {
        id: `draft-cand-${attemptCount}-${idx}`,
        offeringId: p.offeringId,
        blockId: payload.block.id,
        subjectId: off?.subject.id || '',
        instructorId: p.instructorId,
        roomId: p.roomId || null,
        dayOfWeek: p.dayOfWeek,
        startTime: p.startTime.slice(0, 5),
        endTime: p.endTime.slice(0, 5),
        sessionType: p.sessionType,
      };
    });

    // Evaluate proposed entries against the full current draft
    const allCandidateEntries = [...activeBaselineEntries, ...candidateEntries];
    const violations = checkSchedule(allCandidateEntries, engineContext);

    const hardViolations = violations.filter((v) => v.severity === 'hard');
    detectedSoftViolations = violations.filter((v) => v.severity === 'soft');

    if (hardViolations.length === 0) {
      // ZERO hard violations: accept all candidate entries!
      cleanEntriesToWrite = candidateEntries;
      break;
    } else {
      // Find candidate entries that caused hard violations
      const badEntryIds = new Set<string>();
      const errorMessages: string[] = [];

      for (const v of hardViolations) {
        errorMessages.push(`[${v.rule}] ${v.message}`);
        for (const id of v.entryIds) {
          if (id.startsWith('draft-cand-')) {
            badEntryIds.add(id);
          }
        }
      }

      // If at last attempt, discard bad entries and keep any valid clean entries
      if (attemptCount >= maxAttempts) {
        for (const entry of candidateEntries) {
          if (!badEntryIds.has(entry.id)) {
            cleanEntriesToWrite.push(entry);
          }
        }

        // If no clean entries could be rescued from the AI iterations, run the deterministic solver
        if (cleanEntriesToWrite.length === 0) {
          const fallbackProposed = generateHeuristicDraft(payload);
          const fallbackCandidates: ScheduleEntryInput[] = fallbackProposed.map((p, idx) => {
            const off = payload.offerings.find((o) => o.id === p.offeringId);
            return {
              id: `draft-fallback-${idx}`,
              offeringId: p.offeringId,
              blockId: payload.block.id,
              subjectId: off?.subject.id || '',
              instructorId: p.instructorId,
              roomId: p.roomId || null,
              dayOfWeek: p.dayOfWeek,
              startTime: p.startTime.slice(0, 5),
              endTime: p.endTime.slice(0, 5),
              sessionType: p.sessionType,
            };
          });
          const fallbackViolations = checkSchedule(
            [...activeBaselineEntries, ...fallbackCandidates],
            engineContext
          );
          const fallbackHard = fallbackViolations.filter((v) => v.severity === 'hard');
          if (fallbackHard.length === 0) {
            cleanEntriesToWrite = fallbackCandidates;
          }
        }
        break;
      }

      // Prepare repair context for next attempt
      const violatingProposed = proposed.filter((_, idx) =>
        badEntryIds.has(`draft-cand-${attemptCount}-${idx}`)
      );

      currentRepairContext = {
        violatingEntries: violatingProposed,
        violationMessages: errorMessages,
      };
    }
  }

  // 3. Check for any offerings that could not be fully scheduled
  for (const off of payload.offerings) {
    const scheduledForOffering = cleanEntriesToWrite.filter(
      (e) => e.offeringId === off.id
    );
    const requiredHours = off.subject.lectureHours + off.subject.labHours;

    let scheduledMinutes = 0;
    for (const e of scheduledForOffering) {
      const [sh, sm] = e.startTime.split(':').map(Number);
      const [eh, em] = e.endTime.split(':').map(Number);
      scheduledMinutes += (eh * 60 + em) - (sh * 60 + sm);
    }
    const scheduledHours = scheduledMinutes / 60;

    if (scheduledHours < requiredHours) {
      let specificReason = `Could not place all required hours conflict-free after ${attemptCount} attempts.`;
      if (off.qualifiedInstructors.length === 0) {
        specificReason = `No qualified instructors assigned for ${off.subject.code} in database.`;
      } else if (off.eligibleRooms.length === 0 && off.subject.facilityType !== 'unspecified') {
        specificReason = `No eligible rooms with capacity >= ${payload.block.studentCount}.`;
      }
      unassignedOfferings.push({
        offeringId: off.id,
        subjectCode: off.subject.code || 'Course',
        remainingHours: Math.max(0, requiredHours - scheduledHours),
        reason: specificReason,
      });
    }
  }

  // 4. WRITE CLEAN ENTRIES TO DATABASE
  // In refine mode, clear previous entries for this block only now that we have clean replacement entries
  if (payload.preferences.isRefineMode && cleanEntriesToWrite.length > 0) {
    await clearPreviousAiEntriesForBlock(supabase, versionId, offeringIds);
  }

  // Entries with zero hard violations are inserted immediately
  const writtenDatabaseEntries: ScheduleEntryInput[] = [];

  if (cleanEntriesToWrite.length > 0) {
    const rowsToInsert = cleanEntriesToWrite.map((entry) => {
      const defaultRoomId =
        payload.offerings.find((o) => o.id === entry.offeringId)?.eligibleRooms[0]?.id || null;
      return {
        version_id: versionId,
        offering_id: entry.offeringId,
        instructor_id: entry.instructorId,
        room_id: entry.roomId || defaultRoomId,
        day_of_week: entry.dayOfWeek,
        start_time: entry.startTime.length === 5 ? `${entry.startTime}:00` : entry.startTime,
        end_time: entry.endTime.length === 5 ? `${entry.endTime}:00` : entry.endTime,
        session_type: entry.sessionType,
        created_by_ai: true,
      };
    });

    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('schedule_entries')
        .insert(rowsToInsert)
        .select();

      if (insertErr) {
        // If created_by_ai column is not yet on remote DB, fallback insert without that column
        if (insertErr.code === '42703' || insertErr.message.includes('created_by_ai')) {
          const strippedRows = rowsToInsert.map(({ created_by_ai: _, ...rest }) => rest);
          const { data: fallbackInserted, error: fallbackErr } = await supabase
            .from('schedule_entries')
            .insert(strippedRows)
            .select();
          if (fallbackErr) {
            console.error('Fallback insert error:', fallbackErr.message);
          } else if (fallbackInserted) {
            fallbackInserted.forEach((row) => {
              writtenDatabaseEntries.push({
                id: row.id,
                offeringId: row.offering_id,
                blockId: payload.block.id,
                subjectId: '',
                instructorId: row.instructor_id,
                roomId: row.room_id,
                dayOfWeek: row.day_of_week,
                startTime: row.start_time.slice(0, 5),
                endTime: row.end_time.slice(0, 5),
                sessionType: row.session_type,
              });
            });
          }
        } else {
          console.error('Failed to write clean AI schedule entries:', insertErr.message);
        }
      } else if (inserted) {
        inserted.forEach((row) => {
          writtenDatabaseEntries.push({
            id: row.id,
            offeringId: row.offering_id,
            blockId: payload.block.id,
            subjectId: '',
            instructorId: row.instructor_id,
            roomId: row.room_id,
            dayOfWeek: row.day_of_week,
            startTime: row.start_time.slice(0, 5),
            endTime: row.end_time.slice(0, 5),
            sessionType: row.session_type,
          });
        });
      }
    } catch (writeErr) {
      console.error('Error during AI schedule insert:', writeErr);
    }
  }

  // 5. RECORD TO ai_generation_log
  const logRecord = {
    term_id: payload.termId,
    block_id: payload.block.id,
    input_payload: JSON.parse(JSON.stringify(payload)),
    raw_output: JSON.parse(JSON.stringify(finalRawOutput || {})),
    attempt_count: attemptCount,
    entries_written: JSON.parse(JSON.stringify(writtenDatabaseEntries)),
    final_unassigned: JSON.parse(JSON.stringify(unassignedOfferings)),
    created_by: userId,
  };

  try {
    await supabase.from('ai_generation_log').insert(logRecord);
  } catch {
    // If ai_generation_log table does not exist in schema cache, log to audit_log
    await supabase.from('audit_log').insert({
      actor_id: userId,
      action: 'AI_GENERATE_SCHEDULE',
      entity_type: 'ai_generation_log',
      entity_id: payload.block.id,
      before: null,
      after: logRecord,
    });
  }

  return {
    blockId: payload.block.id,
    blockName,
    success: true,
    attemptCount,
    entriesWritten: writtenDatabaseEntries,
    unassigned: unassignedOfferings,
    softViolations: detectedSoftViolations,
    rawOutput: finalRawOutput,
  };
}
