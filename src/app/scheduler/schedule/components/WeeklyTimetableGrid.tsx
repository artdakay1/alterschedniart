// src/app/scheduler/schedule/components/WeeklyTimetableGrid.tsx
'use client';

import React, { useRef } from 'react';
import type { ScheduleEntry, ClassOffering, Subject, Instructor, Room, Block } from '@/types/database';
import { TimetableGridCard } from './TimetableGridCard';
import type { ZoomDensity } from './ScheduleEditorToolbar';
import { timeToMinutes } from '@/lib/conflict-engine';

export const DAYS = [
  { index: 1, name: 'Monday', short: 'Mon' },
  { index: 2, name: 'Tuesday', short: 'Tue' },
  { index: 3, name: 'Wednesday', short: 'Wed' },
  { index: 4, name: 'Thursday', short: 'Thu' },
  { index: 5, name: 'Friday', short: 'Fri' },
  { index: 6, name: 'Saturday', short: 'Sat' },
];

export const TIME_SLOTS = [
  '07:00',
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
  '19:00',
];

export const HOUR_HEIGHT = 80;
export const GRID_START_MIN = 420; // 07:00

export function getSlotFromPointer(e: React.DragEvent): { slotHour: string; isHalfHour: boolean; startTime: string } | null {
  const rect = e.currentTarget.getBoundingClientRect();
  const offsetY = Math.max(0, Math.min(rect.height - 1, e.clientY - rect.top));
  const totalMinutesFromStart = Math.floor((offsetY / HOUR_HEIGHT) * 60);
  const halfHourSteps = Math.floor(totalMinutesFromStart / 30);
  const totalMinutes = GRID_START_MIN + halfHourSteps * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const slotHour = `${String(hours).padStart(2, '0')}:00`;
  const isHalfHour = minutes === 30;
  const startTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { slotHour, isHalfHour, startTime };
}

export function computeDayLayout(dayEntries: ScheduleEntry[]) {
  if (dayEntries.length === 0) return new Map<string, { colIndex: number; totalCols: number }>();
  const sorted = [...dayEntries].sort((a, b) => {
    const aStart = timeToMinutes(a.start_time);
    const bStart = timeToMinutes(b.start_time);
    if (aStart !== bStart) return aStart - bStart;
    return (timeToMinutes(b.end_time) - bStart) - (timeToMinutes(a.end_time) - aStart);
  });

  const clusters: ScheduleEntry[][] = [];
  let currentCluster: ScheduleEntry[] = [];
  let clusterEnd = 0;

  for (const entry of sorted) {
    const start = timeToMinutes(entry.start_time);
    const end = timeToMinutes(entry.end_time);
    if (currentCluster.length === 0) {
      currentCluster.push(entry);
      clusterEnd = end;
    } else {
      if (start < clusterEnd) {
        currentCluster.push(entry);
        clusterEnd = Math.max(clusterEnd, end);
      } else {
        clusters.push(currentCluster);
        currentCluster = [entry];
        clusterEnd = end;
      }
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const layoutMap = new Map<string, { colIndex: number; totalCols: number }>();
  for (const cluster of clusters) {
    const columns: number[] = [];
    for (const entry of cluster) {
      const start = timeToMinutes(entry.start_time);
      const end = timeToMinutes(entry.end_time);
      let placedCol = -1;
      for (let c = 0; c < columns.length; c++) {
        if (columns[c] <= start) {
          columns[c] = end;
          placedCol = c;
          break;
        }
      }
      if (placedCol === -1) {
        columns.push(end);
        placedCol = columns.length - 1;
      }
      layoutMap.set(entry.id, { colIndex: placedCol, totalCols: 1 });
    }
    const maxCols = columns.length;
    for (const entry of cluster) {
      const info = layoutMap.get(entry.id);
      if (info) info.totalCols = maxCols;
    }
  }

  return layoutMap;
}

export interface WeeklyTimetableGridProps {
  selectedBlock?: (Block & { programs?: { code: string; name: string } | null }) | null;
  selectedBlockId: string | null;
  selectedBlockEntries: ScheduleEntry[];
  offerings: (ClassOffering & { subjects?: Subject | null })[];
  blocks: (Block & { programs?: { code: string; name: string } | null })[];
  subjects: Subject[];
  instructors: Instructor[];
  rooms: Room[];
  isReadOnly: boolean;
  zoomDensity: ZoomDensity;
  violationsByEntryId: Map<string, { hard: Array<{ rule: string; message: string }>; soft: Array<{ rule: string; message: string }> }>;
  highlightedEntryId: string | null;
  dragOverSlot: { dayIndex: number; slotHour: string; isHalfHour: boolean } | null;
  activeDragContext: any;
  draggingEntryId: string | null;
  draggingOfferingId: string | null;
  setDragOverSlot: (slot: { dayIndex: number; slotHour: string; isHalfHour: boolean } | null) => void;
  setDraggingEntryId: (id: string | null) => void;
  setDraggingOfferingId: (id: string | null) => void;
  onMoveEntryOnGrid: (entryId: string, dayIndex: number, startTime: string) => void;
  onDropOnGrid: (offeringId: string, dayIndex: number, startTime: string) => void;
  onEditEntry: (entry: ScheduleEntry) => void;
  onDeleteEntry: (id: string) => void;
  getSlotConflicts: (day: number, start: string) => Array<{ badge: string; message: string }>;
  isSubjectAllowed: (subjectId?: string | null) => boolean;
  isSubjectUnspecified: (idOrCode?: string | null) => boolean;
  formatBlockLabel: (b?: any) => string;
}

export function WeeklyTimetableGrid({
  selectedBlock,
  selectedBlockId,
  selectedBlockEntries,
  offerings,
  blocks,
  subjects,
  instructors,
  rooms,
  isReadOnly,
  zoomDensity,
  violationsByEntryId,
  highlightedEntryId,
  dragOverSlot,
  activeDragContext,
  draggingEntryId,
  draggingOfferingId,
  setDragOverSlot,
  setDraggingEntryId,
  setDraggingOfferingId,
  onMoveEntryOnGrid,
  onDropOnGrid,
  onEditEntry,
  onDeleteEntry,
  getSlotConflicts,
  isSubjectAllowed,
  isSubjectUnspecified,
  formatBlockLabel,
}: WeeklyTimetableGridProps) {
  const dragOccurredRef = useRef(false);

  // Feature A: Viewport Density & Zoom Scaling
  const scaleRatio = zoomDensity === '70%' ? 0.75 : zoomDensity === '85%' ? 0.88 : 1.0;
  const containerMinWidth = zoomDensity === '70%' ? '700px' : zoomDensity === '85%' ? '800px' : '920px';

  const blockLabel = selectedBlock ? formatBlockLabel(selectedBlock) : '';
  const isHs =
    blockLabel.toLowerCase().includes('grade') ||
    blockLabel.toLowerCase().includes('high school') ||
    blockLabel.toUpperCase().startsWith('HS');

  return (
    <div className="bg-white rounded-4 shadow-sm border border-white overflow-hidden">
      {/* Grid Header Info */}
      <div className="p-3 px-4 border-bottom border-light d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div>
          <h5 className="fw-bold text-dark mb-0 d-flex align-items-center gap-2">
            <span>Weekly Timetable Grid</span>
            <span className="badge bg-light text-secondary border fw-medium rounded-pill" style={{ fontSize: '11px' }}>
              Scale: {zoomDensity}
            </span>
          </h5>
          <span className="text-muted small">
            Showing scheduled classes for {selectedBlock ? formatBlockLabel(selectedBlock) : 'selected block'}
          </span>
        </div>
      </div>

      {/* Overflow Scrollable Viewport */}
      <div className="overflow-x-auto">
        <div
          style={{
            minWidth: containerMinWidth,
            transformOrigin: 'top left',
            zoom: scaleRatio,
          }}
        >
          {/* Header: Days of Week */}
          <div className="d-flex border-bottom border-light bg-light py-2 sticky-top z-2">
            <div className="text-center text-muted small fw-semibold border-end border-light" style={{ width: '75px', flexShrink: 0 }}>
              Time
            </div>
            {DAYS.map((d) => (
              <div
                key={d.index}
                className="col text-center text-dark small fw-bold border-end border-light"
              >
                <span>{d.name}</span>
              </div>
            ))}
          </div>

          {/* Body: Time Grid & Day Columns */}
          <div className="d-flex position-relative" style={{ height: `${TIME_SLOTS.length * HOUR_HEIGHT}px` }}>
            {/* Time Label Column (Left) */}
            <div className="border-end border-light bg-light bg-opacity-25" style={{ width: '75px', flexShrink: 0 }}>
              {TIME_SLOTS.map((timeSlot) => (
                <div
                  key={timeSlot}
                  className="border-bottom border-light-subtle text-muted font-monospace small d-flex align-items-start justify-content-center pt-1"
                  style={{ height: `${HOUR_HEIGHT}px`, fontSize: '11px' }}
                >
                  {timeSlot}
                </div>
              ))}
            </div>

            {/* 6 Day Columns with Drop Targets and Positioned Cards */}
            <div className="d-flex flex-grow-1 position-relative">
              {DAYS.map((day) => {
                const dayEntries = selectedBlockEntries.filter((e) => e.day_of_week === day.index);
                const layoutMap = computeDayLayout(dayEntries);

                return (
                  <div
                    key={day.index}
                    className="col border-end border-light-subtle position-relative"
                    style={{ height: `${TIME_SLOTS.length * HOUR_HEIGHT}px` }}
                    onDragOver={(e) => {
                      if (isReadOnly) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move';
                      const pos = getSlotFromPointer(e);
                      if (!pos) return;
                      if (
                        dragOverSlot?.dayIndex !== day.index ||
                        dragOverSlot?.slotHour !== pos.slotHour ||
                        dragOverSlot?.isHalfHour !== pos.isHalfHour
                      ) {
                        setDragOverSlot({ dayIndex: day.index, slotHour: pos.slotHour, isHalfHour: pos.isHalfHour });
                      }
                    }}
                    onDragLeave={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      if (
                        e.clientX < rect.left ||
                        e.clientX >= rect.right ||
                        e.clientY < rect.top ||
                        e.clientY >= rect.bottom
                      ) {
                        if (dragOverSlot?.dayIndex === day.index) setDragOverSlot(null);
                      }
                    }}
                    onDrop={(e) => {
                      if (isReadOnly) return;
                      e.preventDefault();
                      const entryId = e.dataTransfer.getData('entryId') || draggingEntryId;
                      const offId =
                        e.dataTransfer.getData('offeringId') ||
                        (!entryId ? e.dataTransfer.getData('text/plain') : null) ||
                        draggingOfferingId;
                      const pos = getSlotFromPointer(e);
                      setDragOverSlot(null);
                      setDraggingOfferingId(null);
                      setDraggingEntryId(null);
                      if (!pos) return;
                      if (entryId) {
                        onMoveEntryOnGrid(entryId, day.index, pos.startTime);
                      } else if (offId) {
                        onDropOnGrid(offId, day.index, pos.startTime);
                      }
                    }}
                  >
                    {/* Dedicated Permanent Institutional Lunch Break Indicator */}
                    <div
                      className="position-absolute start-0 end-0 d-flex align-items-center justify-content-center text-center px-1 border-top border-bottom border-warning border-opacity-50"
                      style={{
                        top: `${isHs ? 5.0 * HOUR_HEIGHT : 5.5 * HOUR_HEIGHT}px`,
                        height: `${isHs ? 1.0 * HOUR_HEIGHT : 0.5 * HOUR_HEIGHT}px`,
                        zIndex: 3,
                        pointerEvents: 'none',
                        backgroundColor: 'rgba(255, 193, 7, 0.08)',
                        backgroundImage:
                          'repeating-linear-gradient(45deg, rgba(255, 193, 7, 0.08), rgba(255, 193, 7, 0.08) 6px, transparent 6px, transparent 12px)',
                      }}
                      title={isHs ? 'High School Lunch Break: 12:00 - 13:00' : 'College Lunch Break: 12:30 - 13:00'}
                    >
                      <span
                        className="badge bg-warning bg-opacity-25 text-dark border border-warning-subtle fw-semibold px-1.5 py-0.5 d-inline-flex align-items-center gap-1 shadow-xs"
                        style={{ fontSize: '9px', lineHeight: '1.2' }}
                      >
                        <i className="bi bi-cup-hot" style={{ fontSize: '9px' }}></i>
                        <span>{isHs ? 'Lunch 12:00-13:00' : 'Lunch 12:30-13:00'}</span>
                      </span>
                    </div>

                    {/* Background Hour Grid Lines & Half-hour Drop Targets */}
                    {TIME_SLOTS.map((slot) => {
                      const isSlotHovered =
                        dragOverSlot?.dayIndex === day.index && dragOverSlot?.slotHour === slot;
                      const isBottomHovered = isSlotHovered && dragOverSlot?.isHalfHour;
                      const isTopHovered = isSlotHovered && !dragOverSlot?.isHalfHour;

                      const [hourPart] = slot.split(':');
                      const topStart = `${hourPart}:00`;
                      const bottomStart = `${hourPart}:30`;

                      const topConflicts = getSlotConflicts(day.index, topStart);
                      const bottomConflicts = getSlotConflicts(day.index, bottomStart);
                      const isTopConflicted = topConflicts.length > 0;
                      const isBottomConflicted = bottomConflicts.length > 0;
                      const isDraggingActive = Boolean(activeDragContext);

                      return (
                        <div
                          key={slot}
                          className={`border-bottom border-light-subtle w-100 position-relative transition ${
                            isSlotHovered ? 'bg-primary-subtle bg-opacity-25' : ''
                          }`}
                          style={{ height: `${HOUR_HEIGHT}px` }}
                        >
                          {/* Top half conflict highlight */}
                          {isDraggingActive && isTopConflicted && !isTopHovered && (
                            <div
                              className="position-absolute start-0 end-0 top-0 d-flex align-items-center justify-content-between px-1.5 border-start border-end border-danger border-opacity-50"
                              style={{
                                height: `${HOUR_HEIGHT / 2}px`,
                                zIndex: 5,
                                opacity: 0.9,
                                pointerEvents: 'none',
                                backgroundColor: 'rgba(220, 53, 69, 0.07)',
                                backgroundImage:
                                  'repeating-linear-gradient(45deg, rgba(220, 53, 69, 0.10), rgba(220, 53, 69, 0.10) 6px, transparent 6px, transparent 12px)',
                              }}
                              title={`Conflict at ${topStart}: ${topConflicts.map((c) => c.message).join(' | ')}`}
                            >
                              <span
                                className="badge bg-danger text-white border border-danger-subtle px-1 py-0 d-inline-flex align-items-center gap-0.5"
                                style={{ fontSize: '8px', lineHeight: '1.2' }}
                              >
                                <i className="bi bi-x-circle-fill" style={{ fontSize: '7.5px' }}></i>
                                <span className="text-truncate" style={{ maxWidth: '90px' }}>
                                  {topConflicts[0].badge}
                                </span>
                              </span>
                              {topConflicts.length > 1 && (
                                <span
                                  className="badge bg-danger-subtle text-danger border border-danger-subtle px-1 py-0"
                                  style={{ fontSize: '7.5px' }}
                                >
                                  +{topConflicts.length - 1}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Top half available slot highlight */}
                          {isDraggingActive && !isTopConflicted && !isTopHovered && (
                            <div
                              className="position-absolute start-0 end-0 top-0 border-start border-success border-opacity-50"
                              style={{
                                height: `${HOUR_HEIGHT / 2}px`,
                                zIndex: 4,
                                pointerEvents: 'none',
                                backgroundColor: 'rgba(25, 135, 84, 0.05)',
                              }}
                            />
                          )}

                          {/* Top half hover drop indicator */}
                          {isTopHovered && (
                            <div
                              className={`position-absolute start-0 end-0 top-0 d-flex flex-column align-items-center justify-content-center p-1 small fw-bold shadow-sm ${
                                isTopConflicted ? 'bg-danger text-white' : 'bg-primary text-white'
                              }`}
                              style={{ height: `${HOUR_HEIGHT / 2}px`, zIndex: 12, opacity: 0.98, fontSize: '10px', pointerEvents: 'none' }}
                            >
                              {isTopConflicted ? (
                                <>
                                  <div className="d-flex align-items-center gap-1 text-truncate">
                                    <i className="bi bi-x-circle-fill"></i>
                                    <span>Conflict: {topConflicts[0].badge}</span>
                                  </div>
                                  <div className="text-white-50 text-truncate" style={{ fontSize: '8.5px', maxWidth: '95%' }}>
                                    {topConflicts[0].message}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="d-flex align-items-center gap-1 text-truncate">
                                    <i className="bi bi-plus-circle-fill"></i>
                                    <span>Place at {topStart}</span>
                                  </div>
                                  {activeDragContext && (
                                    <div className="text-white-50 text-truncate" style={{ fontSize: '8.5px', maxWidth: '95%' }}>
                                      {activeDragContext.subject?.code} ({activeDragContext.sessionType === 'lab' ? 'Lab' : 'Lecture'} {activeDragContext.durationHours}h)
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}

                          <div
                            className="position-absolute start-0 end-0 border-bottom border-light-subtle border-opacity-50"
                            style={{ top: `${HOUR_HEIGHT / 2}px`, borderStyle: 'dashed', pointerEvents: 'none' }}
                          />

                          {/* Bottom half conflict highlight */}
                          {isDraggingActive && isBottomConflicted && !isBottomHovered && (
                            <div
                              className="position-absolute start-0 end-0 bottom-0 d-flex align-items-center justify-content-between px-1.5 border-start border-end border-danger border-opacity-50"
                              style={{
                                height: `${HOUR_HEIGHT / 2}px`,
                                zIndex: 5,
                                opacity: 0.9,
                                pointerEvents: 'none',
                                backgroundColor: 'rgba(220, 53, 69, 0.07)',
                                backgroundImage:
                                  'repeating-linear-gradient(45deg, rgba(220, 53, 69, 0.10), rgba(220, 53, 69, 0.10) 6px, transparent 6px, transparent 12px)',
                              }}
                              title={`Conflict at ${bottomStart}: ${bottomConflicts.map((c) => c.message).join(' | ')}`}
                            >
                              <span
                                className="badge bg-danger text-white border border-danger-subtle px-1 py-0 d-inline-flex align-items-center gap-0.5"
                                style={{ fontSize: '8px', lineHeight: '1.2' }}
                              >
                                <i className="bi bi-x-circle-fill" style={{ fontSize: '7.5px' }}></i>
                                <span className="text-truncate" style={{ maxWidth: '90px' }}>
                                  {bottomConflicts[0].badge}
                                </span>
                              </span>
                              {bottomConflicts.length > 1 && (
                                <span
                                  className="badge bg-danger-subtle text-danger border border-danger-subtle px-1 py-0"
                                  style={{ fontSize: '7.5px' }}
                                >
                                  +{bottomConflicts.length - 1}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Bottom half clean slot highlight */}
                          {isDraggingActive && !isBottomConflicted && !isBottomHovered && (
                            <div
                              className="position-absolute start-0 end-0 bottom-0 border-start border-success border-opacity-50"
                              style={{
                                height: `${HOUR_HEIGHT / 2}px`,
                                zIndex: 4,
                                pointerEvents: 'none',
                                backgroundColor: 'rgba(25, 135, 84, 0.05)',
                              }}
                            />
                          )}

                          {/* Bottom half hover drop indicator */}
                          {isBottomHovered && (
                            <div
                              className={`position-absolute start-0 end-0 bottom-0 d-flex flex-column align-items-center justify-content-center p-1 small fw-bold shadow-sm ${
                                isBottomConflicted ? 'bg-danger text-white' : 'bg-primary text-white'
                              }`}
                              style={{ height: `${HOUR_HEIGHT / 2}px`, zIndex: 12, opacity: 0.98, fontSize: '10px', pointerEvents: 'none' }}
                            >
                              {isBottomConflicted ? (
                                <>
                                  <div className="d-flex align-items-center gap-1 text-truncate">
                                    <i className="bi bi-x-circle-fill"></i>
                                    <span>Conflict: {bottomConflicts[0].badge}</span>
                                  </div>
                                  <div className="text-white-50 text-truncate" style={{ fontSize: '8.5px', maxWidth: '95%' }}>
                                    {bottomConflicts[0].message}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="d-flex align-items-center gap-1 text-truncate">
                                    <i className="bi bi-plus-circle-fill"></i>
                                    <span>Place at {bottomStart}</span>
                                  </div>
                                  {activeDragContext && (
                                    <div className="text-white-50 text-truncate" style={{ fontSize: '8.5px', maxWidth: '95%' }}>
                                      {activeDragContext.subject?.code} ({activeDragContext.sessionType === 'lab' ? 'Lab' : 'Lecture'} {activeDragContext.durationHours}h)
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Positioned Subject Cards */}
                    {dayEntries.map((e) => {
                      const sMins = timeToMinutes(e.start_time);
                      const eMins = timeToMinutes(e.end_time);
                      const topOffset = Math.max(0, ((sMins - GRID_START_MIN) / 60) * HOUR_HEIGHT);
                      const durationMins = Math.max(30, eMins - sMins);
                      const cardHeight = Math.max(34, (durationMins / 60) * HOUR_HEIGHT - 4);

                      const layout = layoutMap.get(e.id) || { colIndex: 0, totalCols: 1 };
                      const widthPercent = 100 / layout.totalCols;
                      const leftPercent = layout.colIndex * widthPercent;

                      const offering = offerings.find((o) => o.id === e.offering_id);
                      const isCurrentBlock = offering?.block_id === selectedBlockId;
                      const otherBlock = !isCurrentBlock ? blocks.find((b) => b.id === offering?.block_id) : null;
                      const subject = subjects.find((s) => s.id === offering?.subject_id);
                      const instructor = instructors.find((i) => i.id === e.instructor_id);
                      const room = rooms.find((r) => r.id === e.room_id);
                      const entryViolations = violationsByEntryId.get(e.id);
                      const isHighlighted = highlightedEntryId === e.id;
                      const canEdit = !isReadOnly && isSubjectAllowed(offering?.subject_id);
                      const isThisDragging = draggingEntryId === e.id;

                      return (
                        <TimetableGridCard
                          key={e.id}
                          entry={e}
                          offering={offering}
                          subject={subject}
                          instructor={instructor}
                          room={room}
                          otherBlock={otherBlock}
                          isCurrentBlock={isCurrentBlock}
                          canEdit={canEdit}
                          isHighlighted={isHighlighted}
                          isThisDragging={isThisDragging}
                          entryViolations={entryViolations}
                          topOffset={topOffset}
                          cardHeight={cardHeight}
                          leftPercent={leftPercent}
                          widthPercent={widthPercent}
                          isSubjectUnspecified={isSubjectUnspecified}
                          formatBlockLabel={formatBlockLabel}
                          onEdit={(entry) => {
                            if (!dragOccurredRef.current) onEditEntry(entry);
                          }}
                          onDelete={onDeleteEntry}
                          onDragStart={(_ev, id) => {
                            dragOccurredRef.current = true;
                            setDraggingEntryId(id);
                          }}
                          onDragEnd={() => {
                            setDraggingEntryId(null);
                            setDragOverSlot(null);
                            setTimeout(() => {
                              dragOccurredRef.current = false;
                            }, 120);
                          }}
                          isDragActive={Boolean(draggingEntryId || draggingOfferingId)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
