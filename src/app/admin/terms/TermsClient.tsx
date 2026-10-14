// src/app/admin/terms/TermsClient.tsx
'use client';

import React, { useState, useTransition, useMemo } from 'react';
import type { AcademicTerm, Program, Subject, ClassOffering, Block } from '@/types/database';
import { DataTable, type Column } from '@/components/DataTable';
import { FormModal } from '@/components/FormModal';
import {
  saveAcademicTermAction,
  deleteAcademicTermAction,
  setAcademicTermCurrentAction,
} from './actions';
import type { AcademicTermInput } from '@/lib/validators/academic';
import { getSubjectCategory, getSubjectYearLevel } from '@/app/admin/subjects/SubjectsClient';

interface TermsClientProps {
  terms: AcademicTerm[];
  programs?: Program[];
  subjects?: Subject[];
  offerings?: (ClassOffering & {
    subjects?: Subject | null;
    blocks?: (Block & { programs?: Program | null }) | null;
  })[];
}

export function TermsClient({
  terms,
  programs = [],
  subjects = [],
  offerings = [],
}: TermsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<AcademicTerm | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // Subjects & Departments Modal state
  const [selectedTermForOverview, setSelectedTermForOverview] = useState<AcademicTerm | null>(null);
  const [overviewDept, setOverviewDept] = useState<'all' | 'BSIT' | 'HS'>('all');
  const [overviewSearch, setOverviewSearch] = useState('');

  const currentTerm = useMemo(() => terms.find((t) => t.is_current) || terms[0], [terms]);

  const [formData, setFormData] = useState<AcademicTermInput>({
    school_year: '2026-2027',
    semester: '1st Semester',
    is_current: false,
  });

  const handleOpenAdd = () => {
    setEditingTerm(null);
    setFormData({
      school_year: '2026-2027',
      semester: '1st Semester',
      is_current: terms.length === 0,
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (term: AcademicTerm) => {
    setEditingTerm(term);
    setFormData({
      school_year: term.school_year,
      semester: term.semester,
      is_current: term.is_current,
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    startTransition(async () => {
      try {
        await saveAcademicTermAction(editingTerm ? editingTerm.id : null, formData);
        setIsModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Academic term ${formData.school_year} (${formData.semester}) saved successfully.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to save term.');
      }
    });
  };

  const handleDelete = (term: AcademicTerm) => {
    if (term.is_current) {
      alert('Cannot delete the currently active term. Please activate another term first.');
      return;
    }
    if (!confirm(`Are you sure you want to delete term ${term.school_year} (${term.semester})?`)) {
      return;
    }

    startTransition(async () => {
      try {
        await deleteAcademicTermAction(term.id);
        setBannerNotice({
          type: 'success',
          message: `Deleted term ${term.school_year} (${term.semester}).`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete term.',
        });
      }
    });
  };

  const handleSetCurrent = (term: AcademicTerm) => {
    startTransition(async () => {
      try {
        await setAcademicTermCurrentAction(term.id);
        setBannerNotice({
          type: 'success',
          message: `Activated ${term.school_year} (${term.semester}) as current academic term.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to activate term.',
        });
      }
    });
  };

  // Filtered subjects for the overview modal
  const termOfferingsForSelectedTerm = useMemo(() => {
    if (!selectedTermForOverview) return [];
    return offerings.filter((o) => o.term_id === selectedTermForOverview.id);
  }, [offerings, selectedTermForOverview]);

  const overviewSubjectList = useMemo(() => {
    const q = overviewSearch.toLowerCase().trim();

    return subjects.filter((s) => {
      const cat = getSubjectCategory(s);
      const isHS = cat === 'high_school';

      if (overviewDept === 'BSIT' && isHS) return false;
      if (overviewDept === 'HS' && !isHS) return false;

      if (q) {
        const matchesCode = s.code.toLowerCase().includes(q);
        const matchesTitle = s.title.toLowerCase().includes(q);
        if (!matchesCode && !matchesTitle) return false;
      }

      return true;
    });
  }, [subjects, overviewDept, overviewSearch]);

  const columns: Column<AcademicTerm>[] = [
    {
      header: 'School Year',
      accessorKey: 'school_year',
      render: (t) => <span className="fw-bold text-dark">{t.school_year}</span>,
    },
    {
      header: 'Semester',
      accessorKey: 'semester',
      render: (t) => <span className="text-secondary small">{t.semester}</span>,
    },
    {
      header: 'Status',
      accessorKey: 'is_current',
      render: (t) =>
        t.is_current ? (
          <span className="pill-status pill-status-progress">
            Current Term
          </span>
        ) : (
          <span className="pill-status pill-status-archived">
            Archived
          </span>
        ),
    },
    {
      header: 'Created On',
      accessorKey: 'created_at',
      render: (t) => (
        <span className="small text-muted font-monospace">
          {new Date(t.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];

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

      {/* Top Action Bar with "View Subjects and Departments" Button */}
      <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3 mb-2">
        <div className="d-flex align-items-center gap-2">
          {currentTerm && (
            <span className="pill-status pill-status-progress">
              Active: {currentTerm.school_year} &bull; {currentTerm.semester}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSelectedTermForOverview(currentTerm || terms[0])}
          className="btn-ref-primary d-inline-flex align-items-center gap-2"
        >
          <i className="bi bi-journal-bookmark-fill" />
          <span>View Term Subjects &amp; Departments</span>
        </button>
      </div>

      <DataTable
        title="Academic Terms"
        description="Configure academic years and active semesters. Only one term may be active concurrently."
        data={terms}
        columns={columns}
        keyExtractor={(t) => t.id}
        searchPlaceholder="Filter school year or semester..."
        searchFilter={(t, q) =>
          t.school_year.toLowerCase().includes(q) || t.semester.toLowerCase().includes(q)
        }
        onAdd={handleOpenAdd}
        addLabel="Add Term"
        actions={(t) => (
          <div className="d-inline-flex align-items-center gap-1.5">
            <button
              onClick={() => setSelectedTermForOverview(t)}
              className="btn btn-sm btn-light border rounded-pill px-2.5 py-0.5 text-primary fw-semibold d-inline-flex align-items-center gap-1"
              style={{ fontSize: '0.74rem' }}
              title="View all subjects and departments for this semester"
            >
              <i className="bi bi-journal-bookmark-fill" />
              <span>Subjects &amp; Depts</span>
            </button>

            {!t.is_current && (
              <button
                onClick={() => handleSetCurrent(t)}
                disabled={isPending}
                className="btn btn-sm btn-outline-success rounded-pill px-2.5 py-0.5"
                style={{ fontSize: '0.74rem' }}
                title="Designate as active term"
              >
                Set Current
              </button>
            )}

            <button
              onClick={() => handleOpenEdit(t)}
              disabled={isPending}
              className="btn btn-sm btn-outline-secondary rounded-pill px-2.5 py-0.5"
              style={{ fontSize: '0.74rem' }}
            >
              Edit
            </button>

            {!t.is_current && (
              <button
                onClick={() => handleDelete(t)}
                disabled={isPending}
                className="btn btn-sm btn-outline-danger rounded-pill px-2.5 py-0.5"
                style={{ fontSize: '0.74rem' }}
              >
                Delete
              </button>
            )}
          </div>
        )}
      />

      {/* Pop-up Page: All Subjects & Departments for Selected Semester */}
      {selectedTermForOverview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="fixed inset-0"
            onClick={() => setSelectedTermForOverview(null)}
          />

          <div
            className="relative w-full max-w-5xl bg-white rounded-5 shadow-2xl p-4 p-md-5 z-10 max-h-[92vh] overflow-y-auto border border-light-subtle"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="d-flex align-items-start justify-content-between pb-3 border-bottom mb-4">
              <div>
                <div className="d-flex align-items-center gap-2 mb-1">
                  <span className="pill-status pill-status-progress">
                    Academic Term Curriculum
                  </span>
                  <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1">
                    {selectedTermForOverview.school_year} &bull; {selectedTermForOverview.semester}
                  </span>
                  {selectedTermForOverview.is_current && (
                    <span className="badge bg-success text-white px-2 py-0.5 rounded-pill" style={{ fontSize: '11px' }}>
                      Current Term
                    </span>
                  )}
                </div>
                <h3 className="fs-5 fw-bold text-dark m-0">
                  Semester Subjects &amp; Academic Departments
                </h3>
                <p className="small text-secondary m-0 mt-0.5">
                  Complete directory of active departments and course subjects offered for this academic term.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedTermForOverview(null)}
                className="btn btn-sm btn-light rounded-circle p-2 text-muted hover:text-dark"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Department Summary Cards */}
            <div className="row g-3 mb-4">
              <div className="col-12 col-md-6">
                <div className="p-3.5 bg-light rounded-4 border border-light-subtle">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <span className="badge bg-primary-subtle text-primary px-2.5 py-1 rounded-pill fw-bold text-uppercase">
                      BSIT Department
                    </span>
                    <span className="pill-status pill-status-review">Higher Education</span>
                  </div>
                  <div className="fw-bold text-dark fs-6 mb-1">
                    Bachelor of Science in Information Technology
                  </div>
                  <p className="text-secondary small mb-2" style={{ fontSize: '0.8rem' }}>
                    4-Year collegiate computing program with software development, networking, databases, and capstone sequences.
                  </p>
                  <div className="d-flex align-items-center gap-3 small text-muted font-monospace" style={{ fontSize: '0.75rem' }}>
                    <span>&bull; Years 1 to 4</span>
                    <span>&bull; Core &amp; GE Minor Subjects</span>
                  </div>
                </div>
              </div>

              <div className="col-12 col-md-6">
                <div className="p-3.5 bg-light rounded-4 border border-light-subtle">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <span className="badge bg-warning-subtle text-warning-emphasis px-2.5 py-1 rounded-pill fw-bold text-uppercase">
                      High School Department
                    </span>
                    <span className="pill-status pill-status-review">Secondary Unit</span>
                  </div>
                  <div className="fw-bold text-dark fs-6 mb-1">
                    Junior &amp; Senior High School Curriculum
                  </div>
                  <p className="text-secondary small mb-2" style={{ fontSize: '0.8rem' }}>
                    Basic secondary education tracks covering JHS Grades 7–10 and SHS academic strands (STEM, TVL Computer Systems).
                  </p>
                  <div className="d-flex align-items-center gap-3 small text-muted font-monospace" style={{ fontSize: '0.75rem' }}>
                    <span>&bull; Grades 7–12</span>
                    <span>&bull; Science, ICT &amp; TVL NC II</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 mb-3">
              {/* Department Tabs */}
              <div className="d-flex flex-wrap align-items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOverviewDept('all')}
                  className={`btn btn-sm rounded-pill px-3 py-1.5 fw-semibold ${
                    overviewDept === 'all'
                      ? 'btn-ref-primary text-white'
                      : 'btn-outline-secondary'
                  }`}
                >
                  All Departments ({subjects.length})
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewDept('BSIT')}
                  className={`btn btn-sm rounded-pill px-3 py-1.5 fw-semibold ${
                    overviewDept === 'BSIT'
                      ? 'btn-ref-primary text-white'
                      : 'btn-outline-secondary'
                  }`}
                >
                  BSIT Department
                </button>
                <button
                  type="button"
                  onClick={() => setOverviewDept('HS')}
                  className={`btn btn-sm rounded-pill px-3 py-1.5 fw-semibold ${
                    overviewDept === 'HS'
                      ? 'btn-ref-primary text-white'
                      : 'btn-outline-secondary'
                  }`}
                >
                  High School Department
                </button>
              </div>

              {/* Search box */}
              <div className="search-capsule-wrap w-100 w-md-auto" style={{ minWidth: '220px' }}>
                <i className="bi bi-search search-capsule-icon" />
                <input
                  type="text"
                  placeholder="Filter subjects in semester..."
                  value={overviewSearch}
                  onChange={(e) => setOverviewSearch(e.target.value)}
                  className="search-capsule-input w-100"
                />
              </div>
            </div>

            {/* Subjects Table */}
            <div className="table-responsive rounded-4 border border-light-subtle overflow-hidden">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light text-uppercase text-secondary small" style={{ fontSize: '0.72rem' }}>
                  <tr>
                    <th scope="col" className="py-2.5 px-3">Course Code</th>
                    <th scope="col" className="py-2.5 px-3">Subject Title</th>
                    <th scope="col" className="py-2.5 px-3">Year / Grade</th>
                    <th scope="col" className="py-2.5 px-3">Department / Track</th>
                    <th scope="col" className="py-2.5 px-3">Units</th>
                    <th scope="col" className="py-2.5 px-3">Weekly Hours</th>
                    <th scope="col" className="py-2.5 px-3">Facility</th>
                  </tr>
                </thead>
                <tbody className="small">
                  {overviewSubjectList.map((s) => {
                    const cat = getSubjectCategory(s);
                    const yr = getSubjectYearLevel(s);
                    const isOfferedInTerm = termOfferingsForSelectedTerm.some((o) => o.subject_id === s.id);

                    return (
                      <tr key={s.id}>
                        <td className="py-2.5 px-3">
                          <span className="fw-bold text-dark font-monospace">{s.code}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="fw-semibold text-dark">{s.title}</div>
                          {isOfferedInTerm && (
                            <span className="badge bg-success-subtle text-success border border-success-subtle mt-0.5" style={{ fontSize: '0.68rem' }}>
                              Enrolled in Term Offerings
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="badge bg-light text-dark border px-2 py-0.5 rounded-pill font-monospace" style={{ fontSize: '0.72rem' }}>
                            {yr}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {cat === 'bsit_major' ? (
                            <span className="pill-status pill-status-progress">BSIT Major</span>
                          ) : cat === 'high_school' ? (
                            <span className="pill-status pill-status-review">High School</span>
                          ) : (
                            <span className="pill-status pill-status-archived">Minor</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-monospace text-muted">
                          {s.units} cr
                        </td>
                        <td className="py-2.5 px-3 font-monospace text-muted">
                          {s.lecture_hours}h Lec / {s.lab_hours}h Lab
                        </td>
                        <td className="py-2.5 px-3">
                          {s.requires_lab ? (
                            <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-0.5 rounded-pill" style={{ fontSize: '0.72rem' }}>
                              Lab Room
                            </span>
                          ) : (
                            <span className="small text-muted">Lecture Room</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {overviewSubjectList.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-5 text-secondary">
                        No subjects match your filter for this semester.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="d-flex align-items-center justify-content-between pt-4 mt-4 border-top">
              <span className="small text-muted">
                Showing <strong>{overviewSubjectList.length}</strong> subjects for {selectedTermForOverview.school_year} ({selectedTermForOverview.semester})
              </span>

              <button
                type="button"
                onClick={() => setSelectedTermForOverview(null)}
                className="btn-ref-secondary"
              >
                Close Curriculum Overview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Term Form Modal */}
      <FormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTerm ? 'Edit Academic Term' : 'Create Academic Term'}
        description="Specify the academic school year and semester identification."
        onSubmit={handleSubmit}
        isSubmitting={isPending}
        error={modalError}
        submitLabel={editingTerm ? 'Save Changes' : 'Create Term'}
      >
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            School Year (e.g. 2026-2027)
          </label>
          <input
            type="text"
            required
            placeholder="2026-2027"
            pattern="^\d{4}-\d{4}$"
            value={formData.school_year}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, school_year: e.target.value }))
            }
            className="form-control ref-form-control"
          />
        </div>

        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Semester
          </label>
          <select
            value={formData.semester}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, semester: e.target.value }))
            }
            className="form-select ref-form-control"
          >
            <option value="1st Semester">1st Semester</option>
            <option value="2nd Semester">2nd Semester</option>
            <option value="Summer">Summer Term</option>
          </select>
        </div>

        {!editingTerm?.is_current && (
          <div className="pt-2">
            <div className="form-check">
              <input
                type="checkbox"
                id="is_current"
                checked={formData.is_current}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, is_current: e.target.checked }))
                }
                className="form-check-input"
              />
              <label htmlFor="is_current" className="form-check-label small text-secondary">
                Set as active current term immediately upon creation
              </label>
            </div>
          </div>
        )}
      </FormModal>
    </div>
  );
}
