// src/lib/conflict-engine/time-slots.ts
// Canonical timetable grid reference for AlterSched.
// Single source of truth for valid start times, durations, and grid slot boundaries.
// Applies to all days (Monday through Saturday) — no separate Saturday grid.

export const TIME_SLOTS = {
  // Canonical start times (8:00, 9:30, 11:00, 1:00, 2:30, 4:00, 5:30, 7:00)
  // Applies every day, including Saturday.
  startTimes: [
    '08:00',
    '09:30',
    '11:00',
    '13:00',
    '14:30',
    '16:00',
    '17:30',
    '19:00',
  ] as const,

  // Standard lecture duration is 90 minutes (1.5 hours)
  standardDurationMinutes: 90,

  // Canonical slot boundaries (valid start and end points for 1h, 1.5h, 2h, and 3h sessions)
  slotBoundaries: [
    '07:00',
    '07:30',
    '08:00',
    '08:30',
    '09:00',
    '09:30',
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '12:00',
    '12:30',
    '13:00',
    '13:30',
    '14:00',
    '14:30',
    '15:00',
    '15:30',
    '16:00',
    '16:30',
    '17:00',
    '17:30',
    '18:00',
    '18:30',
    '19:00',
    '19:30',
    '20:00',
    '20:30',
  ] as const,

  // Institutional lunch break window (College / BSIT): 12:30 - 13:00
  lunchBreak: {
    startTime: '12:30',
    endTime: '13:00',
  },

  // High School lunch break window: 12:00 - 13:00
  hsLunchBreak: {
    startTime: '12:00',
    endTime: '13:00',
  },

  // Aliases for backwards compatibility with any existing imports
  weekdayStartTimes: [
    '08:00',
    '09:30',
    '11:00',
    '13:00',
    '14:30',
    '16:00',
    '17:30',
    '19:00',
  ] as const,
  weekdayStandardDurationMinutes: 90,
  weekdaySlotBoundaries: [
    '08:00',
    '09:30',
    '11:00',
    '12:30',
    '13:00',
    '14:30',
    '16:00',
    '17:30',
    '19:00',
    '20:30',
  ] as const,
} as const;

export type CanonicalStartTime = (typeof TIME_SLOTS.startTimes)[number];
export type WeekdayStartTime = (typeof TIME_SLOTS.startTimes)[number];

