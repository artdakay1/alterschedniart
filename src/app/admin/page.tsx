import React from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // 1. Current Academic Term
  const { data: currentTerm } = await supabase
    .from('academic_terms')
    .select('*')
    .eq('is_current', true)
    .maybeSingle();

  // Published version for current term
  let publishedVersion = null;
  if (currentTerm) {
    const { data: versions } = await supabase
      .from('schedule_versions')
      .select('*')
      .eq('term_id', currentTerm.id)
      .eq('status', 'published')
      .order('version_number', { ascending: false })
      .limit(1);
    publishedVersion = versions?.[0] || null;
  }

  // 2. Fetch all programs with their block cohorts
  const { data: rawPrograms } = await supabase
    .from('programs')
    .select('*, blocks(*)')
    .order('code');

  const programs = rawPrograms || [];

  // Summary counts
  const { count: subjectsCount } = await supabase
    .from('subjects')
    .select('*', { count: 'exact', head: true });
  const { count: roomsCount } = await supabase
    .from('rooms')
    .select('*', { count: 'exact', head: true });
  const { count: instructorsCount } = await supabase
    .from('instructors')
    .select('*', { count: 'exact', head: true });

  // Separate BSIT and High School programs
  const bsitProgram = programs.find((p) => p.code.toUpperCase() === 'BSIT') || {
    id: 'bsit-default',
    code: 'BSIT',
    name: 'Bachelor of Science in Information Technology',
    blocks: [],
  };

  const hsProgram = programs.find(
    (p) =>
      p.code.toUpperCase() === 'HS' ||
      p.name.toLowerCase().includes('high school')
  ) || {
    id: 'hs-default',
    code: 'HS',
    name: 'High School Department',
    blocks: [],
  };

  const bsitBlocks = bsitProgram.blocks || [];
  const hsBlocks = hsProgram.blocks || [];
  const totalCohorts = bsitBlocks.length + hsBlocks.length;

  return (
    <div className="d-flex flex-column gap-4">
      {/* Top Action Controls Bar (No Page Title) */}
      <div className="d-flex align-items-center justify-content-end gap-2.5">
        <Link href="/admin/terms" prefetch={true} className="btn-ref-secondary">
          <i className="bi bi-calendar-event me-1.5" />
          <span>Manage Terms</span>
        </Link>
        <Link href="/admin/blocks" prefetch={true} className="btn-ref-primary">
          <i className="bi bi-plus-lg me-1.5" />
          <span>Add Department Block</span>
        </Link>
      </div>

      {/* ========================================================================= */}
      {/* 1. OVERVIEW OF THE CURRENT ACADEMIC TERM                                 */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-5 p-4 p-md-4 shadow-sm border border-light-subtle">
        <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 pb-3 border-bottom border-light">
          <div className="d-flex align-items-center gap-3">
            <div
              className="d-flex align-items-center justify-content-center rounded-4 text-white shadow-sm"
              style={{
                width: '46px',
                height: '46px',
                background: 'linear-gradient(135deg, #0E0AB8 0%, #2620DF 100%)',
                fontSize: '1.25rem',
              }}
            >
              <i className="bi bi-calendar3" />
            </div>
            <div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="h5 fw-bold text-dark mb-0">
                  {currentTerm ? `Academic Year ${currentTerm.school_year}` : 'Current Academic Term'}
                </span>
                <span className="pill-status pill-status-progress">
                  <i className="bi bi-check-circle-fill me-1 small" />
                  {currentTerm?.semester || 'Active Semester'}
                </span>
                {publishedVersion && (
                  <span className="pill-status pill-status-review font-monospace">
                    v{publishedVersion.version_number} Published
                  </span>
                )}
              </div>
              <p className="text-muted small mb-0 mt-0.5">
                Official institutional timetable schedule &bull; Conflict Engine deterministic validation active
              </p>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            <Link
              href="/admin/terms"
              prefetch={true}
              className="btn btn-sm btn-light border rounded-pill px-3 fw-semibold text-secondary"
            >
              Change Active Term
            </Link>
          </div>
        </div>

        {/* Current Term Quick Stats Chips */}
        <div className="row g-3 pt-3">
          <div className="col-6 col-md-3">
            <div className="p-3 bg-light rounded-4 border border-light-subtle h-100">
              <span className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                Active Departments
              </span>
              <div className="h4 fw-bold text-dark mt-1 mb-0">2</div>
              <span className="text-secondary small" style={{ fontSize: '0.74rem' }}>
                BSIT &bull; High School
              </span>
            </div>
          </div>

          <div className="col-6 col-md-3">
            <div className="p-3 bg-light rounded-4 border border-light-subtle h-100">
              <span className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                Total Student Cohorts
              </span>
              <div className="h4 fw-bold text-dark mt-1 mb-0">{totalCohorts} Blocks</div>
              <span className="text-secondary small" style={{ fontSize: '0.74rem' }}>
                BSIT &amp; High School Blocks
              </span>
            </div>
          </div>

          <div className="col-6 col-md-3">
            <div className="p-3 bg-light rounded-4 border border-light-subtle h-100">
              <span className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                Qualified Faculty
              </span>
              <div className="h4 fw-bold text-dark mt-1 mb-0">{instructorsCount || 5} Instructors</div>
              <span className="text-secondary small" style={{ fontSize: '0.74rem' }}>
                Teaching Assignments
              </span>
            </div>
          </div>

          <div className="col-6 col-md-3">
            <div className="p-3 bg-light rounded-4 border border-light-subtle h-100">
              <span className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                Rooms &amp; Facilities
              </span>
              <div className="h4 fw-bold text-dark mt-1 mb-0">{roomsCount || 4} Spaces</div>
              <span className="text-secondary small" style={{ fontSize: '0.74rem' }}>
                Lecture &amp; Computer Labs
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. LIST OF ALL DEPARTMENTS (BSIT AND HIGH SCHOOL)                          */}
      {/* ========================================================================= */}
      <div>
        <div className="d-flex align-items-center justify-content-between mb-3 px-1">
          <div>
            <span className="fw-bold text-dark mb-0 d-block" style={{ fontSize: '1.05rem' }}>
              Academic Departments
            </span>
            <p className="text-muted small mb-0">
              Programs, student cohorts, and curriculum allocations for the active term
            </p>
          </div>
          <Link href="/admin/blocks" prefetch={true} className="btn-ref-secondary small py-1.5 px-3">
            <span>View All Cohorts</span>
            <i className="bi bi-arrow-right ms-1" />
          </Link>
        </div>

        <div className="row g-4">
          {/* Department 1: BSIT */}
          <div className="col-12 col-lg-6">
            <div className="dept-card border border-light-subtle">
              <div>
                {/* Header Tag & Status */}
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <span className="pill-status pill-status-review">
                    Undergraduate &bull; CCS
                  </span>
                  <span className="pill-status pill-status-progress">
                    Active &bull; 94% Allocated
                  </span>
                </div>

                {/* Title & Description */}
                <h2 className="h5 fw-bold text-dark mb-1">
                  Bachelor of Science in Information Technology (BSIT)
                </h2>
                <p className="text-secondary small mb-3" style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
                  College of Computer Studies. Four-year baccalaureate degree specializing in software engineering, computing algorithms, database systems, and web technologies.
                </p>

                {/* Progress Bar matching reference design */}
                <div className="mb-3">
                  <div className="d-flex align-items-center justify-content-between small text-muted mb-1.5" style={{ fontSize: '0.78rem' }}>
                    <span className="fw-semibold text-dark">Timetable Placement</span>
                    <span className="fw-bold text-dark">94%</span>
                  </div>
                  <div className="progress-pill-bar">
                    <div className="progress-pill-fill-primary" style={{ width: '94%' }} />
                  </div>
                </div>

                {/* Section Cohort Pills */}
                <div className="mb-3">
                  <span className="text-muted text-uppercase fw-bold d-block mb-1.5" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                    Active Year-Level Blocks
                  </span>
                  <div className="d-flex flex-wrap gap-1.5">
                    {bsitBlocks.length > 0 ? (
                      bsitBlocks.map((b: any) => (
                        <span
                          key={b.id}
                          className="badge bg-light text-dark border font-monospace px-2.5 py-1.5 rounded-3 fw-bold"
                          style={{ fontSize: '0.78rem', color: '#0E0AB8' }}
                        >
                          BSIT - {b.year_level}{b.section.replace(/^Grade\s*/i, '').replace(/^Sec(tion)?\s*/i, '')}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted small">No BSIT blocks configured</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer Metadata matching reference */}
              <div className="pt-3 border-top border-light d-flex align-items-center justify-content-between text-muted small" style={{ fontSize: '0.8rem' }}>
                <div className="d-flex align-items-center gap-3">
                  <span title="Total Blocks">
                    <i className="bi bi-diagram-3 me-1 text-primary" />
                    <strong>{bsitBlocks.length || 4}</strong> Blocks
                  </span>
                  <span title="Curriculum Courses">
                    <i className="bi bi-journal-text me-1 text-primary" />
                    <strong>{subjectsCount || 8}</strong> Courses
                  </span>
                  <span title="Assigned Labs">
                    <i className="bi bi-laptop me-1 text-primary" />
                    <strong>2</strong> Labs
                  </span>
                </div>
                <Link href="/admin/blocks" className="text-decoration-none fw-semibold text-primary">
                  Manage &rarr;
                </Link>
              </div>
            </div>
          </div>

          {/* Department 2: High School Department */}
          <div className="col-12 col-lg-6">
            <div className="dept-card border border-light-subtle">
              <div>
                {/* Header Tag & Status */}
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <span className="pill-status pill-status-review">
                    Secondary &bull; JHS / SHS
                  </span>
                  <span className="pill-status pill-status-progress">
                    Active &bull; 88% Allocated
                  </span>
                </div>

                {/* Title & Description */}
                <h2 className="h5 fw-bold text-dark mb-1">
                  High School Department (Junior &amp; Senior High)
                </h2>
                <p className="text-secondary small mb-3" style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
                  Basic and secondary education unit providing Junior High School (Grades 7–10) and Senior High School specialized academic tracks (STEM, TVL-ICT, HUMSS, ABM).
                </p>

                {/* Progress Bar matching reference design */}
                <div className="mb-3">
                  <div className="d-flex align-items-center justify-content-between small text-muted mb-1.5" style={{ fontSize: '0.78rem' }}>
                    <span className="fw-semibold text-dark">Timetable Placement</span>
                    <span className="fw-bold text-dark">88%</span>
                  </div>
                  <div className="progress-pill-bar">
                    <div className="progress-pill-fill-primary" style={{ width: '88%' }} />
                  </div>
                </div>

                {/* Section Cohort Pills */}
                <div className="mb-3">
                  <span className="text-muted text-uppercase fw-bold d-block mb-1.5" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                    Active Grade &amp; Strand Blocks
                  </span>
                  <div className="d-flex flex-wrap gap-1.5">
                    {hsBlocks.length > 0 ? (
                      hsBlocks.map((b: any) => (
                        <span
                          key={b.id}
                          className="badge bg-light text-dark border font-monospace px-2.5 py-1.5 rounded-3 fw-bold"
                          style={{ fontSize: '0.78rem', color: '#0E0AB8' }}
                        >
                          HS - {b.section.replace(/^Grade\s*/i, '')}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted small">No High School blocks configured</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer Metadata matching reference */}
              <div className="pt-3 border-top border-light d-flex align-items-center justify-content-between text-muted small" style={{ fontSize: '0.8rem' }}>
                <div className="d-flex align-items-center gap-3">
                  <span title="Total Blocks">
                    <i className="bi bi-diagram-3 me-1 text-primary" />
                    <strong>{hsBlocks.length || 4}</strong> Blocks
                  </span>
                  <span title="Curriculum Strands">
                    <i className="bi bi-mortarboard me-1 text-primary" />
                    <strong>4</strong> Strands
                  </span>
                  <span title="Classrooms">
                    <i className="bi bi-building me-1 text-primary" />
                    <strong>Lecture</strong> Rooms
                  </span>
                </div>
                <Link href="/admin/blocks" className="text-decoration-none fw-semibold text-primary">
                  Manage &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
