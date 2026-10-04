// src/app/scheduler/schedule/ScheduleEditorClient.tsx
'use client';

import React, { useState, useMemo, useTransition } from 'react';
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
} from './actions';
import type { PublishValidationResult } from '@/lib/publish/publish-gate';
import type { ScheduleEntryFormInput } from '@/lib/validators/schedule';
import { generateAiDraftAction } from '../generate/actions';
import { SpreadsheetScheduleView } from './SpreadsheetScheduleView';

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
}: ScheduleEditorClientProps) {
  const router = useRouter();
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(
    initialBlockId || null
  );

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
  const [scheduleDayPattern, setScheduleDayPattern] = useState<'single' | 'MW' | 'TTH'>('single');
  const [isAiDrafting, setIsAiDrafting] = useState(false);

  const isReadOnly = draftVersion.status !== 'draft';

  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishValidation, setPublishValidation] = useState<PublishValidationResult | null>(null);
  const [isValidatingPublish, setIsValidatingPublish] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isNoRoom, setIsNoRoom] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
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
  const [dragOverSlot, setDragOverSlot] = useState<{
    dayIndex: number;
    slotHour: string;
    isHalfHour: boolean;
  } | null>(null);

  // Multi-block room occupancy overlay state
  const [showAllBlockSchedules, setShowAllBlockSchedules] = useState(true);
  const [selectedGridRoomFilter, setSelectedGridRoomFilter] = useState<string>('all');
  const [spreadsheetShowAllBlocks, setSpreadsheetShowAllBlocks] = useState(false);

  // In-page Department Masterlist state
  const [showMasterlist, setShowMasterlist] = useState(false);
  const [masterlistDept, setMasterlistDept] = useState<'college' | 'high_school'>('college');
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

  // Entries from other blocks for room occupancy visualization
  const otherBlockEntries = useMemo(() => {
    if (!selectedBlockId) return [];
    return entries.filter((e) => {
      const off = initialOfferings.find((o) => o.id === e.offering_id);
      return off && off.block_id !== selectedBlockId;
    });
  }, [entries, initialOfferings, selectedBlockId]);

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
    const list = blockOfferings.length > 0 ? blockOfferings : initialOfferings;
    if (formData.offering_id && !list.some((o) => o.id === formData.offering_id)) {
      const current = initialOfferings.find((o) => o.id === formData.offering_id);
      if (current) return [current, ...list];
    }
    return list;
  }, [blockOfferings, initialOfferings, formData.offering_id]);

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
        return {
          offering: off,
          subject: sub,
          requiredHours,
          scheduledHours,
          remainingHours,
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
    const targetRoom = rooms.find((r) => r.id === preferredRoomId) || rooms[0];

    setEditingEntry(null);
    setIsNoRoom(false);
    setScheduleDayPattern('single');
    setFormData({
      offering_id: initialOff?.id || '',
      instructor_id: initialQualInsts[0]?.id || instructors[0]?.id || '',
      room_id: targetRoom?.id || rooms[0]?.id || '',
      day_of_week: 1,
      start_time: '08:00',
      end_time: '10:00',
      session_type: initialSub?.requires_lab ? 'lab' : 'lecture',
      notes: '',
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  // Handle Drag-to-Grid Placement
  const handleDropOnGrid = (offeringId: string, dayOfWeek: number, startTime: string) => {
    if (isReadOnly) {
      setBannerNotice({
        type: 'error',
        message: 'This schedule version is published or archived (read-only). Direct additions are prohibited.',
      });
      return;
    }

    const off = initialOfferings.find((o) => o.id === offeringId);
    const sub = subjects.find((s) => s.id === off?.subject_id);
    const qualInsts = instructors.filter((inst) =>
      (inst.instructor_qualifications || []).some((q) => q.subject_id === sub?.id)
    );

    const preferredRoomId = (sub as any)?.preferred_room_id;
    const targetRoom = rooms.find((r) => r.id === preferredRoomId) || rooms[0];

    const durationHours = (sub?.lecture_hours || 0) + (sub?.lab_hours || 0) || 2;
    const [sh, sm] = startTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = Math.min(21 * 60, startMins + Math.round(durationHours * 60));
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    const endTime = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;

    setEditingEntry(null);
    setIsNoRoom(false);
    setScheduleDayPattern('single');
    setFormData({
      offering_id: offeringId,
      instructor_id: qualInsts[0]?.id || instructors[0]?.id || '',
      room_id: targetRoom?.id || rooms[0]?.id || '',
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      session_type: sub?.requires_lab ? 'lab' : 'lecture',
      notes: '',
    });
    setModalError(null);
    setIsModalOpen(true);
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

    setEditingEntry(entry);
    setIsNoRoom(!entry.room_id);
    setScheduleDayPattern('single');
    setFormData({
      offering_id: entry.offering_id,
      instructor_id: entry.instructor_id,
      room_id: entry.room_id || '',
      day_of_week: entry.day_of_week,
      start_time: entry.start_time.slice(0, 5),
      end_time: entry.end_time.slice(0, 5),
      session_type: entry.session_type,
      notes: (entry as any).notes || '',
    });
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

    if (formData.end_time <= formData.start_time) {
      setModalError('End time must be after start time.');
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

    const payload: ScheduleEntryFormInput = {
      ...formData,
      offering_id:
        formData.offering_id || blockOfferings[0]?.id || initialOfferings[0]?.id || '',
      instructor_id: formData.instructor_id,
      room_id: isNoRoom ? null : (formData.room_id || null),
      notes: formData.notes?.trim() ? formData.notes.trim() : null,
      days_of_week:
        !editingEntry && scheduleDayPattern === 'MW'
          ? [1, 3]
          : !editingEntry && scheduleDayPattern === 'TTH'
          ? [2, 4]
          : undefined,
      day_of_week:
        scheduleDayPattern === 'MW'
          ? 1
          : scheduleDayPattern === 'TTH'
          ? 2
          : formData.day_of_week,
    };

    startTransition(async () => {
      try {
        await saveScheduleEntryAction(
          draftVersion.id,
          editingEntry ? editingEntry.id : null,
          payload
        );
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
      const res = await generateAiDraftAction(
        currentTermId,
        targetBlockIds,
        {
          splitTwoDays: true,
          preferMornings: true,
          noClassesAfter5pm: false,
          allowSaturday: false,
          customNotes: aiPromptNotes.trim() || undefined,
        },
        mode
      );

      if (res.success) {
        setIsAiModalOpen(false);
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
    return (
      <div className="bg-white rounded-5 p-4 shadow-sm border border-primary border-opacity-25 mb-4">
        {/* Masterlist Header */}
        <div className="d-flex flex-column flex-lg-row align-items-start align-items-lg-center justify-content-between gap-3 pb-3 mb-3 border-bottom border-light-subtle">
          <div>
            <div className="d-flex align-items-center gap-2 mb-1">
              <span
                className="d-inline-flex align-items-center justify-content-center text-white rounded-3 shadow-sm"
                style={{ width: '36px', height: '36px', backgroundColor: '#0E0AB8' }}
              >
                <i className="bi bi-table fs-6"></i>
              </span>
              <h5 className="fw-bold text-dark mb-0">Department Master Schedule</h5>
              <span className="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill">
                {masterlistBlocks.length} Blocks
              </span>
            </div>
            <p className="text-secondary small mb-0">
              Department-wide timetable masterlist across all block cohorts. Switch between departments or toggle between Spreadsheet and Weekly Grid.
            </p>
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2">
            {/* Department Switcher */}
            <div className="d-flex align-items-center gap-1.5 p-1 bg-light rounded-3 border">
              {departmentOptions.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => {
                    setMasterlistDept(dept.id);
                    setMasterlistBlockFilter('all');
                  }}
                  className={`btn btn-sm px-3 py-1.5 rounded-2 fw-semibold border-0 transition ${
                    masterlistDept === dept.id
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-secondary hover:text-dark'
                  }`}
                  style={masterlistDept === dept.id ? { backgroundColor: '#0E0AB8' } : {}}
                >
                  {dept.name} ({dept.blockCount})
                </button>
              ))}
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
            onGenerateAiDraft={() => setIsAiModalOpen(true)}
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

                            return (
                              <div
                                key={e.id}
                                className="rounded-3 p-1.5 transition position-absolute shadow-sm d-flex flex-column justify-content-between overflow-hidden bg-white border border-light-subtle text-dark"
                                style={{
                                  top: `${topOffset + 2}px`,
                                  height: `${cardHeight}px`,
                                  left: `calc(${leftPercent}% + 2px)`,
                                  width: `calc(${widthPercent}% - 4px)`,
                                  zIndex: 3,
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
                                    <button
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        handleOpenEdit(e);
                                      }}
                                      className="btn btn-outline-secondary btn-sm py-0 px-1"
                                      style={{ fontSize: '8.5px', lineHeight: '1.2' }}
                                    >
                                      Edit
                                    </button>
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
      {/* Top Banner Notice */}
      {bannerNotice && (
        <div
          className={`alert ${
            bannerNotice.type === 'success' ? 'alert-success' : 'alert-danger'
          } rounded-4 d-flex align-items-center justify-content-between p-3 mb-3 shadow-sm`}
        >
          <span>{bannerNotice.message}</span>
          <button
            onClick={() => setBannerNotice(null)}
            className="btn btn-sm btn-link text-decoration-none text-reset"
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
          {/* Control Bar */}
          <div className="bg-white rounded-4 p-4 shadow-sm border border-white d-flex flex-column flex-lg-row align-items-start align-items-lg-center justify-content-between gap-3 mb-4">
            <div className="d-flex flex-wrap align-items-center gap-3">
              <div className="d-flex align-items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSelectBlock(null)}
                  className="btn btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center shadow-none p-0 transition"
                  style={{ width: '38px', height: '38px' }}
                  title="Back to Year Level and Block Cohorts overview"
                  aria-label="Back to Overview"
                >
                  <i className="bi bi-arrow-left fs-5"></i>
                </button>

                <div className="border-start ps-3 py-0.5">
                  <div className="small text-muted fw-semibold text-uppercase" style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
                    Editing Schedule For
                  </div>
                  <div className="fw-bold text-dark fs-6 d-flex align-items-center gap-2">
                    <span>{selectedBlock ? formatBlockLabel(selectedBlock) : 'Block'}</span>
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill fw-normal" style={{ fontSize: '11px' }}>
                      {selectedBlock?.student_count || 0} Students
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="form-label small fw-semibold text-muted text-uppercase mb-1" style={{ fontSize: '11px' }}>
                  Schedule Version
                </label>
                <select
                  value={draftVersion.id}
                  onChange={(e) => {
                    const targetParam = selectedBlockId ? `&blockId=${selectedBlockId}` : '';
                    router.push(`/scheduler/schedule?termId=${currentTermId}&versionId=${e.target.value}${targetParam}`);
                  }}
                  className="form-select ref-form-control"
                  style={{ minWidth: '180px' }}
                >
              {(versions || [draftVersion]).map((v) => (
                <option key={v.id} value={v.id}>
                  {versionNames[v.id] ? `${versionNames[v.id]} (v${v.version_number})` : `v${v.version_number}`} &bull; {v.status.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-sm-3 d-flex align-items-center gap-1.5">
            <span
              className={
                draftVersion.status === 'published'
                  ? 'pill-status-progress'
                  : draftVersion.status === 'archived'
                  ? 'pill-status-archived'
                  : 'pill-status-pending'
              }
            >
              {versionNames[draftVersion.id] ? versionNames[draftVersion.id] : `v${draftVersion.version_number}`} [{draftVersion.status.toUpperCase()}]
            </span>
            <button
              type="button"
              onClick={() => {
                setRenameDraftName(versionNames[draftVersion.id] || `Draft v${draftVersion.version_number}`);
                setIsRenameModalOpen(true);
              }}
              className="btn btn-sm btn-outline-secondary py-1 px-2 rounded-3 d-flex align-items-center gap-1 shadow-none"
              title="Rename this version draft"
            >
              <i className="bi bi-pencil-square"></i>
              <span className="small d-none d-md-inline">Rename</span>
            </button>
          </div>
        </div>

        <div className="d-flex flex-wrap align-items-center gap-2">
          {/* Scheduling Style Toggle */}
          <div className="btn-group btn-group-sm p-1 bg-light rounded-3 border" role="group" aria-label="Scheduling Style Toggle">
            <button
              type="button"
              onClick={() => setScheduleStyle('grid')}
              className={`btn btn-sm px-3 fw-semibold transition d-flex align-items-center gap-1.5 ${
                scheduleStyle === 'grid'
                  ? 'btn-primary text-white shadow-sm'
                  : 'btn-light text-secondary'
              }`}
              style={scheduleStyle === 'grid' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
            >
              <i className="bi bi-calendar3-week"></i>
              <span>Weekly Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setScheduleStyle('spreadsheet')}
              className={`btn btn-sm px-3 fw-semibold transition d-flex align-items-center gap-1.5 ${
                scheduleStyle === 'spreadsheet'
                  ? 'btn-primary text-white shadow-sm'
                  : 'btn-light text-secondary'
              }`}
              style={scheduleStyle === 'spreadsheet' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
            >
              <i className="bi bi-table"></i>
              <span>Spreadsheet Style</span>
            </button>
          </div>

          {/* Export Buttons */}
          <div className="d-flex align-items-center gap-1">
            <a
              href={`/api/schedule/export?versionId=${draftVersion.id}&format=pdf&blockId=${selectedBlockId}`}
              download
              className="btn-ref-secondary small py-2 px-3"
              title="Export this block timetable to PDF"
            >
              <i className="bi bi-file-earmark-pdf me-1 text-danger"></i>
              PDF
            </a>
            <a
              href={`/api/schedule/export?versionId=${draftVersion.id}&format=excel&blockId=${selectedBlockId}`}
              download
              className="btn-ref-secondary small py-2 px-3"
              title="Export this block timetable to Excel (.xlsx)"
            >
              <i className="bi bi-file-earmark-spreadsheet me-1 text-success"></i>
              Excel
            </a>
          </div>

          {/* Masterlist Toggle Button */}
          <button
            type="button"
            onClick={() => setShowMasterlist(!showMasterlist)}
            className={`btn-ref-secondary small py-2 px-3 d-flex align-items-center gap-1.5 ${
              showMasterlist ? 'bg-primary text-white border-primary shadow-sm' : ''
            }`}
            title="Open whole department masterlist (spreadsheet & weekly grid)"
          >
            <i className={`bi bi-table ${showMasterlist ? 'text-white' : 'text-primary'}`}></i>
            <span>{showMasterlist ? 'Hide Masterlist' : 'Masterlist'}</span>
          </button>

          {/* Validate All Button */}
          <button
            onClick={() => setIsValidationPanelOpen(!isValidationPanelOpen)}
            className="btn-ref-secondary small py-2 px-3 d-flex align-items-center gap-2"
          >
            <i className="bi bi-shield-check text-primary"></i>
            <span>Validate</span>
            {hardViolationsCount > 0 && (
              <span className="badge rounded-pill bg-danger">
                {hardViolationsCount}
              </span>
            )}
            {softViolationsCount > 0 && (
              <span className="badge rounded-pill bg-warning text-dark">
                {softViolationsCount}
              </span>
            )}
            {hardViolationsCount === 0 && softViolationsCount === 0 && (
              <span className="badge rounded-pill bg-success-subtle text-success">Clean</span>
            )}
          </button>

          {!isReadOnly ? (
            <>
              {/* Save Draft Button */}
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isPending || isSavingDraft}
                className="btn-ref-secondary small py-2 px-3 d-flex align-items-center gap-1.5"
                title="Save current schedule draft progress"
              >
                {isSavingDraft ? (
                  <span className="spinner-border spinner-border-sm text-primary" role="status" />
                ) : (
                  <i className="bi bi-floppy text-primary"></i>
                )}
                <span>{isSavingDraft ? 'Saving...' : 'Save Draft'}</span>
                {lastSavedTime && (
                  <span className="text-muted small" style={{ fontSize: '10px' }}>({lastSavedTime})</span>
                )}
              </button>

              {/* AI Draft Button */}
              <button
                type="button"
                onClick={() => setIsAiModalOpen(true)}
                disabled={isPending || isAiDrafting}
                className="btn-ref-secondary small py-2 px-3 d-flex align-items-center gap-1"
                title="Automatically generate and place schedule draft"
              >
                <i className="bi bi-stars text-primary"></i>
                <span>AI Draft</span>
              </button>

              {/* Add Entry Button */}
              <button
                onClick={handleOpenAdd}
                disabled={isPending}
                className="btn-ref-secondary small py-2 px-3 d-flex align-items-center gap-1"
              >
                <i className="bi bi-plus-lg text-primary"></i>
                <span>Add Class</span>
              </button>

              {/* Publish Schedule Button */}
              <button
                onClick={handleTriggerPublish}
                disabled={isPending}
                className="btn-ref-primary small py-2 px-4 d-flex align-items-center gap-1"
              >
                <i className="bi bi-cloud-arrow-up me-1"></i>
                <span>Publish Schedule</span>
              </button>
            </>
          ) : (
            <div className="d-flex align-items-center gap-2">
              <button
                onClick={handleStartNewDraft}
                disabled={isPending}
                className="btn-ref-primary small py-2 px-3 d-flex align-items-center gap-1"
              >
                <i className="bi bi-plus-lg me-1"></i>
                <span>Start New Draft</span>
              </button>

              {draftVersion.status === 'archived' && (
                <button
                  type="button"
                  onClick={() => setIsConfirmDeleteArchiveOpen(true)}
                  disabled={isPending || isDeletingArchive}
                  className="btn btn-outline-danger btn-sm py-2 px-3 d-flex align-items-center gap-1.5"
                  title="Permanently delete this archived schedule version"
                >
                  <i className="bi bi-trash3"></i>
                  <span>Delete Archive</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

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
              const isDragging = draggingOfferingId === item.offering.id;
              return (
                <div key={item.offering.id} className="col-12 col-sm-6 col-md-4 col-lg-3">
                  <div
                    draggable={!isReadOnly}
                    onDragStart={(e) => {
                      if (isReadOnly) return;
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
                      isDragging
                        ? 'border-primary shadow bg-primary-subtle opacity-75'
                        : 'bg-light border-light-subtle hover-shadow'
                    }`}
                    style={{
                      cursor: isReadOnly ? 'default' : 'grab',
                      userSelect: 'none',
                    }}
                    title={
                      isReadOnly
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
                        {!isReadOnly && (
                          <span
                            className="badge bg-white text-secondary border px-1.5 py-0.5"
                            style={{ fontSize: '9px' }}
                          >
                            <i className="bi bi-arrows-move"></i>
                          </span>
                        )}
                      </div>
                      <div className="text-muted mt-1" style={{ fontSize: '11px' }}>
                        Scheduled: {item.scheduledHours}h / {item.requiredHours}h
                      </div>
                      <div className="text-warning fw-semibold mt-1" style={{ fontSize: '11px' }}>
                        {item.remainingHours}h unplaced
                      </div>
                    </div>

                    <div className="d-flex align-items-center justify-content-between mt-2 pt-2 border-top border-light-subtle">
                      <span
                        className="text-primary fw-semibold d-inline-flex align-items-center gap-1"
                        style={{ fontSize: '10.5px' }}
                      >
                        <i className="bi bi-arrows-move"></i> Drag to Grid
                      </span>
                      {!isReadOnly && (
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
                onGenerateAiDraft={() => setIsAiModalOpen(true)}
              />
            </div>
          ) : (
            <div className="bg-white rounded-4 shadow-sm border border-white overflow-hidden">
              <div className="p-3 px-4 border-bottom border-light d-flex flex-wrap align-items-center justify-content-between gap-3">
                <div>
                  <h5 className="fw-bold text-dark mb-0">
                    Weekly Timetable Grid
                  </h5>
                  <span className="text-muted small">
                    Showing scheduled classes for {selectedBlock ? formatBlockLabel(selectedBlock) : 'selected block'}
                  </span>
                </div>
                <div className="d-flex flex-wrap align-items-center gap-3">
                  {/* Room Filter Selector */}
                  <div className="d-flex align-items-center gap-1.5">
                    <span className="small text-muted fw-semibold" style={{ fontSize: '11px' }}>
                      <i className="bi bi-door-open me-1"></i>Room:
                    </span>
                    <select
                      value={selectedGridRoomFilter}
                      onChange={(e) => setSelectedGridRoomFilter(e.target.value)}
                      className="form-select form-select-sm ref-form-control py-1 px-2.5"
                      style={{ minWidth: '150px', fontSize: '11px' }}
                      aria-label="Filter weekly grid by room"
                    >
                      <option value="all">All Rooms</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.room_type})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Toggle All Block Occupancy */}
                  <div className="form-check form-switch d-flex align-items-center gap-1.5 mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="toggleAllBlocksOccupancy"
                      checked={showAllBlockSchedules}
                      onChange={(e) => setShowAllBlockSchedules(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <label
                      className="form-check-label small fw-semibold text-secondary cursor-pointer"
                      htmlFor="toggleAllBlocksOccupancy"
                      style={{ fontSize: '11px' }}
                    >
                      All Blocks Room Occupancy
                    </label>
                  </div>

                  {/* Legend */}
                  <div className="d-flex align-items-center gap-1.5">
                    <span className="badge bg-primary-subtle text-primary border" style={{ fontSize: '9.5px' }}>
                      ■ Active Block
                    </span>
                    {showAllBlockSchedules && (
                      <span className="badge bg-light text-secondary border border-secondary-subtle" style={{ fontSize: '9.5px' }}>
                        ▫ Other Blocks
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div style={{ minWidth: '850px' }}>
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

                    {/* 6 Day Columns with Absolute Cards */}
                    <div className="d-flex flex-grow-1 position-relative">
                      {DAYS.map((day) => {
                        const currentBlockDayEntries = selectedBlockEntries.filter((e) => e.day_of_week === day.index);
                        const filteredCurrentEntries =
                          selectedGridRoomFilter === 'all'
                            ? currentBlockDayEntries
                            : currentBlockDayEntries.filter((e) => e.room_id === selectedGridRoomFilter);

                        const otherBlockDayEntries = otherBlockEntries.filter((e) => e.day_of_week === day.index);
                        const filteredOtherEntries =
                          selectedGridRoomFilter === 'all'
                            ? otherBlockDayEntries
                            : otherBlockDayEntries.filter((e) => e.room_id === selectedGridRoomFilter);

                        const dayEntries = showAllBlockSchedules
                          ? [...filteredCurrentEntries, ...filteredOtherEntries]
                          : filteredCurrentEntries;

                        const layoutMap = computeDayLayout(dayEntries);

                        return (
                          <div
                            key={day.index}
                            className="col border-end border-light-subtle position-relative"
                            style={{ height: `${TIME_SLOTS.length * HOUR_HEIGHT}px` }}
                          >
                            {/* Background Hour Grid Lines & Half-hour dash with Drop Targets */}
                            {TIME_SLOTS.map((slot) => {
                              const isSlotHovered =
                                dragOverSlot?.dayIndex === day.index && dragOverSlot?.slotHour === slot;
                              const isBottomHovered = isSlotHovered && dragOverSlot?.isHalfHour;
                              const isTopHovered = isSlotHovered && !dragOverSlot?.isHalfHour;

                              return (
                                <div
                                  key={slot}
                                  onDragOver={(e) => {
                                    if (isReadOnly) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'copy';
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const isHalfHour = e.clientY - rect.top > rect.height / 2;
                                    if (
                                      dragOverSlot?.dayIndex !== day.index ||
                                      dragOverSlot?.slotHour !== slot ||
                                      dragOverSlot?.isHalfHour !== isHalfHour
                                    ) {
                                      setDragOverSlot({ dayIndex: day.index, slotHour: slot, isHalfHour });
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
                                      if (dragOverSlot?.dayIndex === day.index && dragOverSlot?.slotHour === slot) {
                                        setDragOverSlot(null);
                                      }
                                    }
                                  }}
                                  onDrop={(e) => {
                                    if (isReadOnly) return;
                                    e.preventDefault();
                                    const offId =
                                      e.dataTransfer.getData('offeringId') ||
                                      e.dataTransfer.getData('text/plain') ||
                                      draggingOfferingId;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const isHalfHour = e.clientY - rect.top > rect.height / 2;
                                    const [hourPart] = slot.split(':');
                                    const calculatedStartTime = isHalfHour ? `${hourPart}:30` : `${hourPart}:00`;
                                    setDragOverSlot(null);
                                    setDraggingOfferingId(null);
                                    if (offId) {
                                      handleDropOnGrid(offId, day.index, calculatedStartTime);
                                    }
                                  }}
                                  className={`border-bottom border-light-subtle w-100 position-relative transition ${
                                    isSlotHovered ? 'bg-primary-subtle bg-opacity-25' : ''
                                  }`}
                                  style={{ height: `${HOUR_HEIGHT}px` }}
                                >
                                  {/* Top half hover drop indicator */}
                                  {isTopHovered && (
                                    <div
                                      className="position-absolute start-0 end-0 top-0 d-flex align-items-center justify-content-center bg-primary text-white small fw-bold shadow-sm"
                                      style={{ height: `${HOUR_HEIGHT / 2}px`, zIndex: 6, opacity: 0.9, fontSize: '10px' }}
                                    >
                                      <i className="bi bi-plus-circle me-1"></i> Place at {slot}
                                    </div>
                                  )}

                                  <div
                                    className="position-absolute start-0 end-0 border-bottom border-light-subtle border-opacity-50"
                                    style={{ top: `${HOUR_HEIGHT / 2}px`, borderStyle: 'dashed' }}
                                  />

                                  {/* Bottom half hover drop indicator */}
                                  {isBottomHovered && (
                                    <div
                                      className="position-absolute start-0 end-0 bottom-0 d-flex align-items-center justify-content-center bg-primary text-white small fw-bold shadow-sm"
                                      style={{ height: `${HOUR_HEIGHT / 2}px`, zIndex: 6, opacity: 0.9, fontSize: '10px' }}
                                    >
                                      <i className="bi bi-plus-circle me-1"></i> Place at {slot.split(':')[0]}:30
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

                              const offering = initialOfferings.find((o) => o.id === e.offering_id);
                              const isCurrentBlock = offering?.block_id === selectedBlockId;
                              const otherBlock = !isCurrentBlock ? blocks.find((b) => b.id === offering?.block_id) : null;
                              const subject = subjects.find((s) => s.id === offering?.subject_id);
                              const instructor = instructors.find((i) => i.id === e.instructor_id);
                              const room = rooms.find((r) => r.id === e.room_id);
                              const entryViolations = violationsByEntryId.get(e.id);
                              const isHighlighted = highlightedEntryId === e.id;

                              if (!isCurrentBlock) {
                                return (
                                  <div
                                    key={e.id}
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
                                    }}
                                    title={`Occupied Room: ${room?.name || 'TBA'}\nCohort: ${otherBlock ? formatBlockLabel(otherBlock) : 'Other Block'}\nCourse: ${subject?.code} - ${subject?.title}\nInstructor: ${instructor?.full_name || 'TBA'}\nTime: ${formatTimeShort(e.start_time)} - ${formatTimeShort(e.end_time)}`}
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
                                        {formatTimeShort(e.start_time)}-{formatTimeShort(e.end_time)}
                                      </span>
                                      <span className="badge bg-light text-muted border" style={{ fontSize: '7.5px', padding: '1px 2px' }}>
                                        Occupied
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={e.id}
                                  className={`rounded-3 p-2 transition position-absolute shadow-sm d-flex flex-column justify-content-between overflow-hidden ${
                                    isHighlighted
                                      ? 'border-2 border-primary shadow'
                                      : ''
                                  } ${
                                    entryViolations && entryViolations.hard.length > 0
                                      ? 'bg-danger-subtle border border-danger text-danger'
                                      : entryViolations && entryViolations.soft.length > 0
                                      ? 'bg-warning-subtle border border-warning text-dark'
                                      : e.session_type === 'lab'
                                      ? 'bg-info-subtle border border-info-subtle text-dark'
                                      : 'bg-white border border-light-subtle text-dark'
                                  }`}
                                  style={{
                                    top: `${topOffset + 2}px`,
                                    height: `${cardHeight}px`,
                                    left: `calc(${leftPercent}% + 3px)`,
                                    width: `calc(${widthPercent}% - 6px)`,
                                    zIndex: isHighlighted ? 10 : 3,
                                  }}
                                >
                                  {/* Header: Subject & Session Type & AI Tag */}
                                  <div>
                                    <div className="d-flex align-items-center justify-content-between gap-1 mb-0.5">
                                      <div className="d-flex align-items-center gap-1 text-truncate">
                                        <span className="fw-bold text-dark text-truncate" style={{ fontSize: '11px' }}>
                                          {subject?.code || 'Course'}
                                        </span>
                                        {e.created_by_ai && (
                                          <span className="badge bg-primary-subtle text-primary border" style={{ fontSize: '8.5px', padding: '1px 3px' }}>
                                            AI
                                          </span>
                                        )}
                                        {(e as any).notes && (
                                          <span
                                            className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle cursor-pointer d-inline-flex align-items-center gap-0.5"
                                            style={{ fontSize: '8.5px', padding: '1px 4px' }}
                                            title={`Note: ${(e as any).notes}`}
                                            onClick={(ev) => {
                                              ev.stopPropagation();
                                              alert(`Scheduler Note for ${subject?.code || 'Course'}:\n\n${(e as any).notes}`);
                                            }}
                                          >
                                            <i className="bi bi-sticky-fill text-warning"></i>
                                            <span>Note</span>
                                          </span>
                                        )}
                                      </div>
                                      <span
                                        className={`badge ${
                                          e.session_type === 'lab'
                                            ? 'bg-info-subtle text-info border'
                                            : 'bg-light text-secondary border'
                                        }`}
                                        style={{ fontSize: '8.5px', padding: '1px 3px' }}
                                      >
                                        {e.session_type}
                                      </span>
                                    </div>

                                    {/* Room & Instructor */}
                                    <div className="text-secondary text-truncate" style={{ fontSize: '10px' }}>
                                      {e.room_id ? room?.name : <span className="fst-italic text-muted">No room / off-site</span>}
                                    </div>
                                    <div className="text-muted text-truncate" style={{ fontSize: '10px' }}>
                                      {instructor?.full_name}
                                    </div>

                                    {/* Inline Violation Badges */}
                                    {entryViolations && entryViolations.hard.length > 0 && (
                                      <div className="mt-0.5 pt-0.5 border-top border-danger border-opacity-25">
                                        <span className="fw-bold text-danger text-truncate d-block" style={{ fontSize: '9px' }}>
                                          <i className="bi bi-exclamation-octagon-fill me-1"></i>
                                          {entryViolations.hard[0].rule.replace('_', ' ')}
                                        </span>
                                      </div>
                                    )}

                                    {entryViolations && entryViolations.soft.length > 0 && !entryViolations.hard.length && (
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
                                      {formatTimeShort(e.start_time)} - {formatTimeShort(e.end_time)}
                                    </div>

                                    {!isReadOnly && (
                                      <div className="d-flex align-items-center gap-1">
                                        <button
                                          onClick={(ev) => {
                                            ev.stopPropagation();
                                            handleOpenEdit(e);
                                          }}
                                          className="btn btn-outline-secondary btn-sm py-0 px-1"
                                          style={{ fontSize: '9.5px', lineHeight: '1.2' }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          onClick={(ev) => {
                                            ev.stopPropagation();
                                            handleDelete(e.id);
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
            <button
              type="button"
              onClick={() => {
                setAiScope('all');
                setIsAiModalOpen(true);
              }}
              disabled={isPending || isAiDrafting}
              className="btn-ref-primary small py-2 px-3 d-flex align-items-center gap-1.5"
              title="Auto-generate complete timetable with AI"
            >
              <i className="bi bi-stars"></i>
              <span>AI Auto-Schedule</span>
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
        {yearLevelGroups.map((group) => (
          <div key={group.title} className="bg-white rounded-5 p-4 shadow-sm border border-light-subtle">
            <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom border-light">
              <div className="d-flex align-items-center gap-2">
                <span className="badge rounded-circle p-1.5" style={{ backgroundColor: '#0E0AB8' }}></span>
                <h5 className="fw-bold text-dark mb-0">
                  {group.title}
                </h5>
                <span className="badge bg-light text-secondary border rounded-pill px-2.5 py-1 small">
                  {group.blocks.length} {group.blocks.length === 1 ? 'Block' : 'Blocks'}
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
                        borderColor: '#e2e8f0',
                        backgroundColor: '#ffffff',
                        transition: 'all 0.18s ease-in-out',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#0E0AB8';
                        e.currentTarget.style.transform = 'translateY(-3px)';
                        e.currentTarget.style.boxShadow = '0 10px 20px rgba(14, 10, 184, 0.08)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e2e8f0';
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = '';
                      }}
                    >
                      <div>
                        {/* Top Header of Card */}
                        <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
                          <div>
                            <h5 className="fw-bold text-dark mb-0">
                              {formatBlockLabel(b)}
                            </h5>
                            <span className="text-muted small" style={{ fontSize: '11px' }}>
                              {b.programs?.code || 'BSIT'} &bull; {b.student_count || 0} Students
                            </span>
                          </div>

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
                              className={`progress-bar ${pct === 100 ? 'bg-success' : pct > 0 ? 'bg-primary' : 'bg-secondary'}`}
                              role="progressbar"
                              style={{ width: `${pct}%` }}
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            ></div>
                          </div>
                        </div>

                        {/* Quick Meta Data Grid */}
                        <div className="p-2.5 bg-light rounded-3 small space-y-1.5 mb-3" style={{ fontSize: '11px' }}>
                          <div className="d-flex align-items-center justify-content-between text-secondary">
                            <span>Weekly Load:</span>
                            <strong className="text-dark">{bs.totalHours} hrs / wk</strong>
                          </div>
                          <div className="d-flex align-items-center justify-content-between text-secondary">
                            <span>Schedule Days:</span>
                            <strong className="text-dark">{bs.dayPattern}</strong>
                          </div>
                          <div className="d-flex align-items-center justify-content-between text-secondary">
                            <span>Classrooms:</span>
                            <span className="text-dark text-truncate text-end ms-2" style={{ maxWidth: '120px' }}>
                              {bs.roomNames.length > 0 ? bs.roomNames.join(', ') : 'None assigned'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary w-100 d-flex align-items-center justify-content-center gap-1.5 fw-semibold py-1.5 rounded-3"
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
        ))}
      </div>
    </div>
  )}

      {/* Add / Edit Entry Modal (Spreadsheet Style 3-Column Layout) */}
      <FormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingEntry ? 'Edit Class Schedule Entry' : 'Add Class Schedule Entry'}
        description="Assign schedule timing, subject, room, and faculty member following the spreadsheet program layout."
        onSubmit={handleSubmit}
        isSubmitting={isPending}
        error={modalError}
        submitLabel={editingEntry ? 'Update Entry' : 'Create Entry'}
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

              {/* Day Pattern Selector (for new entries) */}
              {!editingEntry && (
                <div className="mb-3">
                  <label className="form-label small fw-semibold text-secondary">
                    Schedule Day Pattern
                  </label>
                  <div className="d-flex gap-1 p-1 bg-white rounded-3 border">
                    <button
                      type="button"
                      onClick={() => setScheduleDayPattern('single')}
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
                      onClick={() => setScheduleDayPattern('MW')}
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
                      onClick={() => setScheduleDayPattern('TTH')}
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
              )}

              {/* Day of Week */}
              {scheduleDayPattern === 'single' || editingEntry ? (
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
              ) : (
                <div className="alert alert-primary py-2 px-3 small rounded-3 mb-3 text-xs">
                  <i className="bi bi-calendar2-week me-1"></i>
                  Creates synchronized split sessions on both{' '}
                  <strong>{scheduleDayPattern === 'MW' ? 'Monday & Wednesday' : 'Tuesday & Thursday'}</strong>.
                </div>
              )}

              {/* Session Type */}
              <div className="mb-3">
                <label className="form-label small fw-semibold text-secondary">
                  Session Type
                </label>
                <select
                  value={formData.session_type}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      session_type: e.target.value as 'lecture' | 'lab',
                    }))
                  }
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
                  <input
                    type="time"
                    required
                    value={formData.start_time}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, start_time: e.target.value }))
                    }
                    className="form-control ref-form-control bg-white"
                  />
                </div>
                <div className="col-6">
                  <label className="form-label small fw-semibold text-secondary">
                    End Time
                  </label>
                  <input
                    type="time"
                    required
                    value={formData.end_time}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, end_time: e.target.value }))
                    }
                    className="form-control ref-form-control bg-white"
                  />
                </div>
              </div>
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
                    setFormData((prev) => ({
                      ...prev,
                      offering_id: newOffId,
                      instructor_id: qualInst?.id || '',
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

              {/* Room & Facility */}
              <div className="mb-3">
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <label className="form-label small fw-semibold text-secondary mb-0">
                    Classroom / Laboratory
                  </label>
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
                          setFormData((prev) => ({ ...prev, room_id: rooms[0]?.id || '' }));
                        }
                      }}
                    />
                    <label className="form-check-label small text-secondary" htmlFor="noRoomCheck" style={{ fontSize: '12px', cursor: 'pointer' }}>
                      No room / off-site
                    </label>
                  </div>
                </div>
                <select
                  disabled={isNoRoom}
                  value={isNoRoom ? '' : (formData.room_id || rooms[0]?.id || '')}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, room_id: e.target.value }))
                  }
                  className="form-select ref-form-control bg-white"
                >
                  {isNoRoom ? (
                    <option value="">(No facility required &mdash; off-site session)</option>
                  ) : (
                    rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.room_type}) {r.is_shared ? '[Shared]' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

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
                    const hasAvail = (inst.instructor_availability || []).some(
                      (a) =>
                        a.day_of_week === formData.day_of_week &&
                        isTimeRangeWithin(formData.start_time, formData.end_time, a.start_time, a.end_time)
                    );

                    return (
                      <option key={inst.id} value={inst.id}>
                        {inst.full_name} {hasAvail ? '✓ Available' : '(Check Availability)'}
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

      {/* AI Draft Schedule Generator Modal */}
      <FormModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        title="AI Auto-Schedule Generator"
        description="Automatically schedules and places conflict-free class hours directly onto the weekly grid and spreadsheet."
        onSubmit={(e) => {
          e.preventDefault();
          handleExecuteAiDraft('new');
        }}
        isSubmitting={isAiDrafting}
        submitLabel="Generate New Draft"
        size="lg"
        customFooter={
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 w-100">
            <button
              type="button"
              onClick={() => setIsAiModalOpen(false)}
              disabled={isAiDrafting}
              className="btn btn-outline-secondary btn-sm py-2 px-3 rounded-pill"
            >
              Cancel
            </button>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <button
                type="button"
                onClick={() => handleExecuteAiDraft('refine')}
                disabled={isAiDrafting}
                className="btn btn-outline-primary btn-sm rounded-pill py-2 px-3.5 d-flex align-items-center gap-1.5 fw-semibold shadow-sm"
                title="Reads existing schedule entries and modifies/adjusts them using your preferences"
              >
                {isAiDrafting ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    <span>Analyzing Draft...</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-magic text-primary"></i>
                    <span>Read Current Draft &amp; Apply Preferences</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleExecuteAiDraft('new')}
                disabled={isAiDrafting}
                className="btn-ref-primary small py-2 px-3.5 d-flex align-items-center gap-1.5"
                title="Generates a complete fresh draft from scratch"
              >
                {isAiDrafting ? (
                  <>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <i className="bi bi-stars"></i>
                    <span>Generate New Draft</span>
                  </>
                )}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Target Generation Scope */}
          <div>
            <label className="form-label small fw-semibold text-secondary mb-1">
              Target Generation Scope
            </label>
            <div className="row g-2">
              {selectedBlockId && (
                <div className="col-12 col-md-6">
                  <label
                    className={`p-3 rounded-3 border cursor-pointer d-flex align-items-center justify-content-between h-100 ${
                      aiScope === 'current'
                        ? 'border-primary bg-primary-subtle text-primary-emphasis'
                        : 'border-light-subtle bg-white'
                    }`}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="d-flex align-items-center gap-2">
                      <input
                        type="radio"
                        name="aiScope"
                        checked={aiScope === 'current'}
                        onChange={() => setAiScope('current')}
                        className="form-check-input mt-0"
                      />
                      <div>
                        <span className="fw-semibold text-dark d-block">
                          Selected Block Only
                        </span>
                        <span className="text-muted small">
                          {formatBlockLabel(blocks.find((b) => b.id === selectedBlockId))}
                        </span>
                      </div>
                    </div>
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle">Fast</span>
                  </label>
                </div>
              )}

              <div className={`col-12 ${selectedBlockId ? 'col-md-6' : 'col-md-12'}`}>
                <label
                  className={`p-3 rounded-3 border cursor-pointer d-flex align-items-center justify-content-between h-100 ${
                    aiScope === 'all' || !selectedBlockId
                      ? 'border-primary bg-primary-subtle text-primary-emphasis'
                      : 'border-light-subtle bg-white'
                  }`}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <input
                      type="radio"
                      name="aiScope"
                      checked={aiScope === 'all' || !selectedBlockId}
                      onChange={() => setAiScope('all')}
                      className="form-check-input mt-0"
                    />
                    <div>
                      <span className="fw-semibold text-dark d-block">
                        All Academic Blocks
                      </span>
                      <span className="text-muted small">
                        Generates complete timetable across all {blocks.length} department blocks
                      </span>
                    </div>
                  </div>
                  <span className="badge bg-info-subtle text-info border border-info-subtle">Comprehensive</span>
                </label>
              </div>
            </div>
          </div>

          {/* Natural Language Prompt & Exclusions */}
          <div>
            <div className="d-flex align-items-center justify-content-between mb-1">
              <label className="form-label small fw-semibold text-secondary mb-0">
                Scheduler Instructions & Preferences (AI Prompt)
              </label>
              <span className="badge bg-secondary-subtle text-secondary small">Optional</span>
            </div>
            <textarea
              className="form-control"
              rows={3}
              value={aiPromptNotes}
              onChange={(e) => setAiPromptNotes(e.target.value)}
              placeholder='e.g., "Make a schedule for Block-1A but leave out this 3 subjects GE 1, GE 2, THEO 1. Make the schedule split into two days on MW, TTH and the last one will be Friday."'
              style={{ fontSize: '13px' }}
            />
            <div className="form-text small text-muted">
              You can specify subjects to omit (e.g. <em>&quot;leave out GE 1, GE 2&quot;</em>), day split requests, or specific timing guidelines.
            </div>
          </div>

          <div className="p-3 bg-light rounded-3 border small text-muted">
            <i className="bi bi-info-circle-fill text-primary me-1"></i>
            The AI engine validates room capacities, instructor availability, and prevents overlaps. All generated classes will immediately appear on your weekly grid and spreadsheet.
          </div>
        </div>
      </FormModal>

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
    </div>
  );
}
