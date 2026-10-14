// src/lib/ai/hybrid-refine-solver.ts
/**
 * Hybrid Deterministic AI Refine Solver.
 * Combines natural language intent extraction with the deterministic Conflict Engine
 * to guarantee 100% mathematically conflict-free, zero-hallucination timetable adjustments.
 */

import type { BlockDraftPayload, ProposedEntry } from './types.ts';
import type { ScheduleContext, ScheduleEntryInput } from '../conflict-engine/types.ts';
import { checkSchedule } from '../conflict-engine/index.ts';
import { timeRangesOverlap, timeToMinutes } from '../conflict-engine/utils.ts';

export interface ParsedRefineIntent {
  targetSubjectCode?: string;
  targetDayOfWeek?: number;
  targetTimePreference?: 'morning' | 'afternoon' | 'any';
  specificStartTime?: string;
  action: 'move' | 'reschedule' | 'general';
}

/**
 * Extracts scheduling intent from natural language instructions.
 * E.g. "move PE to another time on saturday" -> { targetSubjectCode: 'PE', targetDayOfWeek: 6, action: 'move' }
 */
export function parseRefineInstruction(instruction: string, availableSubjects: { code: string; title: string }[]): ParsedRefineIntent {
  const text = instruction.toLowerCase().trim();

  // Day of week mapping
  let targetDayOfWeek: number | undefined = undefined;
  if (text.includes('monday') || text.includes('mon')) targetDayOfWeek = 1;
  else if (text.includes('tuesday') || text.includes('tue')) targetDayOfWeek = 2;
  else if (text.includes('wednesday') || text.includes('wed')) targetDayOfWeek = 3;
  else if (text.includes('thursday') || text.includes('thu')) targetDayOfWeek = 4;
  else if (text.includes('friday') || text.includes('fri')) targetDayOfWeek = 5;
  else if (text.includes('saturday') || text.includes('sat')) targetDayOfWeek = 6;
  else if (text.includes('sunday') || text.includes('sun')) targetDayOfWeek = 0;

  // Time preference
  let targetTimePreference: 'morning' | 'afternoon' | 'any' = 'any';
  if (text.includes('morning') || text.includes('am') || text.includes('earlier')) {
    targetTimePreference = 'morning';
  } else if (text.includes('afternoon') || text.includes('pm') || text.includes('later')) {
    targetTimePreference = 'afternoon';
  }

  // Specific time match (e.g. "8:00", "08:00", "1:00", "13:00")
  let specificStartTime: string | undefined = undefined;
  const timeMatch = text.match(/\b(0?[7-9]|1[0-9]|20):([0-5][0-9])\b/);
  if (timeMatch) {
    const hh = String(parseInt(timeMatch[1], 10)).padStart(2, '0');
    specificStartTime = `${hh}:${timeMatch[2]}`;
  }

  // Subject matching: sort longest code first to avoid partial matches
  const sortedSubs = [...availableSubjects].sort((a, b) => b.code.length - a.code.length);
  let matchedSubjectCode: string | undefined = undefined;

  for (const sub of sortedSubs) {
    const code = sub.code.toLowerCase();
    const title = sub.title.toLowerCase();
    // Match exact word boundary of code
    const codeRegex = new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (codeRegex.test(text) || (title.length > 5 && text.includes(title))) {
      matchedSubjectCode = sub.code;
      break;
    }
  }

  // Fallback shorthand check: e.g. "PE", "NSTP", "MATH", "PROG", "THEO"
  if (!matchedSubjectCode) {
    for (const sub of sortedSubs) {
      const codeShort = sub.code.split(/[\s-]+/)[0].toLowerCase();
      if (codeShort.length >= 2) {
        const shortRegex = new RegExp(`\\b${codeShort}\\b`, 'i');
        if (shortRegex.test(text)) {
          matchedSubjectCode = sub.code;
          break;
        }
      }
    }
  }

  return {
    targetSubjectCode: matchedSubjectCode,
    targetDayOfWeek,
    targetTimePreference,
    specificStartTime,
    action: text.includes('move') || text.includes('shift') || text.includes('place') ? 'move' : 'general',
  };
}

/**
 * Solves a targeted adjustment deterministically by finding a 100% conflict-free slot
 * for the requested subject while keeping all other classes locked in place.
 */
export function solveDeterministicRefine(
  payload: BlockDraftPayload,
  intent: ParsedRefineIntent,
  activeBaselineEntries: ScheduleEntryInput[],
  engineContext: ScheduleContext
): ProposedEntry[] | null {
  const { block, offerings, existingEntries } = payload;
  const blockEntries = existingEntries.filter((e) => e.blockId === block.id);

  if (blockEntries.length === 0 && offerings.length === 0) return null;

  // Identify target offering
  let targetOff = intent.targetSubjectCode
    ? offerings.find(
        (o) =>
          (o.subject.code || '').toUpperCase() === intent.targetSubjectCode?.toUpperCase() ||
          (o.subject.code || '').toUpperCase().startsWith(intent.targetSubjectCode?.toUpperCase() || '___')
      )
    : undefined;

  if (!targetOff && offerings.length > 0) {
    targetOff = offerings[0];
  }

  if (!targetOff) return null;

  const isHs =
    (block.name || '').toLowerCase().includes('grade') ||
    (block.name || '').toLowerCase().includes('high school') ||
    (block.name || '').toUpperCase().startsWith('HS');

  const lunchWindow = isHs
    ? { startTime: '12:00', endTime: '13:00' }
    : { startTime: '12:30', endTime: '13:00' };

  // Calculate required session duration in minutes
  const units = targetOff.subject.units || 3;
  let durationHours = targetOff.subject.lectureHours + targetOff.subject.labHours;
  if (!durationHours || durationHours <= 0) {
    durationHours = units === 1 ? 1 : units === 2 ? 2 : 1.5;
  }
  // Standard college 3-unit lecture session is 1.5h
  if (units === 3 && targetOff.subject.lectureHours === 3 && targetOff.subject.labHours === 0 && !isHs) {
    durationHours = 1.5;
  }

  const durationMins = Math.round(durationHours * 60);

  // Other entries of this block remain strictly locked!
  const lockedEntries = blockEntries.filter((e) => e.offeringId !== targetOff.id);

  // Candidate days: user requested day, or default to Saturday (6) if PE / NSTP, or Monday-Saturday
  const subCodeUpper = (targetOff.subject.code || '').toUpperCase();
  const daysToTry: number[] =
    intent.targetDayOfWeek !== undefined
      ? [intent.targetDayOfWeek]
      : subCodeUpper.includes('PE') || subCodeUpper.includes('NSTP')
      ? [6, 5, 1, 2, 3, 4]
      : [1, 2, 3, 4, 5, 6];

  // Canonical candidate start times
  let candidateStartTimes = [
    '08:00',
    '09:30',
    '10:00',
    '11:00',
    '13:00',
    '14:30',
    '15:00',
    '16:00',
    '17:30',
  ];

  if (intent.specificStartTime) {
    candidateStartTimes = [intent.specificStartTime, ...candidateStartTimes.filter((t) => t !== intent.specificStartTime)];
  } else if (intent.targetTimePreference === 'morning') {
    candidateStartTimes = ['08:00', '09:30', '10:00', '11:00', '13:00', '14:30', '16:00'];
  } else if (intent.targetTimePreference === 'afternoon') {
    candidateStartTimes = ['13:00', '14:30', '15:00', '16:00', '17:30', '08:00', '09:30'];
  }

  // Iterate over candidate days and slots to find the first 100% conflict-free placement
  for (const day of daysToTry) {
    for (const startTime of candidateStartTimes) {
      const sMins = timeToMinutes(startTime);
      const eMins = sMins + durationMins;
      if (eMins > 21 * 60) continue; // Past 9:00 PM

      const eh = Math.floor(eMins / 60);
      const em = eMins % 60;
      const endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;

      // 1. Must not cross lunch break
      if (timeRangesOverlap(startTime, endTime, lunchWindow.startTime, lunchWindow.endTime)) {
        continue;
      }

      // 2. Must not overlap locked entries of the same student cohort block
      const cohortOverlap = lockedEntries.some(
        (le) => le.dayOfWeek === day && timeRangesOverlap(startTime, endTime, le.startTime, le.endTime)
      );
      if (cohortOverlap) continue;

      // 3. Find qualified available instructor
      const availableInstructor = targetOff.qualifiedInstructors.find((qi) => {
        // Check instructor weekly availability
        const isAvail = (qi.availability || []).some(
          (a) =>
            a.dayOfWeek === day &&
            timeToMinutes(startTime) >= timeToMinutes(a.startTime) &&
            timeToMinutes(endTime) <= timeToMinutes(a.endTime)
        );
        if (!isAvail && (qi.availability || []).length > 0) return false;

        // Check against active draft across all blocks
        const instBusyInOtherBlocks = activeBaselineEntries.some(
          (be) => be.dayOfWeek === day && be.instructorId === qi.id && timeRangesOverlap(startTime, endTime, be.startTime, be.endTime)
        );
        if (instBusyInOtherBlocks) return false;

        // Check against locked entries of this block
        const instBusyInCurrentBlock = lockedEntries.some(
          (le) => le.dayOfWeek === day && le.instructorId === qi.id && timeRangesOverlap(startTime, endTime, le.startTime, le.endTime)
        );
        return !instBusyInCurrentBlock;
      });

      const instructorIdToUse = availableInstructor ? availableInstructor.id : targetOff.qualifiedInstructors[0]?.id || null;

      // 4. Find available eligible room
      let roomIdToUse: string | null = null;
      if (targetOff.subject.facilityType === 'unspecified') {
        roomIdToUse = null;
      } else {
        const eligibleRooms = targetOff.eligibleRooms.filter((r) => {
          if (targetOff.subject.requiresLab && r.roomType !== 'laboratory') return false;
          return true;
        });

        const freeRoom = eligibleRooms.find((r) => {
          const roomTakenInOtherBlocks = activeBaselineEntries.some(
            (be) => be.dayOfWeek === day && be.roomId === r.id && timeRangesOverlap(startTime, endTime, be.startTime, be.endTime)
          );
          if (roomTakenInOtherBlocks) return false;

          const roomTakenInCurrentBlock = lockedEntries.some(
            (le) => le.dayOfWeek === day && le.roomId === r.id && timeRangesOverlap(startTime, endTime, le.startTime, le.endTime)
          );
          return !roomTakenInCurrentBlock;
        });

        roomIdToUse = freeRoom ? freeRoom.id : eligibleRooms[0]?.id || null;
      }

      // Construct proposed candidate entry
      const proposedNewEntry: ScheduleEntryInput = {
        id: `draft-refine-new-0`,
        offeringId: targetOff.id,
        blockId: block.id,
        subjectId: targetOff.subject.id,
        instructorId: instructorIdToUse || targetOff.qualifiedInstructors[0]?.id || '',
        roomId: roomIdToUse,
        dayOfWeek: day,
        startTime,
        endTime,
        sessionType: targetOff.subject.requiresLab ? 'lab' : 'lecture',
      };

      // Full audit with conflict engine
      const testEntries = [...activeBaselineEntries, ...lockedEntries, proposedNewEntry];
      const auditViolations = checkSchedule(testEntries, engineContext);
      const hardViolations = auditViolations.filter((v) => v.severity === 'hard');

      if (hardViolations.length === 0) {
        // Convert to ProposedEntry output
        const finalProposed: ProposedEntry[] = [
          ...lockedEntries.map((le) => ({
            offeringId: le.offeringId,
            dayOfWeek: le.dayOfWeek,
            startTime: le.startTime,
            endTime: le.endTime,
            roomId: le.roomId,
            instructorId: le.instructorId || '',
            sessionType: le.sessionType,
          })),
          {
            offeringId: proposedNewEntry.offeringId,
            dayOfWeek: proposedNewEntry.dayOfWeek,
            startTime: proposedNewEntry.startTime,
            endTime: proposedNewEntry.endTime,
            roomId: proposedNewEntry.roomId,
            instructorId: proposedNewEntry.instructorId || '',
            sessionType: proposedNewEntry.sessionType,
          },
        ];

        return finalProposed;
      }
    }
  }

  return null;
}
