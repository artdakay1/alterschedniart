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

  const isHs =
    (block.name || '').toLowerCase().includes('grade') ||
    (block.name || '').toLowerCase().includes('high school') ||
    (block.name || '').toUpperCase().startsWith('HS') ||
    offerings.some((o) => (o.subject.code || '').startsWith('HS') || (o.subject.code || '').startsWith('JHS') || (o.subject.code || '').startsWith('SHS'));

  let prompt = `You are an expert academic timetable scheduler for a ${isHs ? 'High School department' : 'university BSIT department'}.
Your task is to assign timetable slots for student block: ${block.name} (${block.studentCount} students).

${SCHEDULING_POLICY_TEXT}

CRITICAL CONSTRAINTS (ZERO HARD VIOLATIONS ALLOWED):
1. REQUIRED HOURS & UNITS CONSTRAINTS (NEVER OVER-SCHEDULE):
   - Read the units and required weekly hours for each course from "AVAILABLE OFFERINGS TO SCHEDULE".
   - You MUST schedule EXACTLY the total required hours (lectureHours + labHours).
   - NEVER add more hours than indicated in the subject's curriculum units!
   - For a 1-unit subject with 1h lecture (such as ROBOTICS, IT 1, or ARDUINO), schedule EXACTLY ONE 1-hour session (60 minutes). NEVER schedule 2 hours, NEVER duplicate the session across days, and NEVER exceed 1 hour total!
   - For a 2-unit course with 2 hours (such as PE / PATHFit), schedule EXACTLY ONE 2-hour session (120 minutes) on a single day.
2. DAY PAIRING CONVENTION (MW and TTH):
   - Standard timetable slots follow the 2-day pairing convention:
     * Monday and Wednesday (MW: dayOfWeek 1 & 3)
     * Tuesday and Thursday (TTH: dayOfWeek 2 & 4)
   - For 3-unit courses with 1.5h lecture and 1.5h lab (e.g. HCI, PROG 1, COMP 1, OOP, IM 1):
     * Schedule the 1.5-hour lecture session on Day 1 of the pair (Monday or Tuesday) in a lecture room.
     * Schedule the 1.5-hour laboratory session on Day 2 of the pair (Wednesday or Thursday) at the EXACT SAME TIME in a computer lab.
   - For 3-hour pure lecture courses (lectureHours === 3, labHours === 0, such as GE 1, GE 2, THEO 1):
     * Schedule two 1.5-hour lecture sessions across the pair (Monday & Wednesday OR Tuesday & Thursday) at the EXACT SAME TIME in a lecture room.
   - For single-session courses with 1 or 2 hours (such as 2-hour PE / PATHFit / NSTP):
     * MUST ALWAYS be scheduled as a single continuous session on a single day for their exact duration. NEVER split 1 or 2 hour courses!
     * PE (Physical Education / PATHFit) and NSTP (ROTC / CWTS) MUST be prioritized for placement on Saturday first, then Friday. Only place them on Monday–Thursday if Saturday and Friday are full or unavailable.
3. ROOM ASSIGNMENT:
   - If an offering's subject has facilityType === 'unspecified', it does NOT require a specific room: roomId may be null (or omitted) and will not cause a room availability conflict.
   - For all other subjects (lecture or lab), assign an eligible room from the offering's eligibleRooms list. If a lecture room is fully booked, a computer lab may be used as a lecture room.
4. INSTRUCTOR QUALIFICATION & AVAILABILITY: You must ONLY assign instructors listed in each offering's "qualifiedInstructors". Assigning an unqualified instructor is STRICTLY FORBIDDEN! If an offering has no qualified instructors, do not assign an instructor to it. The instructor must also be available during the assigned day/time.
5. NO OVERLAPS: No instructor, room, or student block overlaps! A student block CANNOT have two classes at the same time on the same day.
6. NO BLACKOUT CLASH: Do not overlap with any fixed constraints/blackout periods.
${
  isHs
    ? `7. HIGH SCHOOL SCHEDULE HOURS & LUNCH BREAK: All High School classes must be scheduled strictly between 07:00 (7:00 AM) and 16:00 (4:00 PM). LUNCH BREAK IS STRICTLY 12:00 to 13:00 (12:00 PM - 1:00 PM). No class may cross or span the 12:00-13:00 lunch break! Morning classes must conclude by 12:00. Afternoon classes start at or after 13:00.`
    : `7. CANONICAL TIMESLOTS & LUNCH BREAK (CRITICAL HARD CONSTRAINT): All entries must start at one of these EXACT start times: 08:00, 09:30, 11:00, 13:00, 14:30, 16:00, 17:30, 19:00 (applies every day, including Saturday — no separate Saturday grid). Starting at 10:00, 12:00, 14:00, or 15:00 is STRICTLY FORBIDDEN and will cause instant schedule rejection! No class may cross or span the 12:30-13:00 lunch break. Morning classes must conclude by 12:30. Afternoon classes start at or after 13:00.`
}
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
    .map((e) => {
      const off = offerings.find((o) => o.id === e.offeringId);
      const qualInst = off?.qualifiedInstructors.find((i) => i.id === e.instructorId);
      const room = off?.eligibleRooms.find((r) => r.id === e.roomId);
      return {
        courseCode: off?.subject.code || '',
        courseTitle: off?.subject.title || '',
        offeringId: e.offeringId,
        instructorName: qualInst?.name || '',
        instructorId: e.instructorId,
        roomName: room?.name || (off?.subject.facilityType === 'unspecified' ? 'None (N/A)' : ''),
        roomId: e.roomId,
        dayOfWeek: e.dayOfWeek,
        dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][e.dayOfWeek],
        startTime: e.startTime,
        endTime: e.endTime,
        sessionType: e.sessionType,
      };
    }),
  null,
  2
)}

USER DIRECTIVES & MODIFICATIONS TO APPLY:
"${preferences.customNotes || 'Refine timetable conflict-free.'}"

${preferences.refineScope === 'whole_block'
  ? `WHOLE-BLOCK RESHUFFLE MODE:
- You are allowed to adjust, shift, or reshuffle any classes across the week to satisfy the user's overall directive (e.g. morning/afternoon preference, day pairing, or general balance) while maintaining conflict-free placement.`
  : `TARGETED ADJUSTMENT MODE (MANDATORY STRICT RULES):
1. SPECIFIC FOCUS: Only adjust the specific course(s) explicitly mentioned in USER DIRECTIVES (e.g. specific day, day pairing, start time, room, or instructor).
2. LOCK ALL UNMENTIONED CLASSES: Every other course currently on the timetable that is NOT explicitly mentioned in the USER DIRECTIVES MUST REMAIN STRICTLY LOCKED at its EXACT current day, time, room, and instructor! You must output them exactly as they are currently scheduled.
3. DO NOT SHIFT OR DISPLACE LOCKED CLASSES: If placing the requested course into the requested slot would cause a time collision with another class on the schedule, or with instructor/room availability, DO NOT move or reschedule the locked class.`
}\n`
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
  offerings.map((o) => {
    const totalWeeklyHours =
      o.subject.lectureHours + o.subject.labHours > 0
        ? o.subject.lectureHours + o.subject.labHours
        : o.subject.units || 0;
    return {
      offeringId: o.id,
      courseCode: o.subject.code,
      courseTitle: o.subject.title,
      units: o.subject.units,
      totalWeeklyHours,
      lectureHours: o.subject.lectureHours,
      labHours: o.subject.labHours,
      requiresLab: o.subject.requiresLab,
      facilityType: o.subject.facilityType,
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
    };
  }),
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
  existingEntries
    .filter((e) => e.blockId !== block.id)
    .map((e) => ({
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

  const isHsBlock =
    (payload.block.name || '').toLowerCase().includes('high school') ||
    (payload.block.name || '').toLowerCase().includes('grade') ||
    (payload.block.name || '').toUpperCase().startsWith('HS');

  const lunchWindow = isHsBlock
    ? { startTime: '12:00', endTime: '13:00' }
    : { startTime: '12:30', endTime: '13:00' };

  const minStartMinutes = isHsBlock ? 7 * 60 : 8 * 60;
  const maxEndMinutes = isHsBlock
    ? 16 * 60 // 4:00 PM for High School
    : payload.preferences.noClassesAfter5pm ? 17 * 60 : 19 * 60;
  const isSplitTwoDays = payload.preferences.splitTwoDays !== false;

  // Day pairs for 2-day split
  const dayPairs = [[1, 3], [2, 4]]; // MW, TTH
  const extendedDayPairs = isHsBlock
    ? [[1, 3], [2, 4]]
    : [
        [1, 3],
        [2, 4],
        [1, 4],
        [2, 5],
        [1, 5],
        [3, 5],
        ...(payload.preferences.allowSaturday !== false ? [[5, 6]] : []),
      ];

  // Canonical 1.5-hour timetable slots for MW / TTH (strictly avoiding lunch break)
  const split15Slots = isHsBlock
    ? [
        ['07:30', '09:00'],
        ['09:00', '10:30'],
        ['10:30', '12:00'],
        ['07:00', '08:30'],
        ['08:30', '10:00'],
        ['10:00', '11:30'],
        ['13:00', '14:30'],
        ['14:30', '16:00'],
      ]
    : payload.preferences.preferMornings
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
  const canonicalStartTimes = isHsBlock
    ? [
        '07:00',
        '07:30',
        '08:00',
        '08:30',
        '09:00',
        '09:30',
        '10:00',
        '10:30',
        '11:00',
        '13:00',
        '13:30',
        '14:00',
        '14:30',
        '15:00',
      ]
    : payload.preferences.preferMornings
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
    if (!roomId || roomId === '00000000-0000-0000-0000-000000000000') return false;
    if (proposed.some((p) => {
      if (p.roomId !== roomId || p.dayOfWeek !== day) return false;
      const off = payload.offerings.find((o) => o.id === p.offeringId);
      if (off?.subject.facilityType === 'unspecified') return false;
      return timeRangesOverlap(sTime, eTime, p.startTime, p.endTime);
    })) {
      return true;
    }
    if (payload.existingEntries.some((e) => {
      if (!e.roomId || e.roomId !== roomId || e.dayOfWeek !== day) return false;
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
      if (isInstructorOccupied(inst.id, day, sTime, eTime)) return false;
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

    // All eligible rooms are valid (room capacity constraint removed)
    const validRooms = eligibleRooms;
    const lectureRooms = validRooms.filter((r) => r.roomType === 'lecture');
    const labRooms = validRooms.filter((r) => r.roomType === 'laboratory');

    const preferredLectureRooms = lectureRooms.length > 0 ? lectureRooms : validRooms;
    const preferredLabRooms = labRooms.length > 0 ? labRooms : validRooms;

    let lectureDays: number[] = [];
    let assignedInstructorId: string | null = null;

    const subCodeUpper = (subject.code || '').toUpperCase();
    const subTitleUpper = (subject.title || '').toUpperCase();
    const isPE =
      subCodeUpper.includes('PE') ||
      subCodeUpper.includes('PATHFIT') ||
      subTitleUpper.includes('PHYSICAL EDUCATION') ||
      subTitleUpper.includes('PATHFIT');
    const isNSTP =
      subCodeUpper.includes('NSTP') ||
      subCodeUpper.includes('ROTC') ||
      subCodeUpper.includes('CWTS') ||
      subTitleUpper.includes('NATIONAL SERVICE') ||
      subTitleUpper.includes('NSTP');
    const isPEorNSTP = isPE || isNSTP;

    // =========================================================================
    // DAY PAIRING (MW & TTH) - PRIMARY SCHEDULING MODE
    // =========================================================================

    // CASE 1: Standard 3-Unit Course with Lecture (1.5h) & Lab (1.5h)
    // Scheduled together across the Day Pair (MW or TTH) at the exact same time slot!
    // Day 1 (Mon / Tue): Lecture session (1.5h) in Lecture Room
    // Day 2 (Wed / Thu): Lab session (1.5h) in Computer Lab
    if (isSplitTwoDays && !isPEorNSTP && subject.lectureHours === 1.5 && subject.labHours === 1.5) {
      let placedPair = false;
      const pairRounds = [
        offIndex % 2 === 0 ? dayPairs : [...dayPairs].reverse(),
        extendedDayPairs,
      ];

      for (const roundPairs of pairRounds) {
        if (placedPair) break;
        for (const [d1, d2] of roundPairs) {
          if (placedPair) break;
          for (const [sTime, eTime] of split15Slots) {
            const [eh, em] = eTime.split(':').map(Number);
            if (eh * 60 + em > maxEndMinutes) continue;

            const slotKey1 = `${offering.id}:${d1}:${sTime}-${eTime}`;
            const slotKey2 = `${offering.id}:${d2}:${sTime}-${eTime}`;
            if (excludedSlots.has(slotKey1) || excludedSlots.has(slotKey2)) continue;

            // Block must be free at this time slot on both days
            if (isBlockTimeOccupied(d1, sTime, eTime) || isBlockTimeOccupied(d2, sTime, eTime)) continue;

            // Pick qualified instructor available on both days
            const instructor = pickBestInstructorForPair(qualifiedInstructors, d1, d2, sTime, eTime);
            if (!instructor) continue;

            // Room for Day 1 (Lecture) - prefer lecture rooms, overflow to lab rooms or any valid room if all booked
            const isLecUnspecified = subject.facilityType === 'unspecified';
            let lecRoom = isLecUnspecified
              ? null
              : preferredLectureRooms.find(
                  (r) =>
                    !isRoomOccupied(r.id, d1, sTime, eTime) &&
                    !hasFixedConstraintCollision(r.id, d1, sTime, eTime)
                );
            if (!isLecUnspecified && !lecRoom) {
              lecRoom = preferredLabRooms.find(
                (r) =>
                  !isRoomOccupied(r.id, d1, sTime, eTime) &&
                  !hasFixedConstraintCollision(r.id, d1, sTime, eTime)
              ) || validRooms.find(
                (r) =>
                  !isRoomOccupied(r.id, d1, sTime, eTime) &&
                  !hasFixedConstraintCollision(r.id, d1, sTime, eTime)
              );
            }
            if (!isLecUnspecified && !lecRoom) continue;

            // Room for Day 2 (Computer Lab) - overflow to validRooms if needed
            let labRoom = preferredLabRooms.find(
              (r) =>
                !isRoomOccupied(r.id, d2, sTime, eTime) &&
                !hasFixedConstraintCollision(r.id, d2, sTime, eTime)
            ) || validRooms.find(
              (r) =>
                !isRoomOccupied(r.id, d2, sTime, eTime) &&
                !hasFixedConstraintCollision(r.id, d2, sTime, eTime)
            );
            if (!labRoom) continue;

            // Place Day 1 Lecture
            proposed.push({
              offeringId: offering.id,
              instructorId: instructor.id,
              roomId: isLecUnspecified ? '00000000-0000-0000-0000-000000000000' : (lecRoom ? lecRoom.id : '00000000-0000-0000-0000-000000000000'),
              dayOfWeek: d1,
              startTime: sTime,
              endTime: eTime,
              sessionType: 'lecture',
            });

            // Place Day 2 Lab
            proposed.push({
              offeringId: offering.id,
              instructorId: instructor.id,
              roomId: labRoom.id,
              dayOfWeek: d2,
              startTime: sTime,
              endTime: eTime,
              sessionType: 'lab',
            });

            const durMin = 90;
            instructorAssignedMinutes.set(instructor.id, (instructorAssignedMinutes.get(instructor.id) || 0) + durMin * 2);
            for (const d of [d1, d2]) {
              if (!instructorDailyMinutes.has(instructor.id)) instructorDailyMinutes.set(instructor.id, new Map());
              const dMap = instructorDailyMinutes.get(instructor.id)!;
              dMap.set(d, (dMap.get(d) || 0) + durMin);
            }

            placedPair = true;
            break;
          }
        }
      }

      if (placedPair) {
        continue; // Successfully scheduled on day pair!
      }
    }

    // CASE 2: Pure 3-Hour Lecture Course (3.0h lecture, 0h lab)
    // Scheduled as two 1.5-hour lecture sessions on Day Pair (MW or TTH) at the same time slot!
    if (isSplitTwoDays && !isPEorNSTP && subject.lectureHours === 3 && subject.labHours === 0) {
      let placedPair = false;
      const pairRounds = [
        offIndex % 2 === 0 ? dayPairs : [...dayPairs].reverse(),
        extendedDayPairs,
      ];

      for (const roundPairs of pairRounds) {
        if (placedPair) break;
        for (const [d1, d2] of roundPairs) {
          if (placedPair) break;
          for (const [sTime, eTime] of split15Slots) {
            const [eh, em] = eTime.split(':').map(Number);
            if (eh * 60 + em > maxEndMinutes) continue;

            const slotKey1 = `${offering.id}:${d1}:${sTime}-${eTime}`;
            const slotKey2 = `${offering.id}:${d2}:${sTime}-${eTime}`;
            if (excludedSlots.has(slotKey1) || excludedSlots.has(slotKey2)) continue;

            // Block must be free on both days
            if (isBlockTimeOccupied(d1, sTime, eTime) || isBlockTimeOccupied(d2, sTime, eTime)) continue;

            // Pick instructor available on both days
            const instructor = pickBestInstructorForPair(qualifiedInstructors, d1, d2, sTime, eTime);
            if (!instructor) continue;

            // Find a lecture room available on both days - prefer lecture rooms, overflow to lab rooms or any room
            const isUnspecified = subject.facilityType === 'unspecified';
            let roomToUse = isUnspecified
              ? null
              : preferredLectureRooms.find(
                  (r) =>
                    !isRoomOccupied(r.id, d1, sTime, eTime) &&
                    !isRoomOccupied(r.id, d2, sTime, eTime) &&
                    !hasFixedConstraintCollision(r.id, d1, sTime, eTime) &&
                    !hasFixedConstraintCollision(r.id, d2, sTime, eTime)
                );
            if (!isUnspecified && !roomToUse) {
              roomToUse = preferredLabRooms.find(
                (r) =>
                  !isRoomOccupied(r.id, d1, sTime, eTime) &&
                  !isRoomOccupied(r.id, d2, sTime, eTime) &&
                  !hasFixedConstraintCollision(r.id, d1, sTime, eTime) &&
                  !hasFixedConstraintCollision(r.id, d2, sTime, eTime)
              ) || validRooms.find(
                (r) =>
                  !isRoomOccupied(r.id, d1, sTime, eTime) &&
                  !isRoomOccupied(r.id, d2, sTime, eTime) &&
                  !hasFixedConstraintCollision(r.id, d1, sTime, eTime) &&
                  !hasFixedConstraintCollision(r.id, d2, sTime, eTime)
              );
            }
            if (!isUnspecified && !roomToUse) continue;

            // Place on both days (90m each = 180m = 3h total)
            proposed.push({
              offeringId: offering.id,
              instructorId: instructor.id,
              roomId: isUnspecified ? '00000000-0000-0000-0000-000000000000' : (roomToUse ? roomToUse.id : '00000000-0000-0000-0000-000000000000'),
              dayOfWeek: d1,
              startTime: sTime,
              endTime: eTime,
              sessionType: 'lecture',
            });
            proposed.push({
              offeringId: offering.id,
              instructorId: instructor.id,
              roomId: isUnspecified ? '00000000-0000-0000-0000-000000000000' : (roomToUse ? roomToUse.id : '00000000-0000-0000-0000-000000000000'),
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

            placedPair = true;
            break;
          }
        }
      }

      if (placedPair) {
        continue; // Successfully scheduled on day pair!
      }
    }

    // =========================================================================
    // FALLBACK / SINGLE-SESSION SCHEDULING
    // (For 2-hour PE, 1-hour courses, or if paired placement was full)
    // =========================================================================

    // 1. Plan Lecture Session (if lectureHours > 0 and not yet placed)
    if (subject.lectureHours > 0) {
      let placed = false;
      const durationHours = subject.lectureHours;
      // For PE and NSTP: prioritize Saturday (6) first, then Friday (5), then other weekdays (Monday–Thursday)
      const regularDays = [...days.slice(offIndex % days.length), ...days.slice(0, offIndex % days.length)];
      const candidateDays = isPEorNSTP
        ? [6, 5, ...days.filter((d) => d !== 6 && d !== 5)]
        : durationHours === 2
        ? [5, 6, ...days.filter((d) => d !== 5 && d !== 6)]
        : [...regularDays, 5, 6];
      const uniqueCandidateDays = Array.from(new Set(candidateDays));

      for (const day of uniqueCandidateDays) {
        if (placed) break;
        for (const sTime of canonicalStartTimes) {
          const sMin = timeToMinutes(sTime);
          const eMin = sMin + durationHours * 60;
          if (eMin > maxEndMinutes) continue;

          const eTime = `${String(Math.floor(eMin / 60)).padStart(2, '0')}:${String(eMin % 60).padStart(2, '0')}`;

          // Must NOT cross or span lunch break (12:00-13:00 for HS, 12:30-13:00 for College)!
          if (timeRangesOverlap(sTime, eTime, lunchWindow.startTime, lunchWindow.endTime)) continue;

          const slotKey = `${offering.id}:${day}:${sTime}-${eTime}`;
          if (excludedSlots.has(slotKey)) continue;

          if (isBlockTimeOccupied(day, sTime, eTime)) continue;

          const instructor = pickBestInstructor(qualifiedInstructors, day, sTime, eTime);
          if (!instructor || isInstructorOccupied(instructor.id, day, sTime, eTime)) continue;

          const isUnspecified = subject.facilityType === 'unspecified';
          let roomToUse = isUnspecified
            ? null
            : preferredLectureRooms.find(
                (r) => !isRoomOccupied(r.id, day, sTime, eTime) && !hasFixedConstraintCollision(r.id, day, sTime, eTime)
              );
          if (!isUnspecified && !roomToUse) {
            roomToUse = preferredLabRooms.find(
              (r) => !isRoomOccupied(r.id, day, sTime, eTime) && !hasFixedConstraintCollision(r.id, day, sTime, eTime)
            ) || validRooms.find(
              (r) => !isRoomOccupied(r.id, day, sTime, eTime) && !hasFixedConstraintCollision(r.id, day, sTime, eTime)
            );
          }
          if (!isUnspecified && !roomToUse) continue;

          proposed.push({
            offeringId: offering.id,
            instructorId: instructor.id,
            roomId: isUnspecified ? '00000000-0000-0000-0000-000000000000' : (roomToUse ? roomToUse.id : '00000000-0000-0000-0000-000000000000'),
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

    // 2. Plan Lab Session (if labHours > 0)
    // In university schedules, lab sessions are held on Friday or Saturday in computer labs,
    // rather than continuing on the same day in another room!
    if (subject.labHours > 0) {
      const durationHours = subject.labHours;
      let placed = false;

      // For PE & NSTP lab/activity courses, prioritize Saturday (6) first, then Friday (5)
      const labCandidateDays = isPEorNSTP
        ? [6, 5, ...days.filter((d) => d !== 6 && d !== 5)]
        : [
            5,
            6,
            ...days.filter((d) => d !== 5 && d !== 6 && !lectureDays.includes(d)),
            ...days.filter((d) => lectureDays.includes(d)),
          ];
      const uniqueLabCandidateDays = Array.from(new Set(labCandidateDays));

      for (const day of uniqueLabCandidateDays) {
        if (placed) break;
        for (const sTime of canonicalStartTimes) {
          if (placed) break;
          const sMin = timeToMinutes(sTime);
          const eMin = sMin + durationHours * 60;
          if (eMin > maxEndMinutes) continue;

          const eTime = `${String(Math.floor(eMin / 60)).padStart(2, '0')}:${String(eMin % 60).padStart(2, '0')}`;

          // Must NOT cross or span lunch break (12:00-13:00 for HS, 12:30-13:00 for College)!
          if (timeRangesOverlap(sTime, eTime, lunchWindow.startTime, lunchWindow.endTime)) continue;

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

          let roomToUse = preferredLabRooms.find(
            (r) => !isRoomOccupied(r.id, day, sTime, eTime) && !hasFixedConstraintCollision(r.id, day, sTime, eTime)
          ) || validRooms.find(
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

    // Continuous Guard: Verify that subjects never exceed or fall short of required curriculum hours
    let needsHeuristicRepair = false;

    // Enforce canonical start times for college blocks
    const isHsBlock =
      (payload.block.name || '').toLowerCase().includes('grade') ||
      (payload.block.name || '').toLowerCase().includes('high school') ||
      (payload.block.name || '').toUpperCase().startsWith('HS') ||
      payload.offerings.some(
        (o) =>
          (o.subject.code || '').startsWith('HS') ||
          (o.subject.code || '').startsWith('JHS') ||
          (o.subject.code || '').startsWith('SHS')
      );

    if (!isHsBlock) {
      const COLLEGE_CANONICAL_STARTS = new Set([
        '08:00',
        '09:30',
        '11:00',
        '13:00',
        '14:30',
        '16:00',
        '17:30',
        '19:00',
      ]);

      for (const p of validation.data) {
        const s = p.startTime.slice(0, 5);
        if (!COLLEGE_CANONICAL_STARTS.has(s)) {
          if (s === '14:00' || s === '15:00') {
            const dur = timeToMinutes(p.endTime) - timeToMinutes(s);
            p.startTime = '14:30';
            const endMin = timeToMinutes('14:30') + dur;
            p.endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
          } else if (s === '10:00') {
            const dur = timeToMinutes(p.endTime) - timeToMinutes(s);
            p.startTime = '09:30';
            const endMin = timeToMinutes('09:30') + dur;
            p.endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
          }
          if (!COLLEGE_CANONICAL_STARTS.has(p.startTime.slice(0, 5))) {
            needsHeuristicRepair = true;
            break;
          }
        }
      }
    }

    for (const off of payload.offerings) {
      const requiredHours =
        off.subject.lectureHours + off.subject.labHours > 0
          ? off.subject.lectureHours + off.subject.labHours
          : (off.subject.units || 0);
      const reqMins = requiredHours * 60;

      const offEntries = validation.data.filter((p) => p.offeringId === off.id);
      let totalAssignedMins = 0;
      for (const e of offEntries) {
        const [sh, sm] = e.startTime.split(':').map(Number);
        const [eh, em] = e.endTime.split(':').map(Number);
        totalAssignedMins += (eh * 60 + em) - (sh * 60 + sm);
      }

      // Check for over-scheduling or under-scheduling
      if (totalAssignedMins !== reqMins) {
        needsHeuristicRepair = true;
        break;
      }

      // If single-session 1h or 2h subject, ensure it was not split across multiple sessions
      if (requiredHours <= 2 && offEntries.length > 1) {
        needsHeuristicRepair = true;
        break;
      }

      // Check qualification: must only assign qualified instructors
      if (!needsHeuristicRepair) {
        const hasUnqualified = validation.data.some((p) => {
          if (!p.instructorId) return false;
          const targetOff = payload.offerings.find((o) => o.id === p.offeringId);
          if (!targetOff) return false;
          return !targetOff.qualifiedInstructors.some((qi) => qi.id === p.instructorId);
        });
        if (hasUnqualified) {
          needsHeuristicRepair = true;
          break;
        }
      }
    }

    if (needsHeuristicRepair) {
      console.warn(
        '[Gemini Flash] LLM improperly scheduled hours (over/under units) or picked unqualified instructor. Running deterministic solver to guarantee compliant schedule.'
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

