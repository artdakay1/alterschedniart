// src/lib/conflict-engine/utils.ts
// Pure utility functions for the AlterSched Conflict Engine.

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function getDayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
}

export function formatTimeShort(time: string): string {
  if (!time) return '';
  return time.slice(0, 5);
}

/**
 * Converts a time string "HH:MM" or "HH:MM:SS" to total minutes from midnight.
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0] || '0', 10);
  const minutes = parseInt(parts[1] || '0', 10);
  return hours * 60 + minutes;
}

/**
 * Determines whether two time intervals on the same day overlap.
 * Edge-touching intervals (e.g. 10:00-11:00 and 11:00-12:00) do NOT overlap.
 */
export function timeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const sA = timeToMinutes(startA);
  const eA = timeToMinutes(endA);
  const sB = timeToMinutes(startB);
  const eB = timeToMinutes(endB);

  return sA < eB && sB < eA;
}

/**
 * Checks if interval [entryStart, entryEnd] is completely contained
 * within window [windowStart, windowEnd].
 */
export function isTimeRangeWithin(
  entryStart: string,
  entryEnd: string,
  windowStart: string,
  windowEnd: string
): boolean {
  const eStart = timeToMinutes(entryStart);
  const eEnd = timeToMinutes(entryEnd);
  const wStart = timeToMinutes(windowStart);
  const wEnd = timeToMinutes(windowEnd);

  return eStart >= wStart && eEnd <= wEnd;
}

/**
 * Group array items by composite key `${day}:${getKey(item)}` to avoid O(n^2) scans.
 */
export function groupByDayAnd<T>(
  items: T[],
  getDay: (item: T) => number,
  getKey: (item: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = `${getDay(item)}:${getKey(item)}`;
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
