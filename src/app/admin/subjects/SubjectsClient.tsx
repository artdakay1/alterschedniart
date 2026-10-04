// src/app/admin/subjects/SubjectsClient.tsx
'use client';

import React, { useState, useTransition, useMemo } from 'react';
import type { Subject, Room } from '@/types/database';
import { FormModal } from '@/components/FormModal';
import {
  saveSubjectAction,
  deleteSubjectAction,
  deleteSubjectsBulkAction,
  saveSubjectsBatchAction,
  saveSubjectsOrderAction,
  type BatchSubjectInput,
  type SubjectMetaRecord,
  type FacilityType,
} from './actions';

interface SubjectsClientProps {
  subjects: Subject[];
  rooms?: Room[];
  initialYearLevel?: string;
  initialSemester?: string;
  initialDepartment?: 'college' | 'high_school';
  initialMetadataMap?: Record<string, SubjectMetaRecord>;
  isScheduler?: boolean;
}

export type SubjectCategory = 'bsit_major' | 'non_bsit_minor' | 'high_school';
export type DepartmentType = 'college' | 'high_school';

export interface SubjectTableRow {
  id?: string;
  code: string;
  title: string;
  semester: '1st Semester' | '2nd Semester';
  year_level: string;
  category: SubjectCategory;
  is_bsit?: boolean;
  units: number;
  lecture_hours: number;
  lab_hours: number;
  facility: FacilityType;
  preferredRoomId?: string;
  order?: number;
}

export function getSubjectCategory(
  s: Subject,
  map?: Record<string, SubjectMetaRecord>
): SubjectCategory {
  if (map) {
    const m = (s.id ? map[s.id] : undefined) || (s.code ? map[s.code.toUpperCase()] : undefined) || (s.code ? map[s.code] : undefined);
    if (m && typeof m === 'object' && m.category) return m.category;
  }

  const code = (s.code || '').toUpperCase().trim();
  const title = (s.title || '').toLowerCase().trim();

  // High School courses
  if (
    code.startsWith('HS') ||
    code.startsWith('JHS') ||
    code.startsWith('SHS') ||
    code.startsWith('GRADE') ||
    code === 'ROBOTICS' ||
    code === 'IT 1' ||
    title.includes('high school') ||
    title.includes('grade ') ||
    title.includes('shs') ||
    title.includes('jhs')
  ) {
    return 'high_school';
  }

  // IT Subjects from the College of Computer Studies Class Program & BSIT curriculum:
  // - In PDF: ED, ITPROFEL1, CAPSTONE2, IM1, IT PROF EL 3, COMP1, OOP, PROG1, PT, HCI, GE8, NET2, GE6, OS, SIA, GEEL4, ITREVIEW, GEEL1, SAD, SA, APPSDEV
  // - Plus BSIT curriculum: PROG 2, DATASTRUCT 1, DISCRETE 1, NET 1, WEB 1, WEB 2, IM 2, IM 3, IPT 1, IAS 1, CAPSTONE 1, RESEARCH 1, MMC, IT PROF EL 2, IT PROF EL 4, PRAC
  const itMajorCodes = new Set([
    'APPSDEV', 'APPSDEV 1', 'CAPSTONE 1', 'CAPSTONE 2', 'COMP 1', 'COMP1', 'DATASTRUCT 1', 'DISCRETE 1',
    'ED', 'GE 6', 'GE6', 'GE 8', 'GE8', 'GEEL 1', 'GEEL1', 'GEEL 4', 'GEEL4', 'HCI', 'IAS 1', 'IM 1', 'IM1', 'IM 2', 'IM 3',
    'IPT 1', 'IT PROF EL 1', 'ITPROFEL1', 'IT PROF EL 2', 'IT PROF EL 3', 'ITPROFEL3', 'IT PROF EL 4', 'IT REVIEW', 'ITREVIEW',
    'MMC', 'NET 1', 'NET 2', 'NET2', 'OOP', 'OS', 'PRAC', 'PROG 1', 'PROG1', 'PROG 2', 'PT', 'RESEARCH 1',
    'SA', 'SAD', 'SIA', 'WEB 1', 'WEB 2'
  ]);

  if (itMajorCodes.has(code)) {
    return 'bsit_major';
  }

  // All other subjects are Non-BSIT / Minor subjects (e.g. THEO 1-4, PE 1-4, NSTP 1-2, GE 1-5,7,9, GEEL 2-3, REED 1-3, MATH PREP, ACCTG, QM)
  return 'non_bsit_minor';
}

export function getSubjectYearLevel(s: Subject, map?: Record<string, SubjectMetaRecord>): string {
  if (map) {
    if (s.id && map[s.id]?.yearLevel) return map[s.id].yearLevel;
    if (s.code && map[s.code.toUpperCase()]?.yearLevel) return map[s.code.toUpperCase()].yearLevel;
  }

  const code = (s.code || '').toUpperCase();
  const title = (s.title || '').toLowerCase();

  if (code.includes('11') || title.includes('grade 11')) return 'Grade 11 (SHS)';
  if (code.includes('12') || title.includes('grade 12')) return 'Grade 12 (SHS)';
  if (code.includes('7') || title.includes('grade 7')) return 'Grade 7 (JHS)';
  if (code.includes('8') || title.includes('grade 8')) return 'Grade 8 (JHS)';
  if (code.includes('9') || title.includes('grade 9')) return 'Grade 9 (JHS)';
  if (code.includes('10') || title.includes('grade 10')) return 'Grade 10 (JHS)';
  if (code === 'ROBOTICS') return 'Grade 12 (SHS)';
  if (code.startsWith('HS')) return 'Grade 11 (SHS)';

  const match = code.match(/^[A-Z]+(\d)/);
  if (match) {
    const digit = match[1];
    if (digit === '1') return '1st Year';
    if (digit === '2') return '2nd Year';
    if (digit === '3') return '3rd Year';
    if (digit === '4') return '4th Year';
    if (digit === '5') return '5th Year';
  }

  if (title.includes('1st year') || title.includes('year 1')) return '1st Year';
  if (title.includes('2nd year') || title.includes('year 2')) return '2nd Year';
  if (title.includes('3rd year') || title.includes('year 3')) return '3rd Year';
  if (title.includes('4th year') || title.includes('year 4')) return '4th Year';

  return '1st Year';
}

export function isHighSchoolSubject(s: Subject, map?: Record<string, SubjectMetaRecord>): boolean {
  if (map) {
    const meta = map[s.id] || map[(s.code || '').toUpperCase()];
    if (meta?.yearLevel) {
      const yl = meta.yearLevel.toLowerCase();
      if (yl.includes('grade') || yl.includes('high school') || yl.includes('shs') || yl.includes('jhs')) {
        return true;
      }
    }
  }

  const code = (s.code || '').toUpperCase();
  const title = (s.title || '').toLowerCase();

  if (
    code.startsWith('HS') ||
    code.startsWith('JHS') ||
    code.startsWith('SHS') ||
    code.startsWith('GRADE') ||
    code === 'ROBOTICS' ||
    title.includes('high school') ||
    title.includes('grade ') ||
    title.includes('shs') ||
    title.includes('jhs')
  ) {
    return true;
  }

  if (!s.is_bsit) {
    const cat = getSubjectCategory(s);
    if (cat === 'high_school') return true;
  }

  return false;
}

export function getSubjectMeta(
  s: Subject,
  map: Record<string, SubjectMetaRecord>
): SubjectMetaRecord {
  if (s.id && map[s.id]) return map[s.id];
  if (s.code && map[s.code.toUpperCase()]) return map[s.code.toUpperCase()];

  const fallbackYr = getSubjectYearLevel(s);
  const fallbackFacility: FacilityType = s.requires_lab ? 'lab' : 'lecture';
  return {
    yearLevel: fallbackYr,
    semester: '1st Semester',
    facility: fallbackFacility,
    order: 0,
  };
}

export function formatWeeklyHours(lectureHours: number, labHours: number): string {
  const lec = Number(lectureHours || 0);
  const lab = Number(labHours || 0);
  if (lec > 0 && lab > 0) {
    return `${lec}h Lec / ${lab}h Lab`;
  }
  if (lec > 0 && lab === 0) {
    return `${lec}h Lec`;
  }
  if (lec === 0 && lab > 0) {
    return `${lab}h Lab`;
  }
  return '-';
}

const COLLEGE_YEAR_LEVELS = [
  '1st Year',
  '2nd Year',
  '3rd Year',
  '4th Year',
];

const HIGH_SCHOOL_YEAR_LEVELS = [
  'Grade 11 (SHS)',
  'Grade 12 (SHS)',
  'Grade 7 (JHS)',
  'Grade 8 (JHS)',
  'Grade 9 (JHS)',
  'Grade 10 (JHS)',
];

export function SubjectsClient({
  subjects,
  rooms = [],
  initialSemester = '1st Semester',
  initialDepartment = 'college',
  initialMetadataMap = {},
  isScheduler = false,
}: SubjectsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  // Active Department: 'college' or 'high_school'
  const [activeDepartment, setActiveDepartment] = useState<DepartmentType>(initialDepartment);

  // Metadata Map
  const [metadataMap, setMetadataMap] = useState<Record<string, SubjectMetaRecord>>(initialMetadataMap);

  // Filters
  const [semesterFilter, setSemesterFilter] = useState<'1st Semester' | '2nd Semester' | 'all'>(
    (initialSemester as any) || '1st Semester'
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | SubjectCategory>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected subjects for bulk actions (only shown when 2 or more are selected)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Drag-and-drop state
  const [draggedSubjectId, setDraggedSubjectId] = useState<string | null>(null);
  const [dragOverSubjectId, setDragOverSubjectId] = useState<string | null>(null);

  // Modal Table Rows State
  const [tableRows, setTableRows] = useState<SubjectTableRow[]>([]);

  // Switch department with URL parameter sync
  const handleSwitchDepartment = (dept: DepartmentType) => {
    setActiveDepartment(dept);
    setSearchQuery('');
    setCategoryFilter('all');
    setSelectedIds([]);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('dept', dept);
      window.history.replaceState(null, '', url.toString());
    } catch {}
  };

  // Open Modal for adding subjects
  const handleOpenAdd = (defaultYr?: string) => {
    setEditingSubject(null);
    const sem = semesterFilter === '2nd Semester' ? '2nd Semester' : '1st Semester';

    let yr = defaultYr;
    let cat: SubjectCategory = 'bsit_major';

    if (activeDepartment === 'high_school') {
      yr = defaultYr || 'Grade 11 (SHS)';
      cat = 'high_school';
    } else {
      yr = defaultYr || '1st Year';
      cat = categoryFilter !== 'all' && categoryFilter !== 'high_school' ? categoryFilter : 'bsit_major';
    }

    setTableRows([
      {
        code: '',
        title: '',
        semester: sem,
        year_level: yr,
        category: cat,
        is_bsit: activeDepartment === 'college',
        units: 3,
        lecture_hours: 3,
        lab_hours: 0,
        facility: 'lecture',
      },
    ]);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleAddRow = () => {
    setTableRows((prev) => {
      const last = prev[prev.length - 1];
      const defaultYr = activeDepartment === 'high_school' ? 'Grade 11 (SHS)' : '1st Year';
      const defaultCat = activeDepartment === 'high_school' ? 'high_school' : 'bsit_major';

      return [
        ...prev,
        {
          code: '',
          title: '',
          semester: last ? last.semester : '1st Semester',
          year_level: last ? last.year_level : defaultYr,
          category: last ? last.category : defaultCat,
          is_bsit: activeDepartment === 'college',
          units: 3,
          lecture_hours: 3,
          lab_hours: 0,
          facility: 'lecture',
        },
      ];
    });
  };

  const handleRemoveRow = (index: number) => {
    if (tableRows.length <= 1) return;
    setTableRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  const updateTableRow = <K extends keyof SubjectTableRow>(
    index: number,
    field: K,
    val: SubjectTableRow[K]
  ) => {
    setTableRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, [field]: val } : row))
    );
  };

  const handleOpenEdit = (sub: Subject) => {
    setEditingSubject(sub);
    const cat = getSubjectCategory(sub);
    const meta = getSubjectMeta(sub, metadataMap);
    setTableRows([
      {
        id: sub.id,
        code: sub.code,
        title: sub.title,
        semester: meta.semester || '1st Semester',
        year_level: meta.yearLevel,
        category: cat,
        is_bsit: sub.is_bsit,
        units: sub.units,
        lecture_hours: sub.lecture_hours,
        lab_hours: sub.lab_hours,
        facility: meta.facility || (sub.requires_lab ? 'lab' : 'lecture'),
        preferredRoomId: meta.preferredRoomId || '',
        order: meta.order,
      },
    ]);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    // Validate rows
    for (let i = 0; i < tableRows.length; i++) {
      const r = tableRows[i];
      if (!r.code.trim()) {
        setModalError(`Subject #${i + 1}: Course code is required.`);
        return;
      }
      if (!r.title.trim()) {
        setModalError(`Subject #${i + 1}: Subject title is required.`);
        return;
      }
      if (Number(r.units) <= 0) {
        setModalError(`Subject #${i + 1}: Units must be greater than 0.`);
        return;
      }
      if (Number(r.lecture_hours) + Number(r.lab_hours) <= 0) {
        setModalError(`Subject #${i + 1}: Total hours (lecture + lab) must be greater than 0.`);
        return;
      }
    }

    startTransition(async () => {
      try {
        if (editingSubject) {
          const row = tableRows[0];
          await saveSubjectAction(
            editingSubject.id,
            {
              code: row.code.trim().toUpperCase(),
              title: row.title.trim(),
              units: row.units,
              lecture_hours: row.lecture_hours,
              lab_hours: row.lab_hours,
              requires_lab: row.facility === 'lab',
              is_bsit: row.category === 'bsit_major',
            },
            {
              yearLevel: row.year_level,
              semester: row.semester,
              facility: row.facility,
              preferredRoomId: row.preferredRoomId || undefined,
              order: row.order ?? 0,
            }
          );

          const updatedRecord: SubjectMetaRecord = {
            yearLevel: row.year_level,
            semester: row.semester,
            facility: row.facility,
            preferredRoomId: row.preferredRoomId || undefined,
            order: row.order ?? 0,
          };

          setMetadataMap((prev) => ({
            ...prev,
            [editingSubject.id]: updatedRecord,
            [row.code.trim().toUpperCase()]: updatedRecord,
          }));

          setIsModalOpen(false);
          setBannerNotice({
            type: 'success',
            message: `Subject ${row.code} updated successfully.`,
          });
        } else {
          const payload: BatchSubjectInput[] = tableRows.map((r, i) => ({
            code: r.code.trim().toUpperCase(),
            title: r.title.trim(),
            year_level: r.year_level,
            semester: r.semester,
            facility: r.facility,
            category: r.category,
            is_bsit: r.category === 'bsit_major',
            units: Number(r.units),
            lecture_hours: Number(r.lecture_hours || 0),
            lab_hours: Number(r.lab_hours || 0),
            order: i,
          }));

          const res = await saveSubjectsBatchAction(payload);
          if (res.metadataMap) {
            setMetadataMap((prev) => ({ ...prev, ...res.metadataMap }));
          }
          setIsModalOpen(false);
          setBannerNotice({
            type: 'success',
            message: `Successfully created ${res.count} subject${res.count === 1 ? '' : 's'}.`,
          });
        }
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to save subjects.');
      }
    });
  };

  const handleDelete = (sub: Subject) => {
    if (!confirm(`Are you sure you want to delete subject ${sub.code}?`)) return;

    startTransition(async () => {
      try {
        await deleteSubjectAction(sub.id);
        setSelectedIds((prev) => prev.filter((id) => id !== sub.id));
        setBannerNotice({
          type: 'success',
          message: `Deleted subject ${sub.code}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete subject.',
        });
      }
    });
  };

  const handleBulkDelete = (idsToDelete: string[]) => {
    if (idsToDelete.length === 0) return;

    const count = idsToDelete.length;
    const confirmMsg = `Are you sure you want to delete all ${count} selected subjects? This action cannot be undone.`;

    if (!confirm(confirmMsg)) return;

    startTransition(async () => {
      try {
        const res = await deleteSubjectsBulkAction(idsToDelete);
        setSelectedIds([]);
        setBannerNotice({
          type: 'success',
          message: `Successfully deleted ${res.count} subject${res.count === 1 ? '' : 's'}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete selected subjects.',
        });
      }
    });
  };

  const toggleSelectAllForYearLevel = (yearLevelSubjects: Subject[]) => {
    const ids = yearLevelSubjects.map((s) => s.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Drag and Drop arrangement handler
  const handleDropOnSubject = (targetSub: Subject, yearLevel: string) => {
    if (!draggedSubjectId || draggedSubjectId === targetSub.id) {
      setDraggedSubjectId(null);
      setDragOverSubjectId(null);
      return;
    }

    const currentList = subjectsByYearLevel[yearLevel] || [];
    const draggedItem = subjects.find((s) => s.id === draggedSubjectId);
    if (!draggedItem) {
      setDraggedSubjectId(null);
      setDragOverSubjectId(null);
      return;
    }

    const filtered = currentList.filter((s) => s.id !== draggedSubjectId);
    const targetIndex = filtered.findIndex((s) => s.id === targetSub.id);

    const reordered: Subject[] = [...filtered];
    if (targetIndex >= 0) {
      reordered.splice(targetIndex, 0, draggedItem);
    } else {
      reordered.push(draggedItem);
    }

    const orderMap: Record<string, number> = {};
    const updatedMetaBatch: Record<string, SubjectMetaRecord> = {};

    reordered.forEach((s, idx) => {
      orderMap[s.id] = idx;
      orderMap[s.code.toUpperCase()] = idx;
      const prevMeta = getSubjectMeta(s, metadataMap);
      const newMeta: SubjectMetaRecord = {
        ...prevMeta,
        yearLevel,
        order: idx,
      };
      updatedMetaBatch[s.id] = newMeta;
      updatedMetaBatch[s.code.toUpperCase()] = newMeta;
    });

    setMetadataMap((prev) => ({ ...prev, ...updatedMetaBatch }));
    setDraggedSubjectId(null);
    setDragOverSubjectId(null);

    startTransition(async () => {
      try {
        await saveSubjectsOrderAction(orderMap);
        setBannerNotice({
          type: 'success',
          message: 'Arrangement saved successfully.',
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to save order.',
        });
      }
    });
  };

  // Department counts
  const collegeSubjectsCount = useMemo(() => {
    return subjects.filter((s) => !isHighSchoolSubject(s, metadataMap)).length;
  }, [subjects, metadataMap]);

  const highSchoolSubjectsCount = useMemo(() => {
    return subjects.filter((s) => isHighSchoolSubject(s, metadataMap)).length;
  }, [subjects, metadataMap]);

  // Active department's subjects
  const departmentSubjects = useMemo(() => {
    return subjects.filter((s) => {
      const isHS = isHighSchoolSubject(s, metadataMap);
      return activeDepartment === 'high_school' ? isHS : !isHS;
    });
  }, [subjects, activeDepartment, metadataMap]);

  // Semester counts for active department
  const semesterCounts = useMemo(() => {
    let sem1 = 0;
    let sem2 = 0;
    for (const s of departmentSubjects) {
      const meta = getSubjectMeta(s, metadataMap);
      if (meta.semester === '2nd Semester') sem2++;
      else sem1++;
    }
    return { sem1, sem2, all: departmentSubjects.length };
  }, [departmentSubjects, metadataMap]);

  // Track counts for College Department
  const trackCounts = useMemo(() => {
    let bsit = 0;
    let minor = 0;
    for (const s of departmentSubjects) {
      const meta = getSubjectMeta(s, metadataMap);
      if (semesterFilter !== 'all' && meta.semester !== semesterFilter) continue;
      const cat = getSubjectCategory(s, metadataMap);
      if (cat === 'bsit_major') bsit++;
      else if (cat === 'non_bsit_minor') minor++;
    }
    return { bsit, minor };
  }, [departmentSubjects, metadataMap, semesterFilter]);

  // Active Year/Grade Levels to display
  const targetYearLevels = useMemo(() => {
    if (activeDepartment === 'high_school') {
      const list = [...HIGH_SCHOOL_YEAR_LEVELS];
      for (const s of departmentSubjects) {
        const meta = getSubjectMeta(s, metadataMap);
        if (meta.yearLevel && !list.includes(meta.yearLevel)) {
          list.push(meta.yearLevel);
        }
      }
      return list;
    } else {
      const list = [...COLLEGE_YEAR_LEVELS];
      for (const s of departmentSubjects) {
        const meta = getSubjectMeta(s, metadataMap);
        if (meta.yearLevel && !list.includes(meta.yearLevel)) {
          list.push(meta.yearLevel);
        }
      }
      return list;
    }
  }, [activeDepartment, departmentSubjects, metadataMap]);

  // Group filtered subjects by Year Level for active department
  const subjectsByYearLevel = useMemo(() => {
    const map: Record<string, Subject[]> = {};
    for (const yl of targetYearLevels) {
      map[yl] = [];
    }

    const q = searchQuery.trim().toLowerCase();

    for (const s of departmentSubjects) {
      const meta = getSubjectMeta(s, metadataMap);

      // Semester Filter
      if (semesterFilter !== 'all' && meta.semester !== semesterFilter) {
        continue;
      }

      // Track Filter (College only)
      if (activeDepartment === 'college') {
        const cat = getSubjectCategory(s, metadataMap);
        if (categoryFilter !== 'all' && cat !== categoryFilter) {
          continue;
        }
      }

      // Search Query
      if (q) {
        const matchesCode = (s.code || '').toLowerCase().includes(q);
        const matchesTitle = (s.title || '').toLowerCase().includes(q);
        if (!matchesCode && !matchesTitle) continue;
      }

      const yl = meta.yearLevel || (activeDepartment === 'high_school' ? 'Grade 11 (SHS)' : '1st Year');
      if (!map[yl]) map[yl] = [];
      map[yl].push(s);
    }

    // Sort subjects in each year level by their saved `order`
    for (const yl of Object.keys(map)) {
      map[yl].sort((a, b) => {
        const orderA = getSubjectMeta(a, metadataMap).order ?? 0;
        const orderB = getSubjectMeta(b, metadataMap).order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.code.localeCompare(b.code);
      });
    }

    return map;
  }, [departmentSubjects, metadataMap, semesterFilter, categoryFilter, searchQuery, targetYearLevels, activeDepartment]);

  // Summary stats for active department
  const totalDepartmentUnits = useMemo(() => {
    return departmentSubjects.reduce((acc, s) => acc + Number(s.units || 0), 0);
  }, [departmentSubjects]);

  const totalDepartmentHours = useMemo(() => {
    return departmentSubjects.reduce(
      (acc, s) => acc + Number(s.lecture_hours || 0) + Number(s.lab_hours || 0),
      0
    );
  }, [departmentSubjects]);

  const isHighSchool = activeDepartment === 'high_school';

  return (
    <div className="space-y-4">
      {bannerNotice && (
        <div
          className={`alert ${
            bannerNotice.type === 'success' ? 'alert-success' : 'alert-danger'
          } d-flex justify-content-between align-items-center rounded-4 shadow-sm border-0 py-3 px-4 mb-4`}
        >
          <span className="small fw-semibold">{bannerNotice.message}</span>
          <button
            onClick={() => setBannerNotice(null)}
            className="btn btn-sm btn-link text-decoration-none text-muted p-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating Action Bar for Bulk Deletion (Visible only when 2 or more are selected and not in scheduler mode) */}
      {!isScheduler && selectedIds.length >= 2 && (
        <div
          className="position-fixed bottom-0 start-50 translate-middle-x mb-4 shadow-lg rounded-pill bg-dark text-white px-4 py-3 d-flex align-items-center gap-3 border border-secondary"
          style={{ zIndex: 1050 }}
        >
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-danger rounded-pill px-2.5 py-1 fw-bold">
              {selectedIds.length}
            </span>
            <span className="small fw-semibold">subjects selected</span>
          </div>
          <div className="vr bg-secondary opacity-50 my-1"></div>
          <button
            type="button"
            onClick={() => handleBulkDelete(selectedIds)}
            disabled={isPending}
            className="btn btn-sm btn-danger rounded-pill px-3.5 py-1 fw-bold d-inline-flex align-items-center gap-2"
          >
            <i className="bi bi-trash3"></i>
            <span>Delete Selected Subjects</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="btn btn-sm btn-link text-white-50 text-decoration-none p-0 ms-1"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Department Switcher Tabs / Segmented Slide */}
      <div className="d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-3 p-1">
        <div className="bg-white p-1.5 rounded-pill shadow-sm border border-light-subtle d-inline-flex align-items-center gap-1">
          <button
            type="button"
            onClick={() => handleSwitchDepartment('college')}
            className={`btn rounded-pill px-4 py-2 fw-bold d-inline-flex align-items-center gap-2 transition-all ${
              activeDepartment === 'college'
                ? 'btn-ref-primary text-white shadow-sm'
                : 'text-secondary hover:text-dark'
            }`}
          >
            <i className="bi bi-mortarboard-fill fs-5"></i>
            <span>BSIT</span>
            <span
              className={`badge rounded-pill ms-1 ${
                activeDepartment === 'college'
                  ? 'bg-white text-primary'
                  : 'bg-secondary-subtle text-secondary'
              }`}
            >
              {collegeSubjectsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchDepartment('high_school')}
            className={`btn rounded-pill px-4 py-2 fw-bold d-inline-flex align-items-center gap-2 transition-all ${
              activeDepartment === 'high_school'
                ? 'btn-success text-white shadow-sm'
                : 'text-secondary hover:text-dark'
            }`}
          >
            <i className="bi bi-building fs-5"></i>
            <span>High School Department</span>
            <span
              className={`badge rounded-pill ms-1 ${
                activeDepartment === 'high_school'
                  ? 'bg-white text-success'
                  : 'bg-secondary-subtle text-secondary'
              }`}
            >
              {highSchoolSubjectsCount}
            </span>
          </button>
        </div>

        {/* Department Badge */}
        <div className="d-none d-md-flex align-items-center gap-2">
          {isHighSchool ? (
            <span className="badge bg-success-subtle text-success border border-success-subtle px-3 py-1.5 rounded-pill fw-semibold small d-inline-flex align-items-center gap-1.5">
              <i className="bi bi-shield-check"></i>
              <span>Basic Education (Junior &amp; Senior High)</span>
            </span>
          ) : (
            <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-1.5 rounded-pill fw-semibold small d-inline-flex align-items-center gap-1.5">
              <i className="bi bi-mortarboard"></i>
              <span>Higher Education (BSIT)</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Department Header Card */}
      <div
        className={`rounded-4 p-4 shadow-sm border transition-all ${
          isHighSchool
            ? 'bg-white border-success-subtle'
            : 'bg-white border-light-subtle'
        }`}
      >
        <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 mb-4">
          <div className="d-flex align-items-center gap-3">
            <div
              className={`p-3 rounded-4 d-flex align-items-center justify-content-center shadow-sm ${
                isHighSchool
                  ? 'bg-success text-white'
                  : 'bg-primary text-white'
              }`}
            >
              <i className={`fs-3 ${isHighSchool ? 'bi bi-building' : 'bi bi-mortarboard-fill'}`}></i>
            </div>
            <div>
              <div className="d-flex align-items-center gap-2">
                <h1 className="h4 fw-bold text-dark mb-0">
                  {isHighSchool
                    ? 'High School Department Curriculum & Subjects'
                    : 'BSIT Curriculum & Subjects Catalog'}
                </h1>
                <span
                  className={`badge rounded-pill px-2.5 py-1 small fw-semibold ${
                    isHighSchool
                      ? 'bg-success-subtle text-success border border-success-subtle'
                      : 'bg-primary-subtle text-primary border border-primary-subtle'
                  }`}
                >
                  {isHighSchool ? 'High School Department' : 'BSIT'}
                </span>
              </div>
              <p className="text-secondary small mb-0 mt-1">
                {isHighSchool
                  ? 'Manage Junior High School (Grades 7–10) and Senior High School (Grades 11–12) subjects separated by semester and grade levels.'
                  : 'Manage department subjects separated by academic semester and year levels. Configure lecture and lab weekly allocations.'}
              </p>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            {isScheduler ? (
              <span className="badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 fw-semibold small d-inline-flex align-items-center gap-1.5 shadow-sm">
                <i className="bi bi-shield-check"></i>
                <span>Scheduler Mode (Facilities &amp; Hours)</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleOpenAdd()}
                className={`btn btn-sm rounded-pill px-3.5 py-2 fw-semibold d-inline-flex align-items-center gap-2 shadow-sm ${
                  isHighSchool
                    ? 'btn-success text-white'
                    : 'btn-ref-primary text-white'
                }`}
              >
                <i className="bi bi-plus-lg fw-bold"></i>
                <span>{isHighSchool ? 'Add High School Subject' : 'Add BSIT Subject'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Quick Stats Pill Banner */}
        <div
          className={`p-3 rounded-4 border d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4 ${
            isHighSchool ? 'bg-success-subtle/30 border-success-subtle' : 'bg-light border-light-subtle'
          }`}
        >
          <div className="d-flex align-items-center gap-3">
            <div className="small text-secondary">
              <span className="fw-bold text-dark fs-6 me-1">{departmentSubjects.length}</span>
              <span>Total Subjects</span>
            </div>
            <span className="text-muted">•</span>
            <div className="small text-secondary">
              <span className="fw-bold text-dark fs-6 me-1">{totalDepartmentUnits}</span>
              <span>Total Units</span>
            </div>
            <span className="text-muted">•</span>
            <div className="small text-secondary">
              <span className="fw-bold text-dark fs-6 me-1">{totalDepartmentHours}</span>
              <span>Total Weekly Hours</span>
            </div>
          </div>

          <div className="small text-muted font-monospace">
            <i className="bi bi-arrow-left-right me-1"></i>
            <span>Drag rows inside any table to arrange subjects</span>
          </div>
        </div>

        {/* Semester Segmented Tabs & Search */}
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 pt-2 border-top">
          <div className="d-inline-flex p-1 bg-light rounded-pill border">
            <button
              type="button"
              onClick={() => setSemesterFilter('1st Semester')}
              className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-bold transition-all ${
                semesterFilter === '1st Semester'
                  ? isHighSchool
                    ? 'btn-success text-white shadow-sm'
                    : 'btn-ref-primary text-white shadow-sm'
                  : 'text-secondary hover:text-dark'
              }`}
            >
              <span>1st Semester</span>
              <span
                className={`badge rounded-pill ms-2 ${
                  semesterFilter === '1st Semester'
                    ? isHighSchool
                      ? 'bg-white text-success'
                      : 'bg-white text-primary'
                    : 'bg-secondary-subtle text-secondary'
                }`}
              >
                {semesterCounts.sem1}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSemesterFilter('2nd Semester')}
              className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-bold transition-all ${
                semesterFilter === '2nd Semester'
                  ? isHighSchool
                    ? 'btn-success text-white shadow-sm'
                    : 'btn-ref-primary text-white shadow-sm'
                  : 'text-secondary hover:text-dark'
              }`}
            >
              <span>2nd Semester</span>
              <span
                className={`badge rounded-pill ms-2 ${
                  semesterFilter === '2nd Semester'
                    ? isHighSchool
                      ? 'bg-white text-success'
                      : 'bg-white text-primary'
                    : 'bg-secondary-subtle text-secondary'
                }`}
              >
                {semesterCounts.sem2}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSemesterFilter('all')}
              className={`btn btn-sm rounded-pill px-3 py-1.5 fw-bold transition-all ${
                semesterFilter === 'all'
                  ? 'btn-dark text-white shadow-sm'
                  : 'text-secondary hover:text-dark'
              }`}
            >
              <span>All Semesters</span>
              <span
                className={`badge rounded-pill ms-2 ${
                  semesterFilter === 'all'
                    ? 'bg-white text-dark'
                    : 'bg-secondary-subtle text-secondary'
                }`}
              >
                {semesterCounts.all}
              </span>
            </button>
          </div>

          {/* Search Input */}
          <div className="position-relative" style={{ minWidth: '260px' }}>
            <i className="bi bi-search position-absolute top-50 start-0 translate-middle-y ms-3 text-secondary small"></i>
            <input
              type="text"
              placeholder={`Search ${isHighSchool ? 'high school' : 'BSIT'} subjects...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control form-control-sm rounded-pill ps-4.5 pe-3 py-1.5 ref-form-control bg-light"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="btn btn-sm btn-link position-absolute top-50 end-0 translate-middle-y me-2 text-muted p-0 text-decoration-none"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Track Filter Pills (College Only) */}
        {!isHighSchool && (
          <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
            <span className="small text-muted fw-semibold me-1">Track Filter:</span>
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`btn btn-xs rounded-pill px-3 py-1 small fw-semibold ${
                categoryFilter === 'all'
                  ? 'btn-dark text-white'
                  : 'btn-outline-secondary'
              }`}
            >
              All Tracks
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('bsit_major')}
              className={`btn btn-xs rounded-pill px-3 py-1 small fw-semibold ${
                categoryFilter === 'bsit_major'
                  ? 'btn-ref-primary text-white'
                  : 'btn-outline-secondary'
              }`}
            >
              BSIT Major ({trackCounts.bsit})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('non_bsit_minor')}
              className={`btn btn-xs rounded-pill px-3 py-1 small fw-semibold ${
                categoryFilter === 'non_bsit_minor'
                  ? 'btn-ref-primary text-white'
                  : 'btn-outline-secondary'
              }`}
            >
              Non-BSIT / Minor ({trackCounts.minor})
            </button>
          </div>
        )}
      </div>

      {/* Separated Year / Grade Level Tables */}
      <div className="space-y-4">
        {targetYearLevels.map((yearLevel) => {
          const yearSubjects = subjectsByYearLevel[yearLevel] || [];
          const totalUnits = yearSubjects.reduce((acc, s) => acc + Number(s.units || 0), 0);
          const totalHours = yearSubjects.reduce(
            (acc, s) => acc + Number(s.lecture_hours || 0) + Number(s.lab_hours || 0),
            0
          );
          const allSelectedInYear =
            yearSubjects.length > 0 &&
            yearSubjects.every((s) => selectedIds.includes(s.id));

          return (
            <div
              key={yearLevel}
              className={`bg-white rounded-4 shadow-sm border overflow-hidden ${
                isHighSchool ? 'border-success-subtle' : 'border-light-subtle'
              }`}
            >
              {/* Year Level Table Header */}
              <div
                className={`d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between p-3.5 px-4 border-bottom gap-2 ${
                  isHighSchool ? 'bg-success-subtle/20' : 'bg-light'
                }`}
              >
                <div className="d-flex align-items-center gap-3">
                  <div
                    className={`rounded-3 p-2 d-flex align-items-center justify-content-center ${
                      isHighSchool
                        ? 'bg-success text-white'
                        : 'bg-primary-subtle text-primary'
                    }`}
                  >
                    <i className={`fs-5 ${isHighSchool ? 'bi bi-backpack-fill' : 'bi bi-mortarboard-fill'}`}></i>
                  </div>
                  <div>
                    <div className="d-flex align-items-center gap-2">
                      <h2 className="h6 fw-bold text-dark mb-0">{yearLevel}</h2>
                      <span
                        className={`badge rounded-pill px-2.5 py-0.5 small fw-semibold ${
                          isHighSchool ? 'bg-success text-white' : 'bg-primary text-white'
                        }`}
                      >
                        {yearSubjects.length} Subject{yearSubjects.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="text-secondary small mt-0.5">
                      <span>{semesterFilter === 'all' ? 'All Semesters' : semesterFilter}</span>
                      <span className="mx-1.5">•</span>
                      <span className="fw-semibold text-dark">{totalUnits}</span> total units
                      <span className="mx-1.5">•</span>
                      <span className="fw-semibold text-dark">{totalHours}</span> weekly hours
                    </div>
                  </div>
                </div>

                <div className="d-flex align-items-center gap-2">
                  {!isScheduler && (
                    <span className="text-muted small d-none d-md-inline font-monospace" style={{ fontSize: '11px' }}>
                      <i className="bi bi-grip-vertical me-1"></i>Drag rows to arrange
                    </span>
                  )}
                  {!isScheduler && (
                    <button
                      type="button"
                      onClick={() => handleOpenAdd(yearLevel)}
                      className={`btn btn-sm rounded-pill px-3 py-1 fw-semibold d-inline-flex align-items-center gap-1.5 ${
                        isHighSchool ? 'btn-outline-success' : 'btn-outline-primary'
                      }`}
                    >
                      <i className="bi bi-plus-lg"></i>
                      <span>Add to {yearLevel}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Table or Empty State */}
              {yearSubjects.length === 0 ? (
                <div className="p-5 text-center text-muted">
                  <i
                    className={`fs-1 opacity-50 mb-2 d-block ${
                      isHighSchool ? 'bi bi-backpack text-success' : 'bi bi-journal-x text-secondary'
                    }`}
                  ></i>
                  <p className="small fw-semibold mb-1">
                    No subjects configured for {yearLevel} in{' '}
                    {semesterFilter === 'all' ? 'any semester' : semesterFilter}.
                  </p>
                  <p className="text-secondary small mb-3">
                    {isScheduler
                      ? 'No subjects currently assigned to this curriculum level.'
                      : `Click the button below to add ${isHighSchool ? 'high school' : 'BSIT'} subjects to this level.`}
                  </p>
                  {!isScheduler && (
                    <button
                      type="button"
                      onClick={() => handleOpenAdd(yearLevel)}
                      className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-semibold ${
                        isHighSchool ? 'btn-outline-success' : 'btn-outline-primary'
                      }`}
                    >
                      + Add Subject to {yearLevel}
                    </button>
                  )}
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover align-middle mb-0" style={{ fontSize: '13.5px' }}>
                    <thead className="table-light text-secondary text-uppercase fw-semibold" style={{ fontSize: '11px', letterSpacing: '0.5px' }}>
                      <tr>
                        {!isScheduler && (
                          <th style={{ width: '40px' }} className="text-center">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={allSelectedInYear}
                              onChange={() => toggleSelectAllForYearLevel(yearSubjects)}
                              title="Select all in this level"
                            />
                          </th>
                        )}
                        <th style={{ width: '45px' }} className="text-center" title={isScheduler ? "Curriculum Order" : "Drag to arrange"}>
                          Order
                        </th>
                        <th style={{ minWidth: '130px' }}>Course Code</th>
                        <th style={{ minWidth: '240px' }}>Subject Title</th>
                        <th style={{ minWidth: '140px' }}>Category / Track</th>
                        <th style={{ width: '80px' }} className="text-center">Units</th>
                        <th style={{ minWidth: '130px' }}>Weekly Hours</th>
                        <th style={{ minWidth: '150px' }}>Facility</th>
                        <th style={{ width: '130px' }} className="text-end pe-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearSubjects.map((s) => {
                        const meta = getSubjectMeta(s, metadataMap);
                        const isSelected = selectedIds.includes(s.id);
                        const isDragging = draggedSubjectId === s.id;
                        const isDragOver = dragOverSubjectId === s.id;
                        const hoursText = formatWeeklyHours(s.lecture_hours, s.lab_hours);
                        const cat = getSubjectCategory(s, metadataMap);

                        return (
                          <tr
                            key={s.id}
                            draggable={!isScheduler}
                            onDragStart={(e) => {
                              if (isScheduler) return;
                              setDraggedSubjectId(s.id);
                              e.dataTransfer.setData('text/plain', s.id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(e) => {
                              if (isScheduler) return;
                              e.preventDefault();
                              if (draggedSubjectId && draggedSubjectId !== s.id) {
                                setDragOverSubjectId(s.id);
                              }
                            }}
                            onDragLeave={() => {
                              if (isScheduler) return;
                              if (dragOverSubjectId === s.id) {
                                setDragOverSubjectId(null);
                              }
                            }}
                            onDrop={(e) => {
                              if (isScheduler) return;
                              e.preventDefault();
                              handleDropOnSubject(s, yearLevel);
                            }}
                            onDragEnd={() => {
                              if (isScheduler) return;
                              setDraggedSubjectId(null);
                              setDragOverSubjectId(null);
                            }}
                            className={`${isSelected ? 'table-primary-subtle' : ''} ${
                              isDragging ? 'opacity-50 bg-light' : ''
                            } ${
                              isDragOver
                                ? isHighSchool
                                  ? 'border-top border-2 border-success'
                                  : 'border-top border-2 border-primary'
                                : ''
                            } transition-all`}
                            style={{ cursor: isScheduler ? 'default' : 'grab' }}
                          >
                            {!isScheduler && (
                              <td className="text-center">
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={isSelected}
                                  onChange={() => toggleSelectRow(s.id)}
                                />
                              </td>
                            )}
                            <td className="text-center text-muted">
                              <span
                                className="d-inline-flex align-items-center justify-content-center p-1 rounded hover-bg-light"
                                title={isScheduler ? "Curriculum Order" : "Drag to arrange"}
                              >
                                <i className="bi bi-grip-vertical text-secondary fs-6"></i>
                              </span>
                            </td>
                            <td>
                              <span className="fw-bold font-monospace text-dark">
                                {s.code}
                              </span>
                            </td>
                            <td>
                              <span className="fw-medium text-dark">{s.title}</span>
                            </td>
                            <td>
                              {cat === 'bsit_major' && (
                                <span className="pill-status pill-status-progress">BSIT Major</span>
                              )}
                              {cat === 'high_school' && (
                                <span className="pill-status pill-status-review">High School</span>
                              )}
                              {cat === 'non_bsit_minor' && (
                                <span className="pill-status pill-status-archived">Non-BSIT / Minor</span>
                              )}
                            </td>
                            <td className="text-center font-monospace fw-bold text-dark">
                              {s.units}
                            </td>
                            <td>
                              <span className="small text-muted font-monospace fw-semibold">
                                {hoursText}
                              </span>
                            </td>
                            <td>
                              {meta.facility === 'lab' && (
                                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2.5 py-1 rounded-pill small fw-semibold">
                                  Requires Lab
                                </span>
                              )}
                              {meta.facility === 'unspecified' && (
                                <span
                                  className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2.5 py-1 rounded-pill small fw-semibold"
                                  title="Can be taken across any available room at instructor's decision"
                                >
                                  Unspecified Room
                                </span>
                              )}
                              {(meta.facility === 'lecture' || !meta.facility) && (
                                <span className="badge bg-light text-secondary border px-2.5 py-1 rounded-pill small">
                                  Lecture Room
                                </span>
                              )}
                            </td>
                            <td className="text-end pe-4">
                              <div className="d-flex align-items-center justify-content-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(s)}
                                  disabled={isPending}
                                  className={`btn btn-xs rounded-pill px-3 py-1 fw-semibold ${
                                    isScheduler
                                      ? 'btn-ref-primary text-white shadow-sm'
                                      : 'btn-light border text-dark'
                                  }`}
                                  title={isScheduler ? "Configure Facility & Weekly Hours" : "Edit Subject"}
                                >
                                  <i className={`bi ${isScheduler ? 'bi-sliders me-1' : ''}`}></i>
                                  {isScheduler ? 'Configure' : 'Edit'}
                                </button>
                                {!isScheduler && (
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(s)}
                                    disabled={isPending}
                                    className="btn btn-xs btn-outline-danger rounded-pill px-2.5 py-1 fw-semibold"
                                    title="Delete Subject"
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add / Edit Subject Modal (Clean Borderless Spreadsheet Grid Layout) */}
      <FormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={
          editingSubject
            ? isScheduler
              ? 'Configure Facility & Weekly Hours'
              : 'Edit Curriculum Subject'
            : isHighSchool
            ? 'Add High School Subjects (Table Layout)'
            : 'Add BSIT Subjects (Table Layout)'
        }
        description={
          editingSubject
            ? isScheduler
              ? 'Configure facility type, lecture hours, and laboratory hours for timetable generation and scheduling.'
              : 'Update academic subject details, units, semester, and facility in the spreadsheet layout.'
            : isHighSchool
            ? 'Enter High School subject details in the spreadsheet table below. Click "+ Add Another Subject" to queue multiple courses.'
            : 'Enter BSIT subject details in the spreadsheet table below. Click "+ Add Another Subject" to queue multiple courses.'
        }
        onSubmit={handleSubmit}
        isSubmitting={isPending}
        error={modalError}
        submitLabel={
          editingSubject
            ? 'Save Changes'
            : tableRows.length > 1
            ? `Save All (${tableRows.length}) Subjects`
            : 'Save Subject'
        }
        size="xl"
        maxWidth="1380px"
      >
        {/* Style to eliminate the nested rectangle border inside each table cell and hide spinner arrows */}
        <style jsx>{`
          .cell-grid-input {
            border: none !important;
            background: transparent !important;
            box-shadow: none !important;
            outline: none !important;
            border-radius: 0 !important;
            width: 100%;
            height: 100%;
            padding: 8px 10px;
            font-size: 13px;
            color: #212529;
            transition: background-color 0.15s ease, box-shadow 0.15s ease;
          }
          .cell-grid-input:focus {
            background-color: #f0f4ff !important;
            box-shadow: inset 0 0 0 2px #0E0AB8 !important;
          }
          .cell-grid-input:disabled {
            background-color: #f8fafc !important;
            color: #64748b !important;
            cursor: not-allowed !important;
          }
          .cell-grid-number {
            border: none !important;
            background: transparent !important;
            box-shadow: none !important;
            outline: none !important;
            border-radius: 0 !important;
            width: 100% !important;
            height: 100% !important;
            padding: 8px 4px !important;
            font-size: 13.5px !important;
            font-weight: 700 !important;
            color: #0f172a !important;
            text-align: center !important;
            font-family: monospace, ui-monospace, sans-serif !important;
            -webkit-appearance: none !important;
            -moz-appearance: textfield !important;
            appearance: textfield !important;
            transition: background-color 0.15s ease, box-shadow 0.15s ease;
          }
          .cell-grid-number::-webkit-outer-spin-button,
          .cell-grid-number::-webkit-inner-spin-button {
            -webkit-appearance: none !important;
            margin: 0 !important;
            display: none !important;
          }
          .cell-grid-number:focus {
            background-color: #f0f4ff !important;
            box-shadow: inset 0 0 0 2px #0E0AB8 !important;
          }
          .cell-grid-number:disabled {
            background-color: #f8fafc !important;
            color: #64748b !important;
            cursor: not-allowed !important;
          }
          .cell-grid-select {
            border: none !important;
            background: transparent !important;
            box-shadow: none !important;
            outline: none !important;
            border-radius: 0 !important;
            width: 100%;
            height: 100%;
            padding: 8px 6px;
            font-size: 12.5px;
            color: #212529;
            cursor: pointer;
            transition: background-color 0.15s ease, box-shadow 0.15s ease;
          }
          .cell-grid-select:focus {
            background-color: #f0f4ff !important;
            box-shadow: inset 0 0 0 2px #0E0AB8 !important;
          }
          .cell-grid-select:disabled {
            background-color: #f8fafc !important;
            color: #64748b !important;
            cursor: not-allowed !important;
          }
          .cell-grid-td {
            padding: 0 !important;
            vertical-align: middle !important;
            border-color: #e2e8f0 !important;
          }
        `}</style>

        {isScheduler && (
          <div className="alert alert-info py-2.5 px-3 rounded-3 small d-flex align-items-center gap-2.5 mb-3 border-0 bg-primary-subtle text-primary-emphasis">
            <i className="bi bi-shield-lock-fill fs-5 text-primary"></i>
            <div>
              <div className="fw-bold">Scheduler Configuration Mode</div>
              <div className="text-secondary small">
                You can adjust <strong>Facility Type</strong>, <strong>Lecture Hours</strong>, and <strong>Lab Hours</strong>. Core curriculum attributes (Course Code, Title, Units, Track, Year Level, and Semester) are locked by administration.
              </div>
            </div>
          </div>
        )}

        <div className="border rounded-4 bg-white shadow-sm mb-3 overflow-hidden">
          <table className="table table-bordered align-middle mb-0 w-100" style={{ fontSize: '13px' }}>
            <thead className="table-light text-secondary text-uppercase fw-semibold" style={{ fontSize: '11px', letterSpacing: '0.4px' }}>
              <tr>
                <th style={{ width: '32px' }} className="text-center">#</th>
                <th style={{ width: '100px' }}>Course Code</th>
                <th>Subject Title</th>
                <th style={{ width: '115px' }}>Semester</th>
                <th style={{ width: '135px' }}>Year / Grade</th>
                <th style={{ width: '130px' }}>Category / Track</th>
                <th style={{ width: '60px' }} className="text-center" title="Credit Units">Units</th>
                <th style={{ width: '65px' }} className="text-center" title="Lecture Hours">Lec Hrs</th>
                <th style={{ width: '65px' }} className="text-center" title="Laboratory Hours">Lab Hrs</th>
                <th style={{ width: '145px' }}>Facility</th>
                {rooms.length > 0 && <th style={{ width: '170px' }}>Preferred Room</th>}
                {!editingSubject && !isScheduler && <th style={{ width: '40px' }} className="text-center"></th>}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, idx) => (
                <tr key={idx}>
                  <td className="text-center fw-bold text-muted small bg-light">{idx + 1}</td>
                  <td className="cell-grid-td">
                    <input
                      type="text"
                      required
                      placeholder="e.g. IT111"
                      value={row.code}
                      disabled={isScheduler}
                      onChange={(e) => updateTableRow(idx, 'code', e.target.value.toUpperCase())}
                      className="cell-grid-input font-monospace fw-bold"
                    />
                  </td>
                  <td className="cell-grid-td">
                    <input
                      type="text"
                      required
                      placeholder="e.g. Introduction to Computing"
                      value={row.title}
                      disabled={isScheduler}
                      onChange={(e) => updateTableRow(idx, 'title', e.target.value)}
                      className="cell-grid-input"
                    />
                  </td>
                  <td className="cell-grid-td">
                    <select
                      value={row.semester}
                      disabled={isScheduler}
                      onChange={(e) => updateTableRow(idx, 'semester', e.target.value as any)}
                      className="cell-grid-select"
                    >
                      <option value="1st Semester">1st Semester</option>
                      <option value="2nd Semester">2nd Semester</option>
                    </select>
                  </td>
                  <td className="cell-grid-td">
                    <select
                      value={row.year_level}
                      disabled={isScheduler}
                      onChange={(e) => updateTableRow(idx, 'year_level', e.target.value)}
                      className="cell-grid-select"
                    >
                      {isHighSchool ? (
                        <>
                          <option value="Grade 11 (SHS)">Grade 11 (SHS)</option>
                          <option value="Grade 12 (SHS)">Grade 12 (SHS)</option>
                          <option value="Grade 7 (JHS)">Grade 7 (JHS)</option>
                          <option value="Grade 8 (JHS)">Grade 8 (JHS)</option>
                          <option value="Grade 9 (JHS)">Grade 9 (JHS)</option>
                          <option value="Grade 10 (JHS)">Grade 10 (JHS)</option>
                        </>
                      ) : (
                        <>
                          <option value="1st Year">1st Year (BSIT)</option>
                          <option value="2nd Year">2nd Year (BSIT)</option>
                          <option value="3rd Year">3rd Year (BSIT)</option>
                          <option value="4th Year">4th Year (BSIT)</option>
                          <option value="Grade 11 (SHS)">Grade 11 (SHS)</option>
                          <option value="Grade 12 (SHS)">Grade 12 (SHS)</option>
                        </>
                      )}
                    </select>
                  </td>
                  <td className="cell-grid-td">
                    <select
                      value={row.category}
                      disabled={isScheduler}
                      onChange={(e) => {
                        const cat = e.target.value as SubjectCategory;
                        updateTableRow(idx, 'category', cat);
                        updateTableRow(idx, 'is_bsit', cat === 'bsit_major');
                      }}
                      className="cell-grid-select"
                    >
                      {isHighSchool ? (
                        <>
                          <option value="high_school">High School</option>
                          <option value="non_bsit_minor">Non-BSIT / Minor</option>
                          <option value="bsit_major">BSIT Major</option>
                        </>
                      ) : (
                        <>
                          <option value="bsit_major">BSIT Major</option>
                          <option value="non_bsit_minor">Non-BSIT / Minor</option>
                          <option value="high_school">High School</option>
                        </>
                      )}
                    </select>
                  </td>
                  <td className="cell-grid-td">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      required
                      value={row.units}
                      disabled={isScheduler}
                      onChange={(e) => updateTableRow(idx, 'units', parseFloat(e.target.value) || 0)}
                      className="cell-grid-number"
                      title="Units"
                    />
                  </td>
                  <td className="cell-grid-td">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      required
                      value={row.lecture_hours}
                      onChange={(e) => updateTableRow(idx, 'lecture_hours', parseFloat(e.target.value) || 0)}
                      className="cell-grid-number"
                      title="Lecture Hours"
                    />
                  </td>
                  <td className="cell-grid-td">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      required
                      value={row.lab_hours}
                      onChange={(e) => {
                        const lab = parseFloat(e.target.value) || 0;
                        updateTableRow(idx, 'lab_hours', lab);
                        if (lab > 0 && row.facility === 'lecture') {
                          updateTableRow(idx, 'facility', 'lab');
                        }
                      }}
                      className="cell-grid-number"
                      title="Lab Hours"
                    />
                  </td>
                  <td className="cell-grid-td">
                    <select
                      value={row.facility}
                      onChange={(e) => updateTableRow(idx, 'facility', e.target.value as FacilityType)}
                      className="cell-grid-select fw-semibold"
                    >
                      <option value="lecture">Lecture Room</option>
                      <option value="lab">Requires Lab</option>
                      <option value="unspecified">Unspecified Room</option>
                    </select>
                  </td>
                  {rooms.length > 0 && (
                    <td className="cell-grid-td">
                      <select
                        value={row.preferredRoomId || ''}
                        onChange={(e) => updateTableRow(idx, 'preferredRoomId', e.target.value || undefined)}
                        className="cell-grid-select"
                        title="Preferred Room (optional)"
                      >
                        <option value="">Any Room</option>
                        {rooms.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  {!editingSubject && !isScheduler && (
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(idx)}
                        disabled={tableRows.length <= 1}
                        className="btn btn-sm btn-link text-danger p-0 text-decoration-none"
                        title="Remove Row"
                        style={{ opacity: tableRows.length <= 1 ? 0.3 : 1 }}
                      >
                        <i className="bi bi-trash3"></i>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Facility Info Advisory */}
        <div className="bg-light p-3 rounded-4 border d-flex align-items-center gap-2.5 mb-3">
          <i className="bi bi-info-circle-fill text-primary fs-5"></i>
          <p className="small text-secondary mb-0">
            <strong>Unspecified Facility:</strong> This subject can be scheduled across any currently available room at the instructor&apos;s decision. The AlterSched conflict engine guarantees that assigned slots will strictly prevent room collisions and capacity overflows.
          </p>
        </div>

        {/* Plus Sign Button below table to add multiple subjects at once */}
        {!editingSubject && !isScheduler && (
          <div className="d-flex align-items-center justify-content-between p-3 bg-light rounded-4 border">
            <button
              type="button"
              onClick={handleAddRow}
              className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-semibold d-inline-flex align-items-center gap-2 shadow-sm ${
                isHighSchool ? 'btn-outline-success' : 'btn-outline-primary'
              }`}
            >
              <i className="bi bi-plus-lg fw-bold"></i>
              <span>Add Another Subject</span>
            </button>
            <div className="small text-secondary fw-semibold">
              <span
                className={`badge rounded-pill px-2.5 py-1 me-1 ${
                  isHighSchool ? 'bg-success text-white' : 'bg-primary text-white'
                }`}
              >
                {tableRows.length}
              </span>
              subject{tableRows.length === 1 ? '' : 's'} queued
            </div>
          </div>
        )}
      </FormModal>
    </div>
  );
}
