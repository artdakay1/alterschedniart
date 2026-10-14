// src/components/AvailabilityEditor.tsx
'use client';

import React, { useState, useTransition, useMemo } from 'react';
import type { InstructorAvailabilitySlotInput } from '@/lib/validators/academic';

interface AvailabilityEditorProps {
  instructorId: string;
  instructorName: string;
  employmentType?: 'full_time' | 'part_time';
  initialSlots: InstructorAvailabilitySlotInput[];
  onSave: (slots: InstructorAvailabilitySlotInput[]) => Promise<void>;
  isReadOnly?: boolean;
}

// Days of the week shown as columns
const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

// 30-minute time slots from 07:00 to 21:00
const TIME_SLOTS: string[] = [];
for (let h = 7; h < 21; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`);
}

function formatTime(t: string) {
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr);
  const m = mStr || '00';
  const period = h < 12 ? 'AM' : 'PM';
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${m} ${period}`;
}

function addThirtyMin(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const totalMins = h * 60 + m + 30;
  const newH = Math.floor(totalMins / 60);
  const newM = totalMins % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// Standard full-time schedule: 8:00 AM to 8:30 PM, with 12:30 PM - 1:00 PM lunch break blocked
export function getFullTimeDefaultSlots(): InstructorAvailabilitySlotInput[] {
  const slots: InstructorAvailabilitySlotInput[] = [];
  for (const day of DAYS) {
    // Morning window: 08:00 to 12:30
    slots.push({
      day_of_week: day.value,
      start_time: '08:00:00',
      end_time: '12:30:00',
    });
    // Afternoon/Evening window: 13:00 to 20:30 (12:30 to 13:00 is blocked lunch break)
    slots.push({
      day_of_week: day.value,
      start_time: '13:00:00',
      end_time: '20:30:00',
    });
  }
  return slots;
}

export function getFullTimeDefaultGrid(): Set<string> {
  return slotsToGrid(getFullTimeDefaultSlots());
}

// Convert slots (which can span hours) to a set of "day:startTime" 30-min cells
function slotsToGrid(slots: InstructorAvailabilitySlotInput[]): Set<string> {
  const grid = new Set<string>();
  for (const slot of slots) {
    let current = slot.start_time.slice(0, 5);
    const end = slot.end_time.slice(0, 5);
    while (current < end) {
      grid.add(`${slot.day_of_week}:${current}`);
      current = addThirtyMin(current);
    }
  }
  return grid;
}

// Convert grid cells back to merged slots per day
function gridToSlots(grid: Set<string>): InstructorAvailabilitySlotInput[] {
  const byDay: Record<number, string[]> = {};
  for (const cell of grid) {
    const firstColon = cell.indexOf(':');
    if (firstColon === -1) continue;
    const day = parseInt(cell.slice(0, firstColon));
    const time = cell.slice(firstColon + 1);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(time);
  }

  const result: InstructorAvailabilitySlotInput[] = [];
  for (const dayStr of Object.keys(byDay).sort((a, b) => Number(a) - Number(b))) {
    const day = parseInt(dayStr);
    const times = byDay[day].sort();
    if (times.length === 0) continue;

    // Merge consecutive 30-min blocks into ranges
    let rangeStart = times[0];
    let rangeEnd = addThirtyMin(times[0]);

    for (let i = 1; i < times.length; i++) {
      if (times[i] === rangeEnd) {
        rangeEnd = addThirtyMin(times[i]);
      } else {
        result.push({
          day_of_week: day,
          start_time: `${rangeStart}:00`,
          end_time: `${rangeEnd}:00`,
        });
        rangeStart = times[i];
        rangeEnd = addThirtyMin(times[i]);
      }
    }
    result.push({
      day_of_week: day,
      start_time: `${rangeStart}:00`,
      end_time: `${rangeEnd}:00`,
    });
  }
  return result;
}

export function AvailabilityEditor({
  instructorName,
  employmentType = 'full_time',
  initialSlots,
  onSave,
  isReadOnly = false,
}: AvailabilityEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // Grid state: a Set<"day:time"> for all available 30-min blocks
  const [grid, setGrid] = useState<Set<string>>(() => {
    if (initialSlots && initialSlots.length > 0) {
      return slotsToGrid(initialSlots);
    }
    if (employmentType === 'full_time') {
      return getFullTimeDefaultGrid();
    }
    return new Set<string>();
  });

  const applyFullTimeDefault = () => {
    if (isReadOnly) return;
    setGrid(getFullTimeDefaultGrid());
  };

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'add' | 'remove'>('add');

  const toggleCell = (key: string, forceMode?: 'add' | 'remove') => {
    setGrid((prev) => {
      const next = new Set(prev);
      const mode = forceMode ?? (prev.has(key) ? 'remove' : 'add');
      if (mode === 'remove') next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleMouseDown = (key: string) => {
    if (isReadOnly) return;
    const mode = grid.has(key) ? 'remove' : 'add';
    setDragMode(mode);
    setIsDragging(true);
    toggleCell(key, mode);
  };

  const handleMouseEnter = (key: string) => {
    if (!isDragging || isReadOnly) return;
    toggleCell(key, dragMode);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Select/deselect entire day column
  const toggleDay = (dayValue: number) => {
    if (isReadOnly) return;
    const allCells = TIME_SLOTS.map((t) => `${dayValue}:${t}`);
    const allSelected = allCells.every((k) => grid.has(k));
    setGrid((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allCells.forEach((k) => next.delete(k));
      } else {
        allCells.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  // Select/deselect entire time row
  const toggleRow = (time: string) => {
    if (isReadOnly) return;
    const allCells = DAYS.map((d) => `${d.value}:${time}`);
    const allSelected = allCells.every((k) => grid.has(k));
    setGrid((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allCells.forEach((k) => next.delete(k));
      } else {
        allCells.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const clearAll = () => {
    if (isReadOnly) return;
    setGrid(new Set());
  };

  const selectAll = () => {
    if (isReadOnly) return;
    const all = new Set<string>();
    DAYS.forEach((d) => TIME_SLOTS.forEach((t) => all.add(`${d.value}:${t}`)));
    setGrid(all);
  };

  // Count active slots per day
  const daySlotCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const key of grid) {
      const day = parseInt(key.split(':')[0]);
      counts[day] = (counts[day] || 0) + 1;
    }
    return counts;
  }, [grid]);

  const totalSelected = grid.size;

  const handleCommitSave = () => {
    setNotice(null);
    const slots = gridToSlots(grid);
    startTransition(async () => {
      try {
        await onSave(slots);
        setNotice({
          type: 'success',
          message: `Availability schedule for ${instructorName} saved successfully.`,
        });
      } catch (err: unknown) {
        setNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to save availability.',
        });
      }
    });
  };

  return (
    <div
      className="space-y-4"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ userSelect: 'none' }}
    >
      {notice && (
        <div
          className={`alert ${
            notice.type === 'success' ? 'alert-success' : 'alert-danger'
          } d-flex justify-content-between align-items-center rounded-4 shadow-sm border-0 py-3 px-4 mb-3`}
        >
          <span className="small fw-semibold">{notice.message}</span>
          <button
            onClick={() => setNotice(null)}
            className="btn btn-sm btn-link text-decoration-none text-muted p-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid Legend / Actions */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-2">
        <div className="d-flex align-items-center gap-3 small text-secondary">
          <div className="d-flex align-items-center gap-1.5">
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                borderRadius: 3,
                background: 'var(--ref-primary, #0E0AB8)',
                opacity: 0.85,
              }}
            />
            <span>Available</span>
          </div>
          <div className="d-flex align-items-center gap-1.5">
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                borderRadius: 3,
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
              }}
            />
            <span>Unavailable</span>
          </div>
          <div className="d-flex align-items-center gap-1.5">
            <span
              style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                borderRadius: 3,
                background: '#fef3c7',
                border: '1px solid #fde68a',
              }}
            />
            <span className="text-warning-emphasis fw-medium">Lunch Break (12:30–1:00 PM)</span>
          </div>
          <span className="text-muted">
            <i className="bi bi-hand-index me-1" />
            Click or drag to toggle
          </span>
        </div>

        {!isReadOnly && (
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill px-3 py-1 small fw-semibold">
              {totalSelected} blocks selected
              {totalSelected > 0 && (
                <span className="text-primary-emphasis fw-bold ms-1">
                  ({(totalSelected * 0.5).toFixed(1)}h)
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={applyFullTimeDefault}
              className="btn btn-xs btn-primary rounded-pill px-3 py-1 small fw-semibold shadow-sm"
              title="Apply standard Full-Time availability: 8:00 AM to 8:30 PM (Mon-Sat), with 12:30 PM - 1:00 PM lunch break blocked"
            >
              <i className="bi bi-clock-history me-1"></i>
              Full-Time Default (8am–8:30pm)
            </button>
            <button
              type="button"
              onClick={selectAll}
              className="btn btn-xs btn-outline-secondary rounded-pill px-3 py-1 small"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="btn btn-xs btn-outline-danger rounded-pill px-3 py-1 small"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* Weekly Grid Table */}
      <div
        className="border rounded-4 overflow-hidden shadow-sm"
        style={{ overflowX: 'auto' }}
      >
        <table
          className="mb-0 w-100"
          style={{
            borderCollapse: 'collapse',
            fontSize: '12px',
            tableLayout: 'fixed',
            minWidth: '520px',
          }}
        >
          <thead>
            <tr>
              {/* Time label column */}
              <th
                style={{
                  width: '70px',
                  background: '#f8fafc',
                  borderBottom: '2px solid #e2e8f0',
                  borderRight: '1px solid #e2e8f0',
                  padding: '10px 8px',
                  textAlign: 'center',
                  fontSize: '10px',
                  color: '#64748b',
                  fontWeight: 700,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                }}
              >
                Time
              </th>
              {DAYS.map((day) => {
                const count = daySlotCounts[day.value] || 0;
                const allSelected = TIME_SLOTS.every((t) => grid.has(`${day.value}:${t}`));
                return (
                  <th
                    key={day.value}
                    onClick={() => toggleDay(day.value)}
                    style={{
                      background: allSelected ? 'rgba(14,10,184,0.06)' : '#f8fafc',
                      borderBottom: '2px solid #e2e8f0',
                      borderRight: '1px solid #e2e8f0',
                      padding: '8px 6px',
                      textAlign: 'center',
                      fontWeight: 700,
                      fontSize: '11.5px',
                      color: allSelected ? '#0E0AB8' : '#374151',
                      cursor: isReadOnly ? 'default' : 'pointer',
                      transition: 'background 0.15s',
                      letterSpacing: '0.3px',
                    }}
                    title={`Click to toggle all ${day.label} slots`}
                  >
                    <div>{day.label}</div>
                    {count > 0 && (
                      <div
                        style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          color: '#0E0AB8',
                          marginTop: 2,
                          opacity: 0.7,
                        }}
                      >
                        {(count * 0.5).toFixed(1)}h
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {TIME_SLOTS.map((time) => {
              const isHour = time.endsWith(':00');
              const allRowSelected = DAYS.every((d) => grid.has(`${d.value}:${time}`));
              return (
                <tr key={time}>
                  {/* Time label cell */}
                  <td
                    onClick={() => toggleRow(time)}
                    style={{
                      background: time === '12:30' ? '#fef3c7' : allRowSelected ? 'rgba(14,10,184,0.04)' : isHour ? '#f8fafc' : '#fcfcfd',
                      borderRight: '1px solid #e2e8f0',
                      borderBottom: '1px solid ' + (isHour ? '#d1d5db' : '#f1f5f9'),
                      padding: '0 8px',
                      height: isHour ? 30 : 22,
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      fontSize: isHour ? '11px' : time === '12:30' ? '9px' : '9.5px',
                      color: time === '12:30' ? '#92400e' : isHour ? '#374151' : '#94a3b8',
                      fontWeight: isHour || time === '12:30' ? 700 : 400,
                      cursor: isReadOnly ? 'default' : 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title={time === '12:30' ? 'Strict Lunch Break (12:30 PM - 1:00 PM)' : `Click to toggle ${formatTime(time)} across all days`}
                  >
                    {isHour ? formatTime(time) : time === '12:30' ? '12:30 Lunch' : '· · ·'}
                  </td>
                  {DAYS.map((day) => {
                    const key = `${day.value}:${time}`;
                    const isActive = grid.has(key);
                    return (
                      <td
                        key={day.value}
                        onMouseDown={() => handleMouseDown(key)}
                        onMouseEnter={() => handleMouseEnter(key)}
                        style={{
                          background: isActive
                            ? 'rgba(14,10,184,0.75)'
                            : time === '12:30'
                            ? '#fffbeb'
                            : isHour
                            ? '#f9fafb'
                            : '#ffffff',
                          borderRight: '1px solid #e2e8f0',
                          borderBottom: '1px solid ' + (isHour ? '#d1d5db' : '#f1f5f9'),
                          height: isHour ? 30 : 22,
                          cursor: isReadOnly ? 'default' : 'pointer',
                          transition: 'background 0.08s',
                        }}
                        title={`${day.label} ${formatTime(time)}${isActive ? ' (Available)' : time === '12:30' ? ' (Lunch Break)' : ' (Unavailable)'}`}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isReadOnly && (
        <div className="d-flex justify-content-end pt-3 border-top mt-2">
          <button
            type="button"
            onClick={handleCommitSave}
            disabled={isPending}
            className="btn-ref-primary px-4 py-2"
          >
            {isPending ? 'Saving Availability...' : 'Save Availability Schedule'}
          </button>
        </div>
      )}
    </div>
  );
}
