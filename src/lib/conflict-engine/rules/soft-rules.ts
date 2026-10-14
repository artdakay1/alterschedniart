// src/lib/conflict-engine/rules/soft-rules.ts
// Soft rules implementation for AlterSched Conflict Engine.
// Soft rules generate warnings/notices but do not strictly block scheduling.

import type {
  ScheduleEntryInput,
  ScheduleContext,
  Violation,
  SubjectInfo,
  InstructorInfo,
} from '../types.ts';
import {
  getDayName,
} from '../utils.ts';

/**
 * Evaluates all soft advisory rules against schedule entries and context.
 */
export function checkSoftRules(
  entries: ScheduleEntryInput[],
  context: ScheduleContext
): Violation[] {
  const violations: Violation[] = [];

  const subjectsMap = new Map<string, SubjectInfo>(context.subjects.map((s) => [s.id, s]));
  const instructorsMap = new Map<string, InstructorInfo>(
    context.instructors.map((i) => [i.id, i])
  );

  // 1. UNQUALIFIED INSTRUCTOR
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

  // 2. IRREGULAR DAY PAIRING
  // Warn (not block) if a multi-session lecture course doesn't follow MW (1 & 3) or TTH (2 & 4) convention.
  // Labs, electives, capstone, 2-unit/single-session courses, and Friday/Saturday sessions are exempt.
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

    // Subjects with 1 or 2 units/hours are single continuous sessions and exempt from 2-day pairing
    if (
      subject &&
      (subject.units === 2 ||
        subject.units === 1 ||
        (subject.lectureHours <= 2 && subject.lectureHours > 0) ||
        /^(PE|PATHFIT|NSTP)/i.test(subject.code || ''))
    ) {
      continue;
    }

    const isHs =
      (subject?.code || '').toUpperCase().startsWith('HS') ||
      (subject?.code || '').toUpperCase().startsWith('JHS') ||
      (subject?.code || '').toUpperCase().startsWith('SHS') ||
      (subject?.code || '').toUpperCase().startsWith('GRADE');
    if (isHs) continue;

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

