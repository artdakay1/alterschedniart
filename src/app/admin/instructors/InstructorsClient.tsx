// src/app/admin/instructors/InstructorsClient.tsx
'use client';

import React, { useState, useMemo, useTransition, useCallback } from 'react';
import type { Instructor, Subject, Profile, InstructorDepartmentType } from '@/types/database';
import { FormModal } from '@/components/FormModal';
import { AvailabilityEditor } from '@/components/AvailabilityEditor';
import {
  updateInstructorAction,
  saveQualificationsAction,
  saveAvailabilityAction,
} from './actions';
import type {
  InstructorProfileInput,
  InstructorAvailabilitySlotInput,
} from '@/lib/validators/academic';
import type { SubjectMetaRecord } from '@/lib/academic/curriculum-connector';

export type InstructorWithDetails = Instructor & {
  department?: InstructorDepartmentType | null;
  profile?: Profile | null;
  qualifications: string[]; // subject_ids
  availability: InstructorAvailabilitySlotInput[];
};

export type SubjectYearLevelType = string;

export function getSubjectDepartment(
  subject: Subject,
  metadataMap?: Record<string, SubjectMetaRecord>
): 'BSIT' | 'High School' {
  const meta =
    metadataMap?.[subject.id] ||
    metadataMap?.[subject.code?.toUpperCase()] ||
    metadataMap?.[subject.code];
  if (meta?.category === 'high_school') return 'High School';
  if (meta?.category === 'bsit_major' || meta?.category === 'non_bsit_minor') return 'BSIT';

  const code = (subject.code || '').toUpperCase().trim();
  const title = (subject.title || '').toLowerCase();
  if (
    meta?.yearLevel?.includes('Grade') ||
    meta?.yearLevel?.includes('SHS') ||
    meta?.yearLevel?.includes('JHS') ||
    code.startsWith('HS') ||
    code.startsWith('JHS') ||
    code.startsWith('SHS') ||
    code.startsWith('GRADE') ||
    code === 'ROBOTICS' ||
    code === 'IT 1' ||
    title.includes('junior high') ||
    title.includes('senior high') ||
    title.includes('grade ')
  ) {
    return 'High School';
  }
  return 'BSIT';
}

export function getSubjectYearLevel(
  subject: Subject,
  metadataMap?: Record<string, SubjectMetaRecord>
): SubjectYearLevelType {
  const meta =
    metadataMap?.[subject.id] ||
    metadataMap?.[subject.code?.toUpperCase()] ||
    metadataMap?.[subject.code];
  if (meta?.yearLevel) {
    return meta.yearLevel;
  }

  const code = (subject.code || '').toUpperCase().trim();
  const title = (subject.title || '').toLowerCase();

  if (code.includes('11') || title.includes('grade 11')) return 'Grade 11 (SHS)';
  if (code.includes('12') || title.includes('grade 12')) return 'Grade 12 (SHS)';
  if (code.includes('7') || title.includes('grade 7')) return 'Grade 7 (JHS)';
  if (code.includes('8') || title.includes('grade 8')) return 'Grade 8 (JHS)';
  if (code.includes('9') || title.includes('grade 9')) return 'Grade 9 (JHS)';
  if (code.includes('10') || title.includes('grade 10')) return 'Grade 10 (JHS)';
  if (code === 'ROBOTICS' || code === 'IT 1') return 'Grade 12 (SHS)';
  if (code === 'ARDUINO') return 'Grade 11 (SHS)';
  if (code.startsWith('HS')) return 'Grade 11 (SHS)';

  const numMatch = code.match(/\b([1-4])\d{2}\b/) || code.match(/^[A-Z]+(\d)/);
  if (numMatch) {
    const yr = numMatch[1];
    if (yr === '1') return '1st Year';
    if (yr === '2') return '2nd Year';
    if (yr === '3') return '3rd Year';
    if (yr === '4') return '4th Year';
    if (yr === '5') return '5th Year';
  }

  if (title.includes('1st year') || title.includes('year 1')) return '1st Year';
  if (title.includes('2nd year') || title.includes('year 2')) return '2nd Year';
  if (title.includes('3rd year') || title.includes('year 3')) return '3rd Year';
  if (title.includes('4th year') || title.includes('year 4')) return '4th Year';

  return '1st Year';
}

export function truncateSubjectTitle(title: string, maxChars: number = 40): string {
  if (!title) return '';
  if (title.length <= maxChars) return title;
  return title.slice(0, maxChars).trim() + '…';
}

interface InstructorsClientProps {
  instructors: InstructorWithDetails[];
  allSubjects: Subject[];
  metadataMap?: Record<string, SubjectMetaRecord>;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function InstructorsClient({
  instructors,
  allSubjects,
  metadataMap,
}: InstructorsClientProps) {
  const [isPending, startTransition] = useTransition();

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<'all' | 'BSIT' | 'High School' | 'Both'>('all');

  // Expanded Row State (Accordion)
  const [expandedInstructorId, setExpandedInstructorId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'profile' | 'subjects' | 'availability'>('profile');

  // Profile Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<InstructorWithDetails | null>(null);
  const [profileFormData, setProfileFormData] = useState<InstructorProfileInput>({
    employment_type: 'full_time',
    needs_lab_equipment: false,
    department: 'BSIT',
  });

  // Qualifications Modal State & Filters
  const [isQualModalOpen, setIsQualModalOpen] = useState(false);
  const [qualInstructor, setQualInstructor] = useState<InstructorWithDetails | null>(null);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [subjectSearch, setSubjectSearch] = useState('');
  const [qualDeptFilter, setQualDeptFilter] = useState<'all' | 'BSIT' | 'High School'>('all');
  const [qualYearFilter, setQualYearFilter] = useState<'all' | SubjectYearLevelType>('all');

  // Instructor Card Qualifications Filters
  const [cardQualDeptFilter, setCardQualDeptFilter] = useState<'all' | 'BSIT' | 'High School'>('all');
  const [cardQualYearFilter, setCardQualYearFilter] = useState<'all' | SubjectYearLevelType>('all');

  // Availability Modal State
  const [isAvailModalOpen, setIsAvailModalOpen] = useState(false);
  const [availInstructor, setAvailInstructor] = useState<InstructorWithDetails | null>(null);

  const [modalError, setModalError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  // Subject dictionary map for fast lookup
  const subjectsMap = useMemo(() => {
    return new Map<string, Subject>(allSubjects.map((s) => [s.id, s]));
  }, [allSubjects]);

  // Counts for department pills
  const counts = useMemo(() => {
    let bsit = 0;
    let hs = 0;
    let both = 0;
    for (const inst of instructors) {
      const d = inst.department || 'BSIT';
      if (d === 'BSIT') bsit++;
      else if (d === 'High School') hs++;
      else if (d === 'Both') both++;
    }
    return { all: instructors.length, bsit, hs, both };
  }, [instructors]);

  // Filtered instructors list
  const filteredInstructors = useMemo(() => {
    return instructors.filter((inst) => {
      // 1. Department filter
      const dept = inst.department || 'BSIT';
      if (departmentFilter !== 'all' && dept !== departmentFilter) {
        return false;
      }

      // 2. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = inst.full_name.toLowerCase().includes(q);
        const matchesEmail = Boolean(inst.profile?.email?.toLowerCase().includes(q));
        return matchesName || matchesEmail;
      }

      return true;
    });
  }, [instructors, departmentFilter, searchQuery]);

  // Toggle Row Accordion
  const toggleExpand = (instructorId: string) => {
    if (expandedInstructorId === instructorId) {
      setExpandedInstructorId(null);
    } else {
      setExpandedInstructorId(instructorId);
      setActiveTab('profile');
    }
  };

  // 1. Profile Edit Handlers
  const handleOpenEdit = (inst: InstructorWithDetails, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingInstructor(inst);
    setProfileFormData({
      employment_type: inst.employment_type,
      needs_lab_equipment: inst.needs_lab_equipment,
      department: (inst.department as 'BSIT' | 'High School' | 'Both') || 'BSIT',
    });
    setModalError(null);
    setIsEditModalOpen(true);
  };

  const handleSubmitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInstructor) return;
    setModalError(null);

    startTransition(async () => {
      try {
        await updateInstructorAction(editingInstructor.id, profileFormData);
        setIsEditModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Settings updated for ${editingInstructor.full_name} (${profileFormData.department}).`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to update instructor.');
      }
    });
  };

  // 2. Qualifications Handlers
  const handleOpenQualifications = (inst: InstructorWithDetails, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setQualInstructor(inst);
    setSelectedSubjectIds(inst.qualifications);
    setSubjectSearch('');

    // Default modal department to instructor's department if BSIT or High School
    const instDept = inst.department;
    if (instDept === 'High School') {
      setQualDeptFilter('High School');
    } else if (instDept === 'BSIT') {
      setQualDeptFilter('BSIT');
    } else {
      setQualDeptFilter('all');
    }
    setQualYearFilter('all');

    setModalError(null);
    setIsQualModalOpen(true);
  };

  const toggleSubjectSelection = (subjectId: string) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId)
        ? prev.filter((id) => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const handleSelectAllFiltered = () => {
    const idsToAdd = filteredModalSubjects.map((s) => s.id);
    setSelectedSubjectIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
  };

  const handleDeselectAllFiltered = () => {
    const idsToRemove = new Set(filteredModalSubjects.map((s) => s.id));
    setSelectedSubjectIds((prev) => prev.filter((id) => !idsToRemove.has(id)));
  };

  const handleSubmitQualifications = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qualInstructor) return;
    setModalError(null);

    startTransition(async () => {
      try {
        await saveQualificationsAction(qualInstructor.id, selectedSubjectIds);
        setIsQualModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Updated qualifications for ${qualInstructor.full_name} (${selectedSubjectIds.length} subjects).`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to update qualifications.');
      }
    });
  };

  // 3. Availability Handlers
  const handleOpenAvailability = (inst: InstructorWithDetails, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAvailInstructor(inst);
    setIsAvailModalOpen(true);
  };

  const handleSaveAvailability = async (slots: InstructorAvailabilitySlotInput[]) => {
    if (!availInstructor) return;
    await saveAvailabilityAction(availInstructor.id, slots);
    setBannerNotice({
      type: 'success',
      message: `Availability updated for ${availInstructor.full_name} (${slots.length} active slots).`,
    });
  };

  // Helper to match year level filter
  const matchesYearFilter = useCallback(
    (s: Subject, filter: string): boolean => {
      if (filter === 'all') return true;
      const y = getSubjectYearLevel(s, metadataMap);
      const d = getSubjectDepartment(s, metadataMap);
      if (filter === 'High School') {
        return d === 'High School' || /grade|shs|jhs/i.test(y);
      }
      if (filter === 'Grade 11') return y.includes('11');
      if (filter === 'Grade 12') return y.includes('12');
      if (filter === '1st Year') return y.includes('1st Year');
      if (filter === '2nd Year') return y.includes('2nd Year');
      if (filter === '3rd Year') return y.includes('3rd Year');
      if (filter === '4th Year') return y.includes('4th Year');
      return y === filter;
    },
    [metadataMap]
  );

  // Filter subjects in qualification modal by Department, Year Level, and Search
  const filteredModalSubjects = useMemo(() => {
    return allSubjects.filter((s) => {
      if (qualDeptFilter !== 'all') {
        const d = getSubjectDepartment(s, metadataMap);
        if (d !== qualDeptFilter) return false;
      }
      if (qualYearFilter !== 'all') {
        if (!matchesYearFilter(s, qualYearFilter)) return false;
      }
      if (subjectSearch.trim()) {
        const q = subjectSearch.toLowerCase().trim();
        const matches = s.code.toLowerCase().includes(q) || s.title.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [allSubjects, qualDeptFilter, qualYearFilter, subjectSearch, metadataMap, matchesYearFilter]);

  // Counts for modal filters
  const modalDeptCounts = useMemo(() => {
    let bsit = 0;
    let hs = 0;
    for (const s of allSubjects) {
      const d = getSubjectDepartment(s, metadataMap);
      if (d === 'BSIT') bsit++;
      else hs++;
    }
    return { all: allSubjects.length, bsit, hs };
  }, [allSubjects, metadataMap]);

  const modalYearCounts = useMemo(() => {
    const counts: Record<string, number> = {
      '1st Year': 0,
      '2nd Year': 0,
      '3rd Year': 0,
      '4th Year': 0,
      'Grade 11': 0,
      'Grade 12': 0,
      'High School': 0,
    };
    for (const s of allSubjects) {
      if (qualDeptFilter !== 'all') {
        const d = getSubjectDepartment(s, metadataMap);
        if (d !== qualDeptFilter) continue;
      }
      const y = getSubjectYearLevel(s, metadataMap);
      const d = getSubjectDepartment(s, metadataMap);
      if (d === 'High School' || /grade|shs|jhs/i.test(y)) {
        counts['High School']++;
        if (y.includes('11')) counts['Grade 11']++;
        if (y.includes('12')) counts['Grade 12']++;
      } else {
        if (y.includes('1st Year')) counts['1st Year']++;
        else if (y.includes('2nd Year')) counts['2nd Year']++;
        else if (y.includes('3rd Year')) counts['3rd Year']++;
        else if (y.includes('4th Year')) counts['4th Year']++;
      }
    }
    return counts;
  }, [allSubjects, qualDeptFilter, metadataMap]);

  const selectedInFilteredCount = useMemo(() => {
    const selectedSet = new Set(selectedSubjectIds);
    return filteredModalSubjects.filter((s) => selectedSet.has(s.id)).length;
  }, [filteredModalSubjects, selectedSubjectIds]);

  return (
    <div className="space-y-4">
      {/* Banner Notice */}
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

      {/* Header and Controls */}
      <div className="bg-white rounded-4 border p-4 shadow-sm">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 pb-3 border-bottom mb-4">
          <div>
            <h2 className="fs-5 fw-bold text-dark mb-1">Department Instructors</h2>
            <p className="small text-muted mb-0">
              Manage instructor profiles, department assignments, teaching certifications, and weekly availability constraints.
            </p>
          </div>
          <div className="text-end text-muted small">
            Showing <span className="fw-bold text-dark">{filteredInstructors.length}</span> of {instructors.length} instructors
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="d-flex flex-column flex-lg-row align-items-stretch align-items-lg-center justify-content-between gap-3">
          {/* Department Filter Pills */}
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span className="small text-muted fw-bold me-1">Department:</span>
            <button
              type="button"
              onClick={() => setDepartmentFilter('all')}
              className={`btn btn-sm rounded-pill px-3 py-1.5 transition ${
                departmentFilter === 'all'
                  ? 'btn-dark fw-bold shadow-sm'
                  : 'btn-light border text-secondary'
              }`}
            >
              All ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => setDepartmentFilter('BSIT')}
              className={`btn btn-sm rounded-pill px-3 py-1.5 transition ${
                departmentFilter === 'BSIT'
                  ? 'btn-primary fw-bold shadow-sm'
                  : 'btn-light border text-secondary'
              }`}
            >
              BSIT ({counts.bsit})
            </button>
            <button
              type="button"
              onClick={() => setDepartmentFilter('High School')}
              className={`btn btn-sm rounded-pill px-3 py-1.5 transition ${
                departmentFilter === 'High School'
                  ? 'btn-success fw-bold shadow-sm'
                  : 'btn-light border text-secondary'
              }`}
            >
              High School ({counts.hs})
            </button>
            <button
              type="button"
              onClick={() => setDepartmentFilter('Both')}
              className={`btn btn-sm rounded-pill px-3 py-1.5 transition ${
                departmentFilter === 'Both'
                  ? 'btn-indigo fw-bold shadow-sm bg-purple-600 text-white'
                  : 'btn-light border text-secondary'
              }`}
            >
              Both / Gen Ed ({counts.both})
            </button>
          </div>

          {/* Search Box */}
          <div className="w-full lg:w-72">
            <div className="input-group">
              <span className="input-group-text bg-white border-end-0 rounded-start-pill text-muted ps-3">
                🔍
              </span>
              <input
                type="text"
                placeholder="Search instructor name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-control border-start-0 rounded-end-pill py-2 text-sm shadow-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="btn btn-link text-muted position-absolute end-0 top-50 translate-middle-y me-2 text-decoration-none z-10"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Instructors Table Card */}
      <div className="bg-white rounded-4 border shadow-sm overflow-hidden w-100 min-w-0">
        <div className="table-responsive w-100">
          <table className="table table-hover align-middle mb-0 w-100">
            <thead className="table-light border-bottom">
              <tr className="text-secondary small fw-bold text-uppercase">
                <th style={{ width: '44px' }} className="text-center"></th>
                <th className="py-3 ps-2">Instructor Name</th>
                <th className="py-3" style={{ width: '150px' }}>Department</th>
                <th className="py-3" style={{ width: '160px' }}>Employment Type</th>
                <th className="py-3 pe-4 text-end" style={{ width: '100px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInstructors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-5 text-muted">
                    <div className="py-4">
                      <div className="fs-3 mb-2">🧑‍🏫</div>
                      <div className="fw-semibold">No instructors match your current filter</div>
                      <div className="small text-muted mt-1">Try clearing search or changing the department tab.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredInstructors.map((inst) => {
                  const isExpanded = expandedInstructorId === inst.id;
                  const dept = inst.department || 'BSIT';

                  return (
                    <React.Fragment key={inst.id}>
                      {/* Main Clean Row */}
                      <tr
                        onClick={() => toggleExpand(inst.id)}
                        className={`cursor-pointer transition-all ${
                          isExpanded
                            ? 'border-primary border-start border-4'
                            : 'hover:bg-slate-50/70'
                        }`}
                        style={{
                          cursor: 'pointer',
                          backgroundColor: isExpanded ? 'rgba(238, 242, 255, 0.7)' : undefined,
                        }}
                      >
                        {/* Expand Chevron */}
                        <td className="text-center ps-2" style={{ width: '44px' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(inst.id);
                            }}
                            className="btn btn-sm btn-link p-1 text-decoration-none shadow-none"
                            style={{ outline: 'none' }}
                            aria-label="Toggle details"
                          >
                            <span
                              className={`fs-6 fw-bold ${
                                isExpanded ? 'text-primary' : 'text-secondary'
                              }`}
                            >
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </button>
                        </td>

                        {/* Name and Initials */}
                        <td className="ps-2 py-3 min-w-0">
                          <div className="d-flex align-items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-circle d-flex align-items-center justify-content-center text-xs fw-bold shadow-2xs ${
                                dept === 'High School'
                                  ? 'bg-emerald-100 text-emerald-950 border border-emerald-400'
                                  : dept === 'Both'
                                  ? 'bg-purple-100 text-purple-950 border border-purple-400'
                                  : 'bg-blue-100 text-blue-950 border border-blue-400'
                              }`}
                              style={{ width: '38px', height: '38px', flexShrink: 0 }}
                            >
                              {inst.full_name
                                .split(' ')
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join('')
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="fw-bold text-dark fs-6 text-truncate">{inst.full_name}</div>
                            </div>
                          </div>
                        </td>

                        {/* Department Badge */}
                        <td style={{ width: '150px' }}>
                          {dept === 'BSIT' && (
                            <span className="badge bg-blue-600 text-white rounded-pill px-3 py-1.5 fw-bold shadow-2xs">
                              BSIT
                            </span>
                          )}
                          {dept === 'High School' && (
                            <span className="badge bg-emerald-600 text-white rounded-pill px-3 py-1.5 fw-bold shadow-2xs">
                              High School
                            </span>
                          )}
                          {dept === 'Both' && (
                            <span
                              className="badge rounded-pill px-3 py-1.5 fw-bold text-white shadow-2xs"
                              style={{
                                backgroundColor: '#9333ea',
                              }}
                            >
                              Both / Gen Ed
                            </span>
                          )}
                        </td>

                        {/* Employment Type */}
                        <td style={{ width: '160px' }}>
                          <span
                            className={`badge rounded-pill px-2.5 py-1 fw-medium text-capitalize ${
                              inst.employment_type === 'full_time'
                                ? 'bg-light text-dark border'
                                : 'bg-warning-subtle text-warning-emphasis border border-warning-subtle'
                            }`}
                          >
                            {inst.employment_type.replace('_', ' ')}
                          </span>
                        </td>

                        {/* Quick Actions */}
                        <td className="pe-4 text-end" style={{ width: '100px' }}>
                          <button
                            type="button"
                            onClick={(e) => handleOpenEdit(inst, e)}
                            disabled={isPending}
                            className="btn btn-sm btn-outline-secondary rounded-pill px-3 py-1 text-xs fw-semibold shadow-none"
                            style={{ outline: 'none' }}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Accordion Drawer Row - Pure Text and Lines */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="p-0 bg-white border-bottom">
                            <div className="p-3 p-md-4 w-100 min-w-0">
                              {/* Modern Segmented Navigation Tabs (No blue outline, sleek pills) */}
                              <div className="d-inline-flex flex-wrap align-items-center bg-slate-100/90 p-1 rounded-2xl border border-slate-200/80 mb-4 gap-1 shadow-2xs max-w-full">
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('profile')}
                                  className={`btn btn-sm border-0 rounded-xl px-4 py-1.5 text-xs fw-semibold transition-all shadow-none ${
                                    activeTab === 'profile'
                                      ? 'bg-white text-primary shadow-xs fw-bold'
                                      : 'text-secondary hover:text-dark bg-transparent'
                                  }`}
                                  style={{ outline: 'none' }}
                                >
                                  Profile & Contact
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('subjects')}
                                  className={`btn btn-sm border-0 rounded-xl px-4 py-1.5 text-xs fw-semibold transition-all shadow-none ${
                                    activeTab === 'subjects'
                                      ? 'bg-white text-primary shadow-xs fw-bold'
                                      : 'text-secondary hover:text-dark bg-transparent'
                                  }`}
                                  style={{ outline: 'none' }}
                                >
                                  Qualified Subjects ({inst.qualifications.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('availability')}
                                  className={`btn btn-sm border-0 rounded-xl px-4 py-1.5 text-xs fw-semibold transition-all shadow-none ${
                                    activeTab === 'availability'
                                      ? 'bg-white text-primary shadow-xs fw-bold'
                                      : 'text-secondary hover:text-dark bg-transparent'
                                  }`}
                                  style={{ outline: 'none' }}
                                >
                                  Weekly Availability ({inst.availability.length} slots)
                                </button>
                              </div>

                              {/* Tab 1: Profile & Contact - Pure Text and Lines */}
                              {activeTab === 'profile' && (
                                <div className="row g-4 py-1">
                                  <div className="col-12 col-md-4">
                                    <div className="text-muted small fw-semibold text-uppercase tracking-wider mb-1">
                                      Account & Email
                                    </div>
                                    <div className="text-dark fw-medium font-monospace">
                                      {inst.profile?.email || (
                                        <span className="text-muted fst-italic">
                                          External (No user account linked)
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-muted small mt-1">
                                      ID: <span className="font-monospace text-xs">{inst.id}</span>
                                    </div>
                                  </div>

                                  <div className="col-12 col-md-4 border-start-md ps-md-4">
                                    <div className="text-muted small fw-semibold text-uppercase tracking-wider mb-1">
                                      Department Assignment
                                    </div>
                                    <div className="text-dark fw-medium">
                                      {dept === 'BSIT' && 'BSIT Department (College of IT)'}
                                      {dept === 'High School' && 'High School Department (Junior & Senior High)'}
                                      {dept === 'Both' && 'Both / General Education (Cross-Department)'}
                                    </div>
                                    <div className="text-muted small mt-1">
                                      Supervising department scope
                                    </div>
                                  </div>

                                  <div className="col-12 col-md-4 border-start-md ps-md-4">
                                    <div className="text-muted small fw-semibold text-uppercase tracking-wider mb-1">
                                      Employment Status
                                    </div>
                                    <div className="text-dark fw-medium text-capitalize">
                                      {inst.employment_type.replace('_', ' ')}
                                    </div>
                                    <div className="text-muted small mt-1">
                                      Faculty appointment classification
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Tab 2: Qualified Subjects */}
                              {activeTab === 'subjects' && (
                                <div className="py-1">
                                  {/* Clean Unified Header Bar */}
                                  <div className="d-flex flex-column flex-xl-row justify-content-between align-items-start align-items-xl-center gap-3 p-3 bg-slate-50/90 rounded-2xl border border-slate-200/80 mb-3.5 w-100">
                                    {/* Left: Summary & Filters */}
                                    <div className="d-flex flex-wrap align-items-center gap-2.5">
                                      <div className="d-flex align-items-center gap-2 pe-3 border-end border-slate-200">
                                        <span
                                          className="text-secondary small fw-bold text-uppercase tracking-wider"
                                          style={{ fontSize: '0.72rem' }}
                                        >
                                          Certified Subjects
                                        </span>
                                        <span className="badge rounded-pill bg-white text-primary border border-slate-200 px-2.5 py-1 font-monospace text-xs fw-bold shadow-2xs">
                                          {inst.qualifications.length}
                                        </span>
                                      </div>

                                      {/* Department Pills */}
                                      <div
                                        className="btn-group btn-group-sm bg-white p-0.5 rounded-xl border border-slate-200/80 shadow-2xs"
                                        role="group"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => setCardQualDeptFilter('all')}
                                          className={`btn btn-xs py-1 px-2.5 rounded-lg border-0 text-xs transition-all ${
                                            cardQualDeptFilter === 'all'
                                              ? 'bg-slate-800 text-white fw-bold shadow-2xs'
                                              : 'text-secondary hover:text-dark bg-transparent'
                                          }`}
                                          style={{ outline: 'none' }}
                                        >
                                          All
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setCardQualDeptFilter('BSIT')}
                                          className={`btn btn-xs py-1 px-2.5 rounded-lg border-0 text-xs transition-all ${
                                            cardQualDeptFilter === 'BSIT'
                                              ? 'bg-blue-600 text-white fw-bold shadow-2xs'
                                              : 'text-secondary hover:text-dark bg-transparent'
                                          }`}
                                          style={{ outline: 'none' }}
                                        >
                                          BSIT
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setCardQualDeptFilter('High School')}
                                          className={`btn btn-xs py-1 px-2.5 rounded-lg border-0 text-xs transition-all ${
                                            cardQualDeptFilter === 'High School'
                                              ? 'bg-emerald-600 text-white fw-bold shadow-2xs'
                                              : 'text-secondary hover:text-dark bg-transparent'
                                          }`}
                                          style={{ outline: 'none' }}
                                        >
                                          High School
                                        </button>
                                      </div>

                                      {/* Year Level Select */}
                                      <select
                                        value={cardQualYearFilter}
                                        onChange={(e) =>
                                          setCardQualYearFilter(e.target.value as any)
                                        }
                                        className="form-select form-select-sm py-1 ps-2.5 pe-4 rounded-xl border-slate-200/80 bg-white text-xs text-secondary fw-medium shadow-2xs"
                                        style={{ width: 'auto', minWidth: '130px', outline: 'none' }}
                                      >
                                        <option value="all">All Year Levels</option>
                                        <option value="1st Year">1st Year</option>
                                        <option value="2nd Year">2nd Year</option>
                                        <option value="3rd Year">3rd Year</option>
                                        <option value="4th Year">4th Year</option>
                                        <option value="Grade 11">Grade 11</option>
                                        <option value="Grade 12">Grade 12</option>
                                        <option value="High School">All High School</option>
                                      </select>
                                    </div>

                                    {/* Right: Count & Manage Action Button */}
                                    <div className="d-flex flex-wrap align-items-center gap-2.5 w-100 w-xl-auto justify-content-between justify-content-xl-end">
                                      {(cardQualDeptFilter !== 'all' || cardQualYearFilter !== 'all') && (
                                        <span className="text-muted small text-xs">
                                          Showing{' '}
                                          <strong className="text-dark">
                                            {
                                              inst.qualifications.filter((subId) => {
                                                const s = subjectsMap.get(subId);
                                                if (!s) return false;
                                                if (
                                                  cardQualDeptFilter !== 'all' &&
                                                  getSubjectDepartment(s, metadataMap) !== cardQualDeptFilter
                                                )
                                                  return false;
                                                if (!matchesYearFilter(s, cardQualYearFilter))
                                                  return false;
                                                return true;
                                              }).length
                                            }
                                          </strong>{' '}
                                          of {inst.qualifications.length}
                                        </span>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => handleOpenQualifications(inst)}
                                        className="btn btn-sm btn-primary rounded-pill px-3.5 py-1.5 text-xs fw-semibold shadow-sm d-inline-flex align-items-center gap-1.5 transition-transform active:scale-95"
                                        style={{ outline: 'none' }}
                                      >
                                        <span className="fw-bold fs-6 leading-none">+</span>
                                        <span>Manage Qualifications</span>
                                      </button>
                                    </div>
                                  </div>

                                  {inst.qualifications.length === 0 ? (
                                    <div className="text-center py-5 px-4 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
                                      <div className="fs-3 mb-2">📚</div>
                                      <div className="fw-semibold text-dark text-sm mb-1">
                                        No Qualifications Assigned
                                      </div>
                                      <div className="text-muted small mb-3 max-w-sm mx-auto">
                                        This instructor is not yet certified for any curriculum subjects.
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenQualifications(inst)}
                                        className="btn btn-sm btn-outline-primary rounded-pill px-4 py-1.5 text-xs fw-semibold"
                                        style={{ outline: 'none' }}
                                      >
                                        + Assign Qualifications
                                      </button>
                                    </div>
                                  ) : (
                                    <div>
                                      {/* Filtered Subject Cards */}
                                      {inst.qualifications.filter((subId) => {
                                        const s = subjectsMap.get(subId);
                                        if (!s) return false;
                                        if (
                                          cardQualDeptFilter !== 'all' &&
                                          getSubjectDepartment(s, metadataMap) !== cardQualDeptFilter
                                        )
                                          return false;
                                        if (!matchesYearFilter(s, cardQualYearFilter))
                                          return false;
                                        return true;
                                      }).length === 0 ? (
                                        <div className="py-4 text-muted small fst-italic text-center bg-slate-50/60 rounded-2xl border border-slate-200">
                                          No qualified subjects match the selected filters.
                                        </div>
                                      ) : (
                                        <div className="space-y-2">
                                          {inst.qualifications
                                            .filter((subId) => {
                                              const s = subjectsMap.get(subId);
                                              if (!s) return false;
                                              if (
                                                cardQualDeptFilter !== 'all' &&
                                                getSubjectDepartment(s, metadataMap) !== cardQualDeptFilter
                                              )
                                                return false;
                                              if (!matchesYearFilter(s, cardQualYearFilter))
                                                return false;
                                              return true;
                                            })
                                            .map((subId) => {
                                              const sub = subjectsMap.get(subId);
                                              if (!sub) return null;
                                              const dept = getSubjectDepartment(sub, metadataMap);
                                              const yearLevel = getSubjectYearLevel(sub, metadataMap);

                                              return (
                                                <div
                                                  key={subId}
                                                  className="d-flex align-items-center justify-content-between p-2.5 px-3.5 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:bg-slate-50/70 transition-all shadow-2xs gap-3 w-100 min-w-0"
                                                >
                                                  {/* Left: Code and Title */}
                                                  <div className="d-flex align-items-center gap-2.5 min-w-0 flex-grow-1 overflow-hidden">
                                                    <span
                                                      className={`px-2.5 py-1 rounded-lg font-monospace fw-bold text-xs border ${
                                                        dept === 'High School'
                                                          ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                                                          : 'bg-blue-50 text-blue-900 border-blue-300'
                                                      }`}
                                                      style={{ minWidth: '75px', textAlign: 'center', flexShrink: 0 }}
                                                    >
                                                      {sub.code}
                                                    </span>
                                                    <span
                                                      className="text-dark fw-semibold text-sm text-truncate"
                                                      title={sub.title}
                                                      style={{ maxWidth: '340px' }}
                                                    >
                                                      {truncateSubjectTitle(sub.title, 40)}
                                                    </span>
                                                  </div>

                                                  {/* Right: Department, Year Level, and Units Aligned */}
                                                  <div className="d-flex align-items-center gap-2 flex-shrink-0 ms-auto">
                                                    {/* Department Badge (Blue for BSIT, Green for High School) */}
                                                    <span
                                                      className={`badge rounded-pill px-2.5 py-1 text-xs fw-bold shadow-2xs ${
                                                        dept === 'High School'
                                                          ? 'bg-emerald-600 text-white'
                                                          : 'bg-blue-600 text-white'
                                                      }`}
                                                      style={{ minWidth: '60px', textAlign: 'center' }}
                                                    >
                                                      {dept}
                                                    </span>

                                                    {/* Year Level Badge (Matches department color) */}
                                                    <span
                                                      className={`badge rounded-pill px-2.5 py-1 text-xs fw-bold shadow-2xs ${
                                                        dept === 'High School'
                                                          ? 'bg-emerald-700 text-white'
                                                          : 'bg-blue-700 text-white'
                                                      }`}
                                                      style={{ minWidth: '72px', textAlign: 'center' }}
                                                    >
                                                      {yearLevel}
                                                    </span>

                                                    {/* Units Tag */}
                                                    <span
                                                      className="text-slate-700 small font-monospace bg-slate-100 border border-slate-300 rounded-pill px-2.5 py-1 text-xs fw-semibold"
                                                      style={{ minWidth: '120px', textAlign: 'center' }}
                                                    >
                                                      {sub.units} {sub.units === 1 ? 'unit' : 'units'} • {sub.lecture_hours}h lec
                                                      {sub.lab_hours > 0 ? ` + ${sub.lab_hours}h lab` : ''}
                                                    </span>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Tab 3: Weekly Availability - Clean Text and Lines */}
                              {activeTab === 'availability' && (
                                <div className="py-1">
                                  <div className="d-flex justify-content-between align-items-center pb-2 border-bottom mb-3">
                                    <span className="text-muted small">
                                      Configured weekly teaching hours:
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenAvailability(inst)}
                                      className="btn btn-sm btn-link text-primary p-0 text-decoration-none fw-semibold"
                                    >
                                      Configure Availability Schedule
                                    </button>
                                  </div>

                                  {inst.availability.length === 0 ? (
                                    <div className="py-3 text-muted small fst-italic">
                                      No availability constraints configured (instructor is available for all standard hours).
                                    </div>
                                  ) : (
                                    <div className="space-y-0">
                                      {[1, 2, 3, 4, 5, 6].map((dayNum) => {
                                        const daySlots = inst.availability.filter(
                                          (s) => s.day_of_week === dayNum
                                        );
                                        if (daySlots.length === 0) return null;

                                        return (
                                          <div
                                            key={dayNum}
                                            className="d-flex align-items-center py-2 border-bottom"
                                          >
                                            <div
                                              className="fw-bold text-dark me-4"
                                              style={{ width: '120px' }}
                                            >
                                              {DAY_NAMES[dayNum]}
                                            </div>
                                            <div className="text-secondary font-monospace small">
                                              {daySlots
                                                .map(
                                                  (slot) =>
                                                    `${slot.start_time.slice(0, 5)} - ${slot.end_time.slice(0, 5)}`
                                                )
                                                .join(', ')}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Profile & Department Modal */}
      <FormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={`Edit Instructor: ${editingInstructor?.full_name || ''}`}
        description="Configure department supervision, employment status, and equipment prerequisites."
        onSubmit={handleSubmitProfile}
        isSubmitting={isPending}
        error={modalError}
        submitLabel="Save Changes"
      >
        {/* Department Selection */}
        <div className="mb-4">
          <label className="form-label small fw-bold text-dark mb-2">
            Supervising Department
          </label>
          <div className="row g-2">
            <div className="col-4">
              <button
                type="button"
                onClick={() =>
                  setProfileFormData((prev) => ({ ...prev, department: 'BSIT' }))
                }
                className={`btn w-100 p-3 rounded-3 text-start border transition ${
                  profileFormData.department === 'BSIT'
                    ? 'border-primary bg-primary-subtle text-primary fw-bold'
                    : 'bg-white text-secondary'
                }`}
              >
                <div className="fw-bold mb-1">BSIT</div>
                <div className="text-xs text-muted">College of IT</div>
              </button>
            </div>
            <div className="col-4">
              <button
                type="button"
                onClick={() =>
                  setProfileFormData((prev) => ({ ...prev, department: 'High School' }))
                }
                className={`btn w-100 p-3 rounded-3 text-start border transition ${
                  profileFormData.department === 'High School'
                    ? 'border-success bg-success-subtle text-success fw-bold'
                    : 'bg-white text-secondary'
                }`}
              >
                <div className="fw-bold mb-1">High School</div>
                <div className="text-xs text-muted">Junior & Senior HS</div>
              </button>
            </div>
            <div className="col-4">
              <button
                type="button"
                onClick={() =>
                  setProfileFormData((prev) => ({ ...prev, department: 'Both' }))
                }
                className={`btn w-100 p-3 rounded-3 text-start border transition ${
                  profileFormData.department === 'Both'
                    ? 'border-purple bg-purple-50 text-purple-800 fw-bold'
                    : 'bg-white text-secondary'
                }`}
                style={
                  profileFormData.department === 'Both'
                    ? { borderColor: '#a855f7', backgroundColor: '#faf5ff' }
                    : {}
                }
              >
                <div className="fw-bold mb-1">Both / Gen Ed</div>
                <div className="text-xs text-muted">Cross-Department</div>
              </button>
            </div>
          </div>
        </div>

        {/* Employment Type */}
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Employment Type
          </label>
          <select
            value={profileFormData.employment_type}
            onChange={(e) =>
              setProfileFormData((prev) => ({
                ...prev,
                employment_type: e.target.value as 'full_time' | 'part_time',
              }))
            }
            className="form-select"
          >
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
          </select>
        </div>
      </FormModal>

      {/* Qualifications Modal */}
      <FormModal
        isOpen={isQualModalOpen}
        onClose={() => setIsQualModalOpen(false)}
        title={`Teaching Qualifications: ${qualInstructor?.full_name || ''}`}
        description="Select curriculum subjects this instructor is certified and qualified to teach."
        onSubmit={handleSubmitQualifications}
        isSubmitting={isPending}
        error={modalError}
        size="lg"
        submitLabel={`Save Qualifications (${selectedSubjectIds.length})`}
      >
        {/* Filter Controls Row */}
        <div className="bg-slate-50/90 p-3 rounded-2xl border border-slate-200/80 mb-3 space-y-3">
          {/* Department Filter Pills & Bulk Actions */}
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <div className="d-flex align-items-center gap-2">
              <span
                className="small fw-bold text-secondary text-uppercase tracking-wider"
                style={{ fontSize: '0.72rem' }}
              >
                Department:
              </span>
              <div
                className="btn-group btn-group-sm bg-white p-0.5 rounded-xl border border-slate-200/80 shadow-2xs"
                role="group"
              >
                <button
                  type="button"
                  onClick={() => setQualDeptFilter('all')}
                  className={`btn btn-xs py-1 px-2.5 rounded-lg border-0 text-xs transition-all ${
                    qualDeptFilter === 'all'
                      ? 'bg-slate-800 text-white fw-bold shadow-2xs'
                      : 'text-secondary hover:text-dark bg-transparent'
                  }`}
                  style={{ outline: 'none' }}
                >
                  All ({modalDeptCounts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setQualDeptFilter('BSIT')}
                  className={`btn btn-xs py-1 px-2.5 rounded-lg border-0 text-xs transition-all ${
                    qualDeptFilter === 'BSIT'
                      ? 'bg-blue-600 text-white fw-bold shadow-2xs'
                      : 'text-secondary hover:text-dark bg-transparent'
                  }`}
                  style={{ outline: 'none' }}
                >
                  BSIT ({modalDeptCounts.bsit})
                </button>
                <button
                  type="button"
                  onClick={() => setQualDeptFilter('High School')}
                  className={`btn btn-xs py-1 px-2.5 rounded-lg border-0 text-xs transition-all ${
                    qualDeptFilter === 'High School'
                      ? 'bg-emerald-600 text-white fw-bold shadow-2xs'
                      : 'text-secondary hover:text-dark bg-transparent'
                  }`}
                  style={{ outline: 'none' }}
                >
                  High School ({modalDeptCounts.hs})
                </button>
              </div>
            </div>

            {/* Bulk Selection Actions */}
            <div className="d-flex gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                disabled={filteredModalSubjects.length === 0}
                className="btn btn-sm btn-outline-primary rounded-pill px-3 py-1 text-xs fw-semibold shadow-none"
                style={{ outline: 'none' }}
                title="Select all subjects currently shown by filters"
              >
                Select All Filtered
              </button>
              <button
                type="button"
                onClick={handleDeselectAllFiltered}
                disabled={filteredModalSubjects.length === 0}
                className="btn btn-sm btn-outline-secondary rounded-pill px-3 py-1 text-xs fw-semibold shadow-none"
                style={{ outline: 'none' }}
                title="Deselect all subjects currently shown by filters"
              >
                Clear Filtered
              </button>
            </div>
          </div>

          {/* Year Level & Search Row */}
          <div className="row g-2 align-items-center">
            <div className="col-12 col-md-5">
              <div className="d-flex align-items-center gap-2">
                <span
                  className="small fw-bold text-secondary text-uppercase tracking-wider text-nowrap"
                  style={{ fontSize: '0.72rem' }}
                >
                  Year Level:
                </span>
                <select
                  value={qualYearFilter}
                  onChange={(e) => setQualYearFilter(e.target.value as any)}
                  className="form-select form-select-sm py-1 ps-2.5 pe-4 rounded-xl border-slate-200/80 bg-white text-xs text-secondary fw-medium shadow-2xs"
                  style={{ width: '100%', outline: 'none' }}
                >
                  <option value="all">All Year Levels</option>
                  <option value="1st Year">
                    1st Year ({modalYearCounts['1st Year'] || 0})
                  </option>
                  <option value="2nd Year">
                    2nd Year ({modalYearCounts['2nd Year'] || 0})
                  </option>
                  <option value="3rd Year">
                    3rd Year ({modalYearCounts['3rd Year'] || 0})
                  </option>
                  <option value="4th Year">
                    4th Year ({modalYearCounts['4th Year'] || 0})
                  </option>
                  <option value="Grade 11">
                    Grade 11 ({modalYearCounts['Grade 11'] || 0})
                  </option>
                  <option value="Grade 12">
                    Grade 12 ({modalYearCounts['Grade 12'] || 0})
                  </option>
                  <option value="High School">
                    All High School ({modalYearCounts['High School'] || 0})
                  </option>
                </select>
              </div>
            </div>

            <div className="col-12 col-md-7">
              <input
                type="text"
                placeholder="Search subject code or title..."
                value={subjectSearch}
                onChange={(e) => setSubjectSearch(e.target.value)}
                className="form-control form-control-sm py-1 px-3 rounded-xl border-slate-200/80 bg-white text-xs shadow-2xs"
                style={{ outline: 'none' }}
              />
            </div>
          </div>
        </div>

        {/* Status / Count bar */}
        <div className="d-flex justify-content-between align-items-center px-1 mb-2 text-muted small">
          <span className="text-xs">
            Showing <strong className="text-dark">{filteredModalSubjects.length}</strong> matching subjects
            {selectedInFilteredCount > 0 && (
              <span className="text-primary ms-1 fw-medium">
                ({selectedInFilteredCount} selected in view)
              </span>
            )}
          </span>
          <span className="text-xs">
            Total qualified: <strong className="text-dark font-monospace">{selectedSubjectIds.length}</strong>
          </span>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filteredModalSubjects.length === 0 ? (
            <div className="p-5 text-center text-muted small bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
              No subjects found matching the selected Department & Year Level filters.
            </div>
          ) : (
            filteredModalSubjects.map((sub) => {
              const isChecked = selectedSubjectIds.includes(sub.id);
              const dept = getSubjectDepartment(sub, metadataMap);
              const yearLevel = getSubjectYearLevel(sub, metadataMap);

              return (
                <label
                  key={sub.id}
                  className={`d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between p-2.5 px-3.5 rounded-xl border text-xs cursor-pointer transition shadow-2xs gap-2.5 w-100 min-w-0 ${
                    isChecked
                      ? 'bg-blue-50/70 border-blue-500'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  {/* Left: Code and Title */}
                  <div className="d-flex align-items-center gap-2.5 min-w-0 flex-grow-1 w-100 w-sm-auto overflow-hidden">
                    <span
                      className={`px-2.5 py-1 rounded-lg font-monospace fw-bold text-xs border ${
                        dept === 'High School'
                          ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                          : 'bg-blue-50 text-blue-900 border-blue-300'
                      }`}
                      style={{ minWidth: '75px', textAlign: 'center', flexShrink: 0 }}
                    >
                      {sub.code}
                    </span>
                    <span
                      className="text-dark fw-semibold text-sm text-truncate"
                      title={sub.title}
                      style={{ maxWidth: '340px' }}
                    >
                      {truncateSubjectTitle(sub.title, 40)}
                    </span>
                  </div>

                  {/* Right: Department, Year Level, Units, and Checkbox Aligned */}
                  <div className="d-flex flex-wrap align-items-center gap-2 flex-shrink-0 ms-auto ms-sm-0">
                    <span
                      className={`badge rounded-pill px-2.5 py-1 text-xs fw-bold shadow-2xs ${
                        dept === 'High School'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-blue-600 text-white'
                      }`}
                      style={{ minWidth: '60px', textAlign: 'center' }}
                    >
                      {dept}
                    </span>
                    <span
                      className={`badge rounded-pill px-2.5 py-1 text-xs fw-bold shadow-2xs ${
                        dept === 'High School'
                          ? 'bg-emerald-700 text-white'
                          : 'bg-blue-700 text-white'
                      }`}
                      style={{ minWidth: '72px', textAlign: 'center' }}
                    >
                      {yearLevel}
                    </span>
                    <span
                      className="text-slate-700 small font-monospace bg-slate-100 border border-slate-300 rounded-pill px-2.5 py-1 text-xs fw-semibold"
                      style={{ minWidth: '120px', textAlign: 'center' }}
                    >
                      {sub.units} {sub.units === 1 ? 'unit' : 'units'} • {sub.lecture_hours}h lec
                      {sub.lab_hours > 0 ? ` + ${sub.lab_hours}h lab` : ''}
                    </span>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSubjectSelection(sub.id)}
                      className="form-check-input ms-2 rounded-md"
                      style={{ cursor: 'pointer', transform: 'scale(1.15)' }}
                    />
                  </div>
                </label>
              );
            })
          )}
        </div>
      </FormModal>

      {/* Availability Modal */}
      {isAvailModalOpen && availInstructor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div
            className="fixed inset-0 bg-dark bg-opacity-50 backdrop-blur-sm"
            onClick={() => setIsAvailModalOpen(false)}
          />
          <div className="relative w-full max-w-4xl bg-white rounded-5 shadow-2xl p-6 z-10 max-h-[90vh] overflow-y-auto border border-white">
            <div className="d-flex align-items-center justify-between pb-3 border-bottom mb-4">
              <div>
                <h2 className="fs-5 fw-bold text-dark m-0">
                  Availability Matrix: {availInstructor.full_name}
                </h2>
                <p className="small text-secondary m-0 mt-1">
                  Configure recurring weekly time preferences for timetable scheduling.
                </p>
              </div>
              <button
                onClick={() => setIsAvailModalOpen(false)}
                className="btn btn-sm btn-light rounded-circle p-2"
              >
                ✕
              </button>
            </div>

            <AvailabilityEditor
              instructorId={availInstructor.id}
              instructorName={availInstructor.full_name}
              employmentType={availInstructor.employment_type}
              initialSlots={availInstructor.availability}
              onSave={handleSaveAvailability}
            />
          </div>
        </div>
      )}
    </div>
  );
}
