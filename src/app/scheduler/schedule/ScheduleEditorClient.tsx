// src/app/scheduler/schedule/ScheduleEditorClient.tsx
'use client';

import React, { useState, useMemo, useTransition, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AcademicTerm,
  Block,
  Room,
  Instructor,
  Subject,
  ClassOffering,
  ScheduleVersion,
  ScheduleEntry,
  FixedConstraint,
  DepartmentType,
} from '@/types/database';
import { FormModal } from '@/components/FormModal';
import {
  checkSchedule,
  type ScheduleEntryInput,
  type ScheduleContext,
  type Violation,
  timeToMinutes,
  formatTimeShort,
  isTimeRangeWithin,
  timeRangesOverlap,
} from '@/lib/conflict-engine';
import {
  saveScheduleEntryAction,
  deleteScheduleEntryAction,
  ensureOfferingsForBlockAction,
  validateForPublishAction,
  publishScheduleVersionAction,
  startNewDraftAction,
  deleteArchivedVersionAction,
  saveDraftScheduleAction,
  unpublishScheduleVersionAction,
  deleteScheduleVersionAction,
  renameScheduleVersionAction,
  getScheduleVersionNamesAction,
  clearAllDraftScheduleEntriesAction,
  clearBlockDraftScheduleEntriesAction,
} from './actions';
import type { PublishValidationResult } from '@/lib/publish/publish-gate';
import type { ScheduleEntryFormInput } from '@/lib/validators/schedule';
import { generateAiDraftAction } from '../generate/actions';
import { SpreadsheetScheduleView } from './SpreadsheetScheduleView';
import { RadialTimePicker } from '@/components/RadialTimePicker';
import { ScheduleEditorToolbar, type ZoomDensity } from './components/ScheduleEditorToolbar';
import { WeeklyTimetableGrid } from './components/WeeklyTimetableGrid';

function calculateEndTime(startTime24: string, durationMinutes: number): string {
  if (!startTime24 || !startTime24.includes(':')) return '09:30';
  const [sh, sm] = startTime24.split(':').map(Number);
  const startMins = (sh || 0) * 60 + (sm || 0);
  const endMins = Math.min(21 * 60, startMins + durationMinutes);
  const eh = Math.floor(endMins / 60);
  const em = endMins % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

function getSubjectSessionDurationMinutes(
  sub: Subject | undefined,
  sessionType: 'lecture' | 'lab',
  pattern: 'single' | 'MW' | 'TTH'
): number {
  if (!sub) return 90;
  if (sub.lecture_hours === 1.5 && sub.lab_hours === 1.5) {
    return 90;
  }
  if (sessionType === 'lab') {
    return Math.round((sub.lab_hours || 1.5) * 60);
  }
  if (pattern === 'MW' || pattern === 'TTH') {
    if (sub.lecture_hours === 3) return 90;
  }
  if (sub.lecture_hours > 0) {
    return Math.round(sub.lecture_hours * 60);
  }
  return Math.round((sub.units || 2) * 60);
}

interface ScheduleEditorClientProps {
  terms: AcademicTerm[];
  blocks: (Block & { programs?: { code: string; name: string } | null })[];
  currentTermId: string;
  draftVersion: ScheduleVersion;
  versions?: ScheduleVersion[];
  initialBlockId?: string;
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
  fixedConstraints: FixedConstraint[];
  metadataMap?: Record<string, { facility?: 'lecture' | 'lab' | 'unspecified'; [key: string]: any }>;
  userRole?: string;
  schedulerDepartment?: string | null;
  allowedSubjectIds?: string[];
  initialShowMasterlist?: boolean;
}

const DAYS = [
  { index: 1, name: 'Monday', short: 'Mon' },
  { index: 2, name: 'Tuesday', short: 'Tue' },
  { index: 3, name: 'Wednesday', short: 'Wed' },
  { index: 4, name: 'Thursday', short: 'Thu' },
  { index: 5, name: 'Friday', short: 'Fri' },
  { index: 6, name: 'Saturday', short: 'Sat' },
];

const TIME_SLOTS = [
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

export function formatBlockLabel(b?: {
  programs?: { code: string } | null;
  year_level?: number | null;
  section?: string | null;
} | null): string {
  if (!b) return 'Select Student Block';
  const prog = b.programs?.code || 'Block';
  const sec = (b.section || '').trim();
  const yr = b.year_level;

  let cleanSec = sec.replace(/^Sec(tion)?\s*/i, '').trim();

  if (cleanSec.toLowerCase().startsWith('grade') || prog === 'HS') {
    return `${prog} - ${cleanSec}`;
  }

  if (yr && cleanSec.startsWith(String(yr))) {
    return `${prog} - ${cleanSec}`;
  }

  if (yr) {
    return `${prog} - ${yr}${cleanSec}`;
  }

  return `${prog} - ${cleanSec}`;
}

const HOUR_HEIGHT = 80;
const GRID_START_MIN = 420; // 07:00

function getSlotFromPointer(e: React.DragEvent): { slotHour: string; isHalfHour: boolean; startTime: string } | null {
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

function computeDayLayout(dayEntries: ScheduleEntry[]) {
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

export function ScheduleEditorClient({
  terms,
  blocks,
  currentTermId,
  draftVersion,
  versions,
  initialBlockId,
  entries,
  offerings: initialOfferings,
  rooms,
  instructors,
  subjects,
  fixedConstraints,
  metadataMap,
  userRole = 'admin',
  schedulerDepartment = null,
  allowedSubjectIds = [],
  initialShowMasterlist = false,
}: ScheduleEditorClientProps) {
  const router = useRouter();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(
    initialBlockId || null
  );

  const isSubjectAllowed = useMemo(() => {
    return (subjectId?: string | null): boolean => {
      if (!subjectId) return true;
      if (userRole === 'admin') return true;
      if (allowedSubjectIds && allowedSubjectIds.length > 0) {
        return allowedSubjectIds.includes(subjectId);
      }
      if (schedulerDepartment) {
        const sub = subjects.find((s) => s.id === subjectId);
        if (!sub) return true;
        const code = (sub.code || '').toUpperCase();
        const title = (sub.title || '').toLowerCase();
        if (schedulerDepartment === 'BSIT') {
          const isHS =
            code.startsWith('HS') ||
            code.startsWith('JHS') ||
            code.startsWith('SHS') ||
            code.startsWith('GRADE');
          return !isHS;
        }
        if (schedulerDepartment === 'High School') {
          return (
            code.startsWith('HS') ||
            code.startsWith('JHS') ||
            code.startsWith('SHS') ||
            code.startsWith('GRADE') ||
            title.includes('high school') ||
            title.includes('grade ')
          );
        }
      }
      return true;
    };
  }, [userRole, allowedSubjectIds, schedulerDepartment, subjects]);

  const isSubjectUnspecified = (subjIdOrCode?: string | null): boolean => {
    if (!subjIdOrCode || !metadataMap) return false;
    const meta = metadataMap[subjIdOrCode] || metadataMap[subjIdOrCode.toUpperCase()];
    return meta?.facility === 'unspecified';
  };

  const selectedBlock = useMemo(
    () => (selectedBlockId ? blocks.find((b) => b.id === selectedBlockId) || null : null),
    [blocks, selectedBlockId]
  );

  const handleSelectBlock = (bId: string | null) => {
    setSelectedBlockId(bId);
    if (bId) {
      const bOffs = initialOfferings.filter((off) => off.block_id === bId);
      if (bOffs.length > 0) {
        setFormData((prev) => ({ ...prev, offering_id: bOffs[0].id }));
      }
      router.push(
        `/scheduler/schedule?termId=${currentTermId}&versionId=${draftVersion.id}&blockId=${bId}`,
        { scroll: false }
      );
    } else {
      router.push(
        `/scheduler/schedule?termId=${currentTermId}&versionId=${draftVersion.id}`,
        { scroll: false }
      );
    }
  };
  const [scheduleStyle, setScheduleStyle] = useState<'grid' | 'spreadsheet'>('grid');
  const [isPending, startTransition] = useTransition();

  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiScope, setAiScope] = useState<'current' | 'all'>('current');
  const [aiPromptNotes, setAiPromptNotes] = useState('');
  const [aiAllowSaturday, setAiAllowSaturday] = useState(false);
  const [aiRefineScope, setAiRefineScope] = useState<'targeted' | 'whole_block'>('targeted');
  const [collisionNotice, setCollisionNotice] = useState<{
    message: string;
    attemptedPrompt: string;
  } | null>(null);
  const [scheduleDayPattern, setScheduleDayPattern] = useState<'single' | 'MW' | 'TTH'>('single');
  const [isAiDrafting, setIsAiDrafting] = useState(false);

  const [isConfirmClearAllOpen, setIsConfirmClearAllOpen] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [isConfirmClearBlockOpen, setIsConfirmClearBlockOpen] = useState(false);
  const [isClearingBlock, setIsClearingBlock] = useState(false);

  const isReadOnly = draftVersion.status !== 'draft';

  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishValidation, setPublishValidation] = useState<PublishValidationResult | null>(null);
  const [isValidatingPublish, setIsValidatingPublish] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNoRoom, setIsNoRoom] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Two-Session management for modal (e.g. 1.5h Lec + 1.5h Lab or MW/TTH paired sessions)
  const [hasSecondSession, setHasSecondSession] = useState(false);
  const [syncSessionsTime, setSyncSessionsTime] = useState(true);
  const [secondEntry, setSecondEntry] = useState<ScheduleEntry | null>(null);
  const [isSecondNoRoom, setIsSecondNoRoom] = useState(false);
  const [session2Data, setSession2Data] = useState<{
    instructor_id: string;
    room_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    session_type: 'lecture' | 'lab';
    notes: string;
  }>({
    instructor_id: '',
    room_id: '',
    day_of_week: 3,
    start_time: '08:00',
    end_time: '09:30',
    session_type: 'lab',
    notes: '',
  });
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [isValidationPanelOpen, setIsValidationPanelOpen] = useState(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);

  // Custom version draft name state
  const [versionNames, setVersionNames] = useState<Record<string, string>>({});
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameDraftName, setRenameDraftName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Unplaced subject warnings state
  const [unassignedWarnings, setUnassignedWarnings] = useState<
    { blockName: string; subjectCode: string; reason: string }[]
  >([]);
  const [isWarningsModalOpen, setIsWarningsModalOpen] = useState(false);

  // Drag and drop onto grid state
  const [draggingOfferingId, setDraggingOfferingId] = useState<string | null>(null);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const dragOccurredRef = useRef(false);
  const [dragOverSlot, setDragOverSlot] = useState<{
    dayIndex: number;
    slotHour: string;
    isHalfHour: boolean;
  } | null>(null);

  // Auto-scroll viewport when dragging near top or bottom edges
  useEffect(() => {
    if (!draggingOfferingId && !draggingEntryId) return;

    let animId: number | null = null;
    let scrollSpeed = 0;

    const handleWindowDragOver = (e: DragEvent) => {
      const edgeThreshold = 100; // pixels from top or bottom of viewport
      const maxSpeed = 20;
      const clientY = e.clientY;
      const windowHeight = window.innerHeight;

      if (clientY < edgeThreshold) {
        const intensity = (edgeThreshold - Math.max(0, clientY)) / edgeThreshold;
        scrollSpeed = -Math.round(intensity * maxSpeed);
      } else if (clientY > windowHeight - edgeThreshold) {
        const intensity = (Math.min(windowHeight, clientY) - (windowHeight - edgeThreshold)) / edgeThreshold;
        scrollSpeed = Math.round(intensity * maxSpeed);
      } else {
        scrollSpeed = 0;
      }
    };

    const scrollLoop = () => {
      if (scrollSpeed !== 0) {
        window.scrollBy({ top: scrollSpeed, behavior: 'instant' });
      }
      animId = requestAnimationFrame(scrollLoop);
    };

    window.addEventListener('dragover', handleWindowDragOver);
    animId = requestAnimationFrame(scrollLoop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      if (animId) cancelAnimationFrame(animId);
    };
  }, [draggingOfferingId, draggingEntryId]);

  const [spreadsheetShowAllBlocks, setSpreadsheetShowAllBlocks] = useState(false);
  const [zoomDensity, setZoomDensity] = useState<ZoomDensity>('100%');

  // In-page Department Masterlist state
  const [showMasterlist, setShowMasterlist] = useState(initialShowMasterlist);
  const [masterlistDept, setMasterlistDept] = useState<'college' | 'high_school'>(
    schedulerDepartment === 'High School' ? 'high_school' : 'college'
  );
  const [masterlistViewStyle, setMasterlistViewStyle] = useState<'spreadsheet' | 'grid'>('spreadsheet');
  const [masterlistRoomFilter, setMasterlistRoomFilter] = useState<string>('all');
  const [masterlistBlockFilter, setMasterlistBlockFilter] = useState<string>('all');

  // Department options derived from blocks
  const departmentOptions = useMemo(() => {
    const collegeBlocks = blocks.filter((b) => {
      const progCode = b.programs?.code || '';
      const sec = (b.section || '').trim();
      return progCode !== 'HS' && !/^Grade/i.test(sec);
    });
    const hsBlocks = blocks.filter((b) => {
      const progCode = b.programs?.code || '';
      const sec = (b.section || '').trim();
      return progCode === 'HS' || /^Grade/i.test(sec);
    });
    const depts: { id: 'college' | 'high_school'; name: string; blockCount: number }[] = [];
    if (collegeBlocks.length > 0) {
      depts.push({
        id: 'college',
        name: collegeBlocks[0]?.programs?.name || 'BSIT / College Department',
        blockCount: collegeBlocks.length,
      });
    }
    if (hsBlocks.length > 0) {
      depts.push({
        id: 'high_school',
        name: 'High School Department',
        blockCount: hsBlocks.length,
      });
    }
    return depts;
  }, [blocks]);

  const masterlistBlocks = useMemo(() => {
    return blocks.filter((b) => {
      const progCode = b.programs?.code || '';
      const sec = (b.section || '').trim();
      const isHs = progCode === 'HS' || /^Grade/i.test(sec);
      return masterlistDept === 'high_school' ? isHs : !isHs;
    });
  }, [blocks, masterlistDept]);

  const masterlistEntries = useMemo(() => {
    const blkIds = new Set(masterlistBlocks.map((b) => b.id));
    return entries.filter((e) => {
      const off = initialOfferings.find((o) => o.id === e.offering_id);
      return off && blkIds.has(off.block_id);
    });
  }, [entries, initialOfferings, masterlistBlocks]);

  const filteredMasterlistEntries = useMemo(() => {
    let list = masterlistEntries;
    if (masterlistBlockFilter !== 'all') {
      list = list.filter((e) => {
        const off = initialOfferings.find((o) => o.id === e.offering_id);
        return off && off.block_id === masterlistBlockFilter;
      });
    }
    if (masterlistRoomFilter !== 'all') {
      list = list.filter((e) => e.room_id === masterlistRoomFilter);
    }
    return list;
  }, [masterlistEntries, initialOfferings, masterlistBlockFilter, masterlistRoomFilter]);


  // Load version names from cache & database
  React.useEffect(() => {
    try {
      const cached = localStorage.getItem('altersched_version_names');
      if (cached) {
        setVersionNames(JSON.parse(cached));
      }
    } catch {}

    const vIds = (versions || [draftVersion]).map((v) => v.id);
    if (vIds.length > 0) {
      getScheduleVersionNamesAction(vIds)
        .then((map) => {
          if (map && Object.keys(map).length > 0) {
            setVersionNames((prev) => {
              const merged = { ...prev, ...map };
              try {
                localStorage.setItem('altersched_version_names', JSON.stringify(merged));
              } catch {}
              return merged;
            });
          }
        })
        .catch(() => {});
    }
  }, [draftVersion.id, versions]);

  // Filter offerings for the selected block
  const blockOfferings = useMemo(() => {
    if (!selectedBlockId) return [];
    return initialOfferings.filter((off) => off.block_id === selectedBlockId);
  }, [initialOfferings, selectedBlockId]);

  // Initial qualified instructor helper for default formData
  const defaultInitialOffering = blockOfferings[0] || initialOfferings[0];
  const defaultInitialSubject = subjects.find((s) => s.id === defaultInitialOffering?.subject_id);
  const defaultInitialQualInsts = instructors.filter((inst) =>
    (inst.instructor_qualifications || []).some((q) => q.subject_id === defaultInitialSubject?.id)
  );

  // Form State
  const [formData, setFormData] = useState<ScheduleEntryFormInput>({
    offering_id: defaultInitialOffering?.id || '',
    instructor_id: defaultInitialQualInsts[0]?.id || '',
    room_id: rooms[0]?.id || '',
    day_of_week: 1,
    start_time: '08:00',
    end_time: '10:00',
    session_type: 'lecture',
    notes: '',
  });

  // Automatically keep formData.instructor_id in sync with qualified instructors for the active offering
  React.useEffect(() => {
    if (!isModalOpen) return;
    const curOff = initialOfferings.find((o) => o.id === formData.offering_id);
    const curSub = subjects.find((s) => s.id === curOff?.subject_id);
    if (!curSub) return;
    const curQualInsts = instructors.filter((inst) =>
      (inst.instructor_qualifications || []).some((q) => q.subject_id === curSub.id)
    );
    const isValid = curQualInsts.some((i) => i.id === formData.instructor_id);
    if (!isValid) {
      setFormData((prev) => ({
        ...prev,
        instructor_id: curQualInsts[0]?.id || '',
      }));
    }
  }, [isModalOpen, formData.offering_id, initialOfferings, subjects, instructors, formData.instructor_id]);

  // Available offerings scoped to the active block or current entry
  const availableOfferings = useMemo(() => {
    let list = blockOfferings.length > 0 ? blockOfferings : initialOfferings;
    if (userRole !== 'admin') {
      list = list.filter((o) => isSubjectAllowed(o.subject_id));
    }
    if (formData.offering_id && !list.some((o) => o.id === formData.offering_id)) {
      const current = initialOfferings.find((o) => o.id === formData.offering_id);
      if (current) return [current, ...list];
    }
    return list;
  }, [blockOfferings, initialOfferings, formData.offering_id, userRole, isSubjectAllowed]);

  // Available rooms scoped to the scheduler's department
  const availableRooms = useMemo(() => {
    if (userRole === 'admin') return rooms;
    if (!schedulerDepartment) return rooms;
    return rooms.filter((r) => {
      const depts = r.allowed_departments || (r.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
      return depts.includes(schedulerDepartment as DepartmentType);
    });
  }, [rooms, userRole, schedulerDepartment]);

  const isRoomAllowed = useMemo(() => {
    return (roomId?: string | null): boolean => {
      if (!roomId) return true;
      if (userRole === 'admin') return true;
      if (!schedulerDepartment) return true;
      const targetRoom = rooms.find((r) => r.id === roomId);
      if (!targetRoom) return true;
      const depts = targetRoom.allowed_departments || (targetRoom.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
      return depts.includes(schedulerDepartment as DepartmentType);
    };
  }, [rooms, userRole, schedulerDepartment]);

  // Structure for pre-drop conflict details
  interface SlotConflictDetail {
    type: 'lunch' | 'room' | 'instructor' | 'cohort';
    message: string;
    badge: string;
  }

  // Active dragged context (for real-time conflict heatmap & drop indicators)
  const activeDragContext = useMemo(() => {
    if (!draggingEntryId && !draggingOfferingId) return null;

    let targetOfferingId: string | null = null;
    let targetSubject: Subject | null = null;
    let targetRoomId: string | null = null;
    let targetInstructorId: string | null = null;
    let durationHours = 1.5;
    let blockId: string | null = null;
    let entryIdToExclude: string | null = null;
    let sessionType: 'lecture' | 'lab' = 'lecture';

    if (draggingEntryId) {
      entryIdToExclude = draggingEntryId;
      const entry = entries.find((e) => e.id === draggingEntryId);
      if (!entry) return null;
      targetOfferingId = entry.offering_id;
      const off = initialOfferings.find((o) => o.id === entry.offering_id);
      targetSubject = subjects.find((s) => s.id === off?.subject_id) || null;
      blockId = off?.block_id || selectedBlockId || null;
      targetRoomId = entry.room_id || null;
      targetInstructorId = entry.instructor_id || null;
      sessionType = entry.session_type;
      const durMins = Math.max(30, timeToMinutes(entry.end_time) - timeToMinutes(entry.start_time));
      durationHours = durMins / 60;
    } else if (draggingOfferingId) {
      targetOfferingId = draggingOfferingId;
      const off = initialOfferings.find((o) => o.id === draggingOfferingId);
      targetSubject = subjects.find((s) => s.id === off?.subject_id) || null;
      blockId = off?.block_id || selectedBlockId || null;

      const existingForOffering = entries.filter((e) => e.offering_id === draggingOfferingId);
      const hasLec = existingForOffering.some((e) => e.session_type === 'lecture');
      const hasLab = existingForOffering.some((e) => e.session_type === 'lab');

      if (targetSubject && targetSubject.lecture_hours > 0 && targetSubject.lab_hours > 0) {
        if (!hasLec) {
          sessionType = 'lecture';
          durationHours = targetSubject.lecture_hours;
        } else if (!hasLab) {
          sessionType = 'lab';
          durationHours = targetSubject.lab_hours;
        } else {
          sessionType = 'lecture';
          durationHours = 1.5;
        }
      } else if (targetSubject && targetSubject.lecture_hours === 3 && targetSubject.lab_hours === 0) {
        sessionType = 'lecture';
        durationHours = 1.5;
      } else {
        sessionType = targetSubject?.requires_lab ? 'lab' : 'lecture';
        durationHours = (targetSubject?.lecture_hours || 0) + (targetSubject?.lab_hours || 0) || 2;
      }

      const isUnspec = isSubjectUnspecified(targetSubject?.id) || isSubjectUnspecified(targetSubject?.code);
      const preferredRoomId = (targetSubject as any)?.preferred_room_id;
      if (!isUnspec) {
        const targetRoom =
          sessionType === 'lab'
            ? availableRooms.find((r) => r.room_type === 'laboratory') || availableRooms[0] || rooms[0]
            : (preferredRoomId ? availableRooms.find((r) => r.id === preferredRoomId) : null) ||
              availableRooms.find((r) => r.room_type === 'lecture') ||
              availableRooms[0] ||
              rooms[0];
        targetRoomId = targetRoom?.id || null;
      }
    }

    const currentBlock = blocks.find((b) => b.id === blockId);
    const blockLabel = formatBlockLabel(currentBlock);
    const isHs =
      blockLabel.toLowerCase().includes('grade') ||
      blockLabel.toLowerCase().includes('high school') ||
      blockLabel.toUpperCase().startsWith('HS');
    const lunch = isHs ? { s: '12:00', e: '13:00' } : { s: '12:30', e: '13:00' };

    const qualInsts = targetSubject
      ? instructors.filter((inst) =>
          (inst.instructor_qualifications || []).some((q) => q.subject_id === targetSubject?.id)
        )
      : [];

    const room = targetRoomId ? rooms.find((r) => r.id === targetRoomId) || null : null;
    const isRoomUnspec =
      !targetRoomId ||
      targetRoomId === '00000000-0000-0000-0000-000000000000' ||
      room?.name === 'None (N/A)' ||
      room?.name === 'TBA (N/A)';

    return {
      offeringId: targetOfferingId,
      subject: targetSubject,
      blockId,
      blockLabel,
      sessionType,
      durationHours,
      roomId: targetRoomId,
      room,
      isRoomUnspec,
      instructorId: targetInstructorId,
      qualInsts,
      lunch,
      entryIdToExclude,
    };
  }, [
    draggingEntryId,
    draggingOfferingId,
    entries,
    initialOfferings,
    subjects,
    rooms,
    availableRooms,
    instructors,
    blocks,
    selectedBlockId,
    isSubjectUnspecified,
  ]);

  const activeDraggedRoom = useMemo(() => activeDragContext?.room || null, [activeDragContext]);

  // Pure function to calculate all conflict details for a given day and start time
  const getSlotConflicts = (dayIndex: number, slotStart: string): SlotConflictDetail[] => {
    if (!activeDragContext) return [];

    const {
      subject,
      blockId,
      durationHours,
      roomId,
      room,
      isRoomUnspec,
      instructorId,
      qualInsts,
      lunch,
      entryIdToExclude,
    } = activeDragContext;

    const [sh, sm] = slotStart.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = Math.min(21 * 60, startMins + Math.round(durationHours * 60));
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    const slotEnd = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;

    const conflicts: SlotConflictDetail[] = [];

    // 1. Lunch break conflict
    if (timeRangesOverlap(slotStart, slotEnd, lunch.s, lunch.e)) {
      conflicts.push({
        type: 'lunch',
        badge: 'Lunch Break',
        message: `Overlaps lunch break (${lunch.s} - ${lunch.e})`,
      });
    }

    // 2. Cohort / Student Block conflict
    if (blockId) {
      const cohortConflictEntry = entries.find(
        (e) =>
          e.id !== entryIdToExclude &&
          e.day_of_week === dayIndex &&
          initialOfferings.find((o) => o.id === e.offering_id)?.block_id === blockId &&
          timeRangesOverlap(e.start_time, e.end_time, slotStart, slotEnd)
      );
      if (cohortConflictEntry) {
        const cOff = initialOfferings.find((o) => o.id === cohortConflictEntry.offering_id);
        const cSub = subjects.find((s) => s.id === cOff?.subject_id);
        conflicts.push({
          type: 'cohort',
          badge: `Cohort busy (${cSub?.code || 'Class'})`,
          message: `Cohort already scheduled for ${cSub?.code || 'class'} (${formatTimeShort(cohortConflictEntry.start_time)}-${formatTimeShort(cohortConflictEntry.end_time)})`,
        });
      }
    }

    // 3. Room conflict
    if (!isRoomUnspec && roomId) {
      const roomConflictEntry = entries.find(
        (e) =>
          e.id !== entryIdToExclude &&
          e.day_of_week === dayIndex &&
          e.room_id === roomId &&
          timeRangesOverlap(e.start_time, e.end_time, slotStart, slotEnd)
      );
      if (roomConflictEntry) {
        const rOff = initialOfferings.find((o) => o.id === roomConflictEntry.offering_id);
        const rSub = subjects.find((s) => s.id === rOff?.subject_id);
        const rBlock = blocks.find((b) => b.id === rOff?.block_id);
        conflicts.push({
          type: 'room',
          badge: `Room taken (${room?.name})`,
          message: `Room "${room?.name}" occupied by ${rBlock ? formatBlockLabel(rBlock) : 'another block'} (${rSub?.code || 'course'})`,
        });
      }
    }

    // 4. Instructor conflict
    if (instructorId) {
      const instConflictEntry = entries.find(
        (e) =>
          e.id !== entryIdToExclude &&
          e.day_of_week === dayIndex &&
          e.instructor_id === instructorId &&
          timeRangesOverlap(e.start_time, e.end_time, slotStart, slotEnd)
      );
      if (instConflictEntry) {
        const inst = instructors.find((i) => i.id === instructorId);
        conflicts.push({
          type: 'instructor',
          badge: `Faculty busy (${inst?.full_name?.split(' ')[0] || 'Faculty'})`,
          message: `Instructor ${inst?.full_name || 'assigned'} is already teaching another class`,
        });
      }
    } else if (qualInsts.length > 0) {
      const hasAvailableInst = qualInsts.some(
        (inst) =>
          !entries.some(
            (e) =>
              e.id !== entryIdToExclude &&
              e.day_of_week === dayIndex &&
              e.instructor_id === inst.id &&
              timeRangesOverlap(e.start_time, e.end_time, slotStart, slotEnd)
          )
      );
      if (!hasAvailableInst) {
        conflicts.push({
          type: 'instructor',
          badge: `All faculty busy (${qualInsts.length})`,
          message: `All qualified instructors (${qualInsts.map((i) => i.full_name).join(', ')}) are busy`,
        });
      }
    } else if (subject) {
      conflicts.push({
        type: 'instructor',
        badge: 'No qualified faculty',
        message: `No instructors qualified for ${subject.code}`,
      });
    }

    return conflicts;
  };

  // Prepare pure context for the Conflict Engine
  const engineContext: ScheduleContext = useMemo(() => {
    return {
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        roomType: r.room_type,
        capacity: r.capacity,
        isShared: r.is_shared,
      })),
      subjects: subjects.map((s) => {
        const meta = metadataMap
          ? metadataMap[s.id] || metadataMap[s.code.toUpperCase()] || metadataMap[s.code]
          : undefined;
        return {
          id: s.id,
          code: s.code,
          title: s.title,
          units: s.units,
          requiresLab: s.requires_lab,
          facilityType: meta?.facility || (s.requires_lab ? 'lab' : 'lecture'),
          lectureHours: s.lecture_hours,
          labHours: s.lab_hours,
        };
      }),
      instructors: instructors.map((i) => ({
        id: i.id,
        name: i.full_name,
        needsLabEquipment: i.needs_lab_equipment,
        qualifications: (i.instructor_qualifications || []).map((q) => q.subject_id),
        availability: (i.instructor_availability || []).map((a) => ({
          dayOfWeek: a.day_of_week,
          startTime: a.start_time,
          endTime: a.end_time,
        })),
      })),
      blocks: blocks.map((b) => ({
        id: b.id,
        name: formatBlockLabel(b),
        studentCount: b.student_count,
      })),
      fixedConstraints: fixedConstraints.map((c) => ({
        id: c.id,
        termId: c.term_id,
        roomId: c.room_id,
        label: c.label,
        source: c.source,
        dayOfWeek: c.day_of_week,
        startTime: c.start_time,
        endTime: c.end_time,
      })),
    };
  }, [rooms, subjects, instructors, blocks, fixedConstraints]);

  // Transform schedule entries to Conflict Engine format
  const engineEntries: ScheduleEntryInput[] = useMemo(() => {
    return entries.map((e) => {
      const offering = initialOfferings.find((o) => o.id === e.offering_id);
      return {
        id: e.id,
        offeringId: e.offering_id,
        blockId: offering?.block_id || '',
        subjectId: offering?.subject_id || '',
        instructorId: e.instructor_id,
        roomId: e.room_id,
        dayOfWeek: e.day_of_week,
        startTime: e.start_time.slice(0, 5),
        endTime: e.end_time.slice(0, 5),
        sessionType: e.session_type,
      };
    });
  }, [entries, initialOfferings]);

  // Run the conflict engine across all draft entries
  const allViolations: Violation[] = useMemo(() => {
    return checkSchedule(engineEntries, engineContext);
  }, [engineEntries, engineContext]);

  // Map violations by entry ID for quick inline badge lookup
  const violationsByEntryId = useMemo(() => {
    const map = new Map<string, { hard: Violation[]; soft: Violation[] }>();
    for (const v of allViolations) {
      for (const entryId of v.entryIds) {
        const current = map.get(entryId) || { hard: [], soft: [] };
        if (v.severity === 'hard') {
          current.hard.push(v);
        } else {
          current.soft.push(v);
        }
        map.set(entryId, current);
      }
    }
    return map;
  }, [allViolations]);

  const hardViolationsCount = useMemo(
    () => allViolations.filter((v) => v.severity === 'hard').length,
    [allViolations]
  );
  const softViolationsCount = useMemo(
    () => allViolations.filter((v) => v.severity === 'soft').length,
    [allViolations]
  );

  // Filter entries for the selected block to display in the grid
  const selectedBlockEntries = useMemo(() => {
    if (!selectedBlockId) return [];
    return entries.filter((e) => {
      const off = initialOfferings.find((o) => o.id === e.offering_id);
      return off?.block_id === selectedBlockId;
    });
  }, [entries, initialOfferings, selectedBlockId]);

  // Calculate unassigned hours for the selected block's offerings
  const unassignedOfferings = useMemo(() => {
    return blockOfferings
      .map((off) => {
        const sub = subjects.find((s) => s.id === off.subject_id);
        const requiredHours = (sub?.lecture_hours || 0) + (sub?.lab_hours || 0);
        const scheduledEntries = selectedBlockEntries.filter((e) => e.offering_id === off.id);
        let scheduledMinutes = 0;
        for (const e of scheduledEntries) {
          const [sh, sm] = e.start_time.split(':').map(Number);
          const [eh, em] = e.end_time.split(':').map(Number);
          scheduledMinutes += (eh * 60 + em) - (sh * 60 + sm);
        }
        const scheduledHours = scheduledMinutes / 60;
        const remainingHours = Math.max(0, requiredHours - scheduledHours);

        const hasLec = scheduledEntries.some((e) => e.session_type === 'lecture');
        const hasLab = scheduledEntries.some((e) => e.session_type === 'lab');
        let nextSessionType: 'lecture' | 'lab' | null = null;
        let nextSessionDuration = 0;

        if (sub && sub.lecture_hours > 0 && sub.lab_hours > 0) {
          if (!hasLec) {
            nextSessionType = 'lecture';
            nextSessionDuration = sub.lecture_hours;
          } else if (!hasLab) {
            nextSessionType = 'lab';
            nextSessionDuration = sub.lab_hours;
          }
        } else if (sub && sub.lecture_hours === 3 && sub.lab_hours === 0) {
          nextSessionType = 'lecture';
          nextSessionDuration = 1.5;
        } else {
          nextSessionType = sub?.requires_lab ? 'lab' : 'lecture';
          nextSessionDuration = remainingHours;
        }

        return {
          offering: off,
          subject: sub,
          requiredHours,
          scheduledHours,
          remainingHours,
          nextSessionType,
          nextSessionDuration,
        };
      })
      .filter((item) => item.remainingHours > 0);
  }, [blockOfferings, selectedBlockEntries, subjects]);

  // Open Add Modal
  const handleOpenAdd = async (defaultOfferingId?: string | React.MouseEvent) => {
    const actualOfferingId = typeof defaultOfferingId === 'string' ? defaultOfferingId : undefined;
    if (isReadOnly) {
      setBannerNotice({
        type: 'error',
        message: 'This schedule version is published or archived (read-only). Direct additions are prohibited. Start a new draft to make revisions.',
      });
      return;
    }

    if (actualOfferingId) {
      const targetOff = initialOfferings.find((o) => o.id === actualOfferingId);
      if (!isSubjectAllowed(targetOff?.subject_id)) {
        setBannerNotice({
          type: 'error',
          message: 'Unauthorized: This course is outside your department scheduler supervision scope.',
        });
        return;
      }
    }

    let effectiveOfferings = blockOfferings;
    if (selectedBlockId && effectiveOfferings.length === 0) {
      // Auto-generate offerings for this block if none exist
      try {
        await ensureOfferingsForBlockAction(currentTermId, selectedBlockId);
      } catch {
        // ignore fallback
      }
    }
    if (effectiveOfferings.length === 0) {
      effectiveOfferings = initialOfferings;
    }

    const initialOff =
      (actualOfferingId ? initialOfferings.find((o) => o.id === actualOfferingId) : null) ||
      effectiveOfferings[0] ||
      initialOfferings[0];
    const initialSub = subjects.find((s) => s.id === initialOff?.subject_id);
    const initialQualInsts = instructors.filter((inst) =>
      (inst.instructor_qualifications || []).some((q) => q.subject_id === initialSub?.id)
    );
    const preferredRoomId = (initialSub as any)?.preferred_room_id;
    const targetRoom =
      (preferredRoomId ? availableRooms.find((r) => r.id === preferredRoomId) : null) ||
      availableRooms[0] ||
      rooms[0];
    const targetLabRoom =
      availableRooms.find((r) => r.room_type === 'laboratory') ||
      targetRoom;

    const isPairCourse =
      (initialSub?.lecture_hours === 1.5 && initialSub?.lab_hours === 1.5) ||
      initialSub?.lecture_hours === 3;
    const initialPattern: 'single' | 'MW' | 'TTH' = isPairCourse ? 'MW' : 'single';
    setScheduleDayPattern(initialPattern);

    const has2 = Boolean(
      (initialSub && initialSub.lecture_hours > 0 && initialSub.lab_hours > 0) ||
      initialPattern !== 'single'
    );
    setHasSecondSession(has2);
    setSyncSessionsTime(true);
    setEditingEntry(null);
    setSecondEntry(null);
    setIsNoRoom(false);
    setIsSecondNoRoom(false);

    const dur1 = getSubjectSessionDurationMinutes(initialSub, 'lecture', initialPattern);
    const dur2 = getSubjectSessionDurationMinutes(initialSub, initialSub?.requires_lab ? 'lab' : 'lecture', initialPattern);

    setFormData({
      offering_id: initialOff?.id || '',
      instructor_id: initialQualInsts[0]?.id || instructors[0]?.id || '',
      room_id: targetRoom?.id || rooms[0]?.id || '',
      day_of_week: 1,
      start_time: '08:00',
      end_time: calculateEndTime('08:00', dur1),
      session_type: 'lecture',
      notes: '',
    });

    setSession2Data({
      instructor_id: initialQualInsts[0]?.id || instructors[0]?.id || '',
      room_id: (initialSub?.requires_lab ? targetLabRoom?.id : targetRoom?.id) || rooms[0]?.id || '',
      day_of_week: 3,
      start_time: '08:00',
      end_time: calculateEndTime('08:00', dur2),
      session_type: initialSub?.requires_lab ? 'lab' : 'lecture',
      notes: '',
    });

    setModalError(null);
    setIsModalOpen(true);
  };

  // Day pattern change handler (Single Day, MW, TTH)
  const handlePatternChange = (newPattern: 'single' | 'MW' | 'TTH') => {
    setScheduleDayPattern(newPattern);
    const curOff = initialOfferings.find((o) => o.id === formData.offering_id);
    const curSub = subjects.find((s) => s.id === curOff?.subject_id);

    const has2 = Boolean(
      (curSub && curSub.lecture_hours > 0 && curSub.lab_hours > 0) ||
      newPattern !== 'single'
    );
    setHasSecondSession(has2);

    const dur1 = getSubjectSessionDurationMinutes(curSub, formData.session_type, newPattern);
    const dur2 = getSubjectSessionDurationMinutes(curSub, session2Data.session_type, newPattern);

    if (newPattern === 'MW') {
      const s1Time = formData.start_time || '08:00';
      setFormData((prev) => ({
        ...prev,
        day_of_week: 1, // Monday
        end_time: calculateEndTime(s1Time, dur1),
      }));
      setSession2Data((prev) => ({
        ...prev,
        day_of_week: 3, // Wednesday
        start_time: syncSessionsTime ? s1Time : prev.start_time,
        end_time: calculateEndTime(syncSessionsTime ? s1Time : prev.start_time, dur2),
      }));
    } else if (newPattern === 'TTH') {
      const s1Time = formData.start_time || '08:00';
      setFormData((prev) => ({
        ...prev,
        day_of_week: 2, // Tuesday
        end_time: calculateEndTime(s1Time, dur1),
      }));
      setSession2Data((prev) => ({
        ...prev,
        day_of_week: 4, // Thursday
        start_time: syncSessionsTime ? s1Time : prev.start_time,
        end_time: calculateEndTime(syncSessionsTime ? s1Time : prev.start_time, dur2),
      }));
    } else {
      // Single Day
      setFormData((prev) => ({
        ...prev,
        end_time: calculateEndTime(prev.start_time, dur1),
      }));
      if (has2) {
        setSession2Data((prev) => ({
          ...prev,
          end_time: calculateEndTime(prev.start_time, dur2),
        }));
      }
    }
  };

  // Radial start time change for Session 1 (with duration auto-calc)
  const handleSession1StartChange = (newStart: string) => {
    const curOff = initialOfferings.find((o) => o.id === formData.offering_id);
    const curSub = subjects.find((s) => s.id === curOff?.subject_id);
    const dur1 = getSubjectSessionDurationMinutes(curSub, formData.session_type, scheduleDayPattern);
    const newEnd1 = calculateEndTime(newStart, dur1);

    setFormData((prev) => ({
      ...prev,
      start_time: newStart,
      end_time: newEnd1,
    }));

    if (hasSecondSession && syncSessionsTime) {
      const dur2 = getSubjectSessionDurationMinutes(curSub, session2Data.session_type, scheduleDayPattern);
      const newEnd2 = calculateEndTime(newStart, dur2);
      setSession2Data((prev) => ({
        ...prev,
        start_time: newStart,
        end_time: newEnd2,
      }));
    }
  };

  // Radial start time change for Session 2 (with duration auto-calc)
  const handleSession2StartChange = (newStart: string) => {
    const curOff = initialOfferings.find((o) => o.id === formData.offering_id);
    const curSub = subjects.find((s) => s.id === curOff?.subject_id);
    const dur2 = getSubjectSessionDurationMinutes(curSub, session2Data.session_type, scheduleDayPattern);
    const newEnd2 = calculateEndTime(newStart, dur2);

    setSession2Data((prev) => ({
      ...prev,
      start_time: newStart,
      end_time: newEnd2,
    }));
  };

  // Handle Drag-to-Grid Placement (Direct placement without modal popup)
  const handleDropOnGrid = (offeringId: string, dayOfWeek: number, startTime: string) => {
    if (isReadOnly) {
      setBannerNotice({
        type: 'error',
        message: 'This schedule version is published or archived (read-only). Direct additions are prohibited.',
      });
      return;
    }

    const off = initialOfferings.find((o) => o.id === offeringId);
    if (!off) return;
    if (!isSubjectAllowed(off.subject_id)) {
      setBannerNotice({
        type: 'error',
        message: 'Unauthorized: This course is outside your department scheduler supervision scope.',
      });
      return;
    }

    const sub = subjects.find((s) => s.id === off.subject_id);
    const dayObj = DAYS.find((d) => d.index === dayOfWeek);

    const existingForOffering = entries.filter((e) => e.offering_id === offeringId);
    const hasLec = existingForOffering.some((e) => e.session_type === 'lecture');
    const hasLab = existingForOffering.some((e) => e.session_type === 'lab');

    let sessionTypeToPlace: 'lecture' | 'lab' = 'lecture';
    let durationHours = 1.5;

    if (sub && sub.lecture_hours > 0 && sub.lab_hours > 0) {
      if (!hasLec) {
        sessionTypeToPlace = 'lecture';
        durationHours = sub.lecture_hours;
      } else if (!hasLab) {
        sessionTypeToPlace = 'lab';
        durationHours = sub.lab_hours;
      } else {
        setBannerNotice({
          type: 'error',
          message: `${sub.code} is already fully placed (Lecture & Lab sessions assigned).`,
        });
        return;
      }
    } else if (sub && sub.lecture_hours === 3 && sub.lab_hours === 0) {
      sessionTypeToPlace = 'lecture';
      durationHours = 1.5; // Each session of pure 3h lecture is 1.5 hours
      if (existingForOffering.length >= 2) {
        setBannerNotice({
          type: 'error',
          message: `${sub.code} already has both 1.5-hour lecture sessions scheduled.`,
        });
        return;
      }
    } else {
      sessionTypeToPlace = sub?.requires_lab ? 'lab' : 'lecture';
      durationHours = (sub?.lecture_hours || 0) + (sub?.lab_hours || 0) || 2;
    }

    const isUnspec = isSubjectUnspecified(sub?.id) || isSubjectUnspecified(sub?.code);
    const naRoomId = '00000000-0000-0000-0000-000000000000';
    const preferredRoomId = (sub as any)?.preferred_room_id;

    const targetRoom =
      sessionTypeToPlace === 'lab'
        ? availableRooms.find((r) => r.room_type === 'laboratory') || availableRooms[0] || rooms[0]
        : (preferredRoomId ? availableRooms.find((r) => r.id === preferredRoomId) : null) ||
          availableRooms.find((r) => r.room_type === 'lecture') ||
          availableRooms[0] ||
          rooms[0];
    const roomIdToUse = isUnspec ? naRoomId : (targetRoom?.id || naRoomId);

    const [sh, sm] = startTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = Math.min(21 * 60, startMins + Math.round(durationHours * 60));
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    const endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;

    // Lunch break overlap validation
    const currentBlock = blocks.find((b) => b.id === (selectedBlockId || off.block_id));
    const blockLabel = formatBlockLabel(currentBlock);
    const isHs =
      blockLabel.toLowerCase().includes('grade') ||
      blockLabel.toLowerCase().includes('high school') ||
      blockLabel.toUpperCase().startsWith('HS');
    const lunch = isHs ? { s: '12:00', e: '13:00' } : { s: '12:30', e: '13:00' };
    if (timeRangesOverlap(startTime, endTime, lunch.s, lunch.e)) {
      setBannerNotice({
        type: 'error',
        message: `Cannot place ${sub?.code || 'course'}: Overlaps with lunch break (${lunch.s} - ${lunch.e}).`,
      });
      return;
    }

    // Student block collision validation
    const blockOccupied = entries.some(
      (e) =>
        initialOfferings.find((o) => o.id === e.offering_id)?.block_id === off.block_id &&
        e.day_of_week === dayOfWeek &&
        timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
    );
    if (blockOccupied) {
      setBannerNotice({
        type: 'error',
        message: `Cannot place ${sub?.code || 'course'}: Cohort already has a class scheduled on ${dayObj?.name || 'this day'} from ${startTime} to ${endTime}.`,
      });
      return;
    }

    // Room collision validation (for non-unspecified room)
    let roomOccupied = false;
    let occupiedRoomName = '';
    if (!isUnspec && roomIdToUse !== naRoomId) {
      roomOccupied = entries.some(
        (e) =>
          e.day_of_week === dayOfWeek &&
          e.room_id === roomIdToUse &&
          timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
      );
      if (roomOccupied) {
        const r = rooms.find((rm) => rm.id === roomIdToUse);
        occupiedRoomName = r?.name || 'Assigned Room';
      }
    }

    // Instructor qualification & availability
    const qualInsts = instructors.filter((inst) =>
      (inst.instructor_qualifications || []).some((q) => q.subject_id === sub?.id)
    );

    const availableInst = qualInsts.find(
      (inst) =>
        !entries.some(
          (e) =>
            e.day_of_week === dayOfWeek &&
            e.instructor_id === inst.id &&
            timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
        )
    );

    // If room or instructor is conflicted, pop up the edit/add entry modal to allow selecting an alternative
    if (roomOccupied || !availableInst || qualInsts.length === 0) {
      const conflictParts: string[] = [];
      if (roomOccupied) {
        conflictParts.push(`Room "${occupiedRoomName}" is already occupied on ${dayObj?.name || 'this day'} from ${startTime} to ${endTime}.`);
      }
      if (qualInsts.length === 0) {
        conflictParts.push(`No instructors are currently qualified to teach ${sub?.code || 'this course'}.`);
      } else if (!availableInst) {
        conflictParts.push(`All qualified instructors are already occupied at that time.`);
      }

      const conflictMsg = `Conflict detected: ${conflictParts.join(' ')} Please select an alternative room or instructor.`;

      // Find an available alternative room if possible
      const altRoom = availableRooms.find(
        (r) =>
          r.id !== naRoomId &&
          (sessionTypeToPlace === 'lab' ? r.room_type === 'laboratory' : true) &&
          !entries.some(
            (e) =>
              e.day_of_week === dayOfWeek &&
              e.room_id === r.id &&
              timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
          )
      );

      setEditingEntry(null);
      setSecondEntry(null);
      setHasSecondSession(false);
      setScheduleDayPattern('single');
      setIsNoRoom(isUnspec);
      setIsSecondNoRoom(false);

      setFormData({
        offering_id: offeringId,
        instructor_id: availableInst?.id || qualInsts[0]?.id || instructors[0]?.id || '',
        room_id: isUnspec ? naRoomId : (roomOccupied && altRoom ? altRoom.id : roomIdToUse),
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        session_type: sessionTypeToPlace,
        notes: '',
      });

      setModalError(conflictMsg);
      setIsModalOpen(true);
      return;
    }

    const payload: ScheduleEntryFormInput = {
      offering_id: offeringId,
      instructor_id: availableInst.id,
      room_id: roomIdToUse,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      session_type: sessionTypeToPlace,
      notes: null,
    };

    startTransition(async () => {
      try {
        await saveScheduleEntryAction(draftVersion.id, null, payload);
        const sessionLabel = sessionTypeToPlace === 'lab' ? 'Lab' : 'Lecture';
        setBannerNotice({
          type: 'success',
          message: `Placed ${sub?.code || 'course'} ${sessionLabel} (${durationHours}h) on ${dayObj?.name || 'day'} at ${startTime} - ${endTime}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to place schedule entry.',
        });
      }
    });
  };

  // Handle Drag-and-Drop Move of Existing Placed Entry on Grid
  const handleMoveEntryOnGrid = (entryId: string, dayOfWeek: number, startTime: string) => {
    if (isReadOnly) {
      setBannerNotice({
        type: 'error',
        message: 'This schedule version is published or archived (read-only). Direct edits are prohibited.',
      });
      return;
    }

    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    const off = initialOfferings.find((o) => o.id === entry.offering_id) || (entry as any).class_offerings;
    if (!off) return;
    if (!isSubjectAllowed(off.subject_id)) {
      setBannerNotice({
        type: 'error',
        message: 'Unauthorized: This course is outside your department scheduler supervision scope.',
      });
      return;
    }

    const sub = subjects.find((s) => s.id === off.subject_id) || (off as any).subjects;
    const dayObj = DAYS.find((d) => d.index === dayOfWeek);
    const durMins = Math.max(30, timeToMinutes(entry.end_time) - timeToMinutes(entry.start_time));
    const [sh, sm] = startTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = Math.min(21 * 60, startMins + durMins);
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    const endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;

    // Lunch break overlap validation
    const currentBlock = blocks.find((b) => b.id === (selectedBlockId || off.block_id));
    const blockLabel = formatBlockLabel(currentBlock);
    const isHs =
      blockLabel.toLowerCase().includes('grade') ||
      blockLabel.toLowerCase().includes('high school') ||
      blockLabel.toUpperCase().startsWith('HS');
    const lunch = isHs ? { s: '12:00', e: '13:00' } : { s: '12:30', e: '13:00' };
    if (timeRangesOverlap(startTime, endTime, lunch.s, lunch.e)) {
      setBannerNotice({
        type: 'error',
        message: `Cannot move ${sub?.code || 'class'}: Overlaps with lunch break (${lunch.s} - ${lunch.e}).`,
      });
      return;
    }

    // Student block collision check (excluding this entry)
    const blockOccupied = entries.some(
      (e) =>
        e.id !== entry.id &&
        initialOfferings.find((o) => o.id === e.offering_id)?.block_id === off.block_id &&
        e.day_of_week === dayOfWeek &&
        timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
    );
    if (blockOccupied) {
      setBannerNotice({
        type: 'error',
        message: `Cannot move ${sub?.code || 'class'}: Cohort already has a class scheduled on ${dayObj?.name || 'this day'} from ${startTime} to ${endTime}.`,
      });
      return;
    }

    // Room conflict check (excluding this entry)
    let roomOccupied = false;
    let occupiedRoomName = '';
    if (entry.room_id && entry.room_id !== '00000000-0000-0000-0000-000000000000') {
      roomOccupied = entries.some(
        (e) =>
          e.id !== entry.id &&
          e.day_of_week === dayOfWeek &&
          e.room_id === entry.room_id &&
          timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
      );
      if (roomOccupied) {
        const r = rooms.find((rm) => rm.id === entry.room_id);
        occupiedRoomName = r?.name || 'Assigned Room';
      }
    }

    // Instructor conflict check (excluding this entry)
    let instOccupied = false;
    let occupiedInstName = '';
    if (entry.instructor_id) {
      instOccupied = entries.some(
        (e) =>
          e.id !== entry.id &&
          e.day_of_week === dayOfWeek &&
          e.instructor_id === entry.instructor_id &&
          timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
      );
      if (instOccupied) {
        const inst = instructors.find((i) => i.id === entry.instructor_id);
        occupiedInstName = inst?.full_name || 'Assigned Instructor';
      }
    }

    // If room or instructor is conflicted when moving, pop up the Edit Class Schedule Entry modal
    if (roomOccupied || instOccupied) {
      const conflictParts: string[] = [];
      if (roomOccupied) {
        conflictParts.push(`Room "${occupiedRoomName}" is already occupied on ${dayObj?.name || 'this day'} from ${startTime} to ${endTime}.`);
      }
      if (instOccupied) {
        conflictParts.push(`Instructor "${occupiedInstName}" is already teaching another class at that time.`);
      }
      const conflictMsg = `Conflict detected: ${conflictParts.join(' ')} Please select an alternative room or instructor.`;

      // Find an available alternative room if possible
      const altRoom = availableRooms.find(
        (r) =>
          r.id !== '00000000-0000-0000-0000-000000000000' &&
          (entry.session_type === 'lab' ? r.room_type === 'laboratory' : true) &&
          !entries.some(
            (e) =>
              e.id !== entry.id &&
              e.day_of_week === dayOfWeek &&
              e.room_id === r.id &&
              timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
          )
      );

      // Find an available qualified instructor if possible
      const qualInsts = instructors.filter((inst) =>
        (inst.instructor_qualifications || []).some((q) => q.subject_id === sub?.id)
      );
      const altInst = qualInsts.find(
        (inst) =>
          !entries.some(
            (e) =>
              e.id !== entry.id &&
              e.day_of_week === dayOfWeek &&
              e.instructor_id === inst.id &&
              timeRangesOverlap(e.start_time, e.end_time, startTime, endTime)
          )
      );

      setEditingEntry(entry);
      setSecondEntry(null);
      setHasSecondSession(false);
      setScheduleDayPattern('single');
      setIsNoRoom(!entry.room_id || entry.room_id === '00000000-0000-0000-0000-000000000000');
      setIsSecondNoRoom(false);

      setFormData({
        offering_id: entry.offering_id,
        instructor_id: (instOccupied && altInst ? altInst.id : entry.instructor_id) || '',
        room_id: (roomOccupied && altRoom ? altRoom.id : entry.room_id) || '',
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        session_type: entry.session_type,
        notes: (entry as any).notes || '',
      });

      setModalError(conflictMsg);
      setIsModalOpen(true);
      return;
    }

    const payload: ScheduleEntryFormInput = {
      offering_id: entry.offering_id,
      instructor_id: entry.instructor_id,
      room_id: entry.room_id || '00000000-0000-0000-0000-000000000000',
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      session_type: entry.session_type,
      notes: (entry as any).notes || null,
    };

    startTransition(async () => {
      try {
        await saveScheduleEntryAction(draftVersion.id, entry.id, payload);
        setBannerNotice({
          type: 'success',
          message: `Moved ${sub?.code || 'class'} to ${dayObj?.name || 'day'} at ${startTime} - ${endTime}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to reschedule entry.',
        });
      }
    });
  };

  // Open Edit Modal
  const handleOpenEdit = (entry: ScheduleEntry) => {
    if (isReadOnly) {
      setBannerNotice({
        type: 'error',
        message: 'This schedule version is published or archived (read-only). Direct edits are prohibited. Start a new draft to make revisions.',
      });
      return;
    }

    const off = initialOfferings.find((o) => o.id === entry.offering_id);
    if (!isSubjectAllowed(off?.subject_id)) {
      setBannerNotice({
        type: 'error',
        message: 'Unauthorized: This course is outside your department scheduler supervision scope.',
      });
      return;
    }

    const sub = subjects.find((s) => s.id === off?.subject_id);

    // Look for counterpart entry of the same offering in this schedule version
    const counterpart = entries.find((e) => e.offering_id === entry.offering_id && e.id !== entry.id);

    let initialPattern: 'single' | 'MW' | 'TTH' = 'single';
    if (counterpart) {
      const days = [entry.day_of_week, counterpart.day_of_week].sort();
      if (days[0] === 1 && days[1] === 3) initialPattern = 'MW';
      else if (days[0] === 2 && days[1] === 4) initialPattern = 'TTH';
    } else {
      if (entry.day_of_week === 1 || entry.day_of_week === 3) initialPattern = 'MW';
      else if (entry.day_of_week === 2 || entry.day_of_week === 4) initialPattern = 'TTH';
    }

    setScheduleDayPattern(initialPattern);

    const has2 = Boolean(
      counterpart ||
      (sub && sub.lecture_hours > 0 && sub.lab_hours > 0) ||
      initialPattern !== 'single'
    );
    setHasSecondSession(has2);
    setSyncSessionsTime(true);

    let s1Entry = entry;
    let s2Entry = counterpart;

    if (counterpart) {
      if (
        (entry.session_type === 'lab' && counterpart.session_type === 'lecture') ||
        entry.day_of_week > counterpart.day_of_week
      ) {
        s1Entry = counterpart;
        s2Entry = entry;
      }
    }

    setEditingEntry(s1Entry);
    setSecondEntry(s2Entry || null);
    setIsNoRoom(!s1Entry.room_id);
    setIsSecondNoRoom(s2Entry ? !s2Entry.room_id : false);

    const s1Start = s1Entry.start_time.slice(0, 5);
    const dur1 = getSubjectSessionDurationMinutes(sub, s1Entry.session_type, initialPattern);
    const s1End = s1Entry.end_time.slice(0, 5) || calculateEndTime(s1Start, dur1);

    setFormData({
      offering_id: s1Entry.offering_id,
      instructor_id: s1Entry.instructor_id,
      room_id: s1Entry.room_id || '',
      day_of_week: s1Entry.day_of_week,
      start_time: s1Start,
      end_time: s1End,
      session_type: s1Entry.session_type,
      notes: (s1Entry as any).notes || '',
    });

    if (s2Entry) {
      const s2Start = s2Entry.start_time.slice(0, 5);
      const dur2 = getSubjectSessionDurationMinutes(sub, s2Entry.session_type, initialPattern);
      const s2End = s2Entry.end_time.slice(0, 5) || calculateEndTime(s2Start, dur2);

      setSession2Data({
        instructor_id: s2Entry.instructor_id,
        room_id: s2Entry.room_id || '',
        day_of_week: s2Entry.day_of_week,
        start_time: s2Start,
        end_time: s2End,
        session_type: s2Entry.session_type,
        notes: (s2Entry as any).notes || '',
      });
    } else {
      const dur2 = getSubjectSessionDurationMinutes(sub, sub?.requires_lab ? 'lab' : 'lecture', initialPattern);
      const targetLabRoom = availableRooms.find((r) => r.room_type === 'laboratory') || availableRooms[0] || rooms[0];
      setSession2Data({
        instructor_id: s1Entry.instructor_id,
        room_id: (sub?.requires_lab ? targetLabRoom?.id : s1Entry.room_id) || '',
        day_of_week: initialPattern === 'TTH' ? 4 : 3,
        start_time: s1Start,
        end_time: calculateEndTime(s1Start, dur2),
        session_type: sub?.requires_lab ? 'lab' : 'lecture',
        notes: '',
      });
    }

    setModalError(null);
    setIsModalOpen(true);
  };

  // Form Submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (isReadOnly) {
      setModalError('Schedule versions are read-only once published. Start a new draft to make edits.');
      return;
    }

    const targetOffering = initialOfferings.find((o) => o.id === (formData.offering_id || blockOfferings[0]?.id));
    if (targetOffering && !isSubjectAllowed(targetOffering.subject_id)) {
      setModalError('Unauthorized: This course is outside your department scheduler supervision scope.');
      return;
    }

    if (!isNoRoom && formData.room_id && !isRoomAllowed(formData.room_id)) {
      const r = rooms.find((rm) => rm.id === formData.room_id);
      setModalError(
        `Unauthorized: Room "${r?.name || 'Selected Room'}" is not permitted for use by the ${schedulerDepartment} department.`
      );
      return;
    }

    if (formData.end_time <= formData.start_time) {
      setModalError('Session 1 end time must be after start time.');
      return;
    }

    if (!formData.instructor_id) {
      setModalError(
        selectedSubject
          ? `Please select a qualified instructor for ${selectedSubject.code}.`
          : 'Please select a qualified instructor.'
      );
      return;
    }

    const assignedInst = instructors.find((i) => i.id === formData.instructor_id);
    const targetSub = subjects.find((s) => s.id === selectedOffering?.subject_id);
    const isQualified = (assignedInst?.instructor_qualifications || []).some(
      (q) => q.subject_id === targetSub?.id
    );
    if (targetSub && !isQualified) {
      setModalError(
        `Selected instructor ${assignedInst?.full_name || ''} is not qualified to teach ${targetSub.code}.`
      );
      return;
    }

    // Validate Session 2 if active
    if (hasSecondSession) {
      if (!isSecondNoRoom && session2Data.room_id && !isRoomAllowed(session2Data.room_id)) {
        const r = rooms.find((rm) => rm.id === session2Data.room_id);
        setModalError(
          `Unauthorized: Session 2 Room "${r?.name || 'Selected Room'}" is not permitted for use by the ${schedulerDepartment} department.`
        );
        return;
      }
      if (session2Data.end_time <= session2Data.start_time) {
        setModalError('Session 2 end time must be after start time.');
        return;
      }
      if (!session2Data.instructor_id) {
        setModalError('Please select a qualified instructor for Session 2.');
        return;
      }
    }

    const offId =
      formData.offering_id || blockOfferings[0]?.id || initialOfferings[0]?.id || '';

    const curOff = initialOfferings.find((o) => o.id === offId);
    const curSub = subjects.find((s) => s.id === curOff?.subject_id);
    const isUnspecified = isSubjectUnspecified(curSub?.id) || isSubjectUnspecified(curSub?.code);
    const naRoomId = '00000000-0000-0000-0000-000000000000';

    // Room collision check for Session 1
    if (!isNoRoom && formData.room_id && formData.room_id !== naRoomId) {
      const roomOccupied = entries.some(
        (e) =>
          (!editingEntry || e.id !== editingEntry.id) &&
          e.day_of_week === formData.day_of_week &&
          e.room_id === formData.room_id &&
          timeRangesOverlap(e.start_time, e.end_time, formData.start_time, formData.end_time)
      );
      if (roomOccupied) {
        const r = rooms.find((rm) => rm.id === formData.room_id);
        const dayName = DAYS.find((d) => d.index === formData.day_of_week)?.name || 'this day';
        setModalError(
          `Room "${r?.name || 'Selected Room'}" is already occupied on ${dayName} from ${formData.start_time} to ${formData.end_time}. Please select an alternative room.`
        );
        return;
      }
    }

    // Instructor collision check for Session 1
    if (formData.instructor_id) {
      const instOccupied = entries.some(
        (e) =>
          (!editingEntry || e.id !== editingEntry.id) &&
          e.day_of_week === formData.day_of_week &&
          e.instructor_id === formData.instructor_id &&
          timeRangesOverlap(e.start_time, e.end_time, formData.start_time, formData.end_time)
      );
      if (instOccupied) {
        const inst = instructors.find((i) => i.id === formData.instructor_id);
        setModalError(
          `Instructor "${inst?.full_name || 'Selected Faculty'}" is already teaching another class at that time. Please select an alternative instructor.`
        );
        return;
      }
    }

    // Validate Session 2 conflicts if active
    if (hasSecondSession) {
      if (!isSecondNoRoom && session2Data.room_id && session2Data.room_id !== naRoomId) {
        const roomOccupied2 = entries.some(
          (e) =>
            (!secondEntry || e.id !== secondEntry.id) &&
            e.day_of_week === session2Data.day_of_week &&
            e.room_id === session2Data.room_id &&
            timeRangesOverlap(e.start_time, e.end_time, session2Data.start_time, session2Data.end_time)
        );
        if (roomOccupied2) {
          const r = rooms.find((rm) => rm.id === session2Data.room_id);
          const dayName = DAYS.find((d) => d.index === session2Data.day_of_week)?.name || 'this day';
          setModalError(
            `Session 2 Room "${r?.name || 'Selected Room'}" is already occupied on ${dayName} from ${session2Data.start_time} to ${session2Data.end_time}. Please select an alternative room.`
          );
          return;
        }
      }
      if (session2Data.instructor_id) {
        const instOccupied2 = entries.some(
          (e) =>
            (!secondEntry || e.id !== secondEntry.id) &&
            e.day_of_week === session2Data.day_of_week &&
            e.instructor_id === session2Data.instructor_id &&
            timeRangesOverlap(e.start_time, e.end_time, session2Data.start_time, session2Data.end_time)
        );
        if (instOccupied2) {
          const inst = instructors.find((i) => i.id === session2Data.instructor_id);
          setModalError(
            `Session 2 Instructor "${inst?.full_name || 'Selected Faculty'}" is already teaching another class at that time. Please select an alternative instructor.`
          );
          return;
        }
      }
    }

    const payload1: ScheduleEntryFormInput = {
      ...formData,
      offering_id: offId,
      instructor_id: formData.instructor_id,
      room_id: isUnspecified || isNoRoom ? naRoomId : (formData.room_id || naRoomId),
      notes: formData.notes?.trim() ? formData.notes.trim() : null,
      day_of_week: formData.day_of_week,
    };

    startTransition(async () => {
      try {
        await saveScheduleEntryAction(
          draftVersion.id,
          editingEntry ? editingEntry.id : null,
          payload1
        );

        if (hasSecondSession) {
          const payload2: ScheduleEntryFormInput = {
            offering_id: offId,
            instructor_id: session2Data.instructor_id,
            room_id: isUnspecified || isSecondNoRoom ? naRoomId : (session2Data.room_id || naRoomId),
            day_of_week: session2Data.day_of_week,
            start_time: session2Data.start_time,
            end_time: session2Data.end_time,
            session_type: session2Data.session_type,
            notes: session2Data.notes?.trim() ? session2Data.notes.trim() : null,
          };

          await saveScheduleEntryAction(
            draftVersion.id,
            secondEntry ? secondEntry.id : null,
            payload2
          );
        }

        setIsModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: editingEntry
            ? 'Schedule entry updated successfully.'
            : 'Schedule entry added successfully.',
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to save entry.');
      }
    });
  };

  // Handle Delete
  const handleDelete = (entryId: string) => {
    if (isReadOnly) {
      setBannerNotice({
        type: 'error',
        message: 'Cannot delete an entry from a published or archived schedule. Start a new draft.',
      });
      return;
    }

    const targetEntry = entries.find((e) => e.id === entryId);
    const targetOff = initialOfferings.find((o) => o.id === targetEntry?.offering_id);
    if (targetOff && !isSubjectAllowed(targetOff.subject_id)) {
      setBannerNotice({
        type: 'error',
        message: 'Unauthorized: This course is outside your department scheduler supervision scope.',
      });
      return;
    }

    if (!confirm('Remove this class entry from the schedule?')) return;

    startTransition(async () => {
      try {
        await deleteScheduleEntryAction(entryId);
        setBannerNotice({
          type: 'success',
          message: 'Schedule entry removed.',
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete entry.',
        });
      }
    });
  };

  // Handle Trigger Publish Validation Modal
  const handleTriggerPublish = async () => {
    setIsPublishModalOpen(true);
    setIsValidatingPublish(true);
    setPublishValidation(null);
    try {
      const res = await validateForPublishAction(draftVersion.id);
      setPublishValidation(res);
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Validation failed.',
      });
      setIsPublishModalOpen(false);
    } finally {
      setIsValidatingPublish(false);
    }
  };

  // Handle Confirm Publish Execution
  const handleConfirmPublish = () => {
    setIsPublishing(true);
    startTransition(async () => {
      try {
        const res = await publishScheduleVersionAction(draftVersion.id);
        if (res.success) {
          setIsPublishModalOpen(false);
          setBannerNotice({
            type: 'success',
            message: `Schedule Version v${res.versionNumber} successfully published! In-app notifications sent to ${res.notifications?.inAppCount || 0} instructor(s).`,
          });
          router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${res.publishedVersionId}&blockId=${selectedBlockId}`);
        } else {
          setPublishValidation(res.validation || null);
        }
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to publish version.');
      } finally {
        setIsPublishing(false);
      }
    });
  };

  // Handle Start New Draft
  const handleStartNewDraft = () => {
    if (
      !confirm(
        'Start a new draft version? This will clone entries from the published schedule so you can safely make edits in a new version.'
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await startNewDraftAction(currentTermId);
        if (res.success && res.versionId) {
          const target = selectedBlockId ? `&blockId=${selectedBlockId}` : '';
          router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${res.versionId}${target}`);
        }
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to create new draft.',
        });
      }
    });
  };

  // Handle Unpublish Schedule Version
  const handleUnpublishSchedule = () => {
    if (
      !confirm(
        `Are you sure you want to unpublish Schedule Version v${draftVersion.version_number}? This will revert it to draft mode and allow you to make direct changes.`
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await unpublishScheduleVersionAction(draftVersion.id);
        if (res.success) {
          setBannerNotice({
            type: 'success',
            message: res.message,
          });
          const target = selectedBlockId ? `&blockId=${selectedBlockId}` : '';
          router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${draftVersion.id}${target}`);
        }
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to unpublish schedule.',
        });
      }
    });
  };

  // Handle Delete Schedule Version
  const handleDeleteSchedule = () => {
    if (
      !confirm(
        `Permanently delete Schedule Version v${draftVersion.version_number} (${draftVersion.status.toUpperCase()})? This action cannot be undone.`
      )
    ) {
      return;
    }

    startTransition(async () => {
      try {
        const res = await deleteScheduleVersionAction(draftVersion.id);
        if (res.success) {
          setBannerNotice({
            type: 'success',
            message: res.message,
          });
          router.push(`/scheduler/schedule?termId=${currentTermId}`);
        }
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete schedule version.',
        });
      }
    });
  };

  // AI Auto-Draft Execution (Places directly onto grid and spreadsheet, supports 'new' or 'refine' mode)
  const handleExecuteAiDraft = async (mode: 'new' | 'refine' = 'new') => {
    setIsAiDrafting(true);
    try {
      const targetBlockIds = aiScope === 'current' && selectedBlockId ? [selectedBlockId] : blocks.map((b) => b.id);
      const wantsSaturday = aiAllowSaturday || /saturday|sat\b/i.test(aiPromptNotes);
      const res = await generateAiDraftAction(
        currentTermId,
        targetBlockIds,
        {
          splitTwoDays: true,
          preferMornings: true,
          noClassesAfter5pm: false,
          allowSaturday: wantsSaturday,
          customNotes: aiPromptNotes.trim() || undefined,
          refineScope: mode === 'refine' ? aiRefineScope : undefined,
        },
        mode
      );

      if (mode === 'refine' && (res.collisionError || !res.success)) {
        const errorMsg =
          res.collisionError ||
          res.results.find((r) => !r.success && r.error)?.error ||
          'The requested schedule adjustment collided with another class or availability constraint.';
        setIsAiModalOpen(false);
        setCollisionNotice({
          message: errorMsg,
          attemptedPrompt: aiPromptNotes,
        });
        return;
      }

      if (res.success) {
        setIsAiModalOpen(false);
        setCollisionNotice(null);
        const entriesCount = res.results.reduce((acc, r) => acc + r.entriesWritten.length, 0);

        if (res.unassignedWarnings && res.unassignedWarnings.length > 0) {
          setUnassignedWarnings(res.unassignedWarnings);
          setIsWarningsModalOpen(true);
        }

        if (entriesCount > 0) {
          setBannerNotice({
            type: 'success',
            message:
              mode === 'refine'
                ? `AI Draft refined based on your preferences! Updated ${entriesCount} class entries.`
                : `AI Draft successfully generated! Placed ${entriesCount} class entries onto the schedule.`,
          });
        } else {
          setBannerNotice({
            type: 'error',
            message: 'Could not place class entries conflict-free. Please check unassigned notices and instructor qualifications.',
          });
        }
        const targetBlock = aiScope === 'current' && selectedBlockId ? selectedBlockId : (res.firstBlockId || selectedBlockId || '');
        const targetParam = targetBlock ? `&blockId=${targetBlock}` : '';
        if (targetBlock) setSelectedBlockId(targetBlock);
        router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${res.versionId}${targetParam}`);
        router.refresh();
      }
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'AI schedule generation failed.',
      });
    } finally {
      setIsAiDrafting(false);
    }
  };

  // Clear all schedules in the current draft version across all blocks
  const handleClearAllDraftSchedules = async () => {
    setIsClearingAll(true);
    try {
      const res = await clearAllDraftScheduleEntriesAction(draftVersion.id);
      setIsConfirmClearAllOpen(false);
      setBannerNotice({
        type: 'success',
        message: userRole === 'admin'
          ? `Cleared all ${res.clearedCount} scheduled sessions across all blocks for draft v${draftVersion.version_number}.`
          : `Cleared ${res.clearedCount} scheduled sessions within your ${schedulerDepartment || 'department'} scope for draft v${draftVersion.version_number}.`,
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to clear schedules.',
      });
    } finally {
      setIsClearingAll(false);
    }
  };

  // Clear schedules for the currently selected block
  const handleClearBlockDraftSchedule = async () => {
    if (!selectedBlockId) return;
    setIsClearingBlock(true);
    try {
      const res = await clearBlockDraftScheduleEntriesAction(draftVersion.id, selectedBlockId);
      setIsConfirmClearBlockOpen(false);
      setBannerNotice({
        type: 'success',
        message: `Cleared all ${res.clearedCount} scheduled sessions for ${selectedBlock ? formatBlockLabel(selectedBlock) : 'this block'}.`,
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to clear block schedule.',
      });
    } finally {
      setIsClearingBlock(false);
    }
  };

  // Handle Rename Schedule Version Draft
  const handleRenameDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameDraftName.trim()) return;
    setIsRenaming(true);
    try {
      const res = await renameScheduleVersionAction(draftVersion.id, renameDraftName.trim());
      if (res.success) {
        setVersionNames((prev) => {
          const updated = { ...prev, [draftVersion.id]: renameDraftName.trim() };
          try {
            localStorage.setItem('altersched_version_names', JSON.stringify(updated));
          } catch {}
          return updated;
        });
        setIsRenameModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: res.message,
        });
      }
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to rename schedule version.',
      });
    } finally {
      setIsRenaming(false);
    }
  };

  // Save Draft state and handler
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    try {
      const res = await saveDraftScheduleAction(draftVersion.id);
      if (res.success) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLastSavedTime(timeStr);
        setBannerNotice({
          type: 'success',
          message: `Draft v${res.versionNumber} saved successfully at ${timeStr}! ${res.entriesCount} classes recorded.`,
        });
      }
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save draft.',
      });
    } finally {
      setIsSavingDraft(false);
    }
  };

  // Delete Archive state and handler
  const [isDeletingArchive, setIsDeletingArchive] = useState(false);
  const [isConfirmDeleteArchiveOpen, setIsConfirmDeleteArchiveOpen] = useState(false);

  const handleDeleteArchive = async () => {
    setIsDeletingArchive(true);
    try {
      const res = await deleteArchivedVersionAction(draftVersion.id);
      if (res.success) {
        setIsConfirmDeleteArchiveOpen(false);
        setBannerNotice({
          type: 'success',
          message: res.message,
        });
        const remaining = (versions || []).filter((v) => v.id !== draftVersion.id);
        const target = remaining.find((v) => v.status === 'draft') || remaining.find((v) => v.status === 'published') || remaining[0];
        if (target) {
          router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${target.id}&blockId=${selectedBlockId}`);
        } else {
          router.push(`/scheduler/schedule?termId=${currentTermId}`);
        }
        router.refresh();
      }
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete archived version.',
      });
    } finally {
      setIsDeletingArchive(false);
    }
  };

  // Summary calculations for each student block card
  const blockSummaries = useMemo(() => {
    const scheduledOfferingIds = new Set(entries.map((e) => e.offering_id));

    return blocks.map((b) => {
      const bOfferings = initialOfferings.filter((o) => o.block_id === b.id);
      const bEntries = entries.filter((e) => {
        const off = initialOfferings.find((o) => o.id === e.offering_id);
        return off?.block_id === b.id;
      });

      const scheduledOfferings = bOfferings.filter((o) => scheduledOfferingIds.has(o.id));
      const unscheduledOfferings = bOfferings.filter((o) => !scheduledOfferingIds.has(o.id));

      const totalMinutes = bEntries.reduce((sum, e) => {
        return sum + (timeToMinutes(e.end_time.slice(0, 5)) - timeToMinutes(e.start_time.slice(0, 5)));
      }, 0);
      const totalHours = (totalMinutes / 60).toFixed(1);

      // Unique days
      const daysSet = Array.from(new Set(bEntries.map((e) => e.day_of_week))).sort();
      let dayPattern = 'None';
      if (daysSet.length === 2 && daysSet[0] === 1 && daysSet[1] === 3) dayPattern = 'MW';
      else if (daysSet.length === 2 && daysSet[0] === 2 && daysSet[1] === 4) dayPattern = 'TTH';
      else if (daysSet.length === 3 && daysSet[0] === 1 && daysSet[1] === 3 && daysSet[2] === 5) dayPattern = 'MWF';
      else if (daysSet.length > 0) {
        dayPattern = daysSet.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] || '').filter(Boolean).join(', ');
      }

      // Rooms used
      const roomNames = Array.from(
        new Set(
          bEntries
            .map((e) => rooms.find((r) => r.id === e.room_id)?.name)
            .filter(Boolean)
        )
      ) as string[];

      // Check if block has hard violations
      const blockEntryIds = new Set(bEntries.map((e) => e.id));
      const blockViolations = allViolations.filter((v) => {
        return v.entryIds.some((id) => blockEntryIds.has(id));
      });

      const hardCount = blockViolations.filter((v) => v.severity === 'hard').length;
      const isComplete = bOfferings.length > 0 && unscheduledOfferings.length === 0 && hardCount === 0;

      return {
        block: b,
        offeringsCount: bOfferings.length,
        scheduledCount: scheduledOfferings.length,
        unscheduledCount: unscheduledOfferings.length,
        unscheduledOfferings,
        entriesCount: bEntries.length,
        totalHours,
        dayPattern,
        roomNames,
        hardCount,
        isComplete,
      };
    });
  }, [blocks, initialOfferings, entries, rooms, allViolations]);

  // Group blocks by year level
  const yearLevelGroups = useMemo(() => {
    const groups: {
      title: string;
      yearLevel: number;
      isHighSchool?: boolean;
      blocks: typeof blockSummaries;
    }[] = [
      { title: '1st Year Cohorts', yearLevel: 1, blocks: [] },
      { title: '2nd Year Cohorts', yearLevel: 2, blocks: [] },
      { title: '3rd Year Cohorts', yearLevel: 3, blocks: [] },
      { title: '4th Year Cohorts', yearLevel: 4, blocks: [] },
    ];

    const hsGroup: {
      title: string;
      yearLevel: number;
      isHighSchool?: boolean;
      blocks: typeof blockSummaries;
    } = {
      title: 'High School Department',
      yearLevel: 0,
      isHighSchool: true,
      blocks: [],
    };

    blockSummaries.forEach((bs) => {
      const b = bs.block;
      const progCode = b.programs?.code || '';
      const sec = (b.section || '').trim();
      const isHs = progCode === 'HS' || /^Grade/i.test(sec);

      if (isHs) {
        hsGroup.blocks.push(bs);
      } else {
        const idx = groups.findIndex((g) => g.yearLevel === b.year_level);
        if (idx !== -1) {
          groups[idx].blocks.push(bs);
        } else {
          groups.push({
            title: `Year ${b.year_level} Cohorts`,
            yearLevel: b.year_level,
            blocks: [bs],
          });
        }
      }
    });

    if (hsGroup.blocks.length > 0) {
      groups.push(hsGroup);
    }

    // Sort blocks inside each cohort naturally by name so BSIT - 1A, BSIT - 1B appear in order
    groups.forEach((g) => {
      g.blocks.sort((a, b) => {
        const nameA = formatBlockLabel(a.block);
        const nameB = formatBlockLabel(b.block);
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
    });

    return groups.filter((g) => g.blocks.length > 0);
  }, [blockSummaries]);

  // Helper info for dropdown options
  const selectedOffering = initialOfferings.find((o) => o.id === formData.offering_id);
  const selectedSubject = subjects.find((s) => s.id === selectedOffering?.subject_id);
  const qualifiedInstructors = useMemo(() => {
    if (!selectedSubject) return instructors;
    return instructors.filter((inst) =>
      (inst.instructor_qualifications || []).some((q) => q.subject_id === selectedSubject.id)
    );
  }, [instructors, selectedSubject]);
  const currentTerm = terms.find((t) => t.id === currentTermId) || terms[0];

  // Render In-page Department Masterlist Panel (Spreadsheet + Weekly Grid)
  const renderMasterlistPanel = () => {
    const isHsMaster = masterlistDept === 'high_school';
    return (
      <div
        className={`bg-white rounded-5 p-4 shadow-sm border ${
          isHsMaster ? 'border-success border-opacity-35' : 'border-primary border-opacity-25'
        } mb-4`}
      >
        {/* Masterlist Header */}
        <div className="d-flex flex-column flex-lg-row align-items-start align-items-lg-center justify-content-between gap-3 pb-3 mb-3 border-bottom border-light-subtle">
          <div>
            <div className="d-flex align-items-center gap-2 mb-1">
              <span
                className="d-inline-flex align-items-center justify-content-center text-white rounded-3 shadow-sm"
                style={{ width: '36px', height: '36px', backgroundColor: isHsMaster ? '#16a34a' : '#0E0AB8' }}
              >
                <i className="bi bi-table fs-6"></i>
              </span>
              <h5 className="fw-bold text-dark mb-0">Department Master Schedule</h5>
              <span
                className={`badge rounded-pill ${
                  isHsMaster
                    ? 'bg-success-subtle text-success border border-success-subtle'
                    : 'bg-primary-subtle text-primary border border-primary-subtle'
                }`}
              >
                {departmentOptions.find((d) => d.id === masterlistDept)?.name || 'Department'} &bull; {masterlistBlocks.length} Blocks
              </span>
            </div>
            <p className="text-secondary small mb-0">
              Department-wide timetable masterlist across all block cohorts. Switch between departments or toggle between Spreadsheet and Weekly Grid.
            </p>
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2">
            {/* Department Switcher */}
            <div className="d-flex align-items-center gap-1.5 p-1 bg-light rounded-3 border">
              {departmentOptions.map((dept) => {
                const isSelected = masterlistDept === dept.id;
                const isHs = dept.id === 'high_school';
                return (
                  <button
                    key={dept.id}
                    type="button"
                    onClick={() => {
                      setMasterlistDept(dept.id);
                      setMasterlistBlockFilter('all');
                    }}
                    className={`btn btn-sm px-3 py-1.5 rounded-2 fw-semibold border-0 transition ${
                      isSelected
                        ? isHs
                          ? 'bg-success text-white shadow-sm'
                          : 'bg-primary text-white shadow-sm'
                        : 'text-secondary hover:text-dark'
                    }`}
                    style={
                      isSelected
                        ? isHs
                          ? { backgroundColor: '#16a34a', color: '#ffffff' }
                          : { backgroundColor: '#0E0AB8', color: '#ffffff' }
                        : {}
                    }
                  >
                    {dept.name} ({dept.blockCount})
                  </button>
                );
              })}
            </div>

            {/* View Mode Toggle: Spreadsheet vs Weekly Grid */}
            <div className="btn-group btn-group-sm p-1 bg-light rounded-3 border" role="group">
              <button
                type="button"
                onClick={() => setMasterlistViewStyle('spreadsheet')}
                className={`btn btn-sm px-3 fw-semibold transition d-flex align-items-center gap-1.5 ${
                  masterlistViewStyle === 'spreadsheet'
                    ? 'btn-primary text-white shadow-sm'
                    : 'btn-light text-secondary'
                }`}
                style={masterlistViewStyle === 'spreadsheet' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
              >
                <i className="bi bi-file-earmark-spreadsheet"></i>
                <span>Spreadsheet</span>
              </button>
              <button
                type="button"
                onClick={() => setMasterlistViewStyle('grid')}
                className={`btn btn-sm px-3 fw-semibold transition d-flex align-items-center gap-1.5 ${
                  masterlistViewStyle === 'grid'
                    ? 'btn-primary text-white shadow-sm'
                    : 'btn-light text-secondary'
                }`}
                style={masterlistViewStyle === 'grid' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
              >
                <i className="bi bi-calendar3-week"></i>
                <span>Weekly Grid</span>
              </button>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowMasterlist(false)}
              className="btn btn-sm btn-outline-danger py-1.5 px-3 rounded-3 d-flex align-items-center gap-1"
              title="Close Masterlist panel"
            >
              <i className="bi bi-x-lg"></i>
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Masterlist Body */}
        {masterlistViewStyle === 'spreadsheet' ? (
          <SpreadsheetScheduleView
            entries={masterlistEntries}
            offerings={initialOfferings}
            rooms={rooms}
            instructors={instructors}
            subjects={subjects}
            blocks={masterlistBlocks}
            selectedBlockId={masterlistBlocks[0]?.id || ''}
            selectedTerm={currentTerm}
            isReadOnly={isReadOnly}
            lockToBlock={false}
            onEditEntry={handleOpenEdit}
            onDeleteEntry={handleDelete}
            onAddEntry={() => handleOpenAdd()}
            onGenerateAiDraft={() =>
              router.push(
                `/scheduler/generate?termId=${currentTermId}${masterlistBlockFilter && masterlistBlockFilter !== 'all' ? `&blockId=${masterlistBlockFilter}` : ''}`
              )
            }
            isSubjectAllowed={isSubjectAllowed}
          />
        ) : (
          <div className="bg-white rounded-4 shadow-sm border border-light-subtle overflow-hidden">
            {/* Grid Filters Bar */}
            <div className="p-3 px-4 border-bottom border-light d-flex flex-wrap align-items-center justify-content-between gap-3">
              <div>
                <h6 className="fw-bold text-dark mb-0">
                  {departmentOptions.find((d) => d.id === masterlistDept)?.name || 'Department'} Weekly Schedule
                </h6>
                <span className="text-muted small">
                  Showing {filteredMasterlistEntries.length} scheduled classes across{' '}
                  {masterlistBlockFilter === 'all' ? `${masterlistBlocks.length} blocks` : 'selected block'}
                </span>
              </div>

              <div className="d-flex flex-wrap align-items-center gap-3">
                {/* Cohort Block Filter */}
                <div className="d-flex align-items-center gap-1.5">
                  <span className="small text-muted fw-semibold" style={{ fontSize: '11px' }}>
                    <i className="bi bi-collection me-1"></i>Cohort:
                  </span>
                  <select
                    value={masterlistBlockFilter}
                    onChange={(e) => setMasterlistBlockFilter(e.target.value)}
                    className="form-select form-select-sm ref-form-control py-1 px-2.5"
                    style={{ minWidth: '160px', fontSize: '11px' }}
                  >
                    <option value="all">All Cohorts ({masterlistBlocks.length})</option>
                    {masterlistBlocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {formatBlockLabel(b)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Room Filter */}
                <div className="d-flex align-items-center gap-1.5">
                  <span className="small text-muted fw-semibold" style={{ fontSize: '11px' }}>
                    <i className="bi bi-door-open me-1"></i>Room:
                  </span>
                  <select
                    value={masterlistRoomFilter}
                    onChange={(e) => setMasterlistRoomFilter(e.target.value)}
                    className="form-select form-select-sm ref-form-control py-1 px-2.5"
                    style={{ minWidth: '150px', fontSize: '11px' }}
                  >
                    <option value="all">All Rooms ({rooms.length})</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.room_type})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Weekly Grid Timetable */}
            <div className="overflow-x-auto">
              <div style={{ minWidth: '850px' }}>
                <div className="d-flex border-bottom border-light bg-light py-2 sticky-top z-2">
                  <div
                    className="text-center text-muted small fw-semibold border-end border-light"
                    style={{ width: '75px', flexShrink: 0 }}
                  >
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

                <div className="d-flex position-relative" style={{ height: `${TIME_SLOTS.length * HOUR_HEIGHT}px` }}>
                  {/* Time Label Column */}
                  <div
                    className="border-end border-light bg-light bg-opacity-25"
                    style={{ width: '75px', flexShrink: 0 }}
                  >
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

                  {/* 6 Day Columns */}
                  <div className="d-flex flex-grow-1 position-relative">
                    {DAYS.map((day) => {
                      const dayEntries = filteredMasterlistEntries.filter((e) => e.day_of_week === day.index);
                      const layoutMap = computeDayLayout(dayEntries);

                      return (
                        <div
                          key={day.index}
                          className="col border-end border-light-subtle position-relative"
                          style={{ height: `${TIME_SLOTS.length * HOUR_HEIGHT}px` }}
                        >
                          {TIME_SLOTS.map((slot) => (
                            <div
                              key={slot}
                              className="border-bottom border-light-subtle w-100 position-relative"
                              style={{ height: `${HOUR_HEIGHT}px` }}
                            >
                              <div
                                className="position-absolute start-0 end-0 border-bottom border-light-subtle border-opacity-50"
                                style={{ top: `${HOUR_HEIGHT / 2}px`, borderStyle: 'dashed' }}
                              />
                            </div>
                          ))}

                          {dayEntries.map((e) => {
                            const sMins = timeToMinutes(e.start_time);
                            const eMins = timeToMinutes(e.end_time);
                            const topOffset = Math.max(0, ((sMins - GRID_START_MIN) / 60) * HOUR_HEIGHT);
                            const durationMins = Math.max(30, eMins - sMins);
                            const cardHeight = Math.max(34, (durationMins / 60) * HOUR_HEIGHT - 4);

                            const layout = layoutMap.get(e.id) || { colIndex: 0, totalCols: 1 };
                            const widthPercent = 100 / layout.totalCols;
                            const leftPercent = layout.colIndex * widthPercent;

                            const offering = initialOfferings.find((o) => o.id === e.offering_id);
                            const blk = blocks.find((b) => b.id === offering?.block_id);
                            const subject = subjects.find((s) => s.id === offering?.subject_id);
                            const instructor = instructors.find((i) => i.id === e.instructor_id);
                            const room = rooms.find((r) => r.id === e.room_id);

                            const canEdit = !isReadOnly && isSubjectAllowed(offering?.subject_id);

                            return (
                              <div
                                key={e.id}
                                onClick={() => {
                                  if (canEdit) handleOpenEdit(e);
                                }}
                                className={`rounded-3 p-1.5 transition position-absolute shadow-sm d-flex flex-column justify-content-between overflow-hidden bg-white border border-light-subtle text-dark ${
                                  canEdit ? 'cursor-pointer hover:border-primary hover:shadow' : ''
                                }`}
                                style={{
                                  top: `${topOffset + 2}px`,
                                  height: `${cardHeight}px`,
                                  left: `calc(${leftPercent}% + 2px)`,
                                  width: `calc(${widthPercent}% - 4px)`,
                                  zIndex: 3,
                                  cursor: canEdit ? 'pointer' : 'default',
                                }}
                              >
                                <div>
                                  <div className="d-flex align-items-center justify-content-between gap-1 mb-0.5">
                                    <span
                                      className="badge bg-primary-subtle text-primary border border-primary-subtle text-truncate fw-bold"
                                      style={{ fontSize: '8.5px', padding: '1px 3px' }}
                                    >
                                      {blk ? formatBlockLabel(blk) : 'Block'}
                                    </span>
                                    <span
                                      className="badge bg-warning-subtle text-dark border border-warning-subtle fw-semibold"
                                      style={{ fontSize: '8px', padding: '1px 3px' }}
                                    >
                                      📍 {room?.name || 'TBA'}
                                    </span>
                                  </div>
                                  <div className="fw-bold text-dark text-truncate" style={{ fontSize: '10px' }}>
                                    {subject?.code || 'Course'}
                                  </div>
                                  <div className="text-secondary text-truncate" style={{ fontSize: '9px' }}>
                                    {instructor?.full_name}
                                  </div>
                                </div>

                                <div className="mt-auto pt-0.5 border-top border-light-subtle d-flex align-items-center justify-content-between">
                                  <span className="font-monospace text-muted" style={{ fontSize: '8.5px' }}>
                                    {formatTimeShort(e.start_time)}-{formatTimeShort(e.end_time)}
                                  </span>
                                  {!isReadOnly && (
                                    isSubjectAllowed(offering?.subject_id) ? (
                                      <button
                                        type="button"
                                        onClick={(ev) => {
                                          ev.stopPropagation();
                                          handleOpenEdit(e);
                                        }}
                                        className="btn btn-outline-secondary btn-sm py-0 px-1"
                                        style={{ fontSize: '8.5px', lineHeight: '1.2' }}
                                      >
                                        Edit
                                      </button>
                                    ) : (
                                      <span
                                        className="badge bg-secondary-subtle text-secondary border px-1"
                                        style={{ fontSize: '7.5px' }}
                                        title="Outside supervision scope"
                                      >
                                        Locked
                                      </span>
                                    )
                                  )}
                                </div>
                              </div>
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
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Floating Notice Alert - always visible over timetable */}
      {bannerNotice && (
        <div
          className="position-fixed start-50 translate-middle-x shadow-lg d-flex align-items-center justify-content-between px-4 py-3 rounded-4"
          style={{
            bottom: '28px',
            zIndex: 10500,
            maxWidth: '680px',
            width: 'calc(100% - 32px)',
            backgroundColor: bannerNotice.type === 'success' ? '#0f5132' : '#842029',
            color: '#ffffff',
            border: `1px solid ${bannerNotice.type === 'success' ? '#20c997' : '#ea868f'}`,
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div className="d-flex align-items-center gap-2.5 pe-3">
            <i className={`bi ${bannerNotice.type === 'success' ? 'bi-check-circle-fill text-success' : 'bi-exclamation-triangle-fill text-warning'} fs-5 flex-shrink-0`}></i>
            <span className="fw-medium small" style={{ lineHeight: '1.4' }}>{bannerNotice.message}</span>
          </div>
          <button
            onClick={() => setBannerNotice(null)}
            className="btn btn-sm btn-light fw-bold rounded-pill px-3 py-1 text-dark shadow-sm flex-shrink-0"
            style={{ fontSize: '12px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Unassigned Offerings Warning Notice */}
      {unassignedWarnings.length > 0 && (
        <div className="alert alert-warning border border-warning-subtle rounded-4 d-flex align-items-center justify-content-between p-3 mb-3 shadow-sm">
          <div className="d-flex align-items-center gap-2">
            <i className="bi bi-exclamation-triangle-fill text-warning fs-5"></i>
            <div>
              <strong className="text-dark">Scheduling Placement Notice:</strong>{' '}
              <span className="text-secondary">
                {unassignedWarnings.length} subject(s) could not be placed due to missing faculty qualifications or room/time constraints.
              </span>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              onClick={() => setIsWarningsModalOpen(true)}
              className="btn btn-sm btn-outline-warning text-dark fw-semibold py-1 px-3 rounded-pill"
            >
              View Reasons ({unassignedWarnings.length})
            </button>
            <button
              type="button"
              onClick={() => setUnassignedWarnings([])}
              className="btn btn-sm btn-link text-decoration-none text-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Read-Only Status Banner */}
      {isReadOnly && (
        <div className="bg-white rounded-4 p-3 shadow-sm border border-warning border-opacity-25 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-3 text-secondary mb-3">
          <div className="d-flex align-items-center gap-2">
            <span className="badge rounded-circle bg-warning p-1"></span>
            <span className="small fw-semibold text-dark">
              {draftVersion.status === 'published'
                ? `Schedule Version v${draftVersion.version_number} is officially PUBLISHED (Read-Only). No entries can be edited in place.`
                : `Schedule Version v${draftVersion.version_number} is ARCHIVED (Read-Only).`}
            </span>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Link
              href={`/scheduler/qr-sheets?termId=${currentTermId}&versionId=${draftVersion.id}`}
              className="btn-ref-secondary small py-1 px-3"
              title="Printable QR Code sheets for each student block"
            >
              <i className="bi bi-qr-code me-1 text-primary"></i>
              View QR Sheets
            </Link>
            {draftVersion.status === 'published' && (
              <button
                onClick={handleUnpublishSchedule}
                disabled={isPending}
                className="btn btn-outline-warning btn-sm py-1 px-3 d-flex align-items-center gap-1.5"
                title="Revert published schedule back to draft mode to edit"
              >
                <i className="bi bi-arrow-counterclockwise"></i>
                <span>Unpublish to Draft</span>
              </button>
            )}
            <button
              onClick={handleDeleteSchedule}
              disabled={isPending}
              className="btn btn-outline-danger btn-sm py-1 px-2.5 d-flex align-items-center gap-1"
              title="Permanently delete this schedule version"
            >
              <i className="bi bi-trash3"></i>
              <span>Delete</span>
            </button>
            <button
              onClick={handleStartNewDraft}
              disabled={isPending}
              className="btn-ref-primary small py-1 px-3"
            >
              <i className="bi bi-plus-lg me-1"></i>
              Start New Draft
            </button>
          </div>
        </div>
      )}

      {/* In-page Department Masterlist Panel */}
      {showMasterlist && renderMasterlistPanel()}

      {selectedBlockId ? (
        /* DETAILED SCHEDULE EDITOR FOR SELECTED BLOCK */
        <>
          {/* Schedule Editor Toolbar */}
          <ScheduleEditorToolbar
            terms={terms}
            currentTermId={currentTermId}
            currentTerm={currentTerm}
            blocks={blocks}
            selectedBlockId={selectedBlockId}
            selectedBlock={selectedBlock || undefined}
            draftVersion={draftVersion}
            versionName={versionNames[draftVersion.id]}
            versionNames={versionNames}
            versions={versions}
            scheduleStyle={scheduleStyle}
            zoomDensity={zoomDensity}
            showMasterlist={showMasterlist}
            isReadOnly={isReadOnly}
            isPending={isPending}
            isAiDrafting={isAiDrafting}
            isClearingBlock={isClearingBlock}
            isPublishing={isPublishing}
            hardViolationsCount={hardViolationsCount}
            softViolationsCount={softViolationsCount}
            selectedBlockEntriesCount={selectedBlockEntries.length}
            formatBlockLabel={formatBlockLabel}
            onBackToOverview={() => handleSelectBlock(null)}
            onRenameVersion={() => {
              setRenameDraftName(versionNames[draftVersion.id] || `Draft v${draftVersion.version_number}`);
              setIsRenameModalOpen(true);
            }}
            onSelectBlock={(bId) => handleSelectBlock(bId)}
            onSelectTerm={(tId) => router.push(`/scheduler/schedule?termId=${tId}`)}
            onSelectVersion={(vId) => {
              const targetParam = selectedBlockId ? `&blockId=${selectedBlockId}` : '';
              router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${vId}${targetParam}`);
            }}
            onSetScheduleStyle={setScheduleStyle}
            onSetZoomDensity={setZoomDensity}
            onToggleMasterlist={() => setShowMasterlist(!showMasterlist)}
            onToggleValidationPanel={() => setIsValidationPanelOpen(!isValidationPanelOpen)}
            onOpenVersionsModal={() => {}}
            onOpenAiAdjustments={() => {
              setAiScope('current');
              setIsAiModalOpen(true);
            }}
            onOpenClearBlockConfirm={() => setIsConfirmClearBlockOpen(true)}
            onOpenPublishConfirm={handleTriggerPublish}
          />

      {/* Unassigned Course Hours Tray */}
      {unassignedOfferings.length > 0 && (
        <div className="bg-white rounded-4 p-4 shadow-sm border border-warning border-opacity-25 mb-4">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <div className="d-flex align-items-center gap-2">
              <span className="badge rounded-circle bg-warning p-1"></span>
              <h6 className="fw-bold text-dark text-uppercase small mb-0">
                Unassigned Course Hours ({unassignedOfferings.length} courses require placement)
              </h6>
            </div>
            <span className="text-muted small">
              <i className="bi bi-arrows-move me-1 text-primary"></i>
              Drag any subject card directly onto a time slot in the weekly grid below
            </span>
          </div>

          <div className="row g-2">
            {unassignedOfferings.map((item) => {
              const isAllowed = isSubjectAllowed(item.offering.subject_id);
              const isDragging = draggingOfferingId === item.offering.id;
              const canDrag = !isReadOnly && isAllowed;
              return (
                <div key={item.offering.id} className="col-12 col-sm-6 col-md-4 col-lg-3">
                  <div
                    draggable={canDrag}
                    onDragStart={(e) => {
                      if (!canDrag) return;
                      setDraggingOfferingId(item.offering.id);
                      e.dataTransfer.setData('offeringId', item.offering.id);
                      e.dataTransfer.setData('text/plain', item.offering.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDragEnd={() => {
                      setDraggingOfferingId(null);
                      setDragOverSlot(null);
                    }}
                    className={`p-3 rounded-3 border h-100 d-flex flex-column justify-content-between small transition ${
                      !isAllowed
                        ? 'bg-light border-light-subtle opacity-75'
                        : isDragging
                        ? 'border-primary shadow bg-primary-subtle opacity-75'
                        : 'bg-light border-light-subtle hover-shadow'
                    }`}
                    style={{
                      cursor: !canDrag ? 'default' : 'grab',
                      userSelect: 'none',
                    }}
                    title={
                      !isAllowed
                        ? `${item.subject?.code} - Outside supervision scope`
                        : isReadOnly
                        ? `${item.subject?.code} - ${item.subject?.title}`
                        : `Drag onto any weekly grid slot below, or click Manual +`
                    }
                  >
                    <div>
                      <div className="d-flex align-items-start justify-content-between gap-1 mb-1">
                        <div
                          className="fw-bold text-dark text-truncate"
                          title={`${item.subject?.code} - ${item.subject?.title}`}
                        >
                          {item.subject?.code} - {item.subject?.title}
                        </div>
                        {!isAllowed ? (
                          <span
                            className="badge bg-secondary-subtle text-secondary border px-1.5 py-0.5"
                            style={{ fontSize: '9px' }}
                          >
                            <i className="bi bi-lock-fill me-1"></i>Locked
                          </span>
                        ) : !isReadOnly ? (
                          <span
                            className="badge bg-white text-secondary border px-1.5 py-0.5"
                            style={{ fontSize: '9px' }}
                          >
                            <i className="bi bi-arrows-move"></i>
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted mt-1" style={{ fontSize: '11px' }}>
                        Scheduled: {item.scheduledHours}h / {item.requiredHours}h
                        {item.subject && (item.subject.lecture_hours > 0 && item.subject.lab_hours > 0) && (
                          <span className="ms-1 text-secondary">
                            ({item.subject.lecture_hours}h Lec + {item.subject.lab_hours}h Lab)
                          </span>
                        )}
                      </div>
                      <div className="d-flex align-items-center justify-content-between mt-1">
                        <span className="text-warning fw-semibold" style={{ fontSize: '11px' }}>
                          {item.remainingHours}h unplaced
                        </span>
                        {item.nextSessionType && (
                          <span
                            className={`badge px-1.5 py-0.5 border ${
                              item.nextSessionType === 'lab'
                                ? 'bg-info-subtle text-info-emphasis border-info-subtle'
                                : 'bg-primary-subtle text-primary border-primary-subtle'
                            }`}
                            style={{ fontSize: '9px' }}
                            title={`Next drag places ${item.nextSessionType === 'lab' ? 'Laboratory' : 'Lecture'} session (${item.nextSessionDuration}h)`}
                          >
                            Next: {item.nextSessionType === 'lab' ? '🔬 Lab' : '📖 Lec'} ({item.nextSessionDuration}h)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="d-flex align-items-center justify-content-between mt-2 pt-2 border-top border-light-subtle">
                      {isAllowed ? (
                        <span
                          className="text-primary fw-semibold d-inline-flex align-items-center gap-1"
                          style={{ fontSize: '10.5px' }}
                        >
                          <i className="bi bi-arrows-move"></i> Drag to Grid
                        </span>
                      ) : (
                        <span
                          className="text-muted d-inline-flex align-items-center gap-1"
                          style={{ fontSize: '10.5px' }}
                        >
                          <i className="bi bi-shield-lock"></i> Restricted
                        </span>
                      )}
                      {!isReadOnly && isAllowed && (
                        <button
                          type="button"
                          onClick={() => {
                            handleOpenAdd(item.offering.id);
                          }}
                          className="btn btn-link btn-sm text-secondary p-0 text-decoration-none fw-semibold"
                          style={{ fontSize: '10.5px' }}
                          title="Or click to open placement modal directly"
                        >
                          Manual +
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Layout: Weekly Grid or Spreadsheet Style + Side Validation Panel */}
      <div className="row g-4 align-items-start">
        {/* Main Schedule View */}
        <div className={isValidationPanelOpen ? 'col-12 col-lg-9' : 'col-12'}>
          {scheduleStyle === 'spreadsheet' ? (
            <div>
              <div className="d-flex align-items-center justify-content-between mb-2 px-1">
                <div className="d-flex align-items-center gap-2">
                  <span className="small text-muted fw-semibold" style={{ fontSize: '11px' }}>
                    Spreadsheet Scope:
                  </span>
                  <div className="btn-group btn-group-sm" role="group">
                    <button
                      type="button"
                      onClick={() => setSpreadsheetShowAllBlocks(false)}
                      className={`btn btn-sm ${
                        !spreadsheetShowAllBlocks
                          ? 'btn-primary text-white shadow-sm'
                          : 'btn-outline-secondary bg-white text-secondary'
                      }`}
                      style={{ fontSize: '11px' }}
                    >
                      Current Block Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpreadsheetShowAllBlocks(true)}
                      className={`btn btn-sm ${
                        spreadsheetShowAllBlocks
                          ? 'btn-primary text-white shadow-sm'
                          : 'btn-outline-secondary bg-white text-secondary'
                      }`}
                      style={{ fontSize: '11px' }}
                    >
                      All Blocks in Department
                    </button>
                  </div>
                </div>
              </div>
              <SpreadsheetScheduleView
                entries={entries}
                offerings={initialOfferings}
                rooms={rooms}
                instructors={instructors}
                subjects={subjects}
                blocks={blocks}
                selectedBlockId={selectedBlockId}
                selectedTerm={currentTerm}
                isReadOnly={isReadOnly}
                lockToBlock={!spreadsheetShowAllBlocks}
                onEditEntry={handleOpenEdit}
                onDeleteEntry={handleDelete}
                onAddEntry={handleOpenAdd}
                onGenerateAiDraft={() =>
                  router.push(
                    `/scheduler/generate?termId=${currentTermId}${selectedBlockId ? `&blockId=${selectedBlockId}` : ''}`
                  )
                }
                isSubjectAllowed={isSubjectAllowed}
              />
            </div>
          ) : (
            <WeeklyTimetableGrid
              selectedBlock={selectedBlock}
              selectedBlockId={selectedBlockId}
              selectedBlockEntries={selectedBlockEntries}
              offerings={initialOfferings}
              blocks={blocks}
              subjects={subjects}
              instructors={instructors}
              rooms={rooms}
              isReadOnly={isReadOnly}
              zoomDensity={zoomDensity}
              violationsByEntryId={violationsByEntryId}
              highlightedEntryId={highlightedEntryId}
              dragOverSlot={dragOverSlot}
              activeDragContext={activeDragContext}
              draggingEntryId={draggingEntryId}
              draggingOfferingId={draggingOfferingId}
              setDragOverSlot={setDragOverSlot}
              setDraggingEntryId={setDraggingEntryId}
              setDraggingOfferingId={setDraggingOfferingId}
              onMoveEntryOnGrid={handleMoveEntryOnGrid}
              onDropOnGrid={handleDropOnGrid}
              onEditEntry={handleOpenEdit}
              onDeleteEntry={handleDelete}
              getSlotConflicts={getSlotConflicts}
              isSubjectAllowed={isSubjectAllowed}
              isSubjectUnspecified={isSubjectUnspecified}
              formatBlockLabel={formatBlockLabel}
            />
          )}
        </div>

        {/* Validation Side Panel */}
        {isValidationPanelOpen && (
          <div className="col-12 col-lg-3">
            <div className="bg-white rounded-4 shadow-sm border border-white p-4">
              <div className="d-flex align-items-center justify-content-between pb-3 border-bottom border-light mb-3">
                <h6 className="fw-bold text-dark mb-0 d-flex align-items-center gap-2">
                  <span>Conflict Engine Audit</span>
                  <span className="badge bg-light text-secondary border font-monospace">
                    {allViolations.length} total
                  </span>
                </h6>
                <button
                  type="button"
                  className="btn-close small"
                  onClick={() => setIsValidationPanelOpen(false)}
                ></button>
              </div>

              {/* Hard Violations Section */}
              <div className="mb-4">
                <div className="d-flex align-items-center gap-1 mb-1">
                  <span className="badge rounded-circle bg-danger p-1"></span>
                  <h6 className="fw-bold text-danger text-uppercase small mb-0">
                    Hard Conflicts ({hardViolationsCount})
                  </h6>
                </div>
                <p className="text-muted small mb-3">
                  Must be resolved before schedule can be published.
                </p>

                {hardViolationsCount === 0 ? (
                  <div className="p-3 rounded-3 bg-success-subtle border border-success-subtle text-success text-center small fw-semibold">
                    ✓ No hard conflicts detected!
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    {allViolations
                      .filter((v) => v.severity === 'hard')
                      .map((v, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            if (v.entryIds[0]) setHighlightedEntryId(v.entryIds[0]);
                          }}
                          className="p-2 rounded-3 bg-danger-subtle border border-danger-subtle text-danger small cursor-pointer"
                        >
                          <div className="fw-bold text-uppercase mb-1" style={{ fontSize: '10px' }}>
                            {v.rule.replace(/_/g, ' ')}
                          </div>
                          <p className="mb-0" style={{ fontSize: '11px' }}>{v.message}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Soft Violations Section */}
              <div className="pt-3 border-top border-light">
                <div className="d-flex align-items-center gap-1 mb-1">
                  <span className="badge rounded-circle bg-warning p-1"></span>
                  <h6 className="fw-bold text-warning text-uppercase small mb-0">
                    Advisory Warnings ({softViolationsCount})
                  </h6>
                </div>
                <p className="text-muted small mb-3">
                  Informational notifications that do not prevent publishing.
                </p>

                {softViolationsCount === 0 ? (
                  <div className="p-3 rounded-3 bg-light text-muted text-center small">
                    No advisory warnings.
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    {allViolations
                      .filter((v) => v.severity === 'soft')
                      .map((v, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            if (v.entryIds[0]) setHighlightedEntryId(v.entryIds[0]);
                          }}
                          className="p-2 rounded-3 bg-warning-subtle border border-warning-subtle text-dark small cursor-pointer"
                        >
                          <div className="fw-bold text-warning text-uppercase mb-1" style={{ fontSize: '10px' }}>
                            {v.rule.replace(/_/g, ' ')}
                          </div>
                          <p className="mb-0" style={{ fontSize: '11px' }}>{v.message}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  ) : (
    /* ========================================================================= */
    /* YEAR LEVEL & STUDENT BLOCK COHORTS OVERVIEW DASHBOARD                    */
    /* ========================================================================= */
    <div className="space-y-6">
      {/* Institutional Header Banner */}
      <div className="bg-white rounded-5 p-4 shadow-sm border border-light-subtle d-flex flex-column flex-lg-row align-items-start align-items-lg-center justify-content-between gap-4">
        <div>
          <div className="d-flex align-items-center gap-2 mb-1">
            <span
              className="d-inline-flex align-items-center justify-content-center text-white rounded-3 shadow-sm"
              style={{ width: '40px', height: '40px', backgroundColor: '#0E0AB8' }}
            >
              <i className="bi bi-calendar3 fs-5"></i>
            </span>
            <h4 className="fw-bold text-dark mb-0" style={{ letterSpacing: '-0.02em' }}>
              Schedule Editor &bull; Year Levels &amp; Student Blocks
            </h4>
          </div>
          <p className="text-secondary small mb-0 ms-md-5 ps-md-1">
            Select a year level and block cohort to view and edit its weekly grid schedule and spreadsheet timetable.
          </p>
        </div>

        <div className="d-flex flex-wrap align-items-center gap-2.5">
          {/* Term Switcher */}
          <div>
            <select
              value={currentTermId}
              onChange={(e) => {
                router.push(`/scheduler/schedule?termId=${e.target.value}`);
              }}
              className="form-select ref-form-control bg-white"
              style={{ minWidth: '200px' }}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.school_year} &bull; {t.semester} {t.is_current ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Version Switcher */}
          <div>
            <select
              value={draftVersion.id}
              onChange={(e) => {
                router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${e.target.value}`);
              }}
              className="form-select ref-form-control bg-white"
              style={{ minWidth: '160px' }}
            >
              {(versions || [draftVersion]).map((v) => (
                <option key={v.id} value={v.id}>
                  {versionNames[v.id] ? `${versionNames[v.id]} (v${v.version_number})` : `v${v.version_number}`} &bull; {v.status.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {!isReadOnly && (
            <Link
              href={`/scheduler/generate?termId=${currentTermId}${(!showMasterlist && selectedBlockId) ? `&blockId=${selectedBlockId}` : (showMasterlist && masterlistBlockFilter && masterlistBlockFilter !== 'all') ? `&blockId=${masterlistBlockFilter}` : ''}`}
              className="btn-ref-primary small py-2 px-3 d-flex align-items-center gap-1.5 text-decoration-none"
              title="Open Schedule Generator to configure filters and run algorithm"
            >
              <i className="bi bi-cpu"></i>
              <span>Generate Schedule</span>
            </Link>
          )}

          {!isReadOnly && entries.length > 0 && (
            <button
              type="button"
              onClick={() => setIsConfirmClearAllOpen(true)}
              disabled={isPending || isClearingAll}
              className="btn btn-sm btn-outline-danger py-2 px-3 rounded-pill d-flex align-items-center gap-1.5 fw-semibold shadow-xs"
              title={userRole === 'admin' ? 'Clear all scheduled classes across all cohorts in this draft' : `Clear scheduled classes in ${schedulerDepartment || 'your department'} scope`}
            >
              <i className="bi bi-trash3"></i>
              <span>{userRole === 'admin' ? 'Clear All Schedules' : 'Clear Scope Schedules'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMasterlist(!showMasterlist)}
            className={`btn-ref-secondary small py-2 px-3 d-flex align-items-center gap-1.5 ${
              showMasterlist ? 'bg-primary text-white border-primary shadow-sm' : ''
            }`}
            title="Open in-page department master schedule"
          >
            <i className={`bi bi-table ${showMasterlist ? 'text-white' : 'text-primary'}`}></i>
            <span>{showMasterlist ? 'Hide Masterlist' : 'Master Schedule'}</span>
          </button>
        </div>
      </div>

      {/* Metric Overview Row */}
      <div className="row g-3">
        <div className="col-6 col-md-3">
          <div className="p-3 bg-white rounded-4 border border-light-subtle shadow-sm h-100">
            <div className="text-muted small text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
              Academic Cohorts
            </div>
            <div className="d-flex align-items-baseline gap-2">
              <h3 className="fw-bold text-dark mb-0">{blocks.length}</h3>
              <span className="small text-muted">Student Blocks</span>
            </div>
          </div>
        </div>

        <div className="col-6 col-md-3">
          <div className="p-3 bg-white rounded-4 border border-light-subtle shadow-sm h-100">
            <div className="text-muted small text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
              Scheduled Classes
            </div>
            <div className="d-flex align-items-baseline gap-2">
              <h3 className="fw-bold text-primary mb-0">{entries.length}</h3>
              <span className="small text-muted">Sessions Placed</span>
            </div>
          </div>
        </div>

        <div className="col-6 col-md-3">
          <div className="p-3 bg-white rounded-4 border border-light-subtle shadow-sm h-100">
            <div className="text-muted small text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
              Curriculum Completion
            </div>
            <div className="d-flex align-items-baseline gap-2">
              <h3 className="fw-bold text-success mb-0">
                {blockSummaries.filter((b) => b.isComplete).length} / {blocks.length}
              </h3>
              <span className="small text-muted">Blocks 100% Filled</span>
            </div>
          </div>
        </div>

        <div className="col-6 col-md-3">
          <div className="p-3 bg-white rounded-4 border border-light-subtle shadow-sm h-100">
            <div className="text-muted small text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
              Conflict Engine
            </div>
            <div className="d-flex align-items-baseline gap-2">
              {hardViolationsCount === 0 ? (
                <>
                  <h3 className="fw-bold text-success mb-0">0</h3>
                  <span className="small text-success fw-semibold">Clean (0 Overlaps)</span>
                </>
              ) : (
                <>
                  <h3 className="fw-bold text-danger mb-0">{hardViolationsCount}</h3>
                  <span className="small text-danger fw-semibold">Conflicts Detected</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Year Level Groupings with Interactive Block Cards */}
      <div className="space-y-4">
        {yearLevelGroups.map((group) => {
          const isHsGroup = Boolean(group.isHighSchool);
          return (
            <div
              key={group.title}
              className={`bg-white rounded-5 p-4 shadow-sm border ${
                isHsGroup ? 'border-success border-opacity-25' : 'border-light-subtle'
              }`}
            >
              <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom border-light">
                <div className="d-flex align-items-center gap-2">
                  <span
                    className="badge rounded-circle p-1.5"
                    style={{ backgroundColor: isHsGroup ? '#16a34a' : '#0E0AB8' }}
                  ></span>
                  <h5 className="fw-bold text-dark mb-0">
                    {group.title}
                  </h5>
                  <span
                    className={`badge rounded-pill px-2.5 py-1 small ${
                      isHsGroup
                        ? 'bg-success-subtle text-success border border-success-subtle fw-semibold'
                        : 'bg-light text-secondary border'
                    }`}
                  >
                    {isHsGroup ? 'High School Department' : `${group.blocks.length} ${group.blocks.length === 1 ? 'Block' : 'Blocks'}`}
                  </span>
                </div>
                <span className="text-muted small">
                  Click any block to open its weekly schedule &amp; spreadsheet
                </span>
              </div>

              <div className="row g-3">
                {group.blocks.map((bs) => {
                  const b = bs.block;
                  const pct = bs.offeringsCount > 0
                    ? Math.round((bs.scheduledCount / bs.offeringsCount) * 100)
                    : 0;

                  return (
                    <div key={b.id} className="col-12 col-md-6 col-xl-3">
                      <div
                        onClick={() => handleSelectBlock(b.id)}
                        className="p-3.5 rounded-4 border transition h-100 d-flex flex-column justify-content-between shadow-xs"
                        style={{
                          cursor: 'pointer',
                          borderColor: isHsGroup ? '#bbf7d0' : '#e2e8f0',
                          backgroundColor: '#ffffff',
                          transition: 'all 0.18s ease-in-out',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = isHsGroup ? '#16a34a' : '#0E0AB8';
                          e.currentTarget.style.transform = 'translateY(-3px)';
                          e.currentTarget.style.boxShadow = isHsGroup
                            ? '0 10px 20px rgba(22, 163, 74, 0.12)'
                            : '0 10px 20px rgba(14, 10, 184, 0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = isHsGroup ? '#bbf7d0' : '#e2e8f0';
                          e.currentTarget.style.transform = 'none';
                          e.currentTarget.style.boxShadow = '';
                        }}
                      >
                        <div>
                          {/* Top Header of Card */}
                          <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                            <h5 className="fw-bold text-dark mb-0">
                              {formatBlockLabel(b)}
                            </h5>

                            {/* Status Badge */}
                            {bs.isComplete ? (
                              <span className="badge bg-success-subtle text-success border border-success-subtle" style={{ fontSize: '10px' }}>
                                <i className="bi bi-check-circle-fill me-1"></i>Complete
                              </span>
                            ) : bs.hardCount > 0 ? (
                              <span className="badge bg-danger-subtle text-danger border border-danger-subtle" style={{ fontSize: '10px' }}>
                                <i className="bi bi-exclamation-octagon-fill me-1"></i>{bs.hardCount} Conflicts
                              </span>
                            ) : bs.unscheduledCount > 0 ? (
                              <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle" style={{ fontSize: '10px' }}>
                                <i className="bi bi-clock-history me-1"></i>{bs.unscheduledCount} Left
                              </span>
                            ) : (
                              <span className="badge bg-secondary-subtle text-secondary" style={{ fontSize: '10px' }}>
                                No Classes
                              </span>
                            )}
                          </div>

                          {/* Progress Bar */}
                          <div className="mb-3">
                            <div className="d-flex align-items-center justify-content-between small text-muted mb-1" style={{ fontSize: '11px' }}>
                              <span>Curriculum Placement</span>
                              <span className="fw-bold text-dark">{bs.scheduledCount}/{bs.offeringsCount} ({pct}%)</span>
                            </div>
                            <div className="progress" style={{ height: '6px' }}>
                              <div
                                className={`progress-bar ${pct === 100 ? 'bg-success' : pct > 0 ? (isHsGroup ? 'bg-success' : 'bg-primary') : 'bg-secondary'}`}
                                role="progressbar"
                                style={{ width: `${pct}%`, ...(isHsGroup && pct > 0 && pct < 100 ? { backgroundColor: '#16a34a' } : {}) }}
                                aria-valuenow={pct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              ></div>
                            </div>
                          </div>
                        </div>

                        {/* Action Button */}
                        <button
                          type="button"
                          className={`btn btn-sm ${
                            isHsGroup ? 'btn-outline-success' : 'btn-outline-primary'
                          } w-100 d-flex align-items-center justify-content-center gap-1.5 fw-semibold py-1.5 rounded-3`}
                        >
                          <span>Open Schedule Editor</span>
                          <i className="bi bi-arrow-right"></i>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  )}

      {/* Add / Edit Entry Modal (Spreadsheet Style 3-Column Layout) */}
      <FormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingEntry ? 'Edit Class Schedule Entry' : (modalError ? 'Edit Class Schedule Entry' : 'Add Class Schedule Entry')}
        description="Assign schedule timing, subject, room, and faculty member following the spreadsheet program layout."
        onSubmit={handleSubmit}
        isSubmitting={isPending}
        error={modalError}
        submitLabel={editingEntry ? 'Update Entry' : 'Save Entry'}
        size="xl"
      >
        <div className="row g-4">
          {/* Column 1: SCHEDULE (DAY & TIME) */}
          <div className="col-12 col-lg-4">
            <div className="p-3 bg-light rounded-4 border h-100">
              <div
                className="d-flex align-items-center gap-2 px-3 py-1.5 rounded-3 mb-3 text-white fw-bold small text-uppercase"
                style={{ backgroundColor: '#00a2e8', letterSpacing: '0.5px' }}
              >
                <i className="bi bi-calendar3-range"></i>
                <span>1. Schedule & Time</span>
              </div>

              {/* Day Pattern Selector (Single Day, MW, TTH) */}
              <div className="mb-3">
                <label className="form-label small fw-semibold text-secondary mb-1">
                  Schedule Day Pattern
                </label>
                <div className="d-flex gap-1 p-1 bg-white rounded-3 border">
                  <button
                    type="button"
                    onClick={() => handlePatternChange('single')}
                    className={`btn btn-sm flex-fill rounded-2 border-0 fw-semibold text-xs py-1.5 ${
                      scheduleDayPattern === 'single'
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-secondary hover:text-dark'
                    }`}
                  >
                    Single Day
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePatternChange('MW')}
                    className={`btn btn-sm flex-fill rounded-2 border-0 fw-semibold text-xs py-1.5 ${
                      scheduleDayPattern === 'MW'
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-secondary hover:text-dark'
                    }`}
                  >
                    MW (Mon/Wed)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePatternChange('TTH')}
                    className={`btn btn-sm flex-fill rounded-2 border-0 fw-semibold text-xs py-1.5 ${
                      scheduleDayPattern === 'TTH'
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-secondary hover:text-dark'
                    }`}
                  >
                    TTH (Tue/Thu)
                  </button>
                </div>
              </div>

              {/* Two Sessions Display (e.g. Lec + Lab or MW / TTH split) */}
              {hasSecondSession ? (
                <>
                  {/* Session 1 Card */}
                  <div className="p-3 bg-white rounded-3 border mb-3 shadow-xs">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 fw-bold text-xs">
                        Session 1 {scheduleDayPattern === 'MW' ? '(Monday)' : scheduleDayPattern === 'TTH' ? '(Tuesday)' : `(${formData.session_type === 'lecture' ? 'Lecture' : 'Lab'})`}
                      </span>
                      {scheduleDayPattern === 'single' && (
                        <select
                          value={formData.session_type}
                          onChange={(e) => {
                            const st = e.target.value as 'lecture' | 'lab';
                            const curOff = initialOfferings.find((o) => o.id === formData.offering_id);
                            const curSub = subjects.find((s) => s.id === curOff?.subject_id);
                            const dur = getSubjectSessionDurationMinutes(curSub, st, scheduleDayPattern);
                            setFormData((prev) => ({
                              ...prev,
                              session_type: st,
                              end_time: calculateEndTime(prev.start_time, dur),
                            }));
                          }}
                          className="form-select form-select-sm py-0 px-2 text-xs w-auto border-light-subtle"
                        >
                          <option value="lecture">Lecture</option>
                          <option value="lab">Lab</option>
                        </select>
                      )}
                    </div>

                    {scheduleDayPattern === 'single' && (
                      <div className="mb-2">
                        <label className="form-label text-muted text-xs mb-1">Day of Week</label>
                        <select
                          value={formData.day_of_week}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              day_of_week: parseInt(e.target.value, 10),
                            }))
                          }
                          className="form-select form-select-sm ref-form-control bg-white"
                        >
                          {DAYS.map((d) => (
                            <option key={d.index} value={d.index}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="row g-2">
                      <div className="col-6">
                        <label className="form-label text-muted text-xs mb-1">Start Time</label>
                        <RadialTimePicker
                          value={formData.start_time}
                          onChange={handleSession1StartChange}
                        />
                      </div>
                      <div className="col-6">
                        <label className="form-label text-muted text-xs mb-1">End Time</label>
                        <RadialTimePicker
                          value={formData.end_time}
                          onChange={(newEnd) =>
                            setFormData((prev) => ({ ...prev, end_time: newEnd }))
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sync sessions toggle */}
                  <div className="d-flex align-items-center justify-content-between px-1 mb-2">
                    <div className="form-check form-switch mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        id="syncTimesSwitch"
                        checked={syncSessionsTime}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSyncSessionsTime(checked);
                          if (checked) {
                            handleSession1StartChange(formData.start_time);
                          }
                        }}
                      />
                      <label
                        className="form-check-label text-secondary small text-xs"
                        htmlFor="syncTimesSwitch"
                        style={{ cursor: 'pointer' }}
                      >
                        Lock &amp; sync start times
                      </label>
                    </div>
                    <span className="text-muted text-xs">
                      {scheduleDayPattern === 'MW'
                        ? 'Mon & Wed'
                        : scheduleDayPattern === 'TTH'
                        ? 'Tue & Thu'
                        : 'Paired Sessions'}
                    </span>
                  </div>

                  {/* Session 2 Card */}
                  <div className="p-3 bg-white rounded-3 border mb-2 shadow-xs">
                    <div className="d-flex align-items-center justify-content-between mb-2">
                      <span className="badge bg-info-subtle text-info border border-info-subtle px-2 py-1 fw-bold text-xs">
                        Session 2 {scheduleDayPattern === 'MW' ? '(Wednesday)' : scheduleDayPattern === 'TTH' ? '(Thursday)' : `(${session2Data.session_type === 'lab' ? 'Laboratory' : 'Lecture'})`}
                      </span>
                      {scheduleDayPattern === 'single' && (
                        <select
                          value={session2Data.session_type}
                          onChange={(e) => {
                            const st = e.target.value as 'lecture' | 'lab';
                            const curOff = initialOfferings.find((o) => o.id === formData.offering_id);
                            const curSub = subjects.find((s) => s.id === curOff?.subject_id);
                            const dur = getSubjectSessionDurationMinutes(curSub, st, scheduleDayPattern);
                            setSession2Data((prev) => ({
                              ...prev,
                              session_type: st,
                              end_time: calculateEndTime(prev.start_time, dur),
                            }));
                          }}
                          className="form-select form-select-sm py-0 px-2 text-xs w-auto border-light-subtle"
                        >
                          <option value="lab">Lab</option>
                          <option value="lecture">Lecture</option>
                        </select>
                      )}
                    </div>

                    {scheduleDayPattern === 'single' && (
                      <div className="mb-2">
                        <label className="form-label text-muted text-xs mb-1">Day of Week</label>
                        <select
                          value={session2Data.day_of_week}
                          onChange={(e) =>
                            setSession2Data((prev) => ({
                              ...prev,
                              day_of_week: parseInt(e.target.value, 10),
                            }))
                          }
                          className="form-select form-select-sm ref-form-control bg-white"
                        >
                          {DAYS.map((d) => (
                            <option key={d.index} value={d.index}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="row g-2">
                      <div className="col-6">
                        <label className="form-label text-muted text-xs mb-1">Start Time</label>
                        <RadialTimePicker
                          value={session2Data.start_time}
                          onChange={handleSession2StartChange}
                          disabled={syncSessionsTime}
                        />
                      </div>
                      <div className="col-6">
                        <label className="form-label text-muted text-xs mb-1">End Time</label>
                        <RadialTimePicker
                          value={session2Data.end_time}
                          onChange={(newEnd) =>
                            setSession2Data((prev) => ({ ...prev, end_time: newEnd }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Single Session Display */
                <div className="p-3 bg-white rounded-3 border mb-2 shadow-xs">
                  {/* Day of Week */}
                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary">
                      Day of Week
                    </label>
                    <select
                      value={formData.day_of_week}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          day_of_week: parseInt(e.target.value, 10),
                        }))
                      }
                      className="form-select ref-form-control bg-white"
                    >
                      {DAYS.map((d) => (
                        <option key={d.index} value={d.index}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Session Type */}
                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary">
                      Session Type
                    </label>
                    <select
                      value={formData.session_type}
                      onChange={(e) => {
                        const st = e.target.value as 'lecture' | 'lab';
                        const curOff = initialOfferings.find((o) => o.id === formData.offering_id);
                        const curSub = subjects.find((s) => s.id === curOff?.subject_id);
                        const dur = getSubjectSessionDurationMinutes(curSub, st, scheduleDayPattern);
                        setFormData((prev) => ({
                          ...prev,
                          session_type: st,
                          end_time: calculateEndTime(prev.start_time, dur),
                        }));
                      }}
                      className="form-select ref-form-control bg-white"
                    >
                      <option value="lecture">Lecture Session</option>
                      <option value="lab">Laboratory Session</option>
                    </select>
                  </div>

                  {/* Start & End Time */}
                  <div className="row g-2">
                    <div className="col-6">
                      <label className="form-label small fw-semibold text-secondary">
                        Start Time
                      </label>
                      <RadialTimePicker
                        value={formData.start_time}
                        onChange={handleSession1StartChange}
                      />
                    </div>
                    <div className="col-6">
                      <label className="form-label small fw-semibold text-secondary">
                        End Time
                      </label>
                      <RadialTimePicker
                        value={formData.end_time}
                        onChange={(newEnd) =>
                          setFormData((prev) => ({ ...prev, end_time: newEnd }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Column 2: SUBJECT & BLOCK */}
          <div className="col-12 col-lg-4">
            <div className="p-3 bg-light rounded-4 border h-100">
              <div
                className="d-flex align-items-center gap-2 px-3 py-1.5 rounded-3 mb-3 text-white fw-bold small text-uppercase"
                style={{ backgroundColor: '#00a2e8', letterSpacing: '0.5px' }}
              >
                <i className="bi bi-book"></i>
                <span>2. Subject &amp; Block</span>
              </div>

              {/* Subject */}
              <div className="mb-3">
                <label className="form-label small fw-semibold text-secondary">
                  Subject
                </label>
                <select
                  value={formData.offering_id || availableOfferings[0]?.id || ''}
                  onChange={(e) => {
                    const newOffId = e.target.value;
                    const targetOff = initialOfferings.find((o) => o.id === newOffId);
                    const targetSub = subjects.find((s) => s.id === targetOff?.subject_id);
                    const qualInst = instructors.find((inst) =>
                      (inst.instructor_qualifications || []).some((q) => q.subject_id === targetSub?.id)
                    );
                    const isPairCourse =
                      (targetSub?.lecture_hours === 1.5 && targetSub?.lab_hours === 1.5) ||
                      targetSub?.lecture_hours === 3;
                    const pat = isPairCourse ? 'MW' : scheduleDayPattern;
                    const has2 = Boolean(
                      (targetSub && targetSub.lecture_hours > 0 && targetSub.lab_hours > 0) ||
                      pat !== 'single'
                    );
                    setScheduleDayPattern(pat);
                    setHasSecondSession(has2);
                    const dur1 = getSubjectSessionDurationMinutes(targetSub, 'lecture', pat);
                    const dur2 = getSubjectSessionDurationMinutes(targetSub, targetSub?.requires_lab ? 'lab' : 'lecture', pat);
                    const sTime = formData.start_time || '08:00';
                    setFormData((prev) => ({
                      ...prev,
                      offering_id: newOffId,
                      instructor_id: qualInst?.id || prev.instructor_id,
                      end_time: calculateEndTime(sTime, dur1),
                    }));
                    setSession2Data((prev) => ({
                      ...prev,
                      instructor_id: qualInst?.id || prev.instructor_id,
                      start_time: sTime,
                      end_time: calculateEndTime(sTime, dur2),
                    }));
                  }}
                  className="form-select ref-form-control bg-white"
                >
                  {availableOfferings.map((off) => {
                    const sub = subjects.find((s) => s.id === off.subject_id);
                    return (
                      <option key={off.id} value={off.id}>
                        {sub?.code} - {sub?.title}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Student Block info */}
              {selectedOffering && (
                <div className="p-3 bg-white rounded-3 border mb-3">
                  <div className="text-muted small text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
                    Target Student Block
                  </div>
                  {(() => {
                    const blk = blocks.find((b) => b.id === selectedOffering.block_id);
                    return (
                      <div className="fw-bold text-dark">
                        {formatBlockLabel(blk)}
                      </div>
                    );
                  })()}
                  {selectedSubject && (
                    <div className="text-secondary small mt-1">
                      {selectedSubject.units} Units &bull; {selectedSubject.lecture_hours}h Lecture / {selectedSubject.lab_hours}h Lab
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Column 3: ROOM & TEACHER */}
          <div className="col-12 col-lg-4">
            <div className="p-3 bg-light rounded-4 border h-100">
              <div
                className="d-flex align-items-center gap-2 px-3 py-1.5 rounded-3 mb-3 text-white fw-bold small text-uppercase"
                style={{ backgroundColor: '#00a2e8', letterSpacing: '0.5px' }}
              >
                <i className="bi bi-geo-alt"></i>
                <span>3. Room & Teacher</span>
              </div>

              {hasSecondSession ? (
                <>
                  {/* Session 1 Room & Teacher */}
                  {(() => {
                    const curOff = initialOfferings.find((o) => o.id === (formData.offering_id || availableOfferings[0]?.id));
                    const curSub = subjects.find((s) => s.id === curOff?.subject_id);
                    const isUnspecified = isSubjectUnspecified(curSub?.id) || isSubjectUnspecified(curSub?.code);
                    const naRoomId = '00000000-0000-0000-0000-000000000000';

                    return (
                      <>
                        <div className="p-3 bg-white rounded-3 border mb-3 shadow-xs">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-0.5 fw-bold text-xs">
                              Session 1 {scheduleDayPattern === 'MW' ? '(Mon)' : scheduleDayPattern === 'TTH' ? '(Tue)' : `(${formData.session_type === 'lecture' ? 'Lec' : 'Lab'})`}
                            </span>
                            {isUnspecified ? (
                              <span className="badge bg-secondary-subtle text-secondary border px-2 py-0.5" style={{ fontSize: '10px' }}>
                                Unspecified Room (N/A)
                              </span>
                            ) : (
                              <div className="form-check form-check-inline mb-0">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  id="noRoomCheck1"
                                  checked={isNoRoom}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setIsNoRoom(checked);
                                    if (checked) {
                                      setFormData((prev) => ({ ...prev, room_id: '' }));
                                    } else {
                                      setFormData((prev) => ({
                                        ...prev,
                                        room_id: availableRooms[0]?.id || rooms[0]?.id || '',
                                      }));
                                    }
                                  }}
                                />
                                <label className="form-check-label text-secondary" htmlFor="noRoomCheck1" style={{ fontSize: '11px', cursor: 'pointer' }}>
                                  No room / off-site
                                </label>
                              </div>
                            )}
                          </div>

                          <div className="mb-2">
                            <label className="form-label text-muted text-xs mb-1">Classroom / Facility</label>
                            <select
                              disabled={isUnspecified || isNoRoom}
                              value={isUnspecified ? naRoomId : isNoRoom ? '' : (formData.room_id || availableRooms[0]?.id || rooms[0]?.id || '')}
                              onChange={(e) => setFormData((prev) => ({ ...prev, room_id: e.target.value }))}
                              className="form-select form-select-sm ref-form-control bg-white"
                            >
                              {isUnspecified ? (
                                <option value={naRoomId}>None (N/A - Unspecified Room)</option>
                              ) : isNoRoom ? (
                                <option value="">(Off-site session)</option>
                              ) : (
                                availableRooms.map((r) => {
                                  if (r.name === 'None (N/A)') return null;
                                  const depts = r.allowed_departments || (r.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
                                  const isShared = depts.includes('BSIT') && depts.includes('High School');
                                  const deptTag = isShared ? '[Shared]' : `[${depts.join(', ')}]`;
                                  const isOcc = entries.some(
                                    (e) =>
                                      (!editingEntry || e.id !== editingEntry.id) &&
                                      e.day_of_week === formData.day_of_week &&
                                      e.room_id === r.id &&
                                      timeRangesOverlap(e.start_time, e.end_time, formData.start_time, formData.end_time)
                                  );
                                  return (
                                    <option key={r.id} value={r.id}>
                                      {r.name} ({r.room_type === 'laboratory' ? 'Lab' : 'Lec'}) {deptTag} {isOcc ? '⚠️ Occupied' : '✓ Available'}
                                    </option>
                                  );
                                })
                              )}
                            </select>
                            {isUnspecified && (
                              <div className="text-muted fst-italic mt-1" style={{ fontSize: '11px' }}>
                                <i className="bi bi-info-circle me-1"></i>
                                This subject is configured with an unspecified room and never takes any classroom facility.
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="form-label text-muted text-xs mb-1">Assigned Instructor</label>
                            <select
                              value={formData.instructor_id}
                              onChange={(e) => setFormData((prev) => ({ ...prev, instructor_id: e.target.value }))}
                              required
                              className="form-select form-select-sm ref-form-control bg-white"
                            >
                              <option value="" disabled>-- Select Faculty --</option>
                              {qualifiedInstructors.map((inst) => {
                                const isBusy = entries.some(
                                  (e) =>
                                    (!editingEntry || e.id !== editingEntry.id) &&
                                    e.day_of_week === formData.day_of_week &&
                                    e.instructor_id === inst.id &&
                                    timeRangesOverlap(e.start_time, e.end_time, formData.start_time, formData.end_time)
                                );
                                const hasAvail = (inst.instructor_availability || []).some(
                                  (a) =>
                                    a.day_of_week === formData.day_of_week &&
                                    isTimeRangeWithin(formData.start_time, formData.end_time, a.start_time, a.end_time)
                                );
                                const statusLabel = isBusy
                                  ? '⚠️ Occupied (Teaching)'
                                  : hasAvail
                                  ? '✓ Available'
                                  : '(Check Availability)';
                                return (
                                  <option key={inst.id} value={inst.id}>
                                    {inst.full_name} &bull; {statusLabel}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        </div>

                        {/* Session 2 Room & Teacher */}
                        <div className="p-3 bg-white rounded-3 border mb-3 shadow-xs">
                          <div className="d-flex align-items-center justify-content-between mb-2">
                            <span className="badge bg-info-subtle text-info border border-info-subtle px-2 py-0.5 fw-bold text-xs">
                              Session 2 {scheduleDayPattern === 'MW' ? '(Wed)' : scheduleDayPattern === 'TTH' ? '(Thu)' : `(${session2Data.session_type === 'lab' ? 'Lab' : 'Lec'})`}
                            </span>
                            {isUnspecified ? (
                              <span className="badge bg-secondary-subtle text-secondary border px-2 py-0.5" style={{ fontSize: '10px' }}>
                                Unspecified Room (N/A)
                              </span>
                            ) : (
                              <div className="form-check form-check-inline mb-0">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  id="noRoomCheck2"
                                  checked={isSecondNoRoom}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setIsSecondNoRoom(checked);
                                    if (checked) {
                                      setSession2Data((prev) => ({ ...prev, room_id: '' }));
                                    } else {
                                      const labRoom = availableRooms.find((r) => r.room_type === 'laboratory');
                                      setSession2Data((prev) => ({
                                        ...prev,
                                        room_id: labRoom?.id || availableRooms[0]?.id || rooms[0]?.id || '',
                                      }));
                                    }
                                  }}
                                />
                                <label className="form-check-label text-secondary" htmlFor="noRoomCheck2" style={{ fontSize: '11px', cursor: 'pointer' }}>
                                  No room / off-site
                                </label>
                              </div>
                            )}
                          </div>

                          <div className="mb-2">
                            <label className="form-label text-muted text-xs mb-1">Classroom / Facility</label>
                            <select
                              disabled={isUnspecified || isSecondNoRoom}
                              value={isUnspecified ? naRoomId : isSecondNoRoom ? '' : (session2Data.room_id || availableRooms[0]?.id || rooms[0]?.id || '')}
                              onChange={(e) => setSession2Data((prev) => ({ ...prev, room_id: e.target.value }))}
                              className="form-select form-select-sm ref-form-control bg-white"
                            >
                              {isUnspecified ? (
                                <option value={naRoomId}>None (N/A - Unspecified Room)</option>
                              ) : isSecondNoRoom ? (
                                <option value="">(Off-site session)</option>
                              ) : (
                                availableRooms.map((r) => {
                                  if (r.name === 'None (N/A)') return null;
                                  const depts = r.allowed_departments || (r.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
                                  const isShared = depts.includes('BSIT') && depts.includes('High School');
                                  const deptTag = isShared ? '[Shared]' : `[${depts.join(', ')}]`;
                                  const isOcc2 = entries.some(
                                    (e) =>
                                      (!secondEntry || e.id !== secondEntry.id) &&
                                      e.day_of_week === session2Data.day_of_week &&
                                      e.room_id === r.id &&
                                      timeRangesOverlap(e.start_time, e.end_time, session2Data.start_time, session2Data.end_time)
                                  );
                                  return (
                                    <option key={r.id} value={r.id}>
                                      {r.name} ({r.room_type === 'laboratory' ? 'Lab' : 'Lec'}) {deptTag} {isOcc2 ? '⚠️ Occupied' : '✓ Available'}
                                    </option>
                                  );
                                })
                              )}
                            </select>
                            {isUnspecified && (
                              <div className="text-muted fst-italic mt-1" style={{ fontSize: '11px' }}>
                                <i className="bi bi-info-circle me-1"></i>
                                This subject is configured with an unspecified room and never takes any classroom facility.
                              </div>
                            )}
                          </div>

                    <div>
                      <label className="form-label text-muted text-xs mb-1">Assigned Instructor</label>
                      <select
                        value={session2Data.instructor_id}
                        onChange={(e) => setSession2Data((prev) => ({ ...prev, instructor_id: e.target.value }))}
                        required
                        className="form-select form-select-sm ref-form-control bg-white"
                      >
                        <option value="" disabled>-- Select Faculty --</option>
                        {qualifiedInstructors.map((inst) => {
                          const isBusy2 = entries.some(
                            (e) =>
                              (!secondEntry || e.id !== secondEntry.id) &&
                              e.day_of_week === session2Data.day_of_week &&
                              e.instructor_id === inst.id &&
                              timeRangesOverlap(e.start_time, e.end_time, session2Data.start_time, session2Data.end_time)
                          );
                          const hasAvail2 = (inst.instructor_availability || []).some(
                            (a) =>
                              a.day_of_week === session2Data.day_of_week &&
                              isTimeRangeWithin(session2Data.start_time, session2Data.end_time, a.start_time, a.end_time)
                          );
                          const statusLabel2 = isBusy2
                            ? '⚠️ Occupied (Teaching)'
                            : hasAvail2
                            ? '✓ Available'
                            : '(Check Availability)';
                          return (
                            <option key={inst.id} value={inst.id}>
                              {inst.full_name} &bull; {statusLabel2}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        ) : (
                /* Single Session Room & Teacher */
                <>
                  {/* Room & Facility */}
                  {(() => {
                    const curOff = initialOfferings.find((o) => o.id === (formData.offering_id || availableOfferings[0]?.id));
                    const curSub = subjects.find((s) => s.id === curOff?.subject_id);
                    const isUnspecified = isSubjectUnspecified(curSub?.id) || isSubjectUnspecified(curSub?.code);
                    const naRoomId = '00000000-0000-0000-0000-000000000000';

                    return (
                      <div className="mb-3">
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <label className="form-label small fw-semibold text-secondary mb-0">
                            Classroom / Laboratory
                          </label>
                          {isUnspecified ? (
                            <span className="badge bg-secondary-subtle text-secondary border px-2 py-0.5" style={{ fontSize: '10px' }}>
                              Unspecified Room (N/A)
                            </span>
                          ) : (
                            <div className="form-check form-check-inline mb-0">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id="noRoomCheck"
                                checked={isNoRoom}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setIsNoRoom(checked);
                                  if (checked) {
                                    setFormData((prev) => ({ ...prev, room_id: '' }));
                                  } else {
                                    setFormData((prev) => ({
                                      ...prev,
                                      room_id: availableRooms[0]?.id || rooms[0]?.id || '',
                                    }));
                                  }
                                }}
                              />
                              <label className="form-check-label small text-secondary" htmlFor="noRoomCheck" style={{ fontSize: '12px', cursor: 'pointer' }}>
                                No room / off-site
                              </label>
                            </div>
                          )}
                        </div>
                        <select
                          disabled={isUnspecified || isNoRoom}
                          value={isUnspecified ? naRoomId : isNoRoom ? '' : (formData.room_id || availableRooms[0]?.id || rooms[0]?.id || '')}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, room_id: e.target.value }))
                          }
                          className="form-select ref-form-control bg-white"
                        >
                          {isUnspecified ? (
                            <option value={naRoomId}>None (N/A - Unspecified Room)</option>
                          ) : isNoRoom ? (
                            <option value="">(No facility required &mdash; off-site session)</option>
                          ) : (
                            availableRooms.map((r) => {
                              if (r.name === 'None (N/A)') return null;
                              const depts = r.allowed_departments || (r.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
                              const isShared = depts.includes('BSIT') && depts.includes('High School');
                              const deptTag = isShared ? '[Shared]' : `[${depts.join(', ')}]`;
                              const isOcc = entries.some(
                                (e) =>
                                  (!editingEntry || e.id !== editingEntry.id) &&
                                  e.day_of_week === formData.day_of_week &&
                                  e.room_id === r.id &&
                                  timeRangesOverlap(e.start_time, e.end_time, formData.start_time, formData.end_time)
                              );
                              return (
                                <option key={r.id} value={r.id}>
                                  {r.name} ({r.room_type === 'laboratory' ? 'Lab' : 'Lec'}) {deptTag} {isOcc ? '⚠️ Occupied' : '✓ Available'}
                                </option>
                              );
                            })
                          )}
                        </select>
                        {isUnspecified && (
                          <div className="text-muted fst-italic mt-1" style={{ fontSize: '11px' }}>
                            <i className="bi bi-info-circle me-1"></i>
                            This subject is configured with an unspecified room and never takes any classroom facility.
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Instructor */}
                  <div className="mb-3">
                    <div className="d-flex align-items-center justify-content-between mb-1">
                      <label className="form-label small fw-semibold text-secondary mb-0">
                        Assigned Instructor
                      </label>
                      <span className="badge bg-success-subtle text-success border border-success-subtle" style={{ fontSize: '10px' }}>
                        Qualified Faculty Only
                      </span>
                    </div>
                    <select
                      value={formData.instructor_id}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, instructor_id: e.target.value }))
                      }
                      required
                      className="form-select ref-form-control bg-white"
                    >
                      <option value="" disabled>
                        -- Select Qualified Faculty --
                      </option>
                      {qualifiedInstructors.map((inst) => {
                        const isBusy = entries.some(
                          (e) =>
                            (!editingEntry || e.id !== editingEntry.id) &&
                            e.day_of_week === formData.day_of_week &&
                            e.instructor_id === inst.id &&
                            timeRangesOverlap(e.start_time, e.end_time, formData.start_time, formData.end_time)
                        );
                        const hasAvail = (inst.instructor_availability || []).some(
                          (a) =>
                            a.day_of_week === formData.day_of_week &&
                            isTimeRangeWithin(formData.start_time, formData.end_time, a.start_time, a.end_time)
                        );
                        const statusLabel = isBusy
                          ? '⚠️ Occupied (Teaching)'
                          : hasAvail
                          ? '✓ Available'
                          : '(Check Availability)';

                        return (
                          <option key={inst.id} value={inst.id}>
                            {inst.full_name} &bull; {statusLabel}
                          </option>
                        );
                      })}
                    </select>
                    {qualifiedInstructors.length === 0 ? (
                      <p className="text-danger small mt-1 mb-0" style={{ fontSize: '11px' }}>
                        <i className="bi bi-exclamation-triangle-fill me-1"></i>
                        No faculty members are qualified for {selectedSubject?.code || 'this subject'}. Please configure faculty qualifications in Subjects or Instructors settings.
                      </p>
                    ) : (
                      <p className="text-muted small mt-1 mb-0" style={{ fontSize: '11px' }}>
                        Only instructors qualified to teach {selectedSubject?.code || 'this subject'} are selectable.
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Scheduler Notes (Optional) */}
              <div className="mb-2">
                <label className="form-label small fw-semibold text-secondary">
                  Scheduler Notes <span className="text-muted fw-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  value={formData.notes || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  placeholder="e.g. Field work, off-campus practicum, hybrid setup..."
                  className="form-control ref-form-control bg-white"
                  style={{ fontSize: '12.5px' }}
                />
                <span className="text-muted small" style={{ fontSize: '11px' }}>
                  Scheduler reference note. Displays an indicator badge on the weekly grid cell.
                </span>
              </div>
            </div>
          </div>
        </div>
      </FormModal>

      {/* AI Schedule Adjustments Modal */}
      <FormModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        title="AI Schedule Adjustments"
        description="Request schedule adjustments or modifications for the selected block using AI."
        onSubmit={(e) => {
          e.preventDefault();
          handleExecuteAiDraft('refine');
        }}
        isSubmitting={isAiDrafting}
        submitLabel="Apply Adjustments"
        size="md"
        customFooter={
          <div className="d-flex align-items-center justify-content-between gap-2 w-100">
            <button
              type="button"
              onClick={() => setIsAiModalOpen(false)}
              disabled={isAiDrafting}
              className="btn btn-outline-secondary btn-sm py-2 px-3 rounded-pill"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleExecuteAiDraft('refine')}
              disabled={isAiDrafting || !aiPromptNotes.trim()}
              className="btn text-white btn-sm rounded-pill py-2 px-4 d-flex align-items-center gap-1.5 fw-semibold shadow-sm"
              style={{ backgroundColor: '#0E0AB8' }}
            >
              {isAiDrafting ? (
                <>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  <span>Applying Adjustments...</span>
                </>
              ) : (
                <>
                  <i className="bi bi-magic"></i>
                  <span>Apply Adjustments</span>
                </>
              )}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="p-3 bg-light rounded-3 border">
            <div className="small text-muted fw-semibold mb-0.5">
              Target Cohort:
            </div>
            <div className="fw-bold text-dark">
              {selectedBlock ? formatBlockLabel(selectedBlock) : 'Selected Block'}
            </div>
          </div>

          <div>
            <label className="form-label small fw-semibold text-secondary mb-1">
              Adjustment Scope
            </label>
            <div className="btn-group w-100" role="group">
              <button
                type="button"
                onClick={() => setAiRefineScope('targeted')}
                className={`btn btn-sm ${
                  aiRefineScope === 'targeted'
                    ? 'btn-primary text-white fw-semibold'
                    : 'btn-light border text-secondary'
                }`}
              >
                <i className="bi bi-pin-angle me-1" />
                Targeted (Lock unmentioned subjects)
              </button>
              <button
                type="button"
                onClick={() => setAiRefineScope('whole_block')}
                className={`btn btn-sm ${
                  aiRefineScope === 'whole_block'
                    ? 'btn-primary text-white fw-semibold'
                    : 'btn-light border text-secondary'
                }`}
              >
                <i className="bi bi-shuffle me-1" />
                Whole-Block Reshuffle
              </button>
            </div>
            <div className="form-text small text-muted mt-1" style={{ fontSize: '11px' }}>
              {aiRefineScope === 'targeted'
                ? 'Only the subject(s) specifically mentioned in your prompt will be adjusted. All other subjects stay strictly locked.'
                : 'AI can reshuffle all classes in this block to optimize morning/afternoon distribution or resolve broad changes.'}
            </div>
          </div>

          <div>
            <label className="form-label small fw-semibold text-secondary mb-1">
              Adjustment Instructions
            </label>
            <textarea
              className="form-control"
              rows={3}
              value={aiPromptNotes}
              onChange={(e) => {
                const val = e.target.value;
                setAiPromptNotes(val);
                if (/(reshuffle|re-shuffle|whole block|entire block|all classes|re-generate|regenerate)/i.test(val)) {
                  setAiRefineScope('whole_block');
                }
              }}
              placeholder='e.g., "Move PE to Saturday", "Change PROG 1 to TTH", "Assign Mitchillie to HCI", or "Prefer morning slots"'
              style={{ fontSize: '13px' }}
            />
            <div className="form-text small text-muted">
              AI will review the current timetable entries for this block and apply your requested adjustments.
            </div>

            <div className="form-check pt-2">
              <input
                className="form-check-input"
                type="checkbox"
                id="aiAllowSaturdayCheck"
                checked={aiAllowSaturday || /saturday|sat\b/i.test(aiPromptNotes)}
                onChange={(e) => setAiAllowSaturday(e.target.checked)}
              />
              <label className="form-check-label small text-secondary" htmlFor="aiAllowSaturdayCheck" style={{ cursor: 'pointer' }}>
                Allow Saturday scheduling slots (enabled automatically if requested in prompt)
              </label>
            </div>
          </div>
        </div>
      </FormModal>

      {/* Schedule Conflict / Collision Notice Modal */}
      {collisionNotice && (
        <div
          className="modal show d-block"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)', zIndex: 1060 }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-5 p-3">
              <div className="modal-header border-0 pb-2">
                <div className="d-flex align-items-center gap-2">
                  <span
                    className="d-flex align-items-center justify-content-center rounded-3 bg-danger-subtle text-danger"
                    style={{ width: '38px', height: '38px' }}
                  >
                    <i className="bi bi-exclamation-triangle-fill fs-5" />
                  </span>
                  <div>
                    <h2 className="modal-title h6 fw-bold text-dark mb-0">Schedule Conflict Detected</h2>
                    <p className="text-secondary small mb-0">Existing schedule preserved safely</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCollisionNotice(null)}
                  className="btn-close"
                  disabled={isAiDrafting}
                />
              </div>

              <div className="modal-body py-2">
                <div className="p-3 bg-danger-subtle text-danger border border-danger-subtle rounded-3 small mb-3">
                  <div className="fw-bold mb-1 d-flex align-items-center gap-1.5">
                    <i className="bi bi-shield-x" />
                    Conflict Details:
                  </div>
                  <div>{collisionNotice.message}</div>
                </div>

                <p className="small text-secondary mb-2">
                  The AI preserved all existing classes without moving or displacing them. Please enter an alternative instruction to try again (e.g. choose an open time slot, pick a different day, or ask to swap two classes):
                </p>

                <div className="mb-2">
                  <label className="form-label small fw-semibold text-secondary mb-1">
                    Alternative Adjustment Instruction
                  </label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={aiPromptNotes}
                    onChange={(e) => setAiPromptNotes(e.target.value)}
                    placeholder='e.g., "Move PE to Saturday 10:00 instead", or "Swap PROG 1 with MATH PREP"'
                    style={{ fontSize: '13px' }}
                  />
                </div>
              </div>

              <div className="modal-footer border-0 pt-2 d-flex justify-content-between">
                <button
                  type="button"
                  onClick={() => setCollisionNotice(null)}
                  disabled={isAiDrafting}
                  className="btn btn-outline-secondary btn-sm py-2 px-3 rounded-pill"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  onClick={() => handleExecuteAiDraft('refine')}
                  disabled={isAiDrafting || !aiPromptNotes.trim()}
                  className="btn text-white btn-sm rounded-pill py-2 px-4 d-flex align-items-center gap-1.5 fw-semibold shadow-sm"
                  style={{ backgroundColor: '#0E0AB8' }}
                >
                  {isAiDrafting ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                      <span>Retrying Adjustment...</span>
                    </>
                  ) : (
                    <>
                      <i className="bi bi-arrow-repeat" />
                      <span>Retry Adjustment</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Publish Gate Modal */}
      {isPublishModalOpen && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(4px)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content border-0 shadow-lg rounded-5 p-3">
              {/* Modal Header */}
              <div className="modal-header border-0 pb-2">
                <div className="d-flex align-items-center gap-2">
                  <span
                    className={`badge rounded-circle p-1 ${
                      isValidatingPublish
                        ? 'bg-primary'
                        : publishValidation?.hasHardViolations
                        ? 'bg-danger'
                        : publishValidation?.hasSoftViolations
                        ? 'bg-warning'
                        : 'bg-success'
                    }`}
                  />
                  <h5 className="modal-title fw-bold text-dark mb-0">
                    {isValidatingPublish
                      ? 'Validating Draft Schedule...'
                      : publishValidation?.hasHardViolations
                      ? `Publish Blocked: ${publishValidation.hardViolationsCount} Hard Conflict(s)`
                      : publishValidation?.hasSoftViolations
                      ? `Publish Warning: ${publishValidation.softViolationsCount} Soft Warning(s)`
                      : `Publish Schedule Version v${draftVersion.version_number}`}
                  </h5>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setIsPublishModalOpen(false)}
                ></button>
              </div>

              {/* Modal Body */}
              <div className="modal-body pt-1">
                {isValidatingPublish ? (
                  <div className="p-5 text-center">
                    <div className="spinner-border text-primary mb-3" role="status"></div>
                    <p className="text-muted small mb-0">
                      Running deterministic conflict engine across all entries in draft version...
                    </p>
                  </div>
                ) : publishValidation?.hasHardViolations ? (
                  <div>
                    <div className="alert alert-danger rounded-4 text-xs mb-3">
                      <strong>Strict Policy Violation:</strong> This schedule draft cannot be published because it contains hard violations. The schedule cannot be published partially. Please resolve all conflicts below before publishing.
                    </div>

                    <div className="d-flex flex-column gap-3 mb-3" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                      {Object.entries(publishValidation.hardViolationsByBlock).map(([bId, group]) => (
                        <div key={bId} className="p-3 bg-light rounded-4 border border-light-subtle">
                          <div className="small fw-bold text-dark d-flex align-items-center justify-content-between mb-2">
                            <span>Block: {group.blockName}</span>
                            <span className="badge bg-danger-subtle text-danger border">
                              {group.violations.length} hard conflict(s)
                            </span>
                          </div>
                          <div className="d-flex flex-column gap-1 ps-2 border-start border-danger border-2">
                            {group.violations.map((v, idx) => (
                              <div key={idx} className="small text-danger">
                                <span className="font-monospace fw-bold">[{v.rule}]</span> {v.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="d-flex justify-content-end">
                      <button
                        onClick={() => setIsPublishModalOpen(false)}
                        className="btn-ref-secondary"
                      >
                        Close &amp; Resolve Conflicts
                      </button>
                    </div>
                  </div>
                ) : publishValidation?.hasSoftViolations ? (
                  <div>
                    <div className="alert alert-warning rounded-4 text-xs mb-3">
                      <strong>Zero hard conflicts found.</strong> However, there are {publishValidation.softViolationsCount} soft warnings. Soft warnings do not block publication. Are you sure you want to publish this timetable?
                    </div>

                    <div className="d-flex flex-column gap-3 mb-3" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                      {Object.entries(publishValidation.softViolationsByBlock).map(([bId, group]) => (
                        <div key={bId} className="p-3 bg-light rounded-4 border border-light-subtle">
                          <div className="small fw-bold text-dark d-flex align-items-center justify-content-between mb-2">
                            <span>Block: {group.blockName}</span>
                            <span className="badge bg-warning-subtle text-dark border">
                              {group.violations.length} warning(s)
                            </span>
                          </div>
                          <div className="d-flex flex-column gap-1 ps-2 border-start border-warning border-2">
                            {group.violations.map((v, idx) => (
                              <div key={idx} className="small text-dark">
                                <span className="font-monospace fw-bold">[{v.rule}]</span> {v.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="d-flex align-items-center justify-content-between pt-2 border-top border-light">
                      <button
                        onClick={() => setIsPublishModalOpen(false)}
                        className="btn-ref-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmPublish}
                        disabled={isPublishing}
                        className="btn-ref-primary"
                      >
                        {isPublishing ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                            Publishing...
                          </>
                        ) : (
                          'Publish Anyway'
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="alert alert-success rounded-4 text-xs mb-3">
                      <strong>Verification Clean:</strong> All {publishValidation?.totalEntriesCount || 0} scheduled classes passed validation with 0 hard conflicts and 0 soft warnings!
                    </div>

                    <p className="text-secondary small mb-4">
                      Upon publishing:
                      <br />&bull; This version will be finalized as <strong>PUBLISHED</strong> and locked against direct edits.
                      <br />&bull; Any previously published version for this term will be archived.
                      <br />&bull; All assigned instructors will receive in-app notifications and email summaries.
                    </p>

                    <div className="d-flex align-items-center justify-content-between pt-2 border-top border-light">
                      <button
                        onClick={() => setIsPublishModalOpen(false)}
                        className="btn-ref-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleConfirmPublish}
                        disabled={isPublishing}
                        className="btn-ref-primary"
                      >
                        {isPublishing ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                            Publishing...
                          </>
                        ) : (
                          'Confirm & Publish'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Archive Confirmation Modal */}
      <FormModal
        isOpen={isConfirmDeleteArchiveOpen}
        onClose={() => setIsConfirmDeleteArchiveOpen(false)}
        title={`Delete Archived Schedule v${draftVersion.version_number}`}
        description="Permanently remove this archived schedule version from records."
        onSubmit={(e) => {
          e.preventDefault();
          handleDeleteArchive();
        }}
        isSubmitting={isDeletingArchive}
        submitLabel="Yes, Delete Archive"
        size="md"
      >
        <div className="space-y-3">
          <div className="alert alert-danger d-flex align-items-center gap-2 mb-3">
            <i className="bi bi-exclamation-triangle-fill fs-5"></i>
            <div>
              <strong>Warning:</strong> You are about to permanently delete <strong>Archived Schedule Version v{draftVersion.version_number}</strong>. This action cannot be undone.
            </div>
          </div>
          <p className="text-secondary small mb-0">
            All classes and QR tokens associated with this archived schedule version will be permanently removed from the system.
          </p>
        </div>
      </FormModal>

      {/* Rename Schedule Version Draft Modal */}
      <FormModal
        isOpen={isRenameModalOpen}
        onClose={() => setIsRenameModalOpen(false)}
        title={`Rename Schedule Version v${draftVersion.version_number}`}
        description="Provide a custom descriptive name for this schedule version."
        onSubmit={handleRenameDraft}
        isSubmitting={isRenaming}
        submitLabel="Save Version Name"
        size="md"
      >
        <div className="space-y-3">
          <div>
            <label className="form-label small fw-semibold text-secondary">
              Custom Version Name
            </label>
            <input
              type="text"
              className="form-control ref-form-control bg-white"
              placeholder={`e.g., Draft v${draftVersion.version_number} - Morning Priority`}
              value={renameDraftName}
              onChange={(e) => setRenameDraftName(e.target.value)}
              required
              maxLength={80}
              autoFocus
            />
            <div className="form-text small text-muted">
              This name will be displayed in the editor, master schedules table, and PDF/Excel exports.
            </div>
          </div>
        </div>
      </FormModal>

      {/* Unassigned Offerings Reason Modal */}
      <FormModal
        isOpen={isWarningsModalOpen}
        onClose={() => setIsWarningsModalOpen(false)}
        title="Unplaced Subjects Notice"
        description="The following subjects could not be scheduled conflict-free during AI timetable placement."
        onSubmit={(e) => {
          e.preventDefault();
          setIsWarningsModalOpen(false);
        }}
        submitLabel="Close Notice"
        size="lg"
      >
        <div className="space-y-3">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
              <thead className="table-light">
                <tr>
                  <th className="py-2">Student Block</th>
                  <th className="py-2">Subject</th>
                  <th className="py-2">Placement Issue / Reason</th>
                </tr>
              </thead>
              <tbody>
                {unassignedWarnings.map((w, idx) => (
                  <tr key={idx}>
                    <td className="fw-semibold text-dark">{w.blockName}</td>
                    <td>
                      <span className="badge bg-light text-dark border">{w.subjectCode}</span>
                    </td>
                    <td className="text-danger">
                      <i className="bi bi-exclamation-circle me-1"></i>
                      {w.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-light rounded-3 border small text-muted">
            <i className="bi bi-info-circle me-1 text-primary"></i>
            Tip: Most unplaced subjects occur when 0 instructors are marked as qualified for that subject in Subject/Faculty settings, or when instructor availability hours do not overlap with classroom availability.
          </div>
        </div>
      </FormModal>

      {/* Clear All Schedules Confirmation Modal */}
      <FormModal
        isOpen={isConfirmClearAllOpen}
        onClose={() => setIsConfirmClearAllOpen(false)}
        title={userRole === 'admin' ? 'Clear All Schedules' : 'Clear Department Scope Schedules'}
        description={
          userRole === 'admin'
            ? `Remove all scheduled class sessions across all student blocks for draft v${draftVersion.version_number}.`
            : `Remove scheduled class sessions within your ${schedulerDepartment || 'department'} supervision scope for draft v${draftVersion.version_number}.`
        }
        onSubmit={(e) => {
          e.preventDefault();
          handleClearAllDraftSchedules();
        }}
        isSubmitting={isClearingAll}
        submitLabel={userRole === 'admin' ? 'Yes, Clear All Schedules' : 'Yes, Clear My Scope Schedules'}
        size="md"
      >
        <div className="space-y-3">
          <div className="alert alert-danger d-flex align-items-center gap-2 mb-3">
            <i className="bi bi-exclamation-triangle-fill fs-5"></i>
            <div>
              <strong>Warning:</strong> You are about to clear {userRole === 'admin' ? 'all scheduled classes across all cohorts' : `scheduled classes within your ${schedulerDepartment || 'department'} scope`} in <strong>Draft v{draftVersion.version_number}</strong>.
            </div>
          </div>
          <p className="text-secondary small mb-0">
            This will remove {userRole === 'admin' ? 'all' : 'your department\'s'} timetable session entries from this draft. Curriculum subjects and faculty assignments will remain intact so you can re-run the algorithm or place classes fresh.
          </p>
        </div>
      </FormModal>

      {/* Clear Block Schedule Confirmation Modal */}
      <FormModal
        isOpen={isConfirmClearBlockOpen}
        onClose={() => setIsConfirmClearBlockOpen(false)}
        title={`Clear Schedule: ${selectedBlock ? formatBlockLabel(selectedBlock) : 'Block'}`}
        description="Remove all scheduled class sessions for this student block."
        onSubmit={(e) => {
          e.preventDefault();
          handleClearBlockDraftSchedule();
        }}
        isSubmitting={isClearingBlock}
        submitLabel="Yes, Clear Block Schedule"
        size="md"
      >
        <div className="space-y-3">
          <div className="alert alert-warning d-flex align-items-center gap-2 mb-3">
            <i className="bi bi-exclamation-triangle-fill fs-5"></i>
            <div>
              <strong>Are you sure?</strong> You are clearing all scheduled classes for <strong>{selectedBlock ? formatBlockLabel(selectedBlock) : 'this block'}</strong>.
            </div>
          </div>
          <p className="text-secondary small mb-0">
            Other cohort schedules will remain untouched. You can re-add classes or re-run the algorithm for this block at any time.
          </p>
        </div>
      </FormModal>
    </div>
  );
}
