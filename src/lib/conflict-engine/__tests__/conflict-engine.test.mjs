// src/lib/conflict-engine/__tests__/conflict-engine.test.mjs
// Comprehensive Unit Test Suite for AlterSched Conflict Engine.
// Run with: node --experimental-strip-types --test src/lib/conflict-engine/__tests__/conflict-engine.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  checkSchedule,
  timeRangesOverlap,
  timeToMinutes,
  isTimeRangeWithin,
} from '../index.ts';

// Reusable mock context for testing
const mockRooms = [
  { id: 'room-lec-1', name: 'Room 301', roomType: 'lecture', capacity: 45, isShared: false },
  { id: 'room-lec-small', name: 'Room 302', roomType: 'lecture', capacity: 30, isShared: false },
  { id: 'room-lab-1', name: 'Computer Lab 1', roomType: 'laboratory', capacity: 40, isShared: false },
];

const mockSubjects = [
  { id: 'sub-lec-only', code: 'GE101', title: 'Understanding the Self', requiresLab: false, lectureHours: 3, labHours: 0 },
  { id: 'sub-with-lab', code: 'IT111', title: 'Intro to Computing', requiresLab: true, lectureHours: 2, labHours: 3 },
  { id: 'sub-prog-1', code: 'IT112', title: 'Programming 1', requiresLab: true, lectureHours: 2, labHours: 3 },
  { id: 'sub-pe-2unit', code: 'PE101', title: 'Physical Education 1', units: 2, requiresLab: false, lectureHours: 2, labHours: 0 },
  { id: 'sub-nstp-1unit', code: 'NSTP1', title: 'National Service Training Program 1', units: 1, requiresLab: false, lectureHours: 1, labHours: 0 },
];

const mockInstructors = [
  {
    id: 'inst-qualified',
    name: 'Prof. Qualified',
    needsLabEquipment: true,
    qualifications: ['sub-lec-only', 'sub-with-lab', 'sub-pe-2unit', 'sub-nstp-1unit'],
    availability: [
      { dayOfWeek: 1, startTime: '08:00:00', endTime: '18:00:00' }, // Monday
      { dayOfWeek: 2, startTime: '08:00:00', endTime: '18:00:00' }, // Tuesday
      { dayOfWeek: 3, startTime: '08:00:00', endTime: '18:00:00' }, // Wednesday
      { dayOfWeek: 5, startTime: '08:00:00', endTime: '18:00:00' }, // Friday
      { dayOfWeek: 6, startTime: '08:00:00', endTime: '18:00:00' }, // Saturday
    ],
  },
  {
    id: 'inst-no-equipment',
    name: 'Prof. Standard',
    needsLabEquipment: false,
    qualifications: ['sub-lec-only', 'sub-pe-2unit', 'sub-nstp-1unit'],
    availability: [
      { dayOfWeek: 1, startTime: '08:00:00', endTime: '17:00:00' },
      { dayOfWeek: 2, startTime: '08:00:00', endTime: '17:00:00' },
      { dayOfWeek: 6, startTime: '08:00:00', endTime: '17:00:00' },
    ],
  },
];

const mockBlocks = [
  { id: 'block-1', name: 'BSIT 1-A', studentCount: 40 },
  { id: 'block-2', name: 'BSIT 1-B', studentCount: 35 },
];

const mockFixedConstraints = [
  {
    id: 'const-1',
    termId: 'term-1',
    roomId: 'room-lec-1',
    label: 'High School Morning Assembly',
    source: 'high_school',
    dayOfWeek: 1, // Monday
    startTime: '07:30:00',
    endTime: '09:00:00',
  },
  {
    id: 'const-all-rooms',
    termId: 'term-1',
    roomId: null, // Applies to all facilities
    label: 'Institutional Convocation',
    source: 'other',
    dayOfWeek: 5, // Friday
    startTime: '13:00:00',
    endTime: '15:00:00',
  },
];

const baseContext = {
  rooms: mockRooms,
  subjects: mockSubjects,
  instructors: mockInstructors,
  blocks: mockBlocks,
  fixedConstraints: mockFixedConstraints,
};

describe('AlterSched Conflict Engine Unit Tests', () => {
  // -------------------------------------------------------------
  // HELPER TESTS
  // -------------------------------------------------------------
  describe('Helper: timeRangesOverlap and Edge Touching', () => {
    it('edge-touching times (e.g. 10:00-11:00 vs 11:00-12:00) must NOT overlap', () => {
      assert.strictEqual(
        timeRangesOverlap('10:00', '11:00', '11:00', '12:00'),
        false,
        '10:00-11:00 and 11:00-12:00 must not overlap'
      );
      assert.strictEqual(
        timeRangesOverlap('11:00', '12:00', '10:00', '11:00'),
        false,
        '11:00-12:00 and 10:00-11:00 must not overlap (reversed)'
      );
    });

    it('partial overlap must return true', () => {
      assert.strictEqual(
        timeRangesOverlap('10:00', '11:30', '11:00', '12:30'),
        true,
        '10:00-11:30 overlaps with 11:00-12:30'
      );
    });

    it('complete containment must return true', () => {
      assert.strictEqual(
        timeRangesOverlap('08:00', '12:00', '09:00', '10:00'),
        true,
        '08:00-12:00 contains 09:00-10:00'
      );
    });

    it('disjoint intervals must return false', () => {
      assert.strictEqual(
        timeRangesOverlap('08:00', '09:00', '13:00', '14:00'),
        false,
        '08:00-09:00 and 13:00-14:00 must not overlap'
      );
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 1: INSTRUCTOR OVERLAP
  // -------------------------------------------------------------
  describe('Hard Rule: instructor_overlap', () => {
    it('detects when the same instructor is scheduled in overlapping slots on the same day', () => {
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '11:00',
          sessionType: 'lecture',
        },
        {
          id: 'e2',
          offeringId: 'off-2',
          blockId: 'block-2',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified', // Same instructor
          roomId: 'room-lec-small',
          dayOfWeek: 1,                   // Same day
          startTime: '10:00',             // Overlaps 09:00-11:00!
          endTime: '12:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const overlap = violations.find((v) => v.rule === 'instructor_overlap');
      assert.ok(overlap, 'Expected instructor_overlap violation');
      assert.strictEqual(overlap.severity, 'hard');
      assert.deepStrictEqual(overlap.entryIds.sort(), ['e1', 'e2']);
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 2: ROOM OVERLAP
  // -------------------------------------------------------------
  describe('Hard Rule: room_overlap', () => {
    it('detects when two classes are scheduled in the same room at overlapping times', () => {
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1', // Same room
          dayOfWeek: 1,
          startTime: '10:00',
          endTime: '12:00',
          sessionType: 'lecture',
        },
        {
          id: 'e2',
          offeringId: 'off-2',
          blockId: 'block-2',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-1', // Same room
          dayOfWeek: 1,
          startTime: '11:00',   // Overlaps 10:00-12:00!
          endTime: '13:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const overlap = violations.find((v) => v.rule === 'room_overlap');
      assert.ok(overlap, 'Expected room_overlap violation');
      assert.strictEqual(overlap.severity, 'hard');
      assert.deepStrictEqual(overlap.entryIds.sort(), ['e1', 'e2']);
    });

    it('skips entries where room_id IS NULL (off-site/no-room sessions never conflict on room)', () => {
      const entries = [
        {
          id: 'e-offsite-1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: null, // Off-site / field work
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
        {
          id: 'e-offsite-2',
          offeringId: 'off-2',
          blockId: 'block-2',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-no-equipment',
          roomId: null, // Also off-site at the exact same time
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const roomViolations = violations.filter((v) => v.rule === 'room_overlap');
      assert.strictEqual(roomViolations.length, 0, 'No room_overlap violation when roomId is null');
    });

    it('skips room conflict checks when subject facilityType is unspecified (does not need a specific room)', () => {
      const contextWithUnspecified = {
        ...baseContext,
        subjects: [
          ...baseContext.subjects,
          {
            id: 'sub-unspecified',
            code: 'THEO101',
            title: 'Theology 101',
            requiresLab: false,
            facilityType: 'unspecified',
            lectureHours: 3,
            labHours: 0,
          },
        ],
      };

      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
        {
          id: 'e2',
          offeringId: 'off-2',
          blockId: 'block-2',
          subjectId: 'sub-unspecified',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-1', // Same room, same time, but subject has unspecified facility
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, contextWithUnspecified);
      const roomViolations = violations.filter((v) => v.rule === 'room_overlap');
      assert.strictEqual(roomViolations.length, 0, 'No room_overlap when a subject has unspecified facility');
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 3: BLOCK OVERLAP
  // -------------------------------------------------------------
  describe('Hard Rule: block_overlap', () => {
    it('detects when the same student block is assigned two classes at the same time', () => {
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1', // Same block
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '11:00',
          sessionType: 'lecture',
        },
        {
          id: 'e2',
          offeringId: 'off-2',
          blockId: 'block-1', // Same block
          subjectId: 'sub-with-lab',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-small',
          dayOfWeek: 1,
          startTime: '10:30', // Overlaps 09:00-11:00!
          endTime: '12:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const overlap = violations.find((v) => v.rule === 'block_overlap');
      assert.ok(overlap, 'Expected block_overlap violation');
      assert.strictEqual(overlap.severity, 'hard');
      assert.deepStrictEqual(overlap.entryIds.sort(), ['e1', 'e2']);
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 4: FIXED CONSTRAINT CLASH
  // -------------------------------------------------------------
  describe('Hard Rule: fixed_constraint_clash', () => {
    it('detects collision with a specific room constraint', () => {
      // Room 301 is blocked on Monday 07:30 - 09:00
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '08:00', // Collides with 07:30 - 09:00!
          endTime: '10:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const clash = violations.find((v) => v.rule === 'fixed_constraint_clash');
      assert.ok(clash, 'Expected fixed_constraint_clash violation');
      assert.strictEqual(clash.severity, 'hard');
    });

    it('detects collision with an all-rooms institutional blackout', () => {
      // Friday 13:00-15:00 is an all-rooms blackout (roomId = null)
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lab-1',
          dayOfWeek: 5,       // Friday
          startTime: '14:00', // Collides with 13:00 - 15:00!
          endTime: '16:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const clash = violations.find((v) => v.rule === 'fixed_constraint_clash');
      assert.ok(clash, 'Expected all-rooms fixed_constraint_clash violation');
      assert.strictEqual(clash.severity, 'hard');
    });
  });

  // -------------------------------------------------------------
  // HARD RULE: CAPACITY EXCEEDED (REMOVED)
  // -------------------------------------------------------------
  describe('Rule: capacity_exceeded (removed)', () => {
    it('does NOT flag a violation when block student count exceeds room capacity', () => {
      // block-1 has 40 students; room-lec-small holds 30
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1', // 40 students
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-small', // 30 capacity
          dayOfWeek: 1,
          startTime: '09:30',
          endTime: '11:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const cap = violations.find((v) => v.rule === 'capacity_exceeded');
      assert.strictEqual(cap, undefined, 'capacity_exceeded should not be flagged');
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 6: INSTRUCTOR UNAVAILABLE
  // -------------------------------------------------------------
  describe('Hard Rule: instructor_unavailable', () => {
    it('detects when an entry is placed outside the instructor availability window', () => {
      // inst-no-equipment is available Mon/Tue 08:00-17:00, NOT Wednesday
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-1',
          dayOfWeek: 3, // Wednesday (not in availability!)
          startTime: '09:00',
          endTime: '12:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const unavail = violations.find((v) => v.rule === 'instructor_unavailable');
      assert.ok(unavail, 'Expected instructor_unavailable violation');
      assert.strictEqual(unavail.severity, 'hard');
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 7: DUPLICATE SUBJECT IN BLOCK
  // -------------------------------------------------------------
  describe('Hard Rule: duplicate_subject_in_block', () => {
    it('detects when the same subject is assigned to a block under multiple offerings', () => {
      const entries = [
        {
          id: 'e1',
          offeringId: 'offering-A',
          blockId: 'block-1',
          subjectId: 'sub-lec-only', // Same subject
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '12:00',
          sessionType: 'lecture',
        },
        {
          id: 'e2',
          offeringId: 'offering-B', // Different offering!
          blockId: 'block-1',
          subjectId: 'sub-lec-only', // Same subject
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-small',
          dayOfWeek: 3,
          startTime: '09:00',
          endTime: '12:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const dup = violations.find((v) => v.rule === 'duplicate_subject_in_block');
      assert.ok(dup, 'Expected duplicate_subject_in_block violation');
      assert.strictEqual(dup.severity, 'hard');
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 8: INCOMPLETE HOURS
  // -------------------------------------------------------------
  describe('Hard Rule: incomplete_hours', () => {
    it('detects when scheduled minutes do not match course lecture+lab requirements', () => {
      // sub-lec-only requires 3 lecture hours (180 minutes)
      // Entry is scheduled for 2 hours (120 minutes)
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '11:00', // 2 hours instead of 3!
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const hours = violations.find((v) => v.rule === 'incomplete_hours');
      assert.ok(hours, 'Expected incomplete_hours violation');
      assert.strictEqual(hours.severity, 'hard');
    });
  });

  // -------------------------------------------------------------
  // RULE REMOVAL VERIFICATION: LAB ROOM UNDERUSED
  // -------------------------------------------------------------
  describe('Rule Removal: lab_room_underused is removed', () => {
    it('does NOT flag lab_room_underused when a non-lab class uses a lab room', () => {
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lab-1', // Lab room
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '11:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const underused = violations.find((v) => v.rule === 'lab_room_underused');
      assert.strictEqual(underused, undefined, 'lab_room_underused must NOT trigger as it is removed');
    });
  });

  // -------------------------------------------------------------
  // SOFT RULE: UNQUALIFIED INSTRUCTOR
  // -------------------------------------------------------------
  describe('Soft Rule: unqualified_instructor', () => {
    it('flags a soft advisory when instructor is not officially qualified for the course', () => {
      // inst-no-equipment is only qualified for 'sub-lec-only', NOT 'sub-with-lab'
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-with-lab', // Unqualified subject
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '14:00', // 5 hours (2 lec + 3 lab)
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const unqual = violations.find((v) => v.rule === 'unqualified_instructor');
      assert.ok(unqual, 'Expected unqualified_instructor advisory');
      assert.strictEqual(unqual.severity, 'soft');
    });
  });

  // -------------------------------------------------------------
  // RULE REMOVAL VERIFICATION: HEAVY LOAD DAY
  // -------------------------------------------------------------
  describe('Rule Removal: heavy_load_day is removed', () => {
    it('does NOT flag heavy_load_day when instructor teaching load exceeds 6 hours', () => {
      const entries = [
        {
          id: 'e1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '08:00',
          endTime: '11:00', // 3h
          sessionType: 'lecture',
        },
        {
          id: 'e2',
          offeringId: 'off-2',
          blockId: 'block-2',
          subjectId: 'sub-with-lab',
          instructorId: 'inst-qualified',
          roomId: 'room-lab-1',
          dayOfWeek: 1,
          startTime: '13:00',
          endTime: '17:30', // 4.5h -> 7.5h total
          sessionType: 'lab',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const heavy = violations.find((v) => v.rule === 'heavy_load_day');
      assert.strictEqual(heavy, undefined, 'heavy_load_day must NOT trigger as it is removed');
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 9: INVALID TIME SLOT
  // -------------------------------------------------------------
  describe('Hard Rule: invalid_time_slot', () => {
    it('accepts entries that strictly align to canonical weekday start times and durations', () => {
      const entries = [
        {
          id: 'e-valid-lec',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Mon
          startTime: '08:00',
          endTime: '09:30', // Standard 1.5h
          sessionType: 'lecture',
        },
        {
          id: 'e-valid-lab',
          offeringId: 'off-2',
          blockId: 'block-2',
          subjectId: 'sub-with-lab',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lab-1',
          dayOfWeek: 2, // Tue
          startTime: '13:00',
          endTime: '16:00', // Standard 3h lab (2x 1.5h slot blocks)
          sessionType: 'lab',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const slotViolations = violations.filter((v) => v.rule === 'invalid_time_slot');
      assert.strictEqual(slotViolations.length, 0, 'Expected no invalid_time_slot violations for standard slots');
    });

    it('rejects an entry with a non-canonical weekday start time (e.g. 08:15 or 10:00)', () => {
      const entries = [
        {
          id: 'e-bad-start',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '10:00', // Non-canonical start time (grid has 09:30, 11:00)
          endTime: '11:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const badSlot = violations.find((v) => v.rule === 'invalid_time_slot');
      assert.ok(badSlot, 'Expected invalid_time_slot violation for non-grid start time');
      assert.strictEqual(badSlot.severity, 'hard');
      assert.ok(badSlot.message.includes('10:00'));
    });

    it('rejects an entry at 9:47–11:03 (off-grid) by invalid_time_slot', () => {
      const entries = [
        {
          id: 'e-bad-offgrid',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Monday
          startTime: '09:47',
          endTime: '11:03',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const badSlot = violations.find((v) => v.rule === 'invalid_time_slot');
      assert.ok(badSlot, 'Expected invalid_time_slot violation for 09:47-11:03');
      assert.strictEqual(badSlot.severity, 'hard');
    });

    it('rejects a lab whose end time does not align to canonical slot boundaries', () => {
      const entries = [
        {
          id: 'e-bad-lab-end',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-with-lab',
          instructorId: 'inst-qualified',
          roomId: 'room-lab-1',
          dayOfWeek: 2,
          startTime: '08:00',
          endTime: '10:15', // Misaligned end time
          sessionType: 'lab',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const badSlot = violations.find((v) => v.rule === 'invalid_time_slot');
      assert.ok(badSlot, 'Expected invalid_time_slot for misaligned lab end time');
    });

    it('accepts Saturday 9:30-11:00 (aligns to standard 1.5-hr grid)', () => {
      const validSat = [
        {
          id: 'e-sat-valid-930',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 6, // Saturday
          startTime: '09:30',
          endTime: '11:00', // Standard 1.5h slot
          sessionType: 'lecture',
        },
      ];
      const violations = checkSchedule(validSat, baseContext).filter((v) => v.rule === 'invalid_time_slot');
      assert.strictEqual(violations.length, 0, 'Saturday 09:30-11:00 must be valid');
    });

    it('rejects Saturday 10:00-12:00 (old 2-hour grid slot is now invalid)', () => {
      const oldSat = [
        {
          id: 'e-sat-old-1000',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 6, // Saturday
          startTime: '10:00', // Not in canonical start times
          endTime: '12:00',
          sessionType: 'lecture',
        },
      ];
      const violations = checkSchedule(oldSat, baseContext).filter((v) => v.rule === 'invalid_time_slot');
      assert.strictEqual(violations.length, 1, 'Saturday 10:00-12:00 must be rejected');
      assert.strictEqual(violations[0].severity, 'hard');
      assert.ok(violations[0].message.includes('10:00'));
    });

    it('accepts 2-unit subjects scheduled for 2 hours (10:00-12:00) on Saturday without invalid_time_slot', () => {
      const peSat = [
        {
          id: 'e-sat-pe-1000',
          offeringId: 'off-pe',
          blockId: 'block-1',
          subjectId: 'sub-pe-2unit',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 6, // Saturday
          startTime: '10:00',
          endTime: '12:00', // 2 hours
          sessionType: 'lecture',
        },
      ];
      const violations = checkSchedule(peSat, baseContext).filter((v) => v.rule === 'invalid_time_slot');
      assert.strictEqual(violations.length, 0, '2-unit subject 10:00-12:00 on Saturday must be valid');
    });

    it('accepts 2-unit subjects scheduled for 2 hours (10:00-12:00 or 13:00-15:00) on weekdays without invalid_time_slot', () => {
      const peWeekday = [
        {
          id: 'e-tue-pe-1000',
          offeringId: 'off-pe-tue',
          blockId: 'block-1',
          subjectId: 'sub-pe-2unit',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 2, // Tuesday
          startTime: '10:00',
          endTime: '12:00',
          sessionType: 'lecture',
        },
        {
          id: 'e-fri-pe-1300',
          offeringId: 'off-pe-fri',
          blockId: 'block-2',
          subjectId: 'sub-pe-2unit',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-small',
          dayOfWeek: 5, // Friday
          startTime: '13:00',
          endTime: '15:00',
          sessionType: 'lecture',
        },
      ];
      const violations = checkSchedule(peWeekday, baseContext).filter((v) => v.rule === 'invalid_time_slot');
      assert.strictEqual(violations.length, 0, '2-unit subjects on weekdays must not be blocked by invalid_time_slot');
    });

    it('accepts 2-unit subjects scheduled for 2 hours (08:00-10:00) on Monday without invalid_time_slot', () => {
      const peMon = [
        {
          id: 'e-mon-pe-0800',
          offeringId: 'off-pe-mon',
          blockId: 'block-1',
          subjectId: 'sub-pe-2unit',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Monday
          startTime: '08:00',
          endTime: '10:00', // 2 hours
          sessionType: 'lecture',
        },
      ];
      const violations = checkSchedule(peMon, baseContext).filter((v) => v.rule === 'invalid_time_slot');
      assert.strictEqual(violations.length, 0, '2-unit subject 08:00-10:00 on Monday must be valid');
    });

    it('accepts 1-unit subjects scheduled for 1 hour (08:00-09:00 or 10:00-11:00) on any weekday without invalid_time_slot', () => {
      const nstpMon = [
        {
          id: 'e-mon-nstp-0800',
          offeringId: 'off-nstp-mon',
          blockId: 'block-1',
          subjectId: 'sub-nstp-1unit',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Monday
          startTime: '08:00',
          endTime: '09:00', // 1 hour
          sessionType: 'lecture',
        },
        {
          id: 'e-sat-nstp-1000',
          offeringId: 'off-nstp-sat',
          blockId: 'block-2',
          subjectId: 'sub-nstp-1unit',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-small',
          dayOfWeek: 6, // Saturday
          startTime: '10:00',
          endTime: '11:00', // 1 hour
          sessionType: 'lecture',
        },
      ];
      const violations = checkSchedule(nstpMon, baseContext).filter((v) => v.rule === 'invalid_time_slot');
      assert.strictEqual(violations.length, 0, '1-unit subject 1-hour sessions must be valid on Monday and Saturday');
    });

    it('rejects Sunday sessions as outside the canonical timetable grid', () => {
      const entries = [
        {
          id: 'e-sun',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 0, // Sunday
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const sunViolation = violations.find((v) => v.rule === 'invalid_time_slot');
      assert.ok(sunViolation, 'Expected invalid_time_slot for Sunday session');
    });
  });

  // -------------------------------------------------------------
  // HARD RULE 10: SPANS LUNCH BREAK
  // -------------------------------------------------------------
  describe('Hard Rule: spans_lunch_break', () => {
    it('allows an entry ending exactly at 12:30 (touches lunch but does not cross)', () => {
      const entries = [
        {
          id: 'e-touch-start',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '11:00',
          endTime: '12:30', // 1.5h ending exactly at 12:30
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const lunchViolations = violations.filter((v) => v.rule === 'spans_lunch_break');
      assert.strictEqual(lunchViolations.length, 0, '11:00-12:30 touches lunch boundary; valid');
    });

    it('allows an entry starting exactly at 13:00 (touches end of lunch but does not cross)', () => {
      const entries = [
        {
          id: 'e-touch-end',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '13:00', // Starts at 1:00 PM
          endTime: '14:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const lunchViolations = violations.filter((v) => v.rule === 'spans_lunch_break');
      assert.strictEqual(lunchViolations.length, 0, '13:00-14:30 starts after lunch; valid');
    });

    it('rejects an entry from 11:00 to 13:00 (crosses into lunch break 12:30-13:00)', () => {
      const entries = [
        {
          id: 'e-cross-11-1',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '11:00',
          endTime: '13:00', // 11:00 - 1:00 PM: crosses lunch!
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const lunchViolation = violations.find((v) => v.rule === 'spans_lunch_break');
      assert.ok(lunchViolation, '11:00-13:00 must be flagged as spans_lunch_break');
      assert.strictEqual(lunchViolation.severity, 'hard');
      assert.deepStrictEqual(lunchViolation.entryIds, ['e-cross-11-1']);
    });

    it('rejects a 3-hour lab session attempting to span across 12:30-13:00 (e.g. 11:00-14:00)', () => {
      const entries = [
        {
          id: 'e-cross-lab',
          offeringId: 'off-1',
          blockId: 'block-1',
          subjectId: 'sub-with-lab',
          instructorId: 'inst-qualified',
          roomId: 'room-lab-1',
          dayOfWeek: 2,
          startTime: '11:00',
          endTime: '14:00', // 11:00 AM - 2:00 PM
          sessionType: 'lab',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const lunchViolation = violations.find((v) => v.rule === 'spans_lunch_break');
      assert.ok(lunchViolation, '11:00-14:00 must be flagged as spans_lunch_break');
    });

    it('enforces High School lunch break strictly at 12:00-13:00', () => {
      const hsContext = {
        ...baseContext,
        blocks: [
          { id: 'block-hs-1', name: 'Grade 10 - St. Luke', studentCount: 35 },
        ],
        subjects: [
          { id: 'sub-hs-1', code: 'HS-MATH10', title: 'Mathematics 10', lectureHours: 3, labHours: 0, requiresLab: false },
        ],
      };

      // Valid HS entries before and after lunch
      const validEntries = [
        {
          id: 'e-hs-am',
          offeringId: 'off-hs-1',
          blockId: 'block-hs-1',
          subjectId: 'sub-hs-1',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '10:30',
          endTime: '12:00', // Ends at 12:00 (lunch start)
          sessionType: 'lecture',
        },
        {
          id: 'e-hs-pm',
          offeringId: 'off-hs-1',
          blockId: 'block-hs-1',
          subjectId: 'sub-hs-1',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '13:00', // Starts at 13:00 (lunch end)
          endTime: '14:30',
          sessionType: 'lecture',
        },
      ];
      const validViolations = checkSchedule(validEntries, hsContext);
      const lunchViolationsValid = validViolations.filter((v) => v.rule === 'spans_lunch_break');
      assert.strictEqual(lunchViolationsValid.length, 0, 'HS classes touching 12:00 and 13:00 boundaries must be valid');

      // Invalid HS entry crossing 12:00-13:00 lunch break
      const crossingEntries = [
        {
          id: 'e-hs-cross',
          offeringId: 'off-hs-1',
          blockId: 'block-hs-1',
          subjectId: 'sub-hs-1',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1,
          startTime: '11:30',
          endTime: '12:30', // Crosses into 12:00-13:00 HS lunch
          sessionType: 'lecture',
        },
      ];
      const crossingViolations = checkSchedule(crossingEntries, hsContext);
      const lunchViolationCross = crossingViolations.find((v) => v.rule === 'spans_lunch_break');
      assert.ok(lunchViolationCross, 'HS class from 11:30-12:30 must be flagged for High School lunch break');
    });
  });

  // -------------------------------------------------------------
  // SOFT RULE 4: IRREGULAR DAY PAIRING
  // -------------------------------------------------------------
  describe('Soft Rule: irregular_day_pairing', () => {
    it('accepts MW (Monday & Wednesday) pairing for lecture classes without warning', () => {
      const entries = [
        {
          id: 'e-mw-1',
          offeringId: 'off-mw',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Mon
          startTime: '09:30',
          endTime: '11:00',
          sessionType: 'lecture',
        },
        {
          id: 'e-mw-2',
          offeringId: 'off-mw',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 3, // Wed
          startTime: '09:30',
          endTime: '11:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const pairing = violations.find((v) => v.rule === 'irregular_day_pairing');
      assert.strictEqual(pairing, undefined, 'MW pairing must not trigger irregular_day_pairing');
    });

    it('accepts TTH (Tuesday & Thursday) pairing for lecture classes without warning', () => {
      const entries = [
        {
          id: 'e-tth-1',
          offeringId: 'off-tth',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-1',
          dayOfWeek: 2, // Tue
          startTime: '13:00',
          endTime: '14:30',
          sessionType: 'lecture',
        },
        {
          id: 'e-tth-2',
          offeringId: 'off-tth',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-no-equipment',
          roomId: 'room-lec-1',
          dayOfWeek: 4, // Thu
          startTime: '13:00',
          endTime: '14:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const pairing = violations.find((v) => v.rule === 'irregular_day_pairing');
      assert.strictEqual(pairing, undefined, 'TTH pairing must not trigger irregular_day_pairing');
    });

    it('warns (soft severity) when lecture sessions do not follow MW or TTH pairing (e.g. Mon & Tue)', () => {
      const entries = [
        {
          id: 'e-irreg-1',
          offeringId: 'off-irreg',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Mon
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
        {
          id: 'e-irreg-2',
          offeringId: 'off-irreg',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 2, // Tue (irregular: Mon + Tue)
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, baseContext);
      const pairing = violations.find((v) => v.rule === 'irregular_day_pairing');
      assert.ok(pairing, 'Expected irregular_day_pairing advisory');
      assert.strictEqual(pairing.severity, 'soft');
    });

    it('triggers irregular_day_pairing as a soft warning, not a block, when a section is scheduled on Mon/Thu', () => {
      const monThuContext = {
        ...baseContext,
        fixedConstraints: [], // Clear blackout to isolate pairing check
        instructors: [
          {
            ...mockInstructors[0],
            availability: [
              { dayOfWeek: 1, startTime: '08:00:00', endTime: '18:00:00' },
              { dayOfWeek: 4, startTime: '08:00:00', endTime: '18:00:00' },
            ],
          },
        ],
      };

      const entries = [
        {
          id: 'e-mon-thu-1',
          offeringId: 'off-myth',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Monday
          startTime: '09:30',
          endTime: '11:00',
          sessionType: 'lecture',
        },
        {
          id: 'e-mon-thu-2',
          offeringId: 'off-myth',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 4, // Thursday (irregular: Mon + Thu)
          startTime: '09:30',
          endTime: '11:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, monThuContext);
      const pairing = violations.find((v) => v.rule === 'irregular_day_pairing');
      assert.ok(pairing, 'Expected irregular_day_pairing for Mon/Thu combination');
      assert.strictEqual(pairing.severity, 'soft', 'Must be a soft warning, NOT a hard block');
      // Verify no hard violations are triggered
      const hardViolations = violations.filter((v) => v.severity === 'hard');
      assert.strictEqual(hardViolations.length, 0, 'Must NOT trigger any hard block');
    });

    it('exempts labs, electives, capstone, Friday, and Saturday sessions from pairing check', () => {
      const contextWithElectiveAndCapstone = {
        ...baseContext,
        subjects: [
          ...mockSubjects,
          { id: 'sub-elec', code: 'IT-ELEC1', title: 'Data Analytics Elective', requiresLab: false, lectureHours: 3, labHours: 0 },
          { id: 'sub-cap', code: 'CAPSTONE1', title: 'Capstone Project 1', requiresLab: false, lectureHours: 3, labHours: 0 },
        ],
      };

      const entries = [
        // Lab session on Monday only: exempt
        {
          id: 'e-lab-mon',
          offeringId: 'off-lab',
          blockId: 'block-1',
          subjectId: 'sub-with-lab',
          instructorId: 'inst-qualified',
          roomId: 'room-lab-1',
          dayOfWeek: 1,
          startTime: '13:00',
          endTime: '16:00',
          sessionType: 'lab',
        },
        // Friday lecture: exempt
        {
          id: 'e-fri-lec',
          offeringId: 'off-fri',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 5,
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
        // Elective course on Tuesday only: exempt
        {
          id: 'e-elec-tue',
          offeringId: 'off-elec',
          blockId: 'block-1',
          subjectId: 'sub-elec',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 2,
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
        // Capstone project on Wednesday only: exempt
        {
          id: 'e-cap-wed',
          offeringId: 'off-cap',
          blockId: 'block-1',
          subjectId: 'sub-cap',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 3,
          startTime: '08:00',
          endTime: '09:30',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(entries, contextWithElectiveAndCapstone);
      const pairingViolations = violations.filter((v) => v.rule === 'irregular_day_pairing');
      assert.strictEqual(pairingViolations.length, 0, 'Exempted sessions should produce zero irregular_day_pairing warnings');
    });
  });

  // -------------------------------------------------------------
  // VALID SCHEDULE TEST
  // -------------------------------------------------------------
  describe('Clean Schedule Verification', () => {
    it('returns zero violations for a completely valid schedule', () => {
      // sub-lec-only: 3h lec, block-1 (40 students), room-lec-1 (45 cap)
      // inst-qualified: qualified for sub-lec-only, available Mon & Wed 08:00-18:00
      // Mon 09:30-11:00 (1.5h) + Wed 09:30-11:00 (1.5h) = 3h total (matches curriculum)
      // Standard MW pair, canonical weekday start times (09:30), ends before lunch (11:00)
      const validEntries = [
        {
          id: 'e1',
          offeringId: 'off-valid',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 1, // Mon
          startTime: '09:30',
          endTime: '11:00',
          sessionType: 'lecture',
        },
        {
          id: 'e2',
          offeringId: 'off-valid',
          blockId: 'block-1',
          subjectId: 'sub-lec-only',
          instructorId: 'inst-qualified',
          roomId: 'room-lec-1',
          dayOfWeek: 3, // Wed
          startTime: '09:30',
          endTime: '11:00',
          sessionType: 'lecture',
        },
      ];

      const violations = checkSchedule(validEntries, baseContext);
      assert.strictEqual(
        violations.length,
        0,
        `Expected 0 violations, got ${violations.length}: ${JSON.stringify(violations)}`
      );
    });
  });
});

