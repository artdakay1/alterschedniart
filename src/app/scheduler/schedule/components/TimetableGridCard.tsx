// src/app/scheduler/schedule/components/TimetableGridCard.tsx
'use client';

import React from 'react';
import type { ScheduleEntry, ClassOffering, Subject, Instructor, Room, Block } from '@/types/database';
import { formatTimeShort } from '@/lib/conflict-engine';

export interface TimetableGridCardProps {
  entry: ScheduleEntry;
  offering?: (ClassOffering & { subjects?: Subject | null; blocks?: Block | null }) | null;
  subject?: Subject | null;
  instructor?: Instructor | null;
  room?: Room | null;
  otherBlock?: Block | null;
  isCurrentBlock: boolean;
  canEdit: boolean;
  isHighlighted: boolean;
  isThisDragging: boolean;
  entryViolations?: { hard: Array<{ rule: string; message: string }>; soft: Array<{ rule: string; message: string }> };
  topOffset: number;
  cardHeight: number;
  leftPercent: number;
  widthPercent: number;
  isSubjectUnspecified: (idOrCode?: string | null) => boolean;
  formatBlockLabel: (b?: any) => string;
  onEdit: (entry: ScheduleEntry) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  isDragActive?: boolean;
}

export const TimetableGridCard = React.memo(function TimetableGridCard({
  entry,
  subject,
  instructor,
  room,
  otherBlock,
  isCurrentBlock,
  canEdit,
  isHighlighted,
  isThisDragging,
  entryViolations,
  topOffset,
  cardHeight,
  leftPercent,
  widthPercent,
  isSubjectUnspecified,
  formatBlockLabel,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragActive,
}: TimetableGridCardProps) {
  // If entry belongs to another block occupying this room
  if (!isCurrentBlock) {
    return (
      <div
        className="rounded-3 p-1.5 transition position-absolute d-flex flex-column justify-content-between overflow-hidden shadow-none"
        style={{
          top: `${topOffset + 2}px`,
          height: `${cardHeight}px`,
          left: `calc(${leftPercent}% + 2px)`,
          width: `calc(${widthPercent}% - 4px)`,
          zIndex: 2,
          backgroundColor: '#f8fafc',
          border: '1.5px dashed #94a3b8',
          color: '#475569',
          pointerEvents: isDragActive ? 'none' : 'auto',
        }}
        title={`Occupied Room: ${room?.name || 'TBA'}\nCohort: ${otherBlock ? formatBlockLabel(otherBlock) : 'Other Block'}\nCourse: ${subject?.code} - ${subject?.title}\nInstructor: ${instructor?.full_name || 'TBA'}\nTime: ${formatTimeShort(entry.start_time)} - ${formatTimeShort(entry.end_time)}`}
      >
        <div>
          <div className="d-flex align-items-center justify-content-between gap-1 mb-0.5">
            <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle text-truncate fw-semibold" style={{ fontSize: '8px', padding: '1px 3px' }}>
              {otherBlock ? formatBlockLabel(otherBlock) : 'Other Block'}
            </span>
            <span className="badge bg-warning-subtle text-dark border border-warning-subtle fw-bold" style={{ fontSize: '8px', padding: '1px 3px' }}>
              📍 {room?.name || 'Room'}
            </span>
          </div>
          <div className="fw-semibold text-dark text-truncate" style={{ fontSize: '9.5px' }}>
            {subject?.code || 'Course'}
          </div>
          <div className="text-secondary text-truncate" style={{ fontSize: '8.5px' }}>
            {instructor?.full_name}
          </div>
        </div>
        <div className="mt-auto pt-0.5 border-top border-light-subtle d-flex align-items-center justify-content-between">
          <span className="font-monospace text-muted" style={{ fontSize: '8px' }}>
            {formatTimeShort(entry.start_time)}-{formatTimeShort(entry.end_time)}
          </span>
          <span className="badge bg-light text-muted border" style={{ fontSize: '7.5px', padding: '1px 2px' }}>
            Occupied
          </span>
        </div>
      </div>
    );
  }

  const hasHardViolations = Boolean(entryViolations && entryViolations.hard.length > 0);
  const hasSoftViolations = Boolean(entryViolations && entryViolations.soft.length > 0);
  const effectiveCardHeight = hasHardViolations || hasSoftViolations ? Math.max(cardHeight, 95) : Math.max(cardHeight, 52);

  // Feature D: Visual Room Type & Subject Category Accents
  const subCodeUpper = (subject?.code || '').toUpperCase();
  const subTitleUpper = (subject?.title || '').toUpperCase();
  const isPE = subCodeUpper.includes('PE') || subCodeUpper.includes('PATHFIT') || subTitleUpper.includes('PHYSICAL EDUCATION');
  const isNSTP = subCodeUpper.includes('NSTP') || subCodeUpper.includes('CWTS') || subCodeUpper.includes('ROTC');
  const isLab = entry.session_type === 'lab';

  let borderLeftStyle = '4px solid #6366f1'; // Default Lecture: Indigo
  let cardBg = '#fcfdfe';
  let badgeText = '📘 Lec';
  let badgeBg = 'rgba(99, 102, 241, 0.10)';
  let badgeColor = '#4338ca';

  if (hasHardViolations) {
    borderLeftStyle = '4px solid #dc3545';
    cardBg = '#fff5f5';
  } else if (hasSoftViolations) {
    borderLeftStyle = '4px solid #f59e0b';
    cardBg = '#fffbeb';
  } else if (isPE) {
    borderLeftStyle = '4px solid #f97316';
    cardBg = 'rgba(249, 115, 22, 0.04)';
    badgeText = '🏃 PE';
    badgeBg = 'rgba(249, 115, 22, 0.12)';
    badgeColor = '#c2410c';
  } else if (isNSTP) {
    borderLeftStyle = '4px solid #eab308';
    cardBg = 'rgba(234, 179, 8, 0.04)';
    badgeText = '🎖️ NSTP';
    badgeBg = 'rgba(234, 179, 8, 0.12)';
    badgeColor = '#a16207';
  } else if (isLab) {
    borderLeftStyle = '4px solid #10b981';
    cardBg = 'rgba(16, 185, 129, 0.04)';
    badgeText = '💻 Lab';
    badgeBg = 'rgba(16, 185, 129, 0.12)';
    badgeColor = '#047857';
  }

  return (
    <div
      draggable={canEdit}
      onDragStart={(ev) => {
        if (!canEdit) return;
        ev.dataTransfer.setData('entryId', entry.id);
        ev.dataTransfer.setData('text/plain', entry.id);
        ev.dataTransfer.effectAllowed = 'move';
        onDragStart(ev, entry.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (canEdit) onEdit(entry);
      }}
      className={`rounded-3 p-2 transition position-absolute shadow-sm d-flex flex-column justify-content-between overflow-hidden ${
        isHighlighted ? 'ring-2 ring-primary shadow-md' : ''
      } ${canEdit ? 'hover:shadow hover:border-primary-subtle' : ''}`}
      style={{
        top: `${topOffset + 2}px`,
        height: `${effectiveCardHeight}px`,
        minHeight: `${effectiveCardHeight}px`,
        left: `calc(${leftPercent}% + 3px)`,
        width: `calc(${widthPercent}% - 6px)`,
        zIndex: isThisDragging ? 100 : isHighlighted ? 10 : (hasHardViolations ? 4 : 3),
        cursor: canEdit ? 'grab' : 'default',
        opacity: isThisDragging ? 0.35 : 1,
        pointerEvents: isThisDragging ? 'auto' : (isDragActive ? 'none' : 'auto'),
        backgroundColor: cardBg,
        border: '1px solid #e2e8f0',
        borderLeft: borderLeftStyle,
      }}
    >
      {/* Header: Subject & Session Type & Note Tag */}
      <div>
        <div className="d-flex align-items-center justify-content-between gap-1 mb-0.5">
          <div className="d-flex align-items-center gap-1 text-truncate">
            <span className="fw-bold text-dark text-truncate" style={{ fontSize: '11px' }}>
              {subject?.code || 'Course'}
            </span>
            {(entry as any).notes && (
              <span
                className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle cursor-pointer d-inline-flex align-items-center gap-0.5"
                style={{ fontSize: '8.5px', padding: '1px 4px' }}
                title={`Note: ${(entry as any).notes}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  alert(`Scheduler Note for ${subject?.code || 'Course'}:\n\n${(entry as any).notes}`);
                }}
              >
                <i className="bi bi-sticky-fill text-warning"></i>
                <span>Note</span>
              </span>
            )}
          </div>
          <div className="d-flex align-items-center gap-1">
            {canEdit && (
              <span
                className="text-secondary opacity-50"
                title="Drag to reschedule"
                style={{ cursor: 'grab', fontSize: '11px' }}
              >
                <i className="bi bi-grip-vertical"></i>
              </span>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onEdit(entry);
                }}
                className="btn btn-xs py-0 px-1 border-0 bg-white/90 text-primary hover:bg-primary hover:text-white rounded shadow-2xs fw-bold"
                title="Edit schedule entry"
                style={{ fontSize: '9px', lineHeight: '1.2' }}
              >
                <i className="bi bi-pencil-fill me-0.5"></i>
                <span>Edit</span>
              </button>
            )}
            <span
              className="badge rounded-pill fw-semibold border"
              style={{
                fontSize: '8.5px',
                padding: '2px 5px',
                backgroundColor: badgeBg,
                color: badgeColor,
                borderColor: badgeColor + '33',
              }}
            >
              {badgeText}
            </span>
          </div>
        </div>

        {/* Room & Instructor */}
        <div className="text-secondary text-truncate d-flex align-items-center gap-1" style={{ fontSize: '10px' }}>
          <i className="bi bi-geo-alt text-muted" style={{ fontSize: '9px' }}></i>
          {entry.room_id &&
          entry.room_id !== '00000000-0000-0000-0000-000000000000' &&
          room?.name !== 'None (N/A)' &&
          !isSubjectUnspecified(subject?.id) &&
          !isSubjectUnspecified(subject?.code) ? (
            <span className="fw-medium">{room?.name}</span>
          ) : (
            <span className="fst-italic text-muted">None (N/A)</span>
          )}
        </div>
        <div className="text-muted text-truncate d-flex align-items-center gap-1" style={{ fontSize: '10px' }}>
          <i className="bi bi-person text-muted" style={{ fontSize: '9px' }}></i>
          <span>{instructor?.full_name || 'TBA'}</span>
        </div>

        {/* Inline Violation Badges */}
        {hasHardViolations && entryViolations && (
          <div className="mt-0.5 pt-0.5 border-top border-danger border-opacity-25">
            <span className="fw-bold text-danger text-truncate d-block" style={{ fontSize: '9px' }}>
              <i className="bi bi-exclamation-octagon-fill me-1"></i>
              {entryViolations.hard[0].rule.replace('_', ' ')}
            </span>
          </div>
        )}

        {hasSoftViolations && entryViolations && !hasHardViolations && (
          <div className="mt-0.5 pt-0.5 border-top border-warning border-opacity-50">
            <span className="fw-bold text-warning text-truncate d-block" style={{ fontSize: '9px' }}>
              <i className="bi bi-exclamation-triangle-fill me-1"></i>
              {entryViolations.soft[0].rule.replace('_', ' ')}
            </span>
          </div>
        )}
      </div>

      {/* Time & Action buttons at bottom */}
      <div className="mt-auto pt-1 d-flex align-items-center justify-content-between border-top border-light-subtle">
        <div className="text-muted font-monospace" style={{ fontSize: '9.5px' }}>
          {formatTimeShort(entry.start_time)} - {formatTimeShort(entry.end_time)}
        </div>

        {canEdit && (
          <div className="d-flex align-items-center gap-1">
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onEdit(entry);
              }}
              className="btn btn-outline-secondary btn-sm py-0 px-1"
              style={{ fontSize: '9.5px', lineHeight: '1.2' }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onDelete(entry.id);
              }}
              className="btn btn-outline-danger btn-sm py-0 px-1"
              style={{ fontSize: '9.5px', lineHeight: '1.2' }}
            >
              Del
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
