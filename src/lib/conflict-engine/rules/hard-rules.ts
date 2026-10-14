// src/lib/conflict-engine/rules/hard-rules.ts
// Hard rules implementation for AlterSched Conflict Engine.
// Hard rules block publishing or scheduling validation.

import type {
  ScheduleEntryInput,
  ScheduleContext,
  Violation,
  RoomInfo,
  SubjectInfo,
  InstructorInfo,
  BlockInfo,
} from '../types.ts';
import {
  timeRangesOverlap,
  isTimeRangeWithin,
  timeToMinutes,
  formatTimeShort,
  getDayName,
} from '../utils.ts';
import { TIME_SLOTS } from '../time-slots.ts';

/**
 * Evaluates all hard conflict rules against the given schedule entries and context.
 */
export function checkHardRules(
  entries: ScheduleEntryInput[],
  context: ScheduleContext
): Violation[] {
  const violations: Violation[] = [];

  const roomsMap = new Map<string, RoomInfo>(context.rooms.map((r) => [r.id, r]));
  const subjectsMap = new Map<string, SubjectInfo>(context.subjects.map((s) => [s.id, s]));
  const instructorsMap = new Map<string, InstructorInfo>(
    context.instructors.map((i) => [i.id, i])
  );
  const blocksMap = new Map<string, BlockInfo>(context.blocks.map((b) => [b.id, b]));

  // 1. INSTRUCTOR OVERLAP: Same instructor, same day, overlapping time
  const instructorDayMap = new Map<string, ScheduleEntryInput[]>();
  for (const entry of entries) {
    if (!entry.instructorId) continue;
    const key = `${entry.dayOfWeek}:${entry.instructorId}`;
    const list = instructorDayMap.get(key) || [];
    list.push(entry);
    instructorDayMap.set(key, list);
  }

  for (const [, group] of instructorDayMap.entries()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
          const instructor = instructorsMap.get(a.instructorId);
          const instName = instructor?.name || 'Instructor';
          const dayName = getDayName(a.dayOfWeek);
          violations.push({
            severity: 'hard',
            rule: 'instructor_overlap',
            message: `${instName} is double-booked on ${dayName}: overlapping sessions from ${formatTimeShort(
              a.startTime
            )}-${formatTimeShort(a.endTime)} and ${formatTimeShort(
              b.startTime
            )}-${formatTimeShort(b.endTime)}.`,
            entryIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // 2. ROOM OVERLAP: Same room, same day, overlapping time
  const roomDayMap = new Map<string, ScheduleEntryInput[]>();
  for (const entry of entries) {
    if (!entry.roomId || entry.roomId === '00000000-0000-0000-0000-000000000000') continue;
    const room = roomsMap.get(entry.roomId);
    if (room?.name === 'None (N/A)' || room?.name === 'TBA (N/A)') continue;
    const subject = subjectsMap.get(entry.subjectId);
    // Subjects with unspecified facility/room type do not need a specific room: do not mark as room conflict
    if (subject?.facilityType === 'unspecified') continue;
    const key = `${entry.dayOfWeek}:${entry.roomId}`;
    const list = roomDayMap.get(key) || [];
    list.push(entry);
    roomDayMap.set(key, list);
  }

  for (const [, group] of roomDayMap.entries()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
          const room = a.roomId ? roomsMap.get(a.roomId) : undefined;
          const roomName = room?.name || 'Room';
          const dayName = getDayName(a.dayOfWeek);
          violations.push({
            severity: 'hard',
            rule: 'room_overlap',
            message: `Room conflict in ${roomName} on ${dayName}: overlapping classes scheduled from ${formatTimeShort(
              a.startTime
            )}-${formatTimeShort(a.endTime)} and ${formatTimeShort(
              b.startTime
            )}-${formatTimeShort(b.endTime)}.`,
            entryIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // 3. BLOCK OVERLAP: Same student block, same day, overlapping time
  const blockDayMap = new Map<string, ScheduleEntryInput[]>();
  for (const entry of entries) {
    if (!entry.blockId) continue;
    const key = `${entry.dayOfWeek}:${entry.blockId}`;
    const list = blockDayMap.get(key) || [];
    list.push(entry);
    blockDayMap.set(key, list);
  }

  for (const [, group] of blockDayMap.entries()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (timeRangesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
          const block = blocksMap.get(a.blockId);
          const blockName = block?.name || `Block ${a.blockId}`;
          const dayName = getDayName(a.dayOfWeek);
          violations.push({
            severity: 'hard',
            rule: 'block_overlap',
            message: `Block conflict for ${blockName} on ${dayName}: overlapping classes scheduled from ${formatTimeShort(
              a.startTime
            )}-${formatTimeShort(a.endTime)} and ${formatTimeShort(
              b.startTime
            )}-${formatTimeShort(b.endTime)}.`,
            entryIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // 4. FIXED CONSTRAINT CLASH: Overlaps fixed_constraints on room/day/time
  for (const entry of entries) {
    if (!entry.roomId || entry.roomId === '00000000-0000-0000-0000-000000000000') continue;
    const room = roomsMap.get(entry.roomId);
    if (room?.name === 'None (N/A)' || room?.name === 'TBA (N/A)') continue;
    const subject = subjectsMap.get(entry.subjectId);
    if (subject?.facilityType === 'unspecified') continue;

    for (const constraint of context.fixedConstraints) {
      if (constraint.dayOfWeek !== entry.dayOfWeek) continue;

      // Constraint applies if roomId is null (all rooms) or matches entry roomId
      const roomMatches = !constraint.roomId || constraint.roomId === entry.roomId;
      if (!roomMatches) continue;

      if (timeRangesOverlap(entry.startTime, entry.endTime, constraint.startTime, constraint.endTime)) {
        const room = entry.roomId ? roomsMap.get(entry.roomId)?.name : 'All Facilities';
        const dayName = getDayName(entry.dayOfWeek);
        violations.push({
          severity: 'hard',
          rule: 'fixed_constraint_clash',
          message: `Class session clashes with external blackout "${constraint.label}" (${constraint.source.replace(
            '_',
            ' '
          )}) in ${room} on ${dayName} (${formatTimeShort(constraint.startTime)}-${formatTimeShort(
            constraint.endTime
          )}).`,
          entryIds: [entry.id],
        });
      }
    }
  }

  // 5. INSTRUCTOR UNAVAILABLE: Outside availability windows for that day
  for (const entry of entries) {
    const instructor = instructorsMap.get(entry.instructorId);
    if (!instructor) continue;

    // Check if instructor has availability rules defined
    if (instructor.availability && instructor.availability.length > 0) {
      const daySlots = instructor.availability.filter(
        (slot) => slot.dayOfWeek === entry.dayOfWeek
      );

      // Must be completely contained within at least one valid slot
      const isAvailable = daySlots.some((slot) =>
        isTimeRangeWithin(entry.startTime, entry.endTime, slot.startTime, slot.endTime)
      );

      if (!isAvailable) {
        const instName = instructor.name || 'Instructor';
        const dayName = getDayName(entry.dayOfWeek);
        violations.push({
          severity: 'hard',
          rule: 'instructor_unavailable',
          message: `${instName} is not available on ${dayName} between ${formatTimeShort(
            entry.startTime
          )} and ${formatTimeShort(entry.endTime)}.`,
          entryIds: [entry.id],
        });
      }
    }
  }

  // 6. DUPLICATE SUBJECT IN BLOCK: Same subject assigned to same block across multiple offerings
  const blockSubjectOfferings = new Map<string, { offeringIds: Set<string>; entryIds: string[] }>();
  for (const entry of entries) {
    const key = `${entry.blockId}:${entry.subjectId}`;
    const record = blockSubjectOfferings.get(key) || {
      offeringIds: new Set<string>(),
      entryIds: [],
    };
    record.offeringIds.add(entry.offeringId);
    record.entryIds.push(entry.id);
    blockSubjectOfferings.set(key, record);
  }

  for (const [key, record] of blockSubjectOfferings.entries()) {
    if (record.offeringIds.size > 1) {
      const [blockId, subjectId] = key.split(':');
      const block = blocksMap.get(blockId);
      const subject = subjectsMap.get(subjectId);
      const blockName = block?.name || `Block ${blockId}`;
      const subjectCode = subject?.code || subject?.title || 'Subject';
      violations.push({
        severity: 'hard',
        rule: 'duplicate_subject_in_block',
        message: `Duplicate assignment: Subject ${subjectCode} is assigned multiple times to ${blockName} across different class offerings.`,
        entryIds: record.entryIds,
      });
    }
  }

  // 7. INCOMPLETE HOURS: sum of scheduled minutes != (lecture_hours + lab_hours) * 60
  // Group by offering (or blockId + subjectId)
  const offeringMinutesMap = new Map<
    string,
    { totalMinutes: number; entryIds: string[]; blockId: string; subjectId: string }
  >();

  for (const entry of entries) {
    const offeringKey = entry.offeringId || `${entry.blockId}:${entry.subjectId}`;
    const record = offeringMinutesMap.get(offeringKey) || {
      totalMinutes: 0,
      entryIds: [],
      blockId: entry.blockId,
      subjectId: entry.subjectId,
    };
    const duration = timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime);
    record.totalMinutes += Math.max(0, duration);
    record.entryIds.push(entry.id);
    offeringMinutesMap.set(offeringKey, record);
  }

  for (const record of offeringMinutesMap.values()) {
    const subject = subjectsMap.get(record.subjectId);
    if (!subject) continue;

    const totalHours =
      subject.lectureHours + subject.labHours > 0
        ? subject.lectureHours + subject.labHours
        : (subject.units || 0);
    const requiredMinutes = totalHours * 60;
    if (record.totalMinutes !== requiredMinutes) {
      const block = blocksMap.get(record.blockId);
      const blockName = block?.name || 'Block';
      const subjectCode = subject.code || subject.title || 'Course';
      const reqHours = (requiredMinutes / 60).toFixed(1);
      const curHours = (record.totalMinutes / 60).toFixed(1);

      violations.push({
        severity: 'hard',
        rule: 'incomplete_hours',
        message: `Incomplete hours for ${blockName} - ${subjectCode}: scheduled ${curHours}h (${record.totalMinutes}m), but curriculum requires ${reqHours}h (${requiredMinutes}m: ${subject.lectureHours}h lec + ${subject.labHours}h lab).`,
        entryIds: record.entryIds,
      });
    }
  }

  // 8. INVALID TIME SLOT: start_time and lab end_time must match canonical TIME_SLOTS grid
  for (const entry of entries) {
    const normStart = formatTimeShort(entry.startTime);
    const normEnd = formatTimeShort(entry.endTime);
    const startMin = timeToMinutes(entry.startTime);
    const endMin = timeToMinutes(entry.endTime);
    const durationMin = endMin - startMin;

    if (entry.dayOfWeek === 0) {
      // Sunday is not in the canonical timetable grid
      violations.push({
        severity: 'hard',
        rule: 'invalid_time_slot',
        message: `Sunday sessions are outside the canonical AlterSched timetable grid.`,
        entryIds: [entry.id],
      });
    } else if (entry.dayOfWeek >= 1 && entry.dayOfWeek <= 6) {
      const block = blocksMap.get(entry.blockId);
      const subject = subjectsMap.get(entry.subjectId);
      const subCode = (subject?.code || '').toUpperCase().trim();
      const subTitle = (subject?.title || '').toLowerCase();
      const blkName = (block?.name || '').toLowerCase();
      const isHsEntry =
        blkName.includes('grade') ||
        blkName.includes('high school') ||
        (block?.name || '').toUpperCase().startsWith('HS') ||
        subCode.startsWith('HS') ||
        subCode.startsWith('JHS') ||
        subCode.startsWith('SHS') ||
        subCode.startsWith('GRADE') ||
        subCode === 'ROBOTICS' ||
        subCode === 'IT 1' ||
        subCode === 'ARDUINO' ||
        subTitle.includes('junior high') ||
        subTitle.includes('senior high') ||
        subTitle.includes('grade ');

      const isOneOrTwoUnitSubject = Boolean(
        subject && (
          subject.units === 1 ||
          subject.units === 2 ||
          (subject.lectureHours + subject.labHours === 1) ||
          (subject.lectureHours + subject.labHours === 2) ||
          (subject.lectureHours === 1 && subject.labHours === 0) ||
          (subject.lectureHours === 2 && subject.labHours === 0) ||
          /^(PE|PATHFIT|NSTP)/i.test(subject.code || '') ||
          /^(Physical Education|PATHFit)/i.test(subject.title || '')
        )
      );

      const hsStarts = [
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
      ];
      const hourlyStarts = [
        '08:00',
        '09:00',
        '10:00',
        '11:00',
        '12:00',
        '13:00',
        '14:00',
        '15:00',
        '16:00',
        '17:00',
        '18:00',
      ];
      const validStartTimes = isHsEntry
        ? Array.from(new Set([...hsStarts, ...(TIME_SLOTS.startTimes as readonly string[])]))
        : isOneOrTwoUnitSubject
        ? Array.from(new Set([...(TIME_SLOTS.startTimes as readonly string[]), ...hourlyStarts]))
        : (TIME_SLOTS.startTimes as readonly string[]);

      const isValidStart = validStartTimes.includes(normStart);
      const isValidEnd = (TIME_SLOTS.slotBoundaries as readonly string[]).includes(normEnd);

      if (isHsEntry && (normStart < '07:00' || normEnd > '16:00')) {
        violations.push({
          severity: 'hard',
          rule: 'invalid_time_slot',
          message: `High School class session on ${getDayName(entry.dayOfWeek)} (${formatTimeShort(normStart)}-${formatTimeShort(normEnd)}) is outside the High School timetable window (7:00 AM to 4:00 PM).`,
          entryIds: [entry.id],
        });
      } else if (!isValidStart) {
        violations.push({
          severity: 'hard',
          rule: 'invalid_time_slot',
          message: `Invalid start time "${normStart}" on ${getDayName(entry.dayOfWeek)}. Sessions must start at one of: ${validStartTimes.join(', ')}.`,
          entryIds: [entry.id],
        });
      } else if (!isValidEnd) {
        violations.push({
          severity: 'hard',
          rule: 'invalid_time_slot',
          message: `Invalid end time "${normEnd}" on ${getDayName(entry.dayOfWeek)}. Sessions must end at a valid slot boundary: ${TIME_SLOTS.slotBoundaries.join(', ')}.`,
          entryIds: [entry.id],
        });
      } else if (durationMin < 60 || durationMin % 30 !== 0) {
        violations.push({
          severity: 'hard',
          rule: 'invalid_time_slot',
          message: `Invalid session duration (${durationMin} min) on ${getDayName(entry.dayOfWeek)}. Sessions must align to standard academic slot increments.`,
          entryIds: [entry.id],
        });
      } else if (!isOneOrTwoUnitSubject && entry.sessionType === 'lab' && durationMin % TIME_SLOTS.standardDurationMinutes !== 0) {
        violations.push({
          severity: 'hard',
          rule: 'invalid_time_slot',
          message: `Invalid laboratory duration (${durationMin} min) on ${getDayName(entry.dayOfWeek)}. Lab sessions must align to standard ${TIME_SLOTS.standardDurationMinutes}-minute slot increments.`,
          entryIds: [entry.id],
        });
      }
    }
  }

  // 9. SPANS LUNCH BREAK:
  // - College: no single entry may overlap 12:30-13:00 (must conclude by 12:30 or start at/after 13:00)
  // - High School: no single entry may overlap 12:00-13:00 (must conclude by 12:00 or start at/after 13:00)
  for (const entry of entries) {
    const block = blocksMap.get(entry.blockId);
    const subject = subjectsMap.get(entry.subjectId);
    const subCode = (subject?.code || '').toUpperCase().trim();
    const subTitle = (subject?.title || '').toLowerCase();
    const blkName = (block?.name || '').toLowerCase();
    const isHsEntry =
      blkName.includes('grade') ||
      blkName.includes('high school') ||
      (block?.name || '').toUpperCase().startsWith('HS') ||
      subCode.startsWith('HS') ||
      subCode.startsWith('JHS') ||
      subCode.startsWith('SHS') ||
      subCode.startsWith('GRADE') ||
      subCode === 'ROBOTICS' ||
      subCode === 'IT 1' ||
      subCode === 'ARDUINO' ||
      subTitle.includes('junior high') ||
      subTitle.includes('senior high') ||
      subTitle.includes('grade ');

    const lunchWindow = isHsEntry
      ? TIME_SLOTS.hsLunchBreak
      : TIME_SLOTS.lunchBreak;

    if (
      timeRangesOverlap(
        entry.startTime,
        entry.endTime,
        lunchWindow.startTime,
        lunchWindow.endTime
      )
    ) {
      const dayName = getDayName(entry.dayOfWeek);
      const deptLabel = isHsEntry ? 'High School class session' : 'Class session';
      const breakLabel = isHsEntry
        ? 'High School lunch break (12:00-13:00)'
        : 'institutional lunch break (12:30-13:00)';
      const concludeLabel = isHsEntry ? '12:00' : '12:30';

      violations.push({
        severity: 'hard',
        rule: 'spans_lunch_break',
        message: `${deptLabel} on ${dayName} (${formatTimeShort(entry.startTime)}-${formatTimeShort(
          entry.endTime
        )}) crosses the ${breakLabel}. Sessions must conclude by ${concludeLabel} or begin at/after 13:00.`,
        entryIds: [entry.id],
      });
    }
  }

  return violations;
}

