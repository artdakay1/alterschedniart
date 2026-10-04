// src/lib/conflict-engine/rules/soft-rules.ts
// Soft rules implementation for AlterSched Conflict Engine.
// Soft rules generate warnings/notices but do not strictly block scheduling.

import type {
  ScheduleEntryInput,
  ScheduleContext,
  Violation,
  RoomInfo,
  SubjectInfo,
  InstructorInfo,
} from '../types.ts';
import {
  timeToMinutes,
  getDayName,
} from '../utils.ts';

/**
 * Recommended maximum scheduled teaching hours for an instructor in a single day.
 */
export const MAX_DAILY_HOURS = 6;

/**
 * Evaluates all soft advisory rules against schedule entries and context.
 */
export function checkSoftRules(
  entries: ScheduleEntryInput[],
  context: ScheduleContext
): Violation[] {
  const violations: Violation[] = [];

  const roomsMap = new Map<string, RoomInfo>(context.rooms.map((r) => [r.id, r]));
  const subjectsMap = new Map<string, SubjectInfo>(context.subjects.map((s) => [s.id, s]));
  const instructorsMap = new Map<string, InstructorInfo>(
    context.instructors.map((i) => [i.id, i])
  );

  // 1. LAB ROOM UNDERUSED (FYI Warning)
  // Session in a laboratory room, subject does NOT require lab, and instructor.needsLabEquipment is false.
  // Explicitly NOT a hard error — only an informational advisory that a lab is used as a standard room.
  for (const entry of entries) {
    const room = entry.roomId ? roomsMap.get(entry.roomId) : undefined;
    const subject = subjectsMap.get(entry.subjectId);
    const instructor = instructorsMap.get(entry.instructorId);

    const isUnspecified = subject?.facilityType === 'unspecified';

    if (
      !isUnspecified &&
      room?.roomType === 'laboratory' &&
      subject &&
      !subject.requiresLab &&
      entry.sessionType !== 'lab' &&
      instructor &&
      !instructor.needsLabEquipment
    ) {
      const roomName = room.name || 'Laboratory';
      const subjectCode = subject.code || 'Course';
      const instName = instructor.name || 'Instructor';

      violations.push({
        severity: 'soft',
        rule: 'lab_room_underused',
        message: `FYI Notice: Class scheduled in laboratory "${roomName}" for non-lab subject "${subjectCode}", and ${instName} does not require specialized lab equipment. Permitted as standard classroom usage.`,
        entryIds: [entry.id],
      });
    }
  }

  // 2. UNQUALIFIED INSTRUCTOR
  // Instructor has no qualifications record for the subject
  for (const entry of entries) {
    const instructor = instructorsMap.get(entry.instructorId);
    const subject = subjectsMap.get(entry.subjectId);

    if (instructor && subject) {
      const isQualified =
        Array.isArray(instructor.qualifications) &&
        instructor.qualifications.includes(entry.subjectId);

      if (!isQualified) {
        const instName = instructor.name || 'Instructor';
        const subjectCode = subject.code || subject.title || 'Course';

        violations.push({
          severity: 'soft',
          rule: 'unqualified_instructor',
          message: `${instName} does not hold a documented teaching qualification for ${subjectCode}.`,
          entryIds: [entry.id],
        });
      }
    }
  }

  // 3. HEAVY LOAD DAY
  // Same instructor has more than MAX_DAILY_HOURS scheduled in one day
  const instructorDayMinutes = new Map<
    string,
    { totalMinutes: number; entryIds: string[]; instructorId: string; dayOfWeek: number }
  >();

  for (const entry of entries) {
    if (!entry.instructorId) continue;
    const key = `${entry.dayOfWeek}:${entry.instructorId}`;
    const record = instructorDayMinutes.get(key) || {
      totalMinutes: 0,
      entryIds: [],
      instructorId: entry.instructorId,
      dayOfWeek: entry.dayOfWeek,
    };

    const duration = timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime);
    record.totalMinutes += Math.max(0, duration);
    record.entryIds.push(entry.id);
    instructorDayMinutes.set(key, record);
  }

  const maxMinutes = MAX_DAILY_HOURS * 60;
  for (const record of instructorDayMinutes.values()) {
    if (record.totalMinutes > maxMinutes) {
      const instructor = instructorsMap.get(record.instructorId);
      const instName = instructor?.name || 'Instructor';
      const dayName = getDayName(record.dayOfWeek);
      const scheduledHours = (record.totalMinutes / 60).toFixed(1);

      violations.push({
        severity: 'soft',
        rule: 'heavy_load_day',
        message: `${instName} is assigned ${scheduledHours} hours of instruction on ${dayName}, exceeding the recommended limit of ${MAX_DAILY_HOURS} hours/day.`,
        entryIds: record.entryIds,
      });
    }
  }

  // 4. IRREGULAR DAY PAIRING
  // Warn (not block) if a lecture-type entry's day doesn't follow MW (1 & 3) or TTH (2 & 4) convention.
  // Labs, electives, capstone, and Friday/Saturday sessions are exempt.
  const offeringLectureEntries = new Map<
    string,
    { subjectId: string; entries: ScheduleEntryInput[] }
  >();

  for (const entry of entries) {
    if (entry.sessionType !== 'lecture') continue;
    // Friday (5), Saturday (6), and Sunday (0) sessions are exempt
    if (entry.dayOfWeek === 0 || entry.dayOfWeek === 5 || entry.dayOfWeek === 6) continue;

    const subject = subjectsMap.get(entry.subjectId);
    if (isElectiveOrCapstone(subject)) continue;

    const offeringKey = entry.offeringId || `${entry.blockId}:${entry.subjectId}`;
    const record = offeringLectureEntries.get(offeringKey) || {
      subjectId: entry.subjectId,
      entries: [],
    };
    record.entries.push(entry);
    offeringLectureEntries.set(offeringKey, record);
  }

  for (const record of offeringLectureEntries.values()) {
    const subject = subjectsMap.get(record.subjectId);
    const subjectCode = subject?.code || subject?.title || 'Lecture course';
    const distinctDays = Array.from(new Set(record.entries.map((e) => e.dayOfWeek))).sort(
      (a, b) => a - b
    );
    const daysKey = distinctDays.join(',');

    const isMW = daysKey === '1,3';   // Monday & Wednesday
    const isTTH = daysKey === '2,4';  // Tuesday & Thursday

    if (!isMW && !isTTH) {
      const scheduledDaysNames = distinctDays.map(getDayName).join(', ');
      violations.push({
        severity: 'soft',
        rule: 'irregular_day_pairing',
        message: `Irregular lecture day pairing for ${subjectCode}: scheduled on [${scheduledDaysNames}]. Lecture sessions on weekdays should follow the standard MW (Monday & Wednesday) or TTH (Tuesday & Thursday) pairing convention.`,
        entryIds: record.entries.map((e) => e.id),
      });
    }
  }

  return violations;
}

/**
 * Checks whether a course is an elective or capstone course.
 */
function isElectiveOrCapstone(subject?: SubjectInfo): boolean {
  if (!subject) return false;
  const code = (subject.code || '').toUpperCase();
  const title = (subject.title || '').toUpperCase();
  return (
    code.includes('CAPSTONE') ||
    title.includes('CAPSTONE') ||
    code.includes('ELEC') ||
    title.includes('ELECTIVE') ||
    Boolean((subject as unknown as Record<string, unknown>).isElective) ||
    Boolean((subject as unknown as Record<string, unknown>).isCapstone)
  );
}

