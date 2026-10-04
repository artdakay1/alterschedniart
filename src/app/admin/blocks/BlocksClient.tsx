// src/app/admin/blocks/BlocksClient.tsx
'use client';

import React, { useState, useTransition, useMemo } from 'react';
import Link from 'next/link';
import type { Program, Block, AcademicTerm } from '@/types/database';
import { FormModal } from '@/components/FormModal';
import type { YearLevelGroup } from '@/lib/academic/year-levels';
import {
  saveProgramAction,
  deleteProgramAction,
  saveBlockAction,
  deleteBlockAction,
  saveYearLevelAction,
  deleteYearLevelAction,
} from './actions';
import type { ProgramInput, BlockInput } from '@/lib/validators/academic';

interface BlocksClientProps {
  programs: Program[];
  blocks: (Block & { programs?: Program | null })[];
  activeTerm?: AcademicTerm | null;
  initialYearLevelConfigs?: YearLevelGroup[];
}

export function formatShortBlockName(
  programCode: string,
  yearLevel: number,
  section: string
): string {
  const code = (programCode || 'BSIT').trim().toUpperCase();
  const rawSec = section.trim();

  // If section already has the full format like "(BSIT - 1A)" or "BSIT - 1A"
  if (
    rawSec.includes('-') &&
    (rawSec.toUpperCase().startsWith('BSIT') || rawSec.toUpperCase().startsWith('HS'))
  ) {
    return rawSec.replace(/^\(/, '').replace(/\)$/, '');
  }

  // If section is like "Grade 7-A" or "Grade 7A"
  const gradeMatch = rawSec.match(/^Grade\s*(\d+)[-\s]*([A-Za-z0-9]+)?/i);
  if (gradeMatch) {
    const gradeNum = gradeMatch[1];
    const secLetter = gradeMatch[2] ? gradeMatch[2] : '';
    return `${code} - ${gradeNum}${secLetter}`;
  }

  // If section is like "1A", "2B", "11-STEM", "12-TVL"
  if (/^\d+[A-Za-z0-9\-_]*$/.test(rawSec)) {
    return `${code} - ${rawSec}`;
  }

  // If section is just "A", "B", "C"
  return `${code} - ${yearLevel}${rawSec}`;
}

export function BlocksClient({
  programs,
  blocks,
  activeTerm,
  initialYearLevelConfigs = [],
}: BlocksClientProps) {
  const [isPending, startTransition] = useTransition();

  // Dynamic department filter: '(All Departments)' or program code (e.g. BSIT, HS)
  const [selectedDept, setSelectedDept] = useState<string>('all');

  // Year level configs state (no Grade 7 to 10; defaults to BSIT 1-4 and HS Grade 11-12)
  const [yearLevelConfigs, setYearLevelConfigs] = useState<YearLevelGroup[]>(
    initialYearLevelConfigs.length > 0
      ? initialYearLevelConfigs
      : [
          {
            id: 'bsit-1',
            deptCode: 'BSIT',
            deptName: 'Bachelor of Science in Information Technology',
            yearLevelNum: 1,
            title: '1st Year Level',
            subTitle: 'Freshman computing fundamentals, introduction to IT, and general education subjects',
            targetSubjectsYearLevel: '1st Year',
            isHighSchool: false,
          },
          {
            id: 'bsit-2',
            deptCode: 'BSIT',
            deptName: 'Bachelor of Science in Information Technology',
            yearLevelNum: 2,
            title: '2nd Year Level',
            subTitle: 'Sophomore core courses: Data structures, OOP, web systems, and discrete math',
            targetSubjectsYearLevel: '2nd Year',
            isHighSchool: false,
          },
          {
            id: 'bsit-3',
            deptCode: 'BSIT',
            deptName: 'Bachelor of Science in Information Technology',
            yearLevelNum: 3,
            title: '3rd Year Level',
            subTitle: 'Junior advanced courses: Database administration, networking, info assurance & security',
            targetSubjectsYearLevel: '3rd Year',
            isHighSchool: false,
          },
          {
            id: 'bsit-4',
            deptCode: 'BSIT',
            deptName: 'Bachelor of Science in Information Technology',
            yearLevelNum: 4,
            title: '4th Year Level',
            subTitle: 'Senior capstone research, systems administration, and industry internship practicum',
            targetSubjectsYearLevel: '4th Year',
            isHighSchool: false,
          },
          {
            id: 'hs-11',
            deptCode: 'HS',
            deptName: 'High School Department',
            yearLevelNum: 3,
            title: 'Grade 11 - STEM & TVL',
            subTitle: 'Senior High School Grade 11 specialized academic tracks (Pre-Calculus & TVL-ICT)',
            targetSubjectsYearLevel: 'Grade 11 (SHS)',
            isHighSchool: true,
          },
          {
            id: 'hs-12',
            deptCode: 'HS',
            deptName: 'High School Department',
            yearLevelNum: 4,
            title: 'Grade 12 - STEM & TVL',
            subTitle: 'Senior High School Grade 12 graduating projects and computer systems servicing NC II',
            targetSubjectsYearLevel: 'Grade 12 (SHS)',
            isHighSchool: true,
          },
        ]
  );

  // Program modal state
  const [isProgramModalOpen, setIsProgramModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [programFormData, setProgramFormData] = useState<ProgramInput>({
    code: '',
    name: '',
  });

  // Year level modal state
  const [isYearLevelModalOpen, setIsYearLevelModalOpen] = useState(false);
  const [yearLevelFormData, setYearLevelFormData] = useState<{
    program_id: string;
    year_level: number;
    title: string;
    sub_title: string;
    target_subjects: string;
  }>({
    program_id: programs[0]?.id || '',
    year_level: 1,
    title: '',
    sub_title: '',
    target_subjects: '',
  });

  // Block modal state
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const [blockFormData, setBlockFormData] = useState<BlockInput>({
    program_id: programs[0]?.id || '',
    year_level: 1,
    section: 'A',
    student_count: 40,
  });

  const [modalError, setModalError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  // Separate programs for lookups and sort programs naturally by code
  const sortedPrograms = useMemo(
    () =>
      [...programs].sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' })
      ),
    [programs]
  );
  const bsitProgram = useMemo(
    () => sortedPrograms.find((p) => p.code.toUpperCase() === 'BSIT') || sortedPrograms[0],
    [sortedPrograms]
  );
  const hsProgram = useMemo(
    () =>
      sortedPrograms.find(
        (p) => p.code.toUpperCase() === 'HS' || p.name.toLowerCase().includes('high school')
      ),
    [sortedPrograms]
  );

  // Handlers
  const handleOpenAddProgram = () => {
    setEditingProgram(null);
    setProgramFormData({ code: '', name: '' });
    setModalError(null);
    setIsProgramModalOpen(true);
  };

  const handleOpenEditProgram = (prog: Program) => {
    setEditingProgram(prog);
    setProgramFormData({ code: prog.code, name: prog.name });
    setModalError(null);
    setIsProgramModalOpen(true);
  };

  const handleSubmitProgram = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);
    startTransition(async () => {
      try {
        await saveProgramAction(
          editingProgram ? editingProgram.id : null,
          programFormData
        );
        setIsProgramModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Program ${programFormData.code} saved successfully.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to save program.');
      }
    });
  };

  const handleDeleteProgram = (prog: Program) => {
    if (!confirm(`Are you sure you want to delete program "${prog.code}"?`)) return;
    startTransition(async () => {
      try {
        await deleteProgramAction(prog.id);
        setBannerNotice({
          type: 'success',
          message: `Deleted program ${prog.code}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete program.',
        });
      }
    });
  };

  const handleOpenAddBlock = () => {
    setEditingBlock(null);
    setBlockFormData({
      program_id: programs[0]?.id || '',
      year_level: 1,
      section: 'A',
      student_count: 40,
    });
    setModalError(null);
    setIsBlockModalOpen(true);
  };

  const handleOpenAddBlockForYear = (deptCode: string, yearLevelNum: number) => {
    setEditingBlock(null);
    const targetProg =
      programs.find((p) => p.code.toUpperCase() === deptCode.toUpperCase()) || programs[0];
    setBlockFormData({
      program_id: targetProg?.id || programs[0]?.id || '',
      year_level: yearLevelNum,
      section: 'A',
      student_count: 40,
    });
    setModalError(null);
    setIsBlockModalOpen(true);
  };

  const handleOpenAddYearLevel = (defaultProgramId?: string) => {
    const prog = programs.find((p) => p.id === defaultProgramId) || programs[0];
    setYearLevelFormData({
      program_id: prog?.id || '',
      year_level: 1,
      title: '',
      sub_title: '',
      target_subjects: '',
    });
    setModalError(null);
    setIsYearLevelModalOpen(true);
  };

  const handleSubmitYearLevel = () => {
    setModalError(null);
    const prog = programs.find((p) => p.id === yearLevelFormData.program_id);
    if (!prog) {
      setModalError('Please select a valid program.');
      return;
    }
    if (!yearLevelFormData.title.trim()) {
      setModalError('Please enter a title for the year level.');
      return;
    }

    startTransition(async () => {
      try {
        const created = await saveYearLevelAction({
          deptCode: prog.code,
          deptName: prog.name,
          yearLevelNum: yearLevelFormData.year_level,
          title: yearLevelFormData.title.trim(),
          subTitle:
            yearLevelFormData.sub_title.trim() ||
            `${yearLevelFormData.title.trim()} academic curriculum and student blocks`,
          targetSubjectsYearLevel:
            yearLevelFormData.target_subjects.trim() || yearLevelFormData.title.trim(),
        });

        setYearLevelConfigs((prev) => {
          const idx = prev.findIndex(
            (c) =>
              c.deptCode.toUpperCase() === created.deptCode.toUpperCase() &&
              c.yearLevelNum === created.yearLevelNum
          );
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = created;
            return copy;
          }
          return [...prev, created];
        });

        setIsYearLevelModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Year Level "${created.title}" for ${created.deptCode} created successfully.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to create year level.');
      }
    });
  };

  const handleOpenEditBlock = (block: Block) => {
    setEditingBlock(block);
    setBlockFormData({
      program_id: block.program_id,
      year_level: block.year_level,
      section: block.section,
      student_count: block.student_count || 40,
    });
    setModalError(null);
    setIsBlockModalOpen(true);
  };

  const handleSubmitBlock = () => {
    setModalError(null);
    startTransition(async () => {
      try {
        await saveBlockAction(editingBlock?.id || null, blockFormData);
        setIsBlockModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Block ${blockFormData.section} saved successfully.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to save block.');
      }
    });
  };

  const handleDeleteBlock = (block: Block) => {
    if (!confirm(`Delete Block ${block.section}?`)) return;
    startTransition(async () => {
      try {
        await deleteBlockAction(block.id);
        setBannerNotice({
          type: 'success',
          message: `Deleted Block ${block.section}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete block.',
        });
      }
    });
  };

  // Synthesize all configured year levels with any existing blocks
  const allYearConfigs = useMemo(() => {
    const list = [...yearLevelConfigs];

    blocks.forEach((b) => {
      const prog = programs.find((p) => p.id === b.program_id);
      if (!prog) return;
      const exists = list.some(
        (c) =>
          c.deptCode.toUpperCase() === prog.code.toUpperCase() &&
          c.yearLevelNum === b.year_level
      );
      if (!exists) {
        const isHS =
          prog.code.toUpperCase() === 'HS' ||
          prog.name.toLowerCase().includes('high school');
        list.push({
          id: `auto-${prog.code}-${b.year_level}`,
          deptCode: prog.code,
          deptName: prog.name,
          yearLevelNum: b.year_level,
          title: isHS
            ? `Grade ${b.year_level + 8} Level`
            : `${b.year_level}${
                b.year_level === 1
                  ? 'st'
                  : b.year_level === 2
                  ? 'nd'
                  : b.year_level === 3
                  ? 'rd'
                  : 'th'
              } Year Level`,
          subTitle: `${prog.name} Year ${b.year_level} student blocks`,
          targetSubjectsYearLevel: `${b.year_level} Year`,
          isHighSchool: isHS,
        });
      }
    });

    return list;
  }, [yearLevelConfigs, blocks, programs]);

  // Filter year levels by department
  const filteredYearConfigs = useMemo(() => {
    return allYearConfigs.filter((cfg) => {
      if (selectedDept === 'all') return true;
      return cfg.deptCode.toUpperCase() === selectedDept.toUpperCase();
    });
  }, [allYearConfigs, selectedDept]);

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

      {/* Top Filter and Actions Toolbar */}
      <div className="bg-white rounded-4 p-3.5 shadow-sm border border-light-subtle d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 mb-4">
        {/* Dynamic Department Filter Buttons */}
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span
            className="text-secondary small fw-bold text-uppercase me-1"
            style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}
          >
            Department:
          </span>

          <button
            type="button"
            onClick={() => setSelectedDept('all')}
            className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-bold transition ${
              selectedDept === 'all'
                ? 'btn-ref-primary text-white shadow-sm'
                : 'btn-outline-secondary'
            }`}
          >
            (All Departments) <span className="opacity-75 ms-1">({blocks.length})</span>
          </button>

          {sortedPrograms.map((p) => {
            const pBlocks = blocks.filter((b) => b.program_id === p.id);
            const label = p.code.toUpperCase() === 'HS' ? '(High School)' : `(${p.code})`;
            const isSelected = selectedDept.toUpperCase() === p.code.toUpperCase();
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedDept(p.code)}
                className={`btn btn-sm rounded-pill px-3.5 py-1.5 fw-bold transition ${
                  isSelected
                    ? 'btn-ref-primary text-white shadow-sm'
                    : 'btn-outline-secondary'
                }`}
              >
                {label} <span className="opacity-75 ms-1">({pBlocks.length})</span>
              </button>
            );
          })}

          {activeTerm && (
            <div
              className="d-inline-flex align-items-center gap-2 ms-md-2 px-3 py-1.5 rounded-pill bg-light border text-secondary"
              style={{ fontSize: '0.8rem' }}
            >
              <span
                className="bg-success rounded-circle d-inline-block"
                style={{ width: '8px', height: '8px' }}
              />
              <span>
                Active Term: <strong className="text-dark">{activeTerm.school_year} ({activeTerm.semester})</strong>
              </span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="d-flex flex-wrap align-items-center gap-2">
          <button
            type="button"
            onClick={handleOpenAddBlock}
            className="btn-ref-primary d-inline-flex align-items-center gap-1.5"
          >
            <i className="bi bi-plus-lg" />
            <span>Add Block</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenAddYearLevel()}
            className="btn btn-sm btn-outline-primary rounded-pill px-3 py-1.5 fw-semibold d-inline-flex align-items-center gap-1.5"
          >
            <i className="bi bi-calendar-plus" />
            <span>Add Year Level</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddProgram}
            className="btn-ref-secondary d-inline-flex align-items-center gap-1.5"
          >
            <i className="bi bi-mortarboard" />
            <span>New Program</span>
          </button>
        </div>
      </div>

      {/* Year Levels separated only by dividing lines (No sections or cards) */}
      <div className="bg-white rounded-4 p-4 p-md-5 shadow-sm border border-light-subtle">
        {filteredYearConfigs.map((cfg, index) => {
          // Find matching blocks for this department and year level
          const matchingBlocks = blocks.filter((b) => {
            const prog = programs.find((p) => p.id === b.program_id);
            const isHS =
              prog?.code.toUpperCase() === 'HS' ||
              prog?.name.toLowerCase().includes('high school');
            if (cfg.isHighSchool !== isHS) return false;
            return b.year_level === cfg.yearLevelNum;
          });

          // Sort blocks naturally by name so (BSIT - 1A, BSIT - 1B, BSIT - 1C) appear in order
          const sortedMatchingBlocks = [...matchingBlocks].sort((a, b) => {
            const progA = programs.find((p) => p.id === a.program_id);
            const progB = programs.find((p) => p.id === b.program_id);
            const nameA = formatShortBlockName(
              progA?.code || cfg.deptCode,
              cfg.yearLevelNum,
              a.section
            );
            const nameB = formatShortBlockName(
              progB?.code || cfg.deptCode,
              cfg.yearLevelNum,
              b.section
            );
            return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
          });

          return (
            <div key={`${cfg.deptCode}-${cfg.yearLevelNum}`}>
              {/* Year Level Header with Title and "View Subjects" Link */}
              <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3 pb-3 mb-3">
                <div>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span
                      className={`badge ${
                        cfg.isHighSchool
                          ? 'bg-warning-subtle text-warning-emphasis'
                          : 'bg-primary-subtle text-primary'
                      } px-2.5 py-1 rounded-pill fw-bold text-uppercase`}
                      style={{ fontSize: '0.72rem' }}
                    >
                      ({cfg.deptCode})
                    </span>
                    <h3 className="fs-5 fw-bold text-dark m-0">{cfg.title}</h3>
                    <span
                      className="badge bg-light text-secondary border font-monospace px-2.5 py-0.5 rounded-pill"
                      style={{ fontSize: '0.75rem' }}
                    >
                      {sortedMatchingBlocks.length} {sortedMatchingBlocks.length === 1 ? 'Block' : 'Blocks'}
                    </span>
                  </div>
                  <p className="text-secondary small mb-0" style={{ fontSize: '0.82rem' }}>
                    {cfg.subTitle}
                  </p>
                </div>

                {/* Right controls: View Subjects Button & Add Block */}
                <div className="d-flex flex-wrap align-items-center gap-2">
                  <Link
                    href={`/admin/subjects?yearLevel=${encodeURIComponent(cfg.targetSubjectsYearLevel)}`}
                    className="btn btn-sm btn-outline-primary rounded-pill px-3 py-1.5 fw-semibold d-inline-flex align-items-center gap-1.5"
                    title={`Browse all subjects mapped to ${cfg.title}`}
                  >
                    <i className="bi bi-journal-text" />
                    <span>View Subjects &rarr;</span>
                  </Link>

                  <button
                    type="button"
                    onClick={() => handleOpenAddBlockForYear(cfg.deptCode, cfg.yearLevelNum)}
                    className="btn btn-sm btn-light border rounded-pill px-3 py-1.5 text-secondary fw-semibold"
                    title={`Add block to ${cfg.title}`}
                  >
                    <i className="bi bi-plus-lg me-1" />
                    <span>Add Block</span>
                  </button>
                </div>
              </div>

              {/* Blocks inside this Year Level (Clean Table - No Cards) */}
              {sortedMatchingBlocks.length > 0 ? (
                <div className="table-responsive rounded-3 overflow-hidden border border-light-subtle">
                  <table className="table table-hover align-middle mb-0 bg-white">
                    <thead
                      className="table-light text-secondary small text-uppercase"
                      style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}
                    >
                      <tr>
                        <th style={{ width: '25%' }} className="ps-3.5 py-2.5">
                          Block Name
                        </th>
                        <th style={{ width: '42%' }} className="py-2.5">
                          Program / Track
                        </th>
                        <th style={{ width: '15%' }} className="py-2.5">
                          Block
                        </th>
                        <th style={{ width: '18%' }} className="pe-3.5 py-2.5 text-end">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-light">
                      {sortedMatchingBlocks.map((b) => {
                        const prog = programs.find((p) => p.id === b.program_id);
                        const blockCode = formatShortBlockName(
                          prog?.code || cfg.deptCode,
                          cfg.yearLevelNum,
                          b.section
                        );
                        return (
                          <tr key={b.id}>
                            <td className="ps-3.5 py-3">
                              <span
                                className="fw-bold px-2.5 py-1 rounded-pill bg-light border font-monospace d-inline-flex align-items-center"
                                style={{ fontSize: '0.85rem', color: '#0E0AB8' }}
                              >
                                {blockCode}
                              </span>
                            </td>
                            <td className="py-3">
                              <div className="fw-semibold text-dark small">
                                {prog?.name || cfg.deptName}
                              </div>
                              <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                Department: {cfg.deptName}
                              </div>
                            </td>
                            <td className="py-3">
                              <span className="badge bg-light text-secondary border px-2.5 py-1 rounded-pill small">
                                Block {b.section}
                              </span>
                            </td>
                            <td className="pe-3.5 py-3 text-end">
                              <div className="d-inline-flex align-items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditBlock(b)}
                                  disabled={isPending}
                                  className="btn btn-sm btn-light border rounded-pill px-2.5 py-0.5 text-dark fw-semibold"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteBlock(b)}
                                  disabled={isPending}
                                  className="btn btn-sm btn-outline-danger rounded-pill px-2 py-0.5 fw-semibold"
                                  style={{ fontSize: '0.75rem' }}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  className="rounded-3 p-4 text-center text-secondary border border-dashed"
                  style={{ borderColor: '#cbd5e1', backgroundColor: '#f8fafc' }}
                >
                  <i className="bi bi-diagram-3 fs-4 text-muted d-block mb-1" />
                  <p className="small mb-2">No blocks configured yet for {cfg.title}.</p>
                  <button
                    type="button"
                    onClick={() => handleOpenAddBlockForYear(cfg.deptCode, cfg.yearLevelNum)}
                    className="btn btn-sm btn-ref-primary"
                  >
                    <i className="bi bi-plus-lg me-1" />
                    Add Block for {cfg.title}
                  </button>
                </div>
              )}

              {/* Dividing line separating year levels */}
              {index < filteredYearConfigs.length - 1 && (
                <hr
                  className="my-4 my-md-5"
                  style={{ borderColor: '#e2e8f0', borderWidth: '1px', opacity: 1 }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Program Modal */}
      <FormModal
        isOpen={isProgramModalOpen}
        onClose={() => setIsProgramModalOpen(false)}
        title={editingProgram ? 'Edit Degree Program' : 'Create Degree Program'}
        description="Specify degree program identification code and full title."
        onSubmit={handleSubmitProgram}
        isSubmitting={isPending}
        error={modalError}
        submitLabel={editingProgram ? 'Save Program' : 'Create Program'}
      >
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Program Code (e.g. BSIT)
          </label>
          <input
            type="text"
            required
            placeholder="BSIT"
            value={programFormData.code}
            onChange={(e) =>
              setProgramFormData((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))
            }
            className="form-control ref-form-control text-uppercase"
          />
        </div>

        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Program Name
          </label>
          <input
            type="text"
            required
            placeholder="Bachelor of Science in Information Technology"
            value={programFormData.name}
            onChange={(e) =>
              setProgramFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            className="form-control ref-form-control"
          />
        </div>
      </FormModal>

      {/* Block Modal */}
      <FormModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        title={editingBlock ? 'Edit Block' : 'Create Block'}
        description="Define block for scheduling."
        onSubmit={handleSubmitBlock}
        isSubmitting={isPending}
        error={modalError}
        submitLabel={editingBlock ? 'Save Block' : 'Create Block'}
      >
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Academic Program / Department
          </label>
          <select
            value={blockFormData.program_id}
            onChange={(e) =>
              setBlockFormData((prev) => ({ ...prev, program_id: e.target.value }))
            }
            className="form-select ref-form-control"
          >
            {sortedPrograms.map((p) => (
              <option key={p.id} value={p.id}>
                ({p.code}) - {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-6">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Year Level (1 - 5)
            </label>
            <input
              type="number"
              min={1}
              max={5}
              required
              value={blockFormData.year_level}
              onChange={(e) =>
                setBlockFormData((prev) => ({
                  ...prev,
                  year_level: parseInt(e.target.value) || 1,
                }))
              }
              className="form-control ref-form-control"
            />
          </div>

          <div className="col-6">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Block (e.g. 1A, 2A, A, B)
            </label>
            <input
              type="text"
              required
              placeholder="1A"
              value={blockFormData.section}
              onChange={(e) =>
                setBlockFormData((prev) => ({
                  ...prev,
                  section: e.target.value.toUpperCase(),
                }))
              }
              className="form-control ref-form-control text-uppercase"
            />
          </div>
        </div>
      </FormModal>

      {/* Create Year Level Modal */}
      <FormModal
        isOpen={isYearLevelModalOpen}
        onClose={() => setIsYearLevelModalOpen(false)}
        title="Create New Year Level"
        description="Add a new year level cohort for any academic department or degree program."
        onSubmit={handleSubmitYearLevel}
        isSubmitting={isPending}
        error={modalError}
        submitLabel="Create Year Level"
      >
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Department / Program
          </label>
          <select
            value={yearLevelFormData.program_id}
            onChange={(e) =>
              setYearLevelFormData((prev) => ({ ...prev, program_id: e.target.value }))
            }
            className="form-select ref-form-control"
          >
            {sortedPrograms.map((p) => (
              <option key={p.id} value={p.id}>
                ({p.code}) - {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-5">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Year Level (1 - 5)
            </label>
            <input
              type="number"
              min={1}
              max={5}
              required
              value={yearLevelFormData.year_level}
              onChange={(e) =>
                setYearLevelFormData((prev) => ({
                  ...prev,
                  year_level: parseInt(e.target.value) || 1,
                }))
              }
              className="form-control ref-form-control"
            />
          </div>

          <div className="col-7">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Year Level Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. 5th Year Level, Grade 11 - HUMSS"
              value={yearLevelFormData.title}
              onChange={(e) =>
                setYearLevelFormData((prev) => ({
                  ...prev,
                  title: e.target.value,
                }))
              }
              className="form-control ref-form-control"
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Description / Subtitle (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. Specialized academic focus and capstone research"
            value={yearLevelFormData.sub_title}
            onChange={(e) =>
              setYearLevelFormData((prev) => ({
                ...prev,
                sub_title: e.target.value,
              }))
            }
            className="form-control ref-form-control"
          />
        </div>

        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Target Subjects Filter Tag (Optional)
          </label>
          <input
            type="text"
            placeholder="e.g. 5th Year or Grade 11 (SHS)"
            value={yearLevelFormData.target_subjects}
            onChange={(e) =>
              setYearLevelFormData((prev) => ({
                ...prev,
                target_subjects: e.target.value,
              }))
            }
            className="form-control ref-form-control"
          />
          <div className="form-text small text-muted" style={{ fontSize: '0.74rem' }}>
            Used when clicking &quot;View Subjects &rarr;&quot; to filter matching courses.
          </div>
        </div>
      </FormModal>
    </div>
  );
}
