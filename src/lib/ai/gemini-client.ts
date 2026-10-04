// src/lib/ai/gemini-client.ts
// Server-side only Gemini Flash client for academic timetable proposal.
// The Gemini API key is kept strictly on the server and is never sent to the client.

import {
  proposedDraftSchema,
  type ProposedEntry,
  type BlockDraftPayload,
} from './types.ts';
import {
  timeRangesOverlap,
  timeToMinutes,
  isTimeRangeWithin,
} from '../conflict-engine/index.ts';
import { SCHEDULING_POLICY_TEXT } from './scheduling-policy.ts';

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const GEMINI_LITE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';

/**
 * Builds the compact, structured prompt for Gemini Flash.
 */
function buildGeminiPrompt(
  payload: BlockDraftPayload,
  repairContext?: { violatingEntries: ProposedEntry[]; violationMessages: string[] }
): string {
  const { block, offerings, fixedConstraints, existingEntries, preferences } = payload;

  let prompt = `You are an expert academic timetable scheduler for a university BSIT department.
Your task is to assign timetable slots for student block: ${block.name} (${block.studentCount} students).

${SCHEDULING_POLICY_TEXT}

CRITICAL CONSTRAINTS (ZERO HARD VIOLATIONS ALLOWED):
1. REQUIRED HOURS: Schedule exact required hours for each offering: lecture hours in a lecture or laboratory room, lab hours in a laboratory room. If an offering has 3 lec + 1 lab, schedule BOTH sessions.
2. 2-DAY SCHEDULE SPLIT vs SINGLE CONTINUOUS SESSIONS:
   - CRITICAL CONSTRAINT: NEVER SPLIT subjects with 1 or 2 hours! Subjects with 1 or 2 hours of units/lecture/lab (such as 2-hour PE 1, PE 2, PE 3, PATHFit, 1-hour or 2-hour labs, etc.) MUST ALWAYS be scheduled as a SINGLE CONTINUOUS SESSION on a SINGLE DAY for their exact full duration.
   - ONLY 3-hour lecture subjects (subjects with lectureHours === 3) can be split across 2 days:
     * Monday and Wednesday (MW: dayOfWeek 1 & 3)
     * Tuesday and Thursday (TTH: dayOfWeek 2 & 4)
     * Schedule two 1.5-hour sessions (90 mins each) on either MW OR TTH at the SAME time and in the SAME room (e.g. 08:00-09:30, 09:30-11:00, 11:00-12:30, 13:00-14:30, 14:30-16:00, or 16:00-17:30).
   - For courses with 3h lecture + 1h lab: schedule the lecture on MW or TTH (1.5h on each day), and schedule the laboratory session as a single continuous session on Friday (day 5) or Saturday (day 6) in a computer laboratory room.
3. ROOM ASSIGNMENT & CAPACITY:
   - If an offering's subject has facilityType === 'unspecified', it does NOT require a specific room: roomId may be null (or omitted) and will not cause a room availability conflict.
   - For all other subjects (lecture or lab), assign an eligible room from the offering's eligibleRooms list where room capacity >= block student count (${block.studentCount}).
4. INSTRUCTOR QUALIFICATION & AVAILABILITY: You must ONLY assign instructors listed in each offering's "qualifiedInstructors". Assigning an unqualified instructor is STRICTLY FORBIDDEN! If an offering has no qualified instructors, do not assign an instructor to it. The instructor must also be available during the assigned day/time.
5. NO OVERLAPS: No instructor, room, or student block overlaps! A student block CANNOT have two classes at the same time on the same day.
6. NO BLACKOUT CLASH: Do not overlap with any fixed constraints/blackout periods.
7. CANONICAL TIMESLOTS & LUNCH BREAK: All entries must start at one of: 08:00, 09:30, 11:00, 13:00, 14:30, 16:00, 17:30, 19:00 (applies every day, including Saturday — no separate Saturday grid). No class may cross or span the 12:30-13:00 lunch break. Morning classes must conclude by 12:30. Afternoon classes start at or after 13:00.
8. INSTRUCTOR WORKLOAD BALANCE: Distribute subjects across different qualified instructors. Do NOT assign all subjects to one instructor! Maximum recommended teaching time per instructor is 6 hours in a single day.
9. ROOM BALANCE: Distribute lecture classes across available lecture rooms rather than placing all classes in the same room.
10. WEEKLY SPREAD: Distribute classes evenly across the week (Monday through Friday).
${preferences.noClassesAfter5pm ? '11. PREFERENCE: No classes after 17:00 (5:00 PM).\n' : ''}
${preferences.preferMornings ? '12. PREFERENCE: Favor morning time slots (07:30 - 12:00).\n' : ''}

${
  preferences.isRefineMode
    ? `MODE: REFINE CURRENT SCHEDULE DRAFT (READ CURRENT TIMETABLE & APPLY PREFERENCES):
You are refining the current schedule draft. Below are the current active timetable entries for this block in the draft:
${JSON.stringify(
  existingEntries
    .filter((e) => e.blockId === block.id)
    .map((e) => ({
      offeringId: e.offeringId,
      instructorId: e.instructorId,
      roomId: e.roomId,
      dayOfWeek: e.dayOfWeek,
      startTime: e.startTime,
      endTime: e.endTime,
      sessionType: e.sessionType,
    })),
  null,
  2
)}
USER DIRECTIVES & MODIFICATIONS TO APPLY:
"${preferences.customNotes || 'Refine timetable conflict-free.'}"
Carefully read the current timetable above. Keep existing classes that do not need to change, and modify, move, or reassign only the classes requested by the user's preferences!\n`
    : ''
}

${
  preferences.customNotes && !preferences.isRefineMode
    ? `SCHEDULER SPECIAL INSTRUCTIONS (HIGHEST PRIORITY):
"${preferences.customNotes}"
Follow these instructions strictly! If the scheduler requests to leave out or exclude any subjects (e.g. "leave out this 3 subjects GE 1, GE 2, THEO 1"), do NOT schedule those subjects!\n`
    : ''
}

AVAILABLE OFFERINGS TO SCHEDULE:
${JSON.stringify(
  offerings.map((o) => ({
    offeringId: o.id,
    courseCode: o.subject.code,
    courseTitle: o.subject.title,
    lectureHours: o.subject.lectureHours,
    labHours: o.subject.labHours,
    requiresLab: o.subject.requiresLab,
    qualifiedInstructors: o.qualifiedInstructors.map((i) => ({
      id: i.id,
      name: i.name,
      availability: i.availability,
    })),
    eligibleRooms: o.eligibleRooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.roomType,
      capacity: r.capacity,
    })),
  })),
  null,
  2
)}

FIXED CONSTRAINTS (DO NOT OVERLAP):
${JSON.stringify(
  fixedConstraints.map((c) => ({
    label: c.label,
    roomId: c.roomId,
    dayOfWeek: c.dayOfWeek,
    startTime: c.startTime,
    endTime: c.endTime,
  })),
  null,
  2
)}

ALREADY OCCUPIED SLOTS IN OTHER BLOCKS:
${JSON.stringify(
  existingEntries.map((e) => ({
    instructorId: e.instructorId,
    roomId: e.roomId,
    dayOfWeek: e.dayOfWeek,
    startTime: e.startTime,
    endTime: e.endTime,
  })),
  null,
  2
)}
`;

  if (repairContext && repairContext.violatingEntries.length > 0) {
    prompt += `\nREPAIR PASS REQUIRED! The previous proposal produced the following conflicts:
${repairContext.violationMessages.join('\n')}

Offending entries that must be rescheduled to conflict-free slots:
${JSON.stringify(repairContext.violatingEntries, null, 2)}

Please re-propose conflict-free slots for these hours.`;
  }

  prompt += `\n\nOUTPUT FORMAT:
Output ONLY a JSON array of scheduled session objects matching this exact schema:
[
  {
    "offeringId": "string",
    "instructorId": "string",
    "roomId": "string or null", // Valid room ID from eligibleRooms, or null if subject facilityType is unspecified
    "dayOfWeek": 1, // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    "startTime": "08:00",
    "endTime": "09:30",
    "sessionType": "lecture" // or "lab"
  }
]
`;

  return prompt;
}

/**
 * Intelligent deterministic fallback generator used when no API key is provided,
 * when offline, or when the AI model proposal encounters unresolvable conflicts.
 */
export function generateHeuristicDraft(
  payload: BlockDraftPayload,
  excludedSlots: Set<string> = new Set()
): ProposedEntry[] {
  const proposed: ProposedEntry[] = [];
  const days = payload.preferences.allowSaturday ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const maxEndMinutes = payload.preferences.noClassesAfter5pm ? 17 * 60 : 19 * 60;
  const isSplitTwoDays = payload.preferences.splitTwoDays !== false;

  // Day pairs for 2-day split
  const dayPairs = [[1, 3], [2, 4]]; // MW, TTH

  // Canonical 1.5-hour timetable slots for MW / TTH (strictly avoiding 12:30-13:00 lunch break)
  const split15Slots = payload.preferences.preferMornings
    ? [
        ['08:00', '09:30'],
        ['09:30', '11:00'],
        ['11:00', '12:30'],
        ['13:00', '14:30'],
        ['14:30', '16:00'],
        ['16:00', '17:30'],
        ['17:30', '19:00'],
      ]
    : [
        ['09:30', '11:00'],
        ['13:00', '14:30'],
        ['11:00', '12:30'],
        ['14:30', '16:00'],
        ['08:00', '09:30'],
        ['16:00', '17:30'],
        ['17:30', '19:00'],
      ];

  // Canonical timetable grid start times
  const canonicalStartTimes = payload.preferences.preferMornings
    ? ['08:00', '09:30', '11:00', '13:00', '14:30', '16:00', '17:30', '19:00']
    : ['09:30', '13:00', '11:00', '14:30', '08:00', '16:00', '17:30', '19:00'];

  // Track instructor workload (minutes assigned) to balance distribution
  const instructorAssignedMinutes = new Map<string, number>();
  const instructorDailyMinutes = new Map<string, Map<number, number>>();

  // Track block schedule: block cannot have 2 classes at the same time
  const isBlockTimeOccupied = (day: number, sTime: string, eTime: string): boolean => {
    if (proposed.some((p) => p.dayOfWeek === day && timeRangesOverlap(sTime, eTime, p.startTime, p.endTime))) {
      return true;
    }
    if (
      payload.existingEntries.some(
        (e) => e.dayOfWeek === day && e.blockId === payload.block.id && timeRangesOverlap(sTime, eTime, e.startTime, e.endTime)
      )
    ) {
      return true;
    }
    return false;
  };

  // Check if instructor is busy at day/time
  const isInstructorOccupied = (instId: string, day: number, sTime: string, eTime: string): boolean => {
    if (proposed.some((p) => p.instructorId === instId && p.dayOfWeek === day && timeRangesOverlap(sTime, eTime, p.startTime, p.endTime))) {
      return true;
    }
    if (payload.existingEntries.some((e) => e.instructorId === instId && e.dayOfWeek === day && timeRangesOverlap(sTime, eTime, e.startTime, e.endTime))) {
      return true;
    }
    return false;
  };

  // Check if room is busy at day/time (unspecified facility subjects never occupy/block rooms)
  const isRoomOccupied = (roomId: string | null | undefined, day: number, sTime: string, eTime: string): boolean => {
    if (!roomId) return false;
    if (proposed.some((p) => {
      if (p.roomId !== roomId || p.dayOfWeek !== day) return false;
      const off = payload.offerings.find((o) => o.id === p.offeringId);
      if (off?.subject.facilityType === 'unspecified') return false;
      return timeRangesOverlap(sTime, eTime, p.startTime, p.endTime);
    })) {
      return true;
    }
    if (payload.existingEntries.some((e) => {
      if (e.roomId !== roomId || e.dayOfWeek !== day) return false;
      const off = payload.offerings.find((o) => o.subject.id === e.subjectId);
      if (off?.subject.facilityType === 'unspecified') return false;
      return timeRangesOverlap(sTime, eTime, e.startTime, e.endTime);
    })) {
      return true;
    }
    return false;
  };

  // Check fixed constraint collisions
  const hasFixedConstraintCollision = (roomId: string, day: number, sTime: string, eTime: string): boolean => {
    return payload.fixedConstraints.some(
      (c) =>
        c.dayOfWeek === day &&
        (!c.roomId || c.roomId === roomId) &&
        timeRangesOverlap(sTime, eTime, c.startTime, c.endTime)
    );
  };

  // Helper to pick least loaded qualified instructor for a single day
  const pickBestInstructor = (
    qualified: BlockDraftPayload['offerings'][0]['qualifiedInstructors'],
    day: number,
    sTime: string,
    eTime: string
  ) => {
    const available = qualified.filter((inst) => {
      if (!inst.availability || inst.availability.length === 0) return true;
      return inst.availability.some(
        (a) => a.dayOfWeek === day && isTimeRangeWithin(sTime, eTime, a.startTime, a.endTime)
      );
    });

    if (available.length === 0) return null;

    return [...available].sort((a, b) => {
      const dailyA = instructorDailyMinutes.get(a.id)?.get(day) || 0;
      const dailyB = instructorDailyMinutes.get(b.id)?.get(day) || 0;
      if (dailyA !== dailyB) return dailyA - dailyB;
      const totalA = instructorAssignedMinutes.get(a.id) || 0;
      const totalB = instructorAssignedMinutes.get(b.id) || 0;
      return totalA - totalB;
    })[0];
  };

  // Helper to pick least loaded qualified instructor for a day pair (MW or TTH)
  const pickBestInstructorForPair = (
    qualified: BlockDraftPayload['offerings'][0]['qualifiedInstructors'],
    d1: number,
    d2: number,
    sTime: string,
    eTime: string
  ) => {
    const available = qualified.filter((inst) => {
      if (isInstructorOccupied(inst.id, d1, sTime, eTime) || isInstructorOccupied(inst.id, d2, sTime, eTime)) {
        return false;
      }
      if (!inst.availability || inst.availability.length === 0) return true;
      const ok1 = inst.availability.some((a) => a.dayOfWeek === d1 && isTimeRangeWithin(sTime, eTime, a.startTime, a.endTime));
      const ok2 = inst.availability.some((a) => a.dayOfWeek === d2 && isTimeRangeWithin(sTime, eTime, a.startTime, a.endTime));
      return ok1 && ok2;
    });

    if (available.length === 0) return null;

    return [...available].sort((a, b) => {
      const loadA = (instructorDailyMinutes.get(a.id)?.get(d1) || 0) + (instructorDailyMinutes.get(a.id)?.get(d2) || 0);
      const loadB = (instructorDailyMinutes.get(b.id)?.get(d1) || 0) + (instructorDailyMinutes.get(b.id)?.get(d2) || 0);
      if (loadA !== loadB) return loadA - loadB;
      return (instructorAssignedMinutes.get(a.id) || 0) - (instructorAssignedMinutes.get(b.id) || 0);
    })[0];
  };

  // Iterate over offerings to place
  for (let offIndex = 0; offIndex < payload.offerings.length; offIndex++) {
    const offering = payload.offerings[offIndex];
    const { subject, qualifiedInstructors, eligibleRooms } = offering;

    // Filter valid rooms by capacity
    const validRooms = eligibleRooms.filter((r) => r.capacity >= payload.block.studentCount);
    const lectureRooms = validRooms.filter((r) => r.roomType === 'lecture');
    const labRooms = validRooms.filter((r) => r.roomType === 'laboratory');

    const preferredLectureRooms = lectureRooms.length > 0 ? lectureRooms : validRooms;
    const preferredLabRooms = labRooms.length > 0 ? labRooms : validRooms;

    let lectureDays: number[] = [];
    let assignedInstructorId: string | null = null;

    // 1. Plan Lecture Session (if lectureHours > 0)
    if (subject.lectureHours > 0) {
      let placed = false;

      // 2-Day Split: If 3 lecture hours and splitTwoDays is active, schedule two 1.5-hour sessions on MW or TTH
      if (isSplitTwoDays && subject.lectureHours === 3) {
        // Alternate starting pair based on offering index to distribute between MW and TTH
        const orderedPairs = offIndex % 2 === 0 ? dayPairs : [...dayPairs].reverse();

        for (const [d1, d2] of orderedPairs) {
          if (placed) break;
          for (const [sTime, eTime] of split15Slots) {
            const [eh, em] = eTime.split(':').map(Number);
            if (eh * 60 + em > maxEndMinutes) continue;

            const slotKey1 = `${offering.id}:${d1}:${sTime}-${eTime}`;
            const slotKey2 = `${offering.id}:${d2}:${sTime}-${eTime}`;
            if (excludedSlots.has(slotKey1) || excludedSlots.has(slotKey2)) continue;

            // Must be free on both days for the block
            if (isBlockTimeOccupied(d1, sTime, eTime) || isBlockTimeOccupied(d2, sTime, eTime)) continue;

            // Pick instructor available on both days
            const instructor = pickBestInstructorForPair(qualifiedInstructors, d1, d2, sTime, eTime);
            if (!instructor) continue;

            // Find a room available and free of constraints on both days (unspecified facility does not need a specific room)
            const isUnspecified = subject.facilityType === 'unspecified';
            const roomToUse = isUnspecified
              ? (preferredLectureRooms[0] || eligibleRooms[0] || null)
              : preferredLectureRooms.find(
                  (r) =>
                    !isRoomOccupied(r.id, d1, sTime, eTime) &&
                    !isRoomOccupied(r.id, d2, sTime, eTime) &&
                    !hasFixedConstraintCollision(r.id, d1, sTime, eTime) &&
                    !hasFixedConstraintCollision(r.id, d2, sTime, eTime)
                );
            if (!isUnspecified && !roomToUse) continue;

            // Place on both days (90m each = 180m = 3h total)
            proposed.push({
              offeringId: offering.id,
              instructorId: instructor.id,
              roomId: roomToUse ? roomToUse.id : null,
              dayOfWeek: d1,
              startTime: sTime,
              endTime: eTime,
              sessionType: 'lecture',
            });
            proposed.push({
              offeringId: offering.id,
              instructorId: instructor.id,
              roomId: roomToUse ? roomToUse.id : null,
              dayOfWeek: d2,
              startTime: sTime,
              endTime: eTime,
              sessionType: 'lecture',
            });

            const durMin = 90;
            instructorAssignedMinutes.set(instructor.id, (instructorAssignedMinutes.get(instructor.id) || 0) + durMin * 2);
            for (const d of [d1, d2]) {
              if (!instructorDailyMinutes.has(instructor.id)) instructorDailyMinutes.set(instructor.id, new Map());
              const dMap = instructorDailyMinutes.get(instructor.id)!;
              dMap.set(d, (dMap.get(d) || 0) + durMin);
            }

            lectureDays = [d1, d2];
            assignedInstructorId = instructor.id;
            placed = true;
            break;
          }
        }
      }

      // Single-Day fallback (e.g. 2-hour PE 3, or if 2-day split was not applicable or full)
      if (!placed) {
        const durationHours = subject.lectureHours;
        // For 2-hour courses (like PE 3), prefer Friday (5) or Saturday (6) first
        const candidateDays = durationHours === 2
          ? [5, ...(payload.preferences.allowSaturday ? [6] : []), ...days.filter((d) => d !== 5 && d !== 6)]
          : [...days.slice(offIndex % days.length), ...days.slice(0, offIndex % days.length)];

        for (const day of candidateDays) {
          if (placed) break;
          for (const sTime of canonicalStartTimes) {
            const sMin = timeToMinutes(sTime);
            const eMin = sMin + durationHours * 60;
            if (eMin > maxEndMinutes) continue;

            const eTime = `${String(Math.floor(eMin / 60)).padStart(2, '0')}:${String(eMin % 60).padStart(2, '0')}`;

            // Must NOT cross or span 12:30-13:00 lunch break!
            if (timeRangesOverlap(sTime, eTime, '12:30', '13:00')) continue;

            const slotKey = `${offering.id}:${day}:${sTime}-${eTime}`;
            if (excludedSlots.has(slotKey)) continue;

            if (isBlockTimeOccupied(day, sTime, eTime)) continue;

            const instructor = pickBestInstructor(qualifiedInstructors, day, sTime, eTime);
            if (!instructor || isInstructorOccupied(instructor.id, day, sTime, eTime)) continue;

            const isUnspecified = subject.facilityType === 'unspecified';
            const roomToUse = isUnspecified
              ? (preferredLectureRooms[0] || eligibleRooms[0] || null)
              : preferredLectureRooms.find(
                  (r) => !isRoomOccupied(r.id, day, sTime, eTime) && !hasFixedConstraintCollision(r.id, day, sTime, eTime)
                );
            if (!isUnspecified && !roomToUse) continue;

            proposed.push({
              offeringId: offering.id,
              instructorId: instructor.id,
              roomId: roomToUse ? roomToUse.id : null,
              dayOfWeek: day,
              startTime: sTime,
              endTime: eTime,
              sessionType: 'lecture',
            });

            const durMin = durationHours * 60;
            instructorAssignedMinutes.set(instructor.id, (instructorAssignedMinutes.get(instructor.id) || 0) + durMin);
            if (!instructorDailyMinutes.has(instructor.id)) instructorDailyMinutes.set(instructor.id, new Map());
            const dMap = instructorDailyMinutes.get(instructor.id)!;
            dMap.set(day, (dMap.get(day) || 0) + durMin);

            lectureDays = [day];
            assignedInstructorId = instructor.id;
            placed = true;
            break;
          }
        }
      }
    }

    // 2. Plan Lab Session (if labHours > 0)
    // In university schedules, lab sessions are held on Friday or Saturday in computer labs,
    // rather than continuing on the same day in another room!
    if (subject.labHours > 0) {
      const durationHours = subject.labHours;
      let placed = false;

      // Prefer Friday (5) or Saturday (6) first, or a day separate from lecture days
      const labCandidateDays = [
        5,
        ...(payload.preferences.allowSaturday ? [6] : []),
        ...days.filter((d) => d !== 5 && d !== 6 && !lectureDays.includes(d)),
        ...days.filter((d) => lectureDays.includes(d)),
      ];

      for (const day of labCandidateDays) {
        if (placed) break;
        for (const sTime of canonicalStartTimes) {
          if (placed) break;
          const sMin = timeToMinutes(sTime);
          const eMin = sMin + durationHours * 60;
          if (eMin > maxEndMinutes) continue;

          const eTime = `${String(Math.floor(eMin / 60)).padStart(2, '0')}:${String(eMin % 60).padStart(2, '0')}`;

          // Must NOT cross or span 12:30-13:00 lunch break!
          if (timeRangesOverlap(sTime, eTime, '12:30', '13:00')) continue;

          const slotKey = `${offering.id}:${day}:${sTime}-${eTime}`;
          if (excludedSlots.has(slotKey)) continue;

          if (isBlockTimeOccupied(day, sTime, eTime)) continue;

          let instructor = qualifiedInstructors.find((i) => i.id === assignedInstructorId);
          if (
            !instructor ||
            isInstructorOccupied(instructor.id, day, sTime, eTime) ||
            (instructor.availability &&
              instructor.availability.length > 0 &&
              !instructor.availability.some(
                (a) => a.dayOfWeek === day && isTimeRangeWithin(sTime, eTime, a.startTime, a.endTime)
              ))
          ) {
            instructor = pickBestInstructor(qualifiedInstructors, day, sTime, eTime) || undefined;
          }

          if (!instructor || isInstructorOccupied(instructor.id, day, sTime, eTime)) continue;

          const roomToUse = preferredLabRooms.find(
            (r) => !isRoomOccupied(r.id, day, sTime, eTime) && !hasFixedConstraintCollision(r.id, day, sTime, eTime)
          );
          if (!roomToUse) continue;

          proposed.push({
            offeringId: offering.id,
            instructorId: instructor.id,
            roomId: roomToUse.id,
            dayOfWeek: day,
            startTime: sTime,
            endTime: eTime,
            sessionType: 'lab',
          });

          const durMin = durationHours * 60;
          instructorAssignedMinutes.set(instructor.id, (instructorAssignedMinutes.get(instructor.id) || 0) + durMin);
          if (!instructorDailyMinutes.has(instructor.id)) instructorDailyMinutes.set(instructor.id, new Map());
          const dMap = instructorDailyMinutes.get(instructor.id)!;
          dMap.set(day, (dMap.get(day) || 0) + durMin);

          placed = true;
        }
      }
    }
  }

  return proposed;
}

/**
 * Calls Gemini Flash server-side with strict JSON schema parsing and transparent heuristic fallback.
 */
export async function generateDraftWithGemini(
  payload: BlockDraftPayload,
  repairContext?: { violatingEntries: ProposedEntry[]; violationMessages: string[] }
): Promise<{ rawResponse: unknown; parsedEntries: ProposedEntry[] }> {
  const getExcludedSlots = () => {
    const slots = new Set<string>();
    if (repairContext?.violatingEntries) {
      for (const v of repairContext.violatingEntries) {
        slots.add(`${v.offeringId}:${v.dayOfWeek}:${v.startTime}-${v.endTime}`);
      }
    }
    return slots;
  };

  // If no Gemini API key is configured, use deterministic heuristic generator
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('dummy') || GEMINI_API_KEY === 'test') {
    const heuristicResults = generateHeuristicDraft(payload, getExcludedSlots());
    return {
      rawResponse: { mode: 'heuristic', generatedCount: heuristicResults.length },
      parsedEntries: heuristicResults,
    };
  }

  try {
    const promptText = buildGeminiPrompt(payload, repairContext);

    const requestBody = {
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    };

    // Enforce 60-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let response: Response | null = null;
    try {
      response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (primaryErr) {
      console.warn('[Gemini Flash] Primary model fetch error or timeout:', primaryErr);
      try {
        response = await fetch(`${GEMINI_LITE_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
      } catch (liteErr) {
        console.warn('[Gemini Flash] Secondary lite model failed:', liteErr);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (response && !response.ok && response.status === 429) {
      console.warn('[Gemini Flash] Primary model rate limited (429), trying secondary lite model...');
      try {
        response = await fetch(`${GEMINI_LITE_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
      } catch (liteErr) {
        console.warn('[Gemini Flash] Secondary model failed:', liteErr);
      }
    }

    if (!response || !response.ok) {
      const errorBody = response ? await response.text() : 'No response';
      console.warn(`[Gemini Flash] API HTTP error: ${errorBody}. Using heuristic fallback.`);
      const heuristicResults = generateHeuristicDraft(payload, getExcludedSlots());
      return {
        rawResponse: { mode: 'heuristic_fallback', error: `Gemini failure: ${errorBody}`, generatedCount: heuristicResults.length },
        parsedEntries: heuristicResults,
      };
    }

    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(textContent);
    } catch {
      // Retry once with explicit schema prompt
      const retryPrompt = `${promptText}\n\nERROR: Your previous response was invalid JSON. Return ONLY a valid JSON array matching the exact schema.`;
      const retryResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: retryPrompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!retryResponse.ok) {
        throw new Error('Failed to parse Gemini output as JSON after retry.');
      }
      const retryData = await retryResponse.json();
      const retryText = retryData.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      parsedRaw = JSON.parse(retryText);
    }

    // Validate with Zod
    const validation = proposedDraftSchema.safeParse(parsedRaw);
    if (!validation.success) {
      console.warn(`[Gemini Flash] Schema validation failed: ${validation.error.issues[0]?.message}. Using heuristic fallback.`);
      const heuristicResults = generateHeuristicDraft(payload, getExcludedSlots());
      return {
        rawResponse: { mode: 'heuristic_fallback', error: validation.error.issues[0]?.message, generatedCount: heuristicResults.length },
        parsedEntries: heuristicResults,
      };
    }

    // Continuous Guard: Verify that subjects with 1 or 2 hours were never split or truncated to 1.5h
    let needsHeuristicRepair = false;
    for (const off of payload.offerings) {
      if (off.subject.lectureHours > 0 && off.subject.lectureHours <= 2) {
        const offLecEntries = validation.data.filter(
          (p) => p.offeringId === off.id && p.sessionType === 'lecture'
        );
        const reqMins = off.subject.lectureHours * 60;
        const hasSplit = offLecEntries.length > 1;
        const isUnderDuration = offLecEntries.some((e) => {
          const [sh, sm] = e.startTime.split(':').map(Number);
          const [eh, em] = e.endTime.split(':').map(Number);
          return (eh * 60 + em) - (sh * 60 + sm) < reqMins;
        });

        if (hasSplit || isUnderDuration) {
          needsHeuristicRepair = true;
          break;
        }
      }

      // Check qualification: must only assign qualified instructors
      if (!needsHeuristicRepair) {
        const hasUnqualified = validation.data.some((p) => {
          if (!p.instructorId) return false;
          const off = payload.offerings.find((o) => o.id === p.offeringId);
          if (!off) return false;
          return !off.qualifiedInstructors.some((qi) => qi.id === p.instructorId);
        });
        if (hasUnqualified) {
          needsHeuristicRepair = true;
          break;
        }
      }
    }

    if (needsHeuristicRepair) {
      console.warn(
        '[Gemini Flash] LLM improperly split 1h/2h subject or picked unqualified instructor. Running deterministic solver to guarantee compliant schedule.'
      );
      const heuristicResults = generateHeuristicDraft(payload, getExcludedSlots());
      return {
        rawResponse: { mode: 'heuristic_continuous_guard', generatedCount: heuristicResults.length },
        parsedEntries: heuristicResults,
      };
    }

    return {
      rawResponse: data,
      parsedEntries: validation.data,
    };
  } catch (err: unknown) {
    console.warn('[Gemini Flash] Unexpected exception during generation, falling back to heuristic solver:', err);
    const heuristicResults = generateHeuristicDraft(payload, getExcludedSlots());
    return {
      rawResponse: { mode: 'heuristic_fallback', error: err instanceof Error ? err.message : String(err), generatedCount: heuristicResults.length },
      parsedEntries: heuristicResults,
    };
  }
}

