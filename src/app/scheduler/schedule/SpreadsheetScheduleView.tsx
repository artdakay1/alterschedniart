'use client';

import React, { useState, useMemo } from 'react';
import type {
  ScheduleEntry,
  ClassOffering,
  Subject,
  Block,
  Instructor,
  Room,
  AcademicTerm,
} from '@/types/database';

interface SpreadsheetScheduleViewProps {
  entries: (ScheduleEntry & {
    class_offerings?: (ClassOffering & { subjects?: Subject | null; blocks?: Block | null }) | null;
    instructors?: Instructor | null;
    rooms?: Room | null;
  })[];
  offerings: (ClassOffering & { subjects?: Subject | null })[];
  rooms: Room[];
  instructors: (Instructor & {
    instructor_qualifications?: { subject_id: string }[];
    instructor_availability?: { day_of_week: number; start_time: string; end_time: string }[];
  })[];
  subjects: Subject[];
  blocks: (Block & { programs?: { code: string; name: string } | null })[];
  selectedBlockId: string;
  selectedTerm: AcademicTerm;
  isReadOnly: boolean;
  lockToBlock?: boolean;
  onEditEntry: (entry: ScheduleEntry) => void;
  onDeleteEntry: (entryId: string) => void;
  onAddEntry: () => void;
  onGenerateAiDraft?: () => void;
}

// Helpers for day and time formatting
function formatDayAbbrev(days: number[]): string {
  const sorted = Array.from(new Set(days)).sort();
  if (sorted.length === 2 && sorted[0] === 1 && sorted[1] === 3) return 'MW';
  if (sorted.length === 2 && sorted[0] === 2 && sorted[1] === 4) return 'TTH';
  if (sorted.length === 2 && sorted[0] === 1 && sorted[1] === 5) return 'MF';
  if (sorted.length === 2 && sorted[0] === 1 && sorted[1] === 4) return 'MTH';
  if (sorted.length === 2 && sorted[0] === 2 && sorted[1] === 5) return 'TF';
  if (sorted.length === 2 && sorted[0] === 3 && sorted[1] === 5) return 'WF';
  if (sorted.length === 3 && sorted[0] === 1 && sorted[1] === 3 && sorted[2] === 5) return 'MWF';
  if (sorted.length === 2 && sorted[0] === 5 && sorted[1] === 6) return 'FRI/SAT';
  if (sorted.length === 1) {
    switch (sorted[0]) {
      case 0: return 'SUN';
      case 1: return 'MON';
      case 2: return 'TUE';
      case 3: return 'WED';
      case 4: return 'THU';
      case 5: return 'FRI';
      case 6: return 'SAT';
      default: return '';
    }
  }
  const dayCode = (d: number) => {
    switch (d) {
      case 0: return 'SUN';
      case 1: return 'M';
      case 2: return 'T';
      case 3: return 'W';
      case 4: return 'TH';
      case 5: return 'F';
      case 6: return 'S';
      default: return '';
    }
  };
  return sorted.map(dayCode).join('');
}

function formatSpreadsheetRange(startTime: string, endTime: string): string {
  if (!startTime || !endTime) return '';
  const [shStr, smStr] = startTime.split(':');
  const [ehStr, emStr] = endTime.split(':');
  const sh = parseInt(shStr, 10);
  const sm = parseInt(smStr || '0', 10);
  const eh = parseInt(ehStr, 10);
  const em = parseInt(emStr || '0', 10);

  const startHour12 = sh % 12 === 0 ? 12 : sh % 12;
  const startMinuteStr = sm === 0 ? '' : `:${sm < 10 ? '0' + sm : sm}`;

  const endPeriod = eh >= 12 ? 'PM' : 'AM';
  const endHour12 = eh % 12 === 0 ? 12 : eh % 12;
  const endMinuteStr = em === 0 ? '' : `:${em < 10 ? '0' + em : em}`;

  return `${startHour12}${startMinuteStr} - ${endHour12}${endMinuteStr}${endPeriod}`;
}

interface RowItem {
  id: string;
  day: string;
  labTime: string;
  lecTime: string;
  code: string;
  description: string;
  year: number | string;
  room: string;
  units: number;
  entry: ScheduleEntry;
}

interface SubjectGroup {
  code: string;
  rows: RowItem[];
}

interface TeacherGroup {
  teacherId: string;
  teacherName: string;
  totalUnits: number;
  subjects: SubjectGroup[];
  totalRows: number;
}

export function SpreadsheetScheduleView({
  entries,
  offerings,
  rooms,
  instructors,
  subjects,
  blocks,
  selectedBlockId,
  selectedTerm,
  isReadOnly,
  lockToBlock = false,
  onEditEntry,
  onDeleteEntry,
  onAddEntry,
  onGenerateAiDraft,
}: SpreadsheetScheduleViewProps) {
  const [filterScope, setFilterScope] = useState<'all' | 'block'>(lockToBlock ? 'block' : 'all');
  const [selectedFilterBlockId, setSelectedFilterBlockId] = useState<string>('');
  const [selectedFilterRoomId, setSelectedFilterRoomId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Find all blocks that have at least 1 class offering scheduled in entries
  const blocksWithSchedule = useMemo(() => {
    const blockIdsWithClasses = new Set<string>();
    entries.forEach((e) => {
      const off = offerings.find((o) => o.id === e.offering_id);
      if (off?.block_id) {
        blockIdsWithClasses.add(off.block_id);
      }
    });
    return blocks
      .filter((b) => blockIdsWithClasses.has(b.id))
      .sort((a, b) => {
        const progA = a.programs?.code || 'Block';
        const progB = b.programs?.code || 'Block';
        const secA =
          a.section.startsWith(String(a.year_level)) || /^Grade/i.test(a.section)
            ? a.section
            : `${a.year_level}${a.section}`;
        const secB =
          b.section.startsWith(String(b.year_level)) || /^Grade/i.test(b.section)
            ? b.section
            : `${b.year_level}${b.section}`;
        const nameA = `${progA} - ${secA}`;
        const nameB = `${progB} - ${secB}`;
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [entries, offerings, blocks]);

  const effectiveScope = lockToBlock ? 'block' : filterScope;

  // Active block to display when scope is 'block'
  const activeBlockId = lockToBlock
    ? selectedBlockId
    : (selectedFilterBlockId || (blocksWithSchedule.length > 0 ? blocksWithSchedule[0].id : selectedBlockId));

  // Filter entries based on scope
  const scopedEntries = useMemo(() => {
    let list = entries;
    if (effectiveScope === 'block' && activeBlockId) {
      list = list.filter((e) => {
        const off = offerings.find((o) => o.id === e.offering_id);
        return off?.block_id === activeBlockId;
      });
    }

    if (selectedFilterRoomId !== 'all') {
      list = list.filter((e) => e.room_id === selectedFilterRoomId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((e) => {
        const off = offerings.find((o) => o.id === e.offering_id);
        const sub = subjects.find((s) => s.id === off?.subject_id);
        const inst = instructors.find((i) => i.id === e.instructor_id);
        const room = rooms.find((r) => r.id === e.room_id);
        return (
          sub?.code.toLowerCase().includes(q) ||
          sub?.title.toLowerCase().includes(q) ||
          inst?.full_name.toLowerCase().includes(q) ||
          room?.name.toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [entries, effectiveScope, activeBlockId, selectedFilterRoomId, searchQuery, offerings, subjects, instructors, rooms]);

  // Group entries by teacher -> then by subject code
  const teacherGroups: TeacherGroup[] = useMemo(() => {
    // 1. Collect entries by teacher
    const byTeacher = new Map<string, typeof entries>();

    scopedEntries.forEach((e) => {
      const tId = e.instructor_id || 'unassigned';
      if (!byTeacher.has(tId)) {
        byTeacher.set(tId, []);
      }
      byTeacher.get(tId)!.push(e);
    });

    const groups: TeacherGroup[] = [];

    byTeacher.forEach((tEntries, tId) => {
      const instructor = instructors.find((i) => i.id === tId);
      const teacherName = instructor ? instructor.full_name : 'Unassigned Faculty';

      // 2. Group this teacher's entries by Offering / Subject
      const byOffering = new Map<string, typeof entries>();
      tEntries.forEach((e) => {
        const offId = e.offering_id || 'unknown';
        if (!byOffering.has(offId)) {
          byOffering.set(offId, []);
        }
        byOffering.get(offId)!.push(e);
      });

      let totalUnitsSum = 0;
      const countedSubjects = new Set<string>();

      // Build row items per offering
      const rowsForTeacher: RowItem[] = [];

      byOffering.forEach((offEntries, offId) => {
        const off = offerings.find((o) => o.id === offId);
        const sub = subjects.find((s) => s.id === off?.subject_id);
        const blk = blocks.find((b) => b.id === off?.block_id);

        const subCode = sub?.code || 'SUBJ';
        const subTitle = sub?.title || 'Subject';
        const section = blk?.section ? ` ${blk.section}` : '';
        const description = `${subTitle}${section}`;
        const yearLevel = blk?.year_level ?? 1;
        const units = sub?.units ?? 3;

        if (sub && !countedSubjects.has(sub.id)) {
          countedSubjects.add(sub.id);
          totalUnitsSum += units;
        }

        // Group entries by exact time slot (start_time - end_time)
        // If sessions share the same time (even on different days and in different rooms),
        // combine them together (e.g. Day: MF; Rooms: CCS Lecture Room 101/Comp Lab 101)
        const byTimeSlot = new Map<string, typeof offEntries>();
        offEntries.forEach((e) => {
          const timeKey = `${e.start_time.slice(0, 5)}-${e.end_time.slice(0, 5)}`;
          const list = byTimeSlot.get(timeKey) || [];
          list.push(e);
          byTimeSlot.set(timeKey, list);
        });

        byTimeSlot.forEach((timeEntries) => {
          const firstE = timeEntries[0];
          const days = timeEntries.map((e) => e.day_of_week);
          const dayStr = formatDayAbbrev(days);

          // Unique rooms in order of appearance
          const roomNames = Array.from(
            new Set(
              timeEntries.map((e) => {
                const r = rooms.find((rm) => rm.id === e.room_id);
                return r ? r.name : e.room_id ? 'TBA' : 'Off-site';
              })
            )
          );
          const roomStr = roomNames.join('/');

          const hasLab = timeEntries.some((e) => e.session_type === 'lab');
          const hasLec = timeEntries.some((e) => e.session_type === 'lecture');
          const timeRangeStr = formatSpreadsheetRange(firstE.start_time, firstE.end_time);

          let labTime = '';
          let lecTime = '';

          if (hasLab && hasLec) {
            labTime = timeRangeStr;
            lecTime = timeRangeStr;
          } else if (hasLab) {
            labTime = timeRangeStr;
          } else {
            lecTime = timeRangeStr;
          }

          rowsForTeacher.push({
            id: timeEntries.map((e) => e.id).join('-'),
            day: dayStr,
            labTime,
            lecTime,
            code: subCode,
            description,
            year: yearLevel,
            room: roomStr,
            units,
            entry: firstE,
          });
        });
      });

      // 3. Sub-group rows by course CODE (for code rowSpan)
      const subjectMap = new Map<string, RowItem[]>();
      rowsForTeacher.forEach((r) => {
        if (!subjectMap.has(r.code)) {
          subjectMap.set(r.code, []);
        }
        subjectMap.get(r.code)!.push(r);
      });

      const subjectsList: SubjectGroup[] = [];
      subjectMap.forEach((rows, code) => {
        subjectsList.push({ code, rows });
      });

      groups.push({
        teacherId: tId,
        teacherName,
        totalUnits: totalUnitsSum,
        subjects: subjectsList,
        totalRows: rowsForTeacher.length,
      });
    });

    // Sort teachers alphabetically
    groups.sort((a, b) => a.teacherName.localeCompare(b.teacherName));

    return groups;
  }, [scopedEntries, instructors, offerings, subjects, blocks, rooms]);

  const displayedBlock = blocks.find((b) => b.id === (effectiveScope === 'block' ? activeBlockId : selectedBlockId));
  const departmentName = displayedBlock?.programs?.name || 'COLLEGE OF COMPUTER STUDIES';

  return (
    <div className="spreadsheet-schedule-container mb-5">
      {/* Action / Controls Toolbar */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3 p-3 bg-white rounded-3 shadow-sm border border-light">
        <div className="d-flex flex-wrap align-items-center gap-2">
          {lockToBlock ? (
            <div className="d-flex align-items-center gap-2">
              <span className="badge bg-primary px-3 py-2 fs-6 rounded-pill d-flex align-items-center gap-1.5 shadow-sm">
                <i className="bi bi-collection-fill"></i>
                <span>
                  {displayedBlock
                    ? `${displayedBlock.programs?.code || 'BSIT'} ${
                        displayedBlock.section.startsWith(String(displayedBlock.year_level)) || /^Grade/i.test(displayedBlock.section)
                          ? displayedBlock.section
                          : `${displayedBlock.year_level}${displayedBlock.section}`
                      }`
                    : 'Selected Block'}{' '}
                  Schedule
                </span>
              </span>
            </div>
          ) : (
            <div className="d-flex flex-wrap align-items-center gap-2">
              <button
                type="button"
                className={`btn btn-sm px-3 py-1.5 fw-semibold rounded-pill d-flex align-items-center gap-1.5 transition ${
                  filterScope === 'all'
                    ? 'btn-primary text-white shadow-sm'
                    : 'btn-outline-secondary bg-white text-secondary'
                }`}
                onClick={() => setFilterScope('all')}
              >
                <i className="bi bi-people-fill"></i>
                <span>Full College Program</span>
              </button>

              <div className="d-flex align-items-center position-relative">
                <span
                  className={`position-absolute start-0 top-50 translate-middle-y ms-2.5 pointer-events-none ${
                    filterScope === 'block' ? 'text-primary' : 'text-muted'
                  }`}
                  style={{ zIndex: 2 }}
                >
                  <i className="bi bi-collection"></i>
                </span>
                <select
                  className={`form-select form-select-sm fw-semibold rounded-pill ps-4 pe-4 transition ${
                    filterScope === 'block'
                      ? 'border-primary text-primary bg-primary-subtle shadow-sm'
                      : 'border-secondary-subtle text-secondary bg-white'
                  }`}
                  style={{ minWidth: '190px', cursor: 'pointer', height: '34px' }}
                  value={filterScope === 'block' ? (activeBlockId || '') : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setSelectedFilterBlockId(val);
                      setFilterScope('block');
                    } else {
                      setFilterScope('all');
                    }
                  }}
                  aria-label="Filter schedule by block"
                >
                  <option value="" disabled={filterScope === 'block'}>
                    {blocksWithSchedule.length === 0 ? 'No blocks scheduled' : '— Filter by Block —'}
                  </option>
                  {blocksWithSchedule.map((b) => {
                    const blockLabel = `${b.programs?.code || 'Block'} - ${
                      b.section.startsWith(String(b.year_level)) || /^Grade/i.test(b.section)
                        ? b.section
                        : `${b.year_level}${b.section}`
                    }`;
                    return (
                      <option key={b.id} value={b.id}>
                        {blockLabel}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>
          )}

          {/* Room Filter Dropdown */}
          <div className="d-flex align-items-center position-relative">
            <span
              className={`position-absolute start-0 top-50 translate-middle-y ms-2.5 pointer-events-none ${
                selectedFilterRoomId !== 'all' ? 'text-primary' : 'text-muted'
              }`}
              style={{ zIndex: 2 }}
            >
              <i className="bi bi-door-open"></i>
            </span>
            <select
              className={`form-select form-select-sm fw-semibold rounded-pill ps-4 pe-4 transition ${
                selectedFilterRoomId !== 'all'
                  ? 'border-primary text-primary bg-primary-subtle shadow-sm'
                  : 'border-secondary-subtle text-secondary bg-white'
              }`}
              style={{ minWidth: '165px', cursor: 'pointer', height: '34px' }}
              value={selectedFilterRoomId}
              onChange={(e) => setSelectedFilterRoomId(e.target.value)}
              aria-label="Filter schedule by classroom or lab"
            >
              <option value="all">All Rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.room_type})
                </option>
              ))}
            </select>
          </div>

          <div className="position-relative ms-sm-2" style={{ minWidth: '220px' }}>
            <i className="bi bi-search position-absolute top-50 start-0 translate-middle-y ms-2 text-muted small"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subject, room, teacher..."
              className="form-control form-control-sm ps-4 ref-form-control"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="btn btn-link btn-sm position-absolute top-50 end-0 translate-middle-y text-muted p-0 me-2"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        <div className="d-flex align-items-center gap-2">
          {!isReadOnly && onGenerateAiDraft && (
            <button
              onClick={onGenerateAiDraft}
              className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1.5 px-3"
              title="Generate schedule draft with AI"
            >
              <i className="bi bi-stars text-primary"></i>
              <span>AI Auto-Schedule</span>
            </button>
          )}

          {!isReadOnly && (
            <button
              onClick={onAddEntry}
              className="btn btn-sm btn-primary d-flex align-items-center gap-1 shadow-sm px-3"
            >
              <i className="bi bi-plus-lg"></i>
              <span>Add Class Entry</span>
            </button>
          )}

          <button
            onClick={() => window.print()}
            className="btn btn-sm btn-outline-dark d-flex align-items-center gap-1 px-3"
            title="Print Spreadsheet Program"
          >
            <i className="bi bi-printer"></i>
            <span>Print Program</span>
          </button>
        </div>
      </div>

      {/* Main Spreadsheet Card */}
      <div className="bg-white rounded-4 shadow-sm border border-dark overflow-hidden print-area">
        {/* Institutional Header Banner */}
        <div
          className="p-3 text-white position-relative"
          style={{
            background: 'linear-gradient(135deg, #050b1e 0%, #0a1738 50%, #08112c 100%)',
            borderBottom: '3.5px solid #00a2e8',
          }}
        >
          {/* Subtle Circuit Tech Glow Lines */}
          <div
            className="position-absolute top-0 bottom-0 start-0 end-0 opacity-15 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(#00a2e8 1px, transparent 1px)',
              backgroundSize: '16px 16px',
            }}
          />

          <div className="d-flex align-items-center justify-content-between position-relative z-1 px-2">
            {/* Left: CCTC Logo */}
            <div className="d-flex align-items-center justify-content-center" style={{ width: '85px', height: '85px' }}>
              <img
                src="/images/cctc-logo.png"
                alt="CCTC Logo"
                style={{ maxWidth: '80px', maxHeight: '80px', objectFit: 'contain' }}
              />
            </div>

            {/* Center: Program Details + AlterSched Logo */}
            <div className="text-center flex-grow-1 px-2">
              <div className="d-flex align-items-center justify-content-center gap-2 mb-1">
                <img
                  src="/images/altersched-logo.png"
                  alt="AlterSched Logo"
                  style={{ height: '32px', width: 'auto', objectFit: 'contain' }}
                  className="d-none d-sm-inline-block"
                />
                <h4
                  className="fw-extrabold mb-0 text-uppercase text-white tracking-wide"
                  style={{
                    letterSpacing: '1.5px',
                    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                    fontSize: '22px',
                    textShadow: '0 2px 4px rgba(0,0,0,0.6)',
                  }}
                >
                  {departmentName}
                </h4>
              </div>
              <div
                className="fw-bold d-inline-block px-3 py-0.5 rounded-pill mb-1"
                style={{
                  backgroundColor: 'rgba(0, 162, 232, 0.18)',
                  color: '#00c3ff',
                  border: '1px solid rgba(0, 195, 255, 0.35)',
                  fontSize: '13px',
                  letterSpacing: '1px',
                }}
              >
                CLASS PROGRAM | {selectedTerm?.semester || 'First Semester'}
                {effectiveScope === 'block' && displayedBlock
                  ? ` • ${displayedBlock.programs?.code || 'BSIT'} ${
                      displayedBlock.section.startsWith(String(displayedBlock.year_level)) || /^Grade/i.test(displayedBlock.section)
                        ? displayedBlock.section
                        : `${displayedBlock.year_level}${displayedBlock.section}`
                    }`
                  : ' • FULL COLLEGE PROGRAM'}
              </div>
              <div
                className="fw-semibold text-light"
                style={{
                  fontSize: '13px',
                  letterSpacing: '1.2px',
                  color: '#e2e8f0',
                }}
              >
                S.Y. {selectedTerm?.school_year || '2026 - 2027'}
              </div>
            </div>

            {/* Right: CCS Logo */}
            <div className="d-flex align-items-center justify-content-center" style={{ width: '85px', height: '85px' }}>
              <img
                src="/images/ccs-logo.png"
                alt="CCS Logo"
                style={{ maxWidth: '80px', maxHeight: '80px', objectFit: 'contain' }}
              />
            </div>
          </div>
        </div>

        {/* Spreadsheet Table View (9 Fixed Columns perfectly fitted to 100% width, no horizontal scrollbars) */}
        <div className="w-100 overflow-visible">
          <table
            className="table table-bordered mb-0 align-middle w-100"
            style={{
              width: '100%',
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              border: '2px solid #000000',
              fontFamily: "'Segoe UI', Arial, sans-serif",
              fontSize: '11px',
            }}
          >
            {/* Proportional percentage column widths summing to 100% (Day, Lab Time, Lec Time, Code, Desc, Year, Room, Teacher, Units) */}
            <colgroup>
              <col style={{ width: '5%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '4%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>

            {/* Table Header: 3-row layout matching reference */}
            <thead>
              {/* Row 1: Cyan Top Header */}
              <tr
                style={{
                  backgroundColor: '#00a2e8',
                  color: '#ffffff',
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '11.5px',
                }}
              >
                <th
                  colSpan={3}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '5px 2px',
                    letterSpacing: '0.5px',
                    backgroundColor: '#00a2e8',
                    color: '#ffffff',
                  }}
                >
                  SCHEDULE
                </th>
                <th
                  rowSpan={3}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '5px 3px',
                    verticalAlign: 'middle',
                    letterSpacing: '0.5px',
                    backgroundColor: '#00a2e8',
                    color: '#ffffff',
                    wordBreak: 'break-word',
                  }}
                >
                  CODE
                </th>
                <th
                  rowSpan={3}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '5px 4px',
                    verticalAlign: 'middle',
                    letterSpacing: '0.5px',
                    backgroundColor: '#00a2e8',
                    color: '#ffffff',
                  }}
                >
                  DESCRIPTION
                </th>
                <th
                  rowSpan={3}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '5px 2px',
                    verticalAlign: 'middle',
                    letterSpacing: '0.5px',
                    backgroundColor: '#00a2e8',
                    color: '#ffffff',
                  }}
                >
                  YEAR
                </th>
                <th
                  rowSpan={3}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '5px 3px',
                    verticalAlign: 'middle',
                    letterSpacing: '0.5px',
                    backgroundColor: '#00a2e8',
                    color: '#ffffff',
                    wordBreak: 'break-word',
                  }}
                >
                  ROOM
                </th>
                <th
                  rowSpan={3}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '5px 4px',
                    verticalAlign: 'middle',
                    letterSpacing: '0.5px',
                    backgroundColor: '#00a2e8',
                    color: '#ffffff',
                    wordBreak: 'break-word',
                  }}
                >
                  TEACHER
                </th>
                <th
                  rowSpan={3}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '5px 2px',
                    verticalAlign: 'middle',
                    letterSpacing: '0.3px',
                    backgroundColor: '#00a2e8',
                    color: '#ffffff',
                    fontSize: '10.5px',
                    lineHeight: 1.1,
                  }}
                >
                  Total Units
                </th>
              </tr>

              {/* Row 2: DAY & TIME */}
              <tr
                style={{
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              >
                <th
                  rowSpan={2}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '4px 2px',
                    verticalAlign: 'middle',
                    backgroundColor: '#ffffff',
                  }}
                >
                  DAY
                </th>
                <th
                  colSpan={2}
                  style={{
                    border: '1.5px solid #000000',
                    padding: '4px 2px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  TIME
                </th>
              </tr>

              {/* Row 3: LAB & LECTURE */}
              <tr
                style={{
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: '10.5px',
                }}
              >
                <th
                  style={{
                    border: '1.5px solid #000000',
                    padding: '3px 2px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  LAB
                </th>
                <th
                  style={{
                    border: '1.5px solid #000000',
                    padding: '3px 2px',
                    backgroundColor: '#ffffff',
                  }}
                >
                  LECTURE
                </th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody>
              {teacherGroups.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="text-center py-5 text-muted"
                    style={{ border: '1.5px solid #000000' }}
                  >
                    <div className="py-4">
                      <i className="bi bi-calendar-x fs-1 text-secondary opacity-50 d-block mb-2"></i>
                      <p className="fw-semibold mb-1">No class entries found for this view</p>
                      <p className="small text-muted mb-3">
                        {filterScope === 'block'
                          ? 'This student block does not have placed classes yet.'
                          : 'No class entries have been placed in this schedule draft yet.'}
                      </p>
                      {!isReadOnly && (
                        <div className="d-flex align-items-center justify-content-center gap-2">
                          {onGenerateAiDraft && (
                            <button
                              onClick={onGenerateAiDraft}
                              className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1.5"
                            >
                              <i className="bi bi-stars"></i>
                              <span>Auto-Place with AI</span>
                            </button>
                          )}
                          <button
                            onClick={onAddEntry}
                            className="btn btn-sm btn-primary"
                          >
                            <i className="bi bi-plus-lg me-1"></i>
                            Add First Class
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                teacherGroups.map((teacher, tIdx) => {
                  let teacherRowTracker = 0;

                  return (
                    <React.Fragment key={teacher.teacherId}>
                      {teacher.subjects.map((subjGroup) => {
                        return subjGroup.rows.map((row, rSubIdx) => {
                          const isFirstRowOfTeacher = teacherRowTracker === 0;
                          const isFirstRowOfSubj = rSubIdx === 0;
                          teacherRowTracker++;

                          // Heavy dividing line between different teachers
                          const rowTopBorderStyle = isFirstRowOfTeacher && tIdx > 0 ? '3px solid #000000' : '1px solid #111111';

                          return (
                            <tr
                              key={row.id}
                              className="spreadsheet-row position-relative"
                              style={{
                                borderTop: rowTopBorderStyle,
                                borderBottom: '1px solid #111111',
                                backgroundColor: '#ffffff',
                              }}
                            >
                              {/* 1. Day */}
                              <td
                                style={{
                                  border: '1px solid #111111',
                                  padding: '4px 2px',
                                  textAlign: 'center',
                                  fontWeight: 600,
                                  fontSize: '11px',
                                }}
                              >
                                {row.day || '-'}
                              </td>

                              {/* 2. Lab Time */}
                              <td
                                style={{
                                  border: '1px solid #111111',
                                  padding: '4px 3px',
                                  textAlign: 'center',
                                  fontSize: '10.5px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {row.labTime || ''}
                              </td>

                              {/* 3. Lecture Time */}
                              <td
                                style={{
                                  border: '1px solid #111111',
                                  padding: '4px 3px',
                                  textAlign: 'center',
                                  fontSize: '10.5px',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {row.lecTime || ''}
                              </td>

                              {/* 4. Course Code (Spanned across sections of same subject) */}
                              {isFirstRowOfSubj && (
                                <td
                                  rowSpan={subjGroup.rows.length}
                                  style={{
                                    border: '1px solid #111111',
                                    padding: '4px 3px',
                                    textAlign: 'center',
                                    fontWeight: 700,
                                    fontSize: '11px',
                                    verticalAlign: 'middle',
                                    backgroundColor: '#ffffff',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {subjGroup.code}
                                </td>
                              )}

                              {/* 5. Description (Subject title + Section) */}
                              <td
                                style={{
                                  border: '1px solid #111111',
                                  padding: '4px 4px',
                                  textAlign: 'center',
                                  fontSize: '11px',
                                }}
                              >
                                <div className="d-flex align-items-center justify-content-between gap-1">
                                  <span className="flex-grow-1 text-center" style={{ lineHeight: 1.25 }}>{row.description}</span>
                                  {/* Quick Actions (Draft mode only) */}
                                  {!isReadOnly && (
                                    <div className="row-actions opacity-0 transition ms-1 d-inline-flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() => onEditEntry(row.entry)}
                                        className="btn btn-outline-primary btn-sm py-0 px-1"
                                        style={{ fontSize: '9px', lineHeight: 1.2 }}
                                        title="Edit Entry"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onDeleteEntry(row.entry.id)}
                                        className="btn btn-outline-danger btn-sm py-0 px-1"
                                        style={{ fontSize: '9px', lineHeight: 1.2 }}
                                        title="Delete Entry"
                                      >
                                        Del
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* 6. Year Level */}
                              <td
                                style={{
                                  border: '1px solid #111111',
                                  padding: '4px 2px',
                                  textAlign: 'center',
                                  fontWeight: 600,
                                  fontSize: '11px',
                                }}
                              >
                                {row.year}
                              </td>

                              {/* 7. Room */}
                              <td
                                style={{
                                  border: '1px solid #111111',
                                  padding: '4px 3px',
                                  textAlign: 'center',
                                  fontSize: '11px',
                                  wordBreak: 'break-word',
                                }}
                              >
                                {row.room}
                              </td>

                              {/* 8. Teacher (Spanned across all subjects taught by this teacher) */}
                              {isFirstRowOfTeacher && (
                                <td
                                  rowSpan={teacher.totalRows}
                                  style={{
                                    border: '1px solid #111111',
                                    padding: '6px 4px',
                                    textAlign: 'center',
                                    fontWeight: 700,
                                    fontSize: '11px',
                                    verticalAlign: 'middle',
                                    backgroundColor: '#ffffff',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {teacher.teacherName}
                                </td>
                              )}

                              {/* 9. Total Units (Spanned across all subjects taught by this teacher) */}
                              {isFirstRowOfTeacher && (
                                <td
                                  rowSpan={teacher.totalRows}
                                  style={{
                                    border: '1.5px solid #111111',
                                    padding: '6px 2px',
                                    textAlign: 'center',
                                    fontWeight: 700,
                                    fontSize: '11px',
                                    verticalAlign: 'middle',
                                    backgroundColor: '#ffffff',
                                  }}
                                >
                                  {teacher.totalUnits}
                                </td>
                              )}
                            </tr>
                          );
                        });
                      })}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx global>{`
        .spreadsheet-schedule-container table {
          table-layout: fixed !important;
          width: 100% !important;
          max-width: 100% !important;
        }
        .spreadsheet-row:hover {
          background-color: #f0f7ff !important;
        }
        .spreadsheet-row:hover .row-actions {
          opacity: 1 !important;
        }
        @media print {
          body {
            background: white !important;
          }
          nav, aside, .app-sidebar, .app-topbar, .spreadsheet-schedule-container > div:first-child {
            display: none !important;
          }
          .spreadsheet-schedule-container {
            margin: 0 !important;
            padding: 0 !important;
          }
          .print-area {
            border: none !important;
            box-shadow: none !important;
          }
          @page {
            size: landscape;
            margin: 1cm;
          }
        }
      `}</style>
    </div>
  );
}
