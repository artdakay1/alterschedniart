// src/app/scheduler/generate/GenerateClient.tsx
'use client';

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { AcademicTerm, Block, Instructor, Subject } from '@/types/database';
import { generateAiDraftAction, type SchedulingFilters } from './actions';
import type { SchedulerPreferences, BlockDraftResult } from '@/lib/ai';

interface GenerateClientProps {
  terms: AcademicTerm[];
  blocks: (Block & { programs?: { code: string; name: string } | null })[];
  instructors?: (Instructor & {
    profiles?: { department?: string | null } | null;
    instructor_qualifications?: { subject_id: string }[];
  })[];
  subjects?: Subject[];
  offerings?: { id: string; block_id: string; subject_id: string; term_id: string }[];
  existingEntries?: { id: string; offering_id: string; start_time: string; end_time: string }[];
  metadataMap?: Record<string, { yearLevel?: string; facility?: string; [key: string]: any }>;
  currentTermId: string;
  initialBlockId?: string | null;
  userRole?: string;
  schedulerDepartment?: string | null;
  allowedSubjectIds?: string[] | null;
}

type BlockStatus = 'queued' | 'generating' | 'validating' | 'writing' | 'done' | 'failed';

export function GenerateClient({
  terms,
  blocks,
  instructors = [],
  subjects = [],
  offerings = [],
  existingEntries = [],
  metadataMap = {},
  currentTermId,
  initialBlockId = null,
  userRole = 'scheduler',
  schedulerDepartment = 'BSIT',
  allowedSubjectIds = null,
}: GenerateClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedTermId, setSelectedTermId] = useState(currentTermId);

  // Derive department for a block
  const getBlockDept = (b: Block & { programs?: { code: string; name: string } | null }): 'BSIT' | 'High School' => {
    const isHs =
      b.programs?.code === 'HS' ||
      b.year_level >= 7 ||
      (b.section || '').toLowerCase().startsWith('grade') ||
      (b.programs?.name || '').toLowerCase().includes('high school');
    return isHs ? 'High School' : 'BSIT';
  };

  // Target initial block if navigated from schedule editor for a specific cohort
  const targetInitialBlock = useMemo(() => {
    if (!initialBlockId) return null;
    return blocks.find((b) => b.id === initialBlockId) || null;
  }, [initialBlockId, blocks]);

  // Base scoped blocks according to user role & department
  const scopedBlocks = useMemo(() => {
    if (userRole === 'admin') return blocks;
    const targetDept = schedulerDepartment || 'BSIT';
    return blocks.filter((b) => getBlockDept(b) === targetDept);
  }, [blocks, userRole, schedulerDepartment]);

  // Base scoped instructors according to user role & department
  const scopedInstructors = useMemo(() => {
    if (userRole === 'admin') return instructors;
    const targetDept = schedulerDepartment || 'BSIT';
    return instructors.filter((inst) => {
      const instDept = inst.department || inst.profiles?.department;
      if (!instDept || instDept === 'Both') return true;
      return instDept === targetDept;
    });
  }, [instructors, userRole, schedulerDepartment]);

function isHighSchoolSubject(sub: { code?: string; title?: string }): boolean {
  const code = (sub.code || '').toUpperCase();
  const title = (sub.title || '').toLowerCase();
  return (
    code.startsWith('HS') ||
    code.startsWith('JHS') ||
    code.startsWith('SHS') ||
    code.startsWith('GRADE') ||
    title.includes('high school') ||
    title.includes('grade ')
  );
}

  // Base scoped subjects according to user role, department & allowedSubjectIds
  const scopedSubjects = useMemo(() => {
    let result = subjects;
    if (userRole !== 'admin') {
      const targetDept = schedulerDepartment || 'BSIT';
      result = result.filter((sub) => {
        const isHs = isHighSchoolSubject(sub);
        return targetDept === 'High School' ? isHs : !isHs;
      });
      if (allowedSubjectIds && allowedSubjectIds.length > 0) {
        result = result.filter((sub) => allowedSubjectIds.includes(sub.id));
      }
    }
    return result;
  }, [subjects, userRole, schedulerDepartment, allowedSubjectIds]);

  // 1. Department Filter (no cohorts)
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<'All' | 'BSIT' | 'High School'>(() => {
    if (targetInitialBlock) {
      return getBlockDept(targetInitialBlock);
    }
    return 'All';
  });

  // Dynamic Department Filter Pills based on scope
  const deptPills = useMemo(() => {
    if (userRole !== 'admin') {
      const dept = (schedulerDepartment as 'BSIT' | 'High School') || 'BSIT';
      return [
        { key: dept, label: dept === 'High School' ? 'High School Department' : 'BSIT Department' },
      ];
    }
    return [
      { key: 'All', label: 'All Departments' },
      { key: 'BSIT', label: 'BSIT Department' },
      { key: 'High School', label: 'High School Department' },
    ];
  }, [userRole, schedulerDepartment]);

  // Set of subject IDs with qualified instructors
  const qualifiedSubjectIds = useMemo(() => {
    const set = new Set<string>();
    for (const inst of instructors) {
      for (const q of inst.instructor_qualifications || []) {
        if (q.subject_id) set.add(q.subject_id);
      }
    }
    return set;
  }, [instructors]);

  // Determine blocks with completed schedules
  const initialCompletedBlockIds = useMemo(() => {
    const completed = new Set<string>();
    if (!existingEntries || existingEntries.length === 0 || !offerings || offerings.length === 0) {
      return completed;
    }

    for (const b of blocks) {
      const bOfferings = offerings.filter((o) => o.block_id === b.id);
      if (bOfferings.length === 0) continue;

      const bOfferingIds = new Set(bOfferings.map((o) => o.id));
      const bEntries = existingEntries.filter((e) => bOfferingIds.has(e.offering_id));
      if (bEntries.length === 0) continue;

      // Schedulable offerings (offerings with available qualified faculty)
      const schedulableOfferings = bOfferings.filter((o) => qualifiedSubjectIds.has(o.subject_id));
      const targetOfferings = schedulableOfferings.length > 0 ? schedulableOfferings : bOfferings;

      const allTargetMet = targetOfferings.every((off) => {
        const sub = subjects.find((s) => s.id === off.subject_id);
        const units = typeof sub?.units === 'number' && !isNaN(sub.units) ? sub.units : 0;
        let lecHours = typeof sub?.lecture_hours === 'number' && !isNaN(sub.lecture_hours) ? sub.lecture_hours : 0;
        let labHours = typeof sub?.lab_hours === 'number' && !isNaN(sub.lab_hours) ? sub.lab_hours : 0;

        if (lecHours + labHours === 0 && units > 0) {
          if (sub?.requires_lab) {
            lecHours = Math.max(1, units - 1);
            labHours = Math.min(3, units);
          } else {
            lecHours = units;
            labHours = 0;
          }
        }
        if (units === 1) {
          lecHours = 1;
          labHours = 0;
        }
        const requiredMinutes = Math.round((lecHours + labHours) * 60);

        const offEntries = bEntries.filter((e) => e.offering_id === off.id);
        if (offEntries.length === 0) return false;

        let scheduledMinutes = 0;
        for (const e of offEntries) {
          const [sh, sm] = e.start_time.split(':').map(Number);
          const [eh, em] = e.end_time.split(':').map(Number);
          scheduledMinutes += (eh * 60 + em) - (sh * 60 + sm);
        }

        return scheduledMinutes >= requiredMinutes || offEntries.length > 0;
      });

      const allHaveSessions = bOfferings.every((off) =>
        bEntries.some((e) => e.offering_id === off.id)
      );

      if (allTargetMet || allHaveSessions) {
        completed.add(b.id);
      }
    }

    return completed;
  }, [blocks, offerings, existingEntries, subjects, qualifiedSubjectIds]);

  const [completedBlockIds, setCompletedBlockIds] = useState<Set<string>>(initialCompletedBlockIds);

  useEffect(() => {
    setCompletedBlockIds(initialCompletedBlockIds);
  }, [initialCompletedBlockIds]);

  // 2. Block Filters & Selection - if initialBlockId is specified, lock selection strictly to that block only!
  const [blockSearch, setBlockSearch] = useState('');
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>(() => {
    if (targetInitialBlock) {
      return [targetInitialBlock.id];
    }
    return scopedBlocks.filter((b) => !initialCompletedBlockIds.has(b.id)).map((b) => b.id);
  });

  useEffect(() => {
    if (initialBlockId && blocks.some((b) => b.id === initialBlockId)) {
      const b = blocks.find((blk) => blk.id === initialBlockId)!;
      setSelectedDeptFilter(getBlockDept(b));
      setSelectedBlockIds([initialBlockId]);
    }
  }, [initialBlockId, blocks]);

  // 3. Instructor Filters & Selection
  const [instructorMode, setInstructorMode] = useState<'all' | 'custom'>('all');
  const [selectedInstructorIds, setSelectedInstructorIds] = useState<string[]>(
    scopedInstructors.map((i) => i.id)
  );
  const [instructorSearch, setInstructorSearch] = useState('');
  const [instructorDeptFilter, setInstructorDeptFilter] = useState<'All' | 'BSIT' | 'High School'>('All');

  // 4. Subject Filters & Selection
  const [subjectMode, setSubjectMode] = useState<'all' | 'custom'>('all');
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(
    scopedSubjects.map((s) => s.id)
  );
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectDeptFilter, setSubjectDeptFilter] = useState<'All' | 'BSIT' | 'High School'>('All');

  // Default internal preferences for generator algorithm
  const [preferences] = useState<SchedulerPreferences>({
    noClassesAfter5pm: false,
    preferMornings: true,
    allowSaturday: false,
    splitTwoDays: true,
    customNotes: '',
  });

  const [blockProgress, setBlockProgress] = useState<Record<string, BlockStatus>>({});
  const [generationResults, setGenerationResults] = useState<BlockDraftResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filtered blocks based on Department and Search
  const filteredBlocks = useMemo(() => {
    return scopedBlocks.filter((b) => {
      const dept = getBlockDept(b);
      // Department filter
      if (selectedDeptFilter !== 'All') {
        if (dept !== selectedDeptFilter) return false;
      }

      // Search filter
      if (blockSearch.trim()) {
        const query = blockSearch.toLowerCase();
        const code = (b.programs?.code || '').toLowerCase();
        const name = (b.programs?.name || '').toLowerCase();
        const sec = (b.section || '').toLowerCase();
        const yl = String(b.year_level);
        if (!code.includes(query) && !name.includes(query) && !sec.includes(query) && !yl.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [scopedBlocks, selectedDeptFilter, blockSearch]);

  // Derived active department based on user role, department filter, or selected blocks
  const effectiveDepartment = useMemo<'BSIT' | 'High School' | 'All'>(() => {
    if (userRole !== 'admin') {
      return (schedulerDepartment as 'BSIT' | 'High School') || 'BSIT';
    }
    if (selectedDeptFilter !== 'All') {
      return selectedDeptFilter;
    }
    if (selectedBlockIds.length > 0) {
      const pickedBlocks = scopedBlocks.filter((b) => selectedBlockIds.includes(b.id));
      if (pickedBlocks.length > 0) {
        const allHs = pickedBlocks.every((b) => getBlockDept(b) === 'High School');
        const allBsit = pickedBlocks.every((b) => getBlockDept(b) === 'BSIT');
        if (allHs) return 'High School';
        if (allBsit) return 'BSIT';
      }
    }
    if (subjectDeptFilter !== 'All') {
      return subjectDeptFilter;
    }
    return 'All';
  }, [userRole, schedulerDepartment, selectedDeptFilter, selectedBlockIds, scopedBlocks, subjectDeptFilter]);

  // Offerings for the currently selected blocks
  const selectedBlocksOfferings = useMemo(() => {
    if (!offerings || offerings.length === 0 || selectedBlockIds.length === 0) return [];
    return offerings.filter((o) => selectedBlockIds.includes(o.block_id));
  }, [offerings, selectedBlockIds]);

  const selectedBlocksSubjectIds = useMemo(() => {
    return new Set(selectedBlocksOfferings.map((o) => o.subject_id));
  }, [selectedBlocksOfferings]);

  // Dynamically filter subjects pool to match picked department, year level, or block
  const filteredSubjects = useMemo(() => {
    return scopedSubjects.filter((sub) => {
      const isHs = isHighSchoolSubject(sub);

      // Department filter
      if (effectiveDepartment === 'BSIT' && isHs) return false;
      if (effectiveDepartment === 'High School' && !isHs) return false;

      // Block-specific filtering: If specific blocks are selected and have offerings in this term, narrow strictly to those subjects!
      if (selectedBlocksSubjectIds.size > 0) {
        if (!selectedBlocksSubjectIds.has(sub.id)) return false;
      }

      // Search query filter
      if (subjectSearch.trim()) {
        const query = subjectSearch.toLowerCase();
        const code = sub.code.toLowerCase();
        const title = sub.title.toLowerCase();
        return code.includes(query) || title.includes(query);
      }
      return true;
    });
  }, [
    scopedSubjects,
    effectiveDepartment,
    selectedBlocksSubjectIds,
    metadataMap,
    subjectSearch,
  ]);

  // Dynamically filter instructors pool to match picked department, year level, or block
  const filteredInstructors = useMemo(() => {
    const relevantSubjectIds = new Set(filteredSubjects.map((s) => s.id));

    return scopedInstructors.filter((inst) => {
      const instDept = inst.department || inst.profiles?.department || 'BSIT';

      // Department filter
      if (effectiveDepartment === 'BSIT' && instDept === 'High School') return false;
      if (effectiveDepartment === 'High School' && instDept === 'BSIT') return false;

      // Subject qualification matching:
      // If we have subjects in the filtered pool and qualifications exist in DB,
      // narrow down instructors to those who are qualified to teach the relevant subjects
      if (relevantSubjectIds.size > 0) {
        const hasMatchingQual = (inst.instructor_qualifications || []).some((q) =>
          relevantSubjectIds.has(q.subject_id)
        );
        const anyHasQual = scopedInstructors.some((other) =>
          (other.instructor_qualifications || []).some((q) => relevantSubjectIds.has(q.subject_id))
        );
        if (anyHasQual && !hasMatchingQual) {
          return false;
        }
      }

      // Search query filter
      if (instructorSearch.trim()) {
        const query = instructorSearch.toLowerCase();
        return inst.full_name.toLowerCase().includes(query);
      }
      return true;
    });
  }, [scopedInstructors, effectiveDepartment, filteredSubjects, instructorSearch]);

  const handleSelectDepartment = (deptKey: 'All' | 'BSIT' | 'High School') => {
    setSelectedDeptFilter(deptKey);
    const matchingBlocks = scopedBlocks.filter((b) => {
      const dept = getBlockDept(b);
      if (deptKey === 'All') return true;
      return dept === deptKey;
    });
    setSelectedBlockIds(matchingBlocks.filter((b) => !completedBlockIds.has(b.id)).map((b) => b.id));
  };

  // Toggle handlers for Blocks
  const handleToggleBlock = (blockId: string) => {
    setSelectedBlockIds((prev) =>
      prev.includes(blockId) ? prev.filter((id) => id !== blockId) : [...prev, blockId]
    );
  };

  const handleSelectAllFilteredBlocks = () => {
    const filteredIds = filteredBlocks.map((b) => b.id);
    const allSelected = filteredIds.every((id) => selectedBlockIds.includes(id));
    if (allSelected) {
      setSelectedBlockIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedBlockIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  // Toggle handlers for Instructors
  const handleToggleInstructor = (id: string) => {
    setSelectedInstructorIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllFilteredInstructors = () => {
    const ids = filteredInstructors.map((i) => i.id);
    const allSelected = ids.every((id) => selectedInstructorIds.includes(id));
    if (allSelected) {
      setSelectedInstructorIds((prev) => prev.filter((i) => !ids.includes(i)));
    } else {
      setSelectedInstructorIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  // Toggle handlers for Subjects
  const handleToggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSelectAllFilteredSubjects = () => {
    const ids = filteredSubjects.map((s) => s.id);
    const allSelected = ids.every((id) => selectedSubjectIds.includes(id));
    if (allSelected) {
      setSelectedSubjectIds((prev) => prev.filter((s) => !ids.includes(s)));
    } else {
      setSelectedSubjectIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
  };

  // Submission handler
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setGenerationResults(null);

    if (selectedBlockIds.length === 0) {
      setErrorMessage('Please select at least one student block to generate schedule.');
      return;
    }

    if (instructorMode === 'custom' && selectedInstructorIds.length === 0) {
      setErrorMessage('Please select at least one instructor in the instructor filter.');
      return;
    }

    if (subjectMode === 'custom' && selectedSubjectIds.length === 0) {
      setErrorMessage('Please select at least one subject in the subject filter.');
      return;
    }

    // Initialize progress indicators
    const initialProgress: Record<string, BlockStatus> = {};
    for (const bId of selectedBlockIds) {
      initialProgress[bId] = 'generating';
    }
    setBlockProgress(initialProgress);

    startTransition(async () => {
      try {
        const filters: SchedulingFilters = {
          blockIds: selectedBlockIds,
          instructorIds: instructorMode === 'custom' ? selectedInstructorIds : (filteredInstructors.length > 0 ? filteredInstructors.map((i) => i.id) : undefined),
          subjectIds: subjectMode === 'custom' ? selectedSubjectIds : (filteredSubjects.length > 0 ? filteredSubjects.map((s) => s.id) : undefined),
        };

        const response = await generateAiDraftAction(
          selectedTermId,
          selectedBlockIds,
          preferences,
          'new',
          filters
        );

        setGenerationResults(response.results);

        const finalProgress: Record<string, BlockStatus> = {};
        for (const res of response.results) {
          finalProgress[res.blockId] = res.success ? 'done' : 'failed';
          if (res.success) {
            setCompletedBlockIds((prev) => new Set([...prev, res.blockId]));
            setSelectedBlockIds((prev) => prev.filter((id) => id !== res.blockId));
          }
        }
        setBlockProgress(finalProgress);

        // Route to Schedule Editor directly to the Master Schedule
        setTimeout(() => {
          router.push(
            `/scheduler/schedule?termId=${selectedTermId}&versionId=${response.versionId}&masterlist=true`
          );
          router.refresh();
        }, 800);
      } catch (err: unknown) {
        setErrorMessage(
          err instanceof Error ? err.message : 'The scheduling algorithm encountered an unexpected error.'
        );
        const errProgress: Record<string, BlockStatus> = {};
        for (const bId of selectedBlockIds) {
          errProgress[bId] = 'failed';
        }
        setBlockProgress(errProgress);
      }
    });
  };

  return (
    <div className="d-flex flex-column gap-4">
      {/* Header Banner */}
      <div className="bg-white rounded-5 shadow-sm p-4 p-md-4 border border-light-subtle d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3">
        <div>
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-flex align-items-center justify-content-center rounded-3 text-white shadow-sm"
              style={{
                width: '38px',
                height: '38px',
                background: 'linear-gradient(135deg, #0E0AB8 0%, #2620DF 100%)',
              }}
            >
              <i className="bi bi-cpu fs-5" />
            </span>
            <h1 className="h4 fw-bold text-dark mb-0">Automated Schedule Generator</h1>
          </div>
          <p className="text-secondary small mb-0 mt-1">
            Configure filtering criteria (Year Levels, Blocks, Faculty, and Subjects) and run the Conflict Engine algorithm to synthesize conflict-free timetables.
          </p>
        </div>

        {/* Top Direct Action Button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isPending || selectedBlockIds.length === 0}
          className="btn text-white px-4 py-2.5 rounded-3 fw-bold d-inline-flex align-items-center gap-2 shadow-sm align-self-stretch align-self-md-center justify-content-center"
          style={{
            backgroundColor: '#0E0AB8',
            borderColor: '#0E0AB8',
            fontSize: '0.92rem',
          }}
        >
          {isPending ? (
            <>
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              <span>Generating Schedules...</span>
            </>
          ) : (
            <>
              <i className="bi bi-play-circle-fill fs-5" />
              <span>Start Making Schedules</span>
            </>
          )}
        </button>
      </div>

      {errorMessage && (
        <div className="alert alert-danger rounded-4 py-3 px-4 small d-flex justify-content-between align-items-center border-0 shadow-sm">
          <div className="d-flex align-items-center gap-2">
            <i className="bi bi-exclamation-triangle-fill text-danger fs-5" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="btn btn-sm btn-link text-decoration-none text-muted p-0"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleGenerate} className="d-flex flex-column gap-4">
        {/* ========================================================================= */}
        {/* 1. ACADEMIC TERM SELECTOR                                                */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-5 shadow-sm p-4 border border-light-subtle">
          <div className="row g-3 align-items-center">
            <div className="col-12 col-md-4">
              <label className="form-label small fw-bold text-dark mb-1">
                Target Academic Term
              </label>
              <div className="text-muted small">
                Select the school year &amp; semester to generate timetables for.
              </div>
            </div>
            <div className="col-12 col-md-8">
              <select
                value={selectedTermId}
                onChange={(e) => {
                  const newTermId = e.target.value;
                  setSelectedTermId(newTermId);
                  router.push(`/scheduler/generate?termId=${newTermId}`);
                }}
                className="form-select ref-form-control"
                style={{ maxWidth: '420px' }}
              >
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    Academic Year {t.school_year} — {t.semester} {t.is_current ? '★ (Current Active Term)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. DEPARTMENT & STUDENT BLOCKS FILTER                                     */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-5 shadow-sm p-4 p-md-4 border border-light-subtle">
          <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 pb-3 border-bottom border-light">
            <div>
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-diagram-3-fill text-primary" />
                <h2 className="h6 fw-bold text-dark mb-0">Department &amp; Student Blocks Filter</h2>
              </div>
              <div className="text-muted small mt-0.5 d-flex align-items-center gap-2 flex-wrap">
                <span>
                  {selectedBlockIds.length} of {scopedBlocks.length} blocks selected for timetable generation
                </span>
                {completedBlockIds.size > 0 && (
                  <span
                    className="badge rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                    style={{
                      fontSize: '11px',
                      backgroundColor: '#E6F4EA',
                      color: '#137333',
                      border: '1px solid #CEEAD6',
                      padding: '2px 8px',
                    }}
                  >
                    <i className="bi bi-check-circle-fill text-success" />
                    {completedBlockIds.size} completed
                  </span>
                )}
              </div>
            </div>

            <div className="d-flex align-items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  const incomplete = filteredBlocks.filter((b) => !completedBlockIds.has(b.id)).map((b) => b.id);
                  setSelectedBlockIds((prev) =>
                    Array.from(new Set([...prev.filter((id) => !filteredBlocks.some((b) => b.id === id)), ...incomplete]))
                  );
                }}
                className="btn btn-sm btn-outline-success rounded-pill px-3 fw-semibold d-inline-flex align-items-center gap-1"
                title="Select all blocks in current view that do not have completed schedules"
              >
                <i className="bi bi-filter" />
                Select Incomplete
              </button>
              <button
                type="button"
                onClick={handleSelectAllFilteredBlocks}
                className="btn btn-sm btn-outline-primary rounded-pill px-3 fw-semibold"
              >
                {filteredBlocks.every((b) => selectedBlockIds.includes(b.id))
                  ? 'Deselect Filtered'
                  : 'Select All Filtered'}
              </button>
              <button
                type="button"
                onClick={() =>
                  selectedBlockIds.length === scopedBlocks.length
                    ? setSelectedBlockIds([])
                    : setSelectedBlockIds(scopedBlocks.map((b) => b.id))
                }
                className="btn btn-sm btn-light border rounded-pill px-3 fw-semibold text-secondary"
              >
                {selectedBlockIds.length === scopedBlocks.length ? 'Clear All' : 'Select All Blocks'}
              </button>
            </div>
          </div>

          {/* Focused Block Notice if entered from specific cohort */}
          {targetInitialBlock && selectedBlockIds.length === 1 && selectedBlockIds[0] === targetInitialBlock.id && (
            <div className="alert alert-info py-2 px-3 rounded-4 border-0 d-flex align-items-center justify-content-between mt-3 mb-1 shadow-xs">
              <div className="d-flex align-items-center gap-2 small">
                <i className="bi bi-funnel-fill text-primary fs-6" />
                <span>
                  Generation is automatically filtered specifically for <strong>{targetInitialBlock.programs?.code || 'Cohort'} {targetInitialBlock.section}</strong>.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBlockIds(scopedBlocks.map((b) => b.id))}
                className="btn btn-sm btn-link text-decoration-none p-0 fw-semibold"
                style={{ fontSize: '12px' }}
              >
                Clear Focus &amp; Show All Blocks
              </button>
            </div>
          )}

          {/* Department Quick Filter Pills */}
          <div className="pt-3 pb-2">
            <span className="small text-muted fw-semibold text-uppercase d-block mb-2" style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
              Filter by Department:
            </span>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {deptPills.map((pill) => {
                const isActive = selectedDeptFilter === pill.key;
                const isHs = pill.key === 'High School';
                return (
                  <button
                    key={pill.key}
                    type="button"
                    onClick={() => handleSelectDepartment(pill.key as any)}
                    className={`btn btn-sm rounded-pill px-3 fw-semibold transition ${
                      isActive
                        ? isHs
                          ? 'btn-success text-white shadow-xs'
                          : 'btn-primary text-white shadow-xs'
                        : 'btn-light text-secondary border'
                    }`}
                    style={
                      isActive
                        ? isHs
                          ? { backgroundColor: '#16a34a', borderColor: '#16a34a' }
                          : { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' }
                        : {}
                    }
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search Box */}
          <div className="py-2">
            <div className="input-group" style={{ maxWidth: '380px' }}>
              <span className="input-group-text bg-light border-end-0">
                <i className="bi bi-search text-muted" />
              </span>
              <input
                type="text"
                value={blockSearch}
                onChange={(e) => setBlockSearch(e.target.value)}
                placeholder="Search blocks or sections..."
                className="form-control bg-light border-start-0 ps-0"
              />
              {blockSearch && (
                <button
                  type="button"
                  onClick={() => setBlockSearch('')}
                  className="btn btn-light border border-start-0"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Blocks Grid */}
          <div className="row g-3 pt-2">
            {filteredBlocks.map((b) => {
              const isSelected = selectedBlockIds.includes(b.id);
              const isCompleted = completedBlockIds.has(b.id);
              const status = blockProgress[b.id];
              const dept = getBlockDept(b);
              const isHs = dept === 'High School';

              return (
                <div key={b.id} className="col-12 col-sm-6 col-md-4">
                  <div
                    onClick={() => !isPending && handleToggleBlock(b.id)}
                    className={`p-3 rounded-4 border transition d-flex align-items-center justify-content-between h-100 ${
                      isSelected
                        ? 'bg-light border-primary shadow-xs'
                        : isCompleted
                        ? 'bg-white border-success-subtle shadow-xs'
                        : 'bg-white border-light-subtle opacity-75'
                    }`}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="d-flex align-items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="form-check-input mt-0 pointer-events-none"
                      />
                      <div>
                        <div className="d-flex align-items-center gap-1.5 flex-wrap">
                          <span className="fw-bold text-dark small">
                            {b.programs?.code || 'Block'} - {b.section.startsWith(String(b.year_level)) || /^Grade/i.test(b.section) ? b.section : `${b.year_level}${b.section}`}
                          </span>
                          {userRole === 'admin' && (
                            <span
                              className="badge rounded-pill fw-semibold"
                              style={{
                                fontSize: '10px',
                                backgroundColor: isHs ? '#E6F4EA' : '#E8EEFF',
                                color: isHs ? '#137333' : '#0E0AB8',
                                border: `1px solid ${isHs ? '#CEEAD6' : '#C4D4FF'}`,
                              }}
                            >
                              {dept}
                            </span>
                          )}
                          {isCompleted && (
                            <span
                              className="badge rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                              style={{
                                fontSize: '10px',
                                backgroundColor: '#E6F4EA',
                                color: '#137333',
                                border: '1px solid #CEEAD6',
                              }}
                              title="Schedule is complete"
                            >
                              <i className="bi bi-check-lg" />
                              Completed
                            </span>
                          )}
                        </div>
                        <div className="text-muted small mt-0.5" style={{ fontSize: '11px' }}>
                          {isHs
                            ? (b.section?.match(/Grade\s*\d+/i)?.[0] || (b.year_level === 3 ? 'Grade 11' : b.year_level === 4 ? 'Grade 12' : `Grade ${b.year_level}`))
                            : `Year Level ${b.year_level}`}
                        </div>
                      </div>
                    </div>

                    {status ? (
                      <span
                        className={`pill-status ${
                          status === 'done'
                            ? 'pill-status-progress'
                            : status === 'generating'
                            ? 'pill-status-pending'
                            : status === 'failed'
                            ? 'pill-status-archived text-danger'
                            : 'pill-status-archived'
                        }`}
                      >
                        {status}
                      </span>
                    ) : isCompleted ? (
                      <span
                        className="badge rounded-pill fw-semibold d-inline-flex align-items-center gap-1 shadow-xs"
                        style={{
                          fontSize: '11px',
                          backgroundColor: '#E6F4EA',
                          color: '#137333',
                          border: '1px solid #CEEAD6',
                          padding: '4px 8px',
                        }}
                      >
                        <i className="bi bi-check-circle-fill text-success" />
                        Completed
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {filteredBlocks.length === 0 && (
              <div className="col-12 text-center py-4 text-muted small">
                No blocks match the selected filter criteria.
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 3. INSTRUCTORS POOL FILTER                                               */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-5 shadow-sm p-4 p-md-4 border border-light-subtle">
          <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 pb-3 border-bottom border-light">
            <div>
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-person-badge-fill text-primary" />
                <h2 className="h6 fw-bold text-dark mb-0">Instructors Pool Filter</h2>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap mt-0.5">
                <span className="text-muted small">
                  {instructorMode === 'all'
                    ? `${filteredInstructors.length} faculty automatically filtered for ${effectiveDepartment === 'All' ? 'all departments' : effectiveDepartment}`
                    : `${selectedInstructorIds.length} of ${filteredInstructors.length} instructors selected`}
                </span>
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill py-0.5 px-2" style={{ fontSize: '10px' }}>
                  <i className="bi bi-funnel me-1"></i>
                  Auto-Filtered Pool
                </span>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                onClick={() => setInstructorMode('all')}
                className={`btn btn-sm rounded-pill px-3 fw-semibold ${
                  instructorMode === 'all'
                    ? 'btn-primary text-white shadow-xs'
                    : 'btn-light text-secondary border'
                }`}
                style={instructorMode === 'all' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
              >
                Include All Faculty
              </button>
              <button
                type="button"
                onClick={() => setInstructorMode('custom')}
                className={`btn btn-sm rounded-pill px-3 fw-semibold ${
                  instructorMode === 'custom'
                    ? 'btn-primary text-white shadow-xs'
                    : 'btn-light text-secondary border'
                }`}
                style={instructorMode === 'custom' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
              >
                Filter Specific Instructors
              </button>
            </div>
          </div>

          {instructorMode === 'custom' && (
            <div className="pt-3">
              {/* Department subfilter & search */}
              <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2 pb-3">
                {userRole === 'admin' ? (
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    {(['All', 'BSIT', 'High School'] as const).map((dept) => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setInstructorDeptFilter(dept)}
                        className={`btn btn-sm rounded-pill px-3 fw-semibold ${
                          instructorDeptFilter === dept
                            ? 'btn-outline-primary active'
                            : 'btn-light text-secondary border'
                        }`}
                      >
                        {dept === 'All' ? 'All Departments' : dept}
                      </button>
                    ))}
                  </div>
                ) : <div />}

                <div className="d-flex align-items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllFilteredInstructors}
                    className="btn btn-sm btn-link text-primary text-decoration-none fw-semibold p-0"
                  >
                    {filteredInstructors.every((i) => selectedInstructorIds.includes(i.id))
                      ? 'Deselect Filtered'
                      : 'Select All Filtered'}
                  </button>
                  <span className="text-muted">|</span>
                  <div className="input-group" style={{ maxWidth: '240px' }}>
                    <input
                      type="text"
                      value={instructorSearch}
                      onChange={(e) => setInstructorSearch(e.target.value)}
                      placeholder="Search faculty..."
                      className="form-control form-control-sm bg-light"
                    />
                  </div>
                </div>
              </div>

              {/* Instructors Checkbox Grid */}
              <div className="row g-2">
                {filteredInstructors.map((inst) => {
                  const isSelected = selectedInstructorIds.includes(inst.id);
                  const instDept = inst.department || inst.profiles?.department || 'BSIT';
                  const isHs = instDept === 'High School';

                  return (
                    <div key={inst.id} className="col-12 col-sm-6 col-md-4">
                      <div
                        onClick={() => handleToggleInstructor(inst.id)}
                        className={`p-2.5 px-3 rounded-3 border transition d-flex align-items-center justify-content-between ${
                          isSelected
                            ? 'bg-light border-primary'
                            : 'bg-white border-light-subtle opacity-75'
                        }`}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="d-flex align-items-center gap-2.5 text-truncate">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="form-check-input mt-0 pointer-events-none"
                          />
                          <span className="small fw-semibold text-dark text-truncate">
                            {inst.full_name}
                          </span>
                        </div>
                        <span
                          className="badge rounded-pill fw-semibold ms-2"
                          style={{
                            fontSize: '10px',
                            backgroundColor: isHs ? '#E6F4EA' : '#E8EEFF',
                            color: isHs ? '#137333' : '#0E0AB8',
                            border: `1px solid ${isHs ? '#CEEAD6' : '#C4D4FF'}`,
                          }}
                        >
                          {instDept}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {filteredInstructors.length === 0 && (
                  <div className="col-12 text-center py-3 text-muted small">
                    No instructors found.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 4. SUBJECTS CURRICULUM FILTER                                            */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-5 shadow-sm p-4 p-md-4 border border-light-subtle">
          <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 pb-3 border-bottom border-light">
            <div>
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-book-fill text-primary" />
                <h2 className="h6 fw-bold text-dark mb-0">Curriculum Subjects Filter</h2>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap mt-0.5">
                <span className="text-muted small">
                  {subjectMode === 'all'
                    ? `${filteredSubjects.length} subjects automatically filtered for ${effectiveDepartment === 'All' ? 'all departments' : effectiveDepartment}${selectedBlockIds.length > 0 && selectedBlockIds.length < scopedBlocks.length ? ` • ${selectedBlockIds.length} Block(s)` : ''}`
                    : `${selectedSubjectIds.length} of ${filteredSubjects.length} subjects selected`}
                </span>
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill py-0.5 px-2" style={{ fontSize: '10px' }}>
                  <i className="bi bi-funnel me-1"></i>
                  Auto-Filtered Pool
                </span>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                onClick={() => setSubjectMode('all')}
                className={`btn btn-sm rounded-pill px-3 fw-semibold ${
                  subjectMode === 'all'
                    ? 'btn-primary text-white shadow-xs'
                    : 'btn-light text-secondary border'
                }`}
                style={subjectMode === 'all' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
              >
                Include All Subjects
              </button>
              <button
                type="button"
                onClick={() => setSubjectMode('custom')}
                className={`btn btn-sm rounded-pill px-3 fw-semibold ${
                  subjectMode === 'custom'
                    ? 'btn-primary text-white shadow-xs'
                    : 'btn-light text-secondary border'
                }`}
                style={subjectMode === 'custom' ? { backgroundColor: '#0E0AB8', borderColor: '#0E0AB8' } : {}}
              >
                Filter Specific Subjects
              </button>
            </div>
          </div>

          {subjectMode === 'custom' && (
            <div className="pt-3">
              {/* Department subfilter & search */}
              <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2 pb-3">
                {userRole === 'admin' ? (
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    {(['All', 'BSIT', 'High School'] as const).map((dept) => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setSubjectDeptFilter(dept)}
                        className={`btn btn-sm rounded-pill px-3 fw-semibold ${
                          subjectDeptFilter === dept
                            ? 'btn-outline-primary active'
                            : 'btn-light text-secondary border'
                        }`}
                      >
                        {dept === 'All' ? 'All Departments' : dept}
                      </button>
                    ))}
                  </div>
                ) : <div />}

                <div className="d-flex align-items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllFilteredSubjects}
                    className="btn btn-sm btn-link text-primary text-decoration-none fw-semibold p-0"
                  >
                    {filteredSubjects.every((s) => selectedSubjectIds.includes(s.id))
                      ? 'Deselect Filtered'
                      : 'Select All Filtered'}
                  </button>
                  <span className="text-muted">|</span>
                  <div className="input-group" style={{ maxWidth: '240px' }}>
                    <input
                      type="text"
                      value={subjectSearch}
                      onChange={(e) => setSubjectSearch(e.target.value)}
                      placeholder="Search subjects..."
                      className="form-control form-control-sm bg-light"
                    />
                  </div>
                </div>
              </div>

              {/* Subjects Checkbox Grid */}
              <div className="row g-2" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                {filteredSubjects.map((sub) => {
                  const isSelected = selectedSubjectIds.includes(sub.id);
                  const isHs = isHighSchoolSubject(sub);

                  return (
                    <div key={sub.id} className="col-12 col-md-6">
                      <div
                        onClick={() => handleToggleSubject(sub.id)}
                        className={`p-2.5 px-3 rounded-3 border transition d-flex align-items-center justify-content-between ${
                          isSelected
                            ? 'bg-light border-primary'
                            : 'bg-white border-light-subtle opacity-75'
                        }`}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="d-flex align-items-center gap-2.5 text-truncate">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="form-check-input mt-0 pointer-events-none"
                          />
                          <div className="text-truncate">
                            <span className="small fw-bold text-dark me-2">
                              {sub.code}
                            </span>
                            <span className="small text-muted text-truncate">
                              {sub.title}
                            </span>
                          </div>
                        </div>

                        <div className="d-flex align-items-center gap-1.5 ms-2 flex-shrink-0">
                          <span className="badge bg-light text-secondary border" style={{ fontSize: '10px' }}>
                            {sub.units} Units
                          </span>
                          <span
                            className="badge rounded-pill fw-semibold"
                            style={{
                              fontSize: '10px',
                              backgroundColor: isHs ? '#E6F4EA' : '#E8EEFF',
                              color: isHs ? '#137333' : '#0E0AB8',
                              border: `1px solid ${isHs ? '#CEEAD6' : '#C4D4FF'}`,
                            }}
                          >
                            {isHs ? 'High School' : 'BSIT'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredSubjects.length === 0 && (
                  <div className="col-12 text-center py-3 text-muted small">
                    No subjects found.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* 5. PRIMARY ACTION CONTROLS                                               */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-5 shadow-sm p-4 border border-light-subtle d-flex flex-column flex-md-row align-items-center justify-content-between gap-3">
          <div className="small text-muted">
            <i className="bi bi-shield-check text-success me-1.5" />
            Every session will be verified against the deterministic Conflict Engine rules (lunch break, canonical slots, zero room/faculty clashes).
          </div>

          <button
            type="submit"
            disabled={isPending || selectedBlockIds.length === 0}
            className="btn text-white px-5 py-3 rounded-3 fw-bold d-inline-flex align-items-center gap-2 shadow"
            style={{
              backgroundColor: '#0E0AB8',
              borderColor: '#0E0AB8',
              fontSize: '1rem',
              letterSpacing: '0.01em',
            }}
          >
            {isPending ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                <span>Synthesizing Draft Schedule...</span>
              </>
            ) : (
              <>
                <i className="bi bi-play-circle-fill fs-5" />
                <span>Start Making Schedules</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Generation Results Summary */}
      {generationResults && (
        <div className="bg-white rounded-5 shadow-sm p-4 border border-light-subtle space-y-3">
          <h3 className="fs-5 fw-bold text-dark m-0">
            Generation Results
          </h3>
          <div className="row g-3">
            {generationResults.map((res) => (
              <div key={res.blockId} className="col-12 col-md-6">
                <div className="p-3 rounded-4 border bg-light">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <span className="fw-bold text-dark small">
                      {res.blockName}
                    </span>
                    <span className="pill-status pill-status-progress">
                      {res.entriesWritten.length} sessions placed
                    </span>
                  </div>

                  {res.unassigned.length > 0 && (
                    <div className="pt-2 border-top mt-2">
                      <span className="small fw-bold text-warning">
                        Unassigned Hours ({res.unassigned.length}):
                      </span>
                      <ul className="mt-1 mb-0 ps-3 small text-muted">
                        {res.unassigned.map((u, i) => (
                          <li key={i}>
                            {u.subjectCode}: {u.remainingHours}h remaining ({u.reason})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
