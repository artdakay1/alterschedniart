import React from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function SchedulerDashboardPage() {
  const supabase = await createClient();

  // 1. Current Academic Term
  const { data: currentTerm } = await supabase
    .from('academic_terms')
    .select('*')
    .eq('is_current', true)
    .maybeSingle();

  // Published or Draft version for current term
  let publishedVersion = null;
  let draftVersion = null;
  if (currentTerm) {
    const { data: versions } = await supabase
      .from('schedule_versions')
      .select('*')
      .eq('term_id', currentTerm.id)
      .order('version_number', { ascending: false });

    publishedVersion = versions?.find((v) => v.status === 'published') || null;
    draftVersion = versions?.find((v) => v.status === 'draft') || null;
  }

  // 2. Fetch all programs with block cohorts
  const { data: rawPrograms } = await supabase
    .from('programs')
    .select('*, blocks(*)')
    .order('code');

  const programs = rawPrograms || [];

  // Summary counts
  const { count: roomsCount } = await supabase
    .from('rooms')
    .select('*', { count: 'exact', head: true });
  const { count: instructorsCount } = await supabase
    .from('instructors')
    .select('*', { count: 'exact', head: true });
  const { count: entriesCount } = await supabase
    .from('schedule_entries')
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
  const totalCohorts = (bsitBlocks.length || 4) + (hsBlocks.length || 4);

  return (
    <div className="d-flex flex-column gap-4">
      {/* Top Action Controls Bar (No Page Title) */}
      <div className="d-flex align-items-center justify-content-end gap-2.5">
        <Link href="/scheduler/generate" prefetch={true} className="btn-ref-secondary">
          <i className="bi bi-cpu me-1.5 text-primary" />
          <span>Schedule Generator</span>
        </Link>
        <Link href="/scheduler/schedule" prefetch={true} className="btn-ref-primary">
          <i className="bi bi-calendar-plus me-1.5" />
          <span>Open Schedule Editor</span>
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
              <i className="bi bi-calendar-check" />
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
                {publishedVersion ? (
                  <span className="pill-status pill-status-review font-monospace">
                    v{publishedVersion.version_number} Published
                  </span>
                ) : draftVersion ? (
                  <span className="pill-status pill-status-pending font-monospace">
                    v{draftVersion.version_number} Draft In Progress
                  </span>
                ) : null}
              </div>
              <p className="text-muted small mb-0 mt-0.5">
                Deterministic conflict validator active &bull; Automated constraint checking on every class slot
              </p>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            <Link
              href="/scheduler/schedule"
              prefetch={true}
              className="btn btn-sm btn-light border rounded-pill px-3 fw-semibold text-secondary"
            >
              Edit Grid Slots
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
                Academic Cohorts
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
                Assigned Faculty
              </span>
              <div className="h4 fw-bold text-dark mt-1 mb-0">{instructorsCount || 5} Instructors</div>
              <span className="text-secondary small" style={{ fontSize: '0.74rem' }}>
                Teaching Weekly Slots
              </span>
            </div>
          </div>

          <div className="col-6 col-md-3">
            <div className="p-3 bg-light rounded-4 border border-light-subtle h-100">
              <span className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                Scheduled Entries
              </span>
              <div className="h4 fw-bold text-dark mt-1 mb-0">{entriesCount || 0} Classes</div>
              <span className="text-secondary small" style={{ fontSize: '0.74rem' }}>
                Across {roomsCount || 4} Rooms
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
              Departmental cohorts, curriculum allocations, and scheduling status
            </p>
          </div>
          <Link href="/scheduler/schedule" prefetch={true} className="btn-ref-secondary small py-1.5 px-3">
            <span>Open Timetable</span>
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
                      bsitBlocks.map((b: any) => {
                        const sec = (b.section || '').trim();
                        const yearStr = String(b.year_level || '');
                        const label = sec.startsWith(yearStr) || /^Grade/i.test(sec) ? sec : `${yearStr}${sec}`;
                        return (
                          <span
                            key={b.id}
                            className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3"
                            style={{ fontSize: '0.75rem' }}
                          >
                            BSIT - {label}
                          </span>
                        );
                      })
                    ) : (
                      <>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          BSIT - 1A
                        </span>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          BSIT - 1B
                        </span>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          BSIT - 2A
                        </span>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          BSIT - 2B
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer Metadata */}
              <div className="pt-3 border-top border-light d-flex align-items-center justify-content-between text-muted small" style={{ fontSize: '0.8rem' }}>
                <div className="d-flex align-items-center gap-3">
                  <span title="Total Blocks">
                    <i className="bi bi-diagram-3 me-1 text-primary" />
                    <strong>{bsitBlocks.length || 4}</strong> Blocks
                  </span>
                  <span title="Computer Labs Assigned">
                    <i className="bi bi-laptop me-1 text-primary" />
                    <strong>2</strong> Labs
                  </span>
                </div>
                <Link href="/scheduler/schedule" className="text-decoration-none fw-semibold text-primary">
                  Edit Block &rarr;
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

                {/* Block Cohort Pills */}
                <div className="mb-3">
                  <span className="text-muted text-uppercase fw-bold d-block mb-1.5" style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                    Active Grade &amp; Strand Blocks
                  </span>
                  <div className="d-flex flex-wrap gap-1.5">
                    {hsBlocks.length > 0 ? (
                      hsBlocks.map((b: any) => {
                        const sec = (b.section || '').trim();
                        const label = sec.toLowerCase().startsWith('grade') ? sec : `Grade ${b.year_level} - ${sec}`;
                        return (
                          <span
                            key={b.id}
                            className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3"
                            style={{ fontSize: '0.75rem' }}
                          >
                            HS - {label}
                          </span>
                        );
                      })
                    ) : (
                      <>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          HS - Grade 7-Diamond
                        </span>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          HS - Grade 8-Emerald
                        </span>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          HS - Grade 11-STEM A
                        </span>
                        <span className="badge bg-light text-secondary border font-monospace px-2.5 py-1.5 rounded-3">
                          HS - Grade 12-TVL A
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Card Footer Metadata */}
              <div className="pt-3 border-top border-light d-flex align-items-center justify-content-between text-muted small" style={{ fontSize: '0.8rem' }}>
                <div className="d-flex align-items-center gap-3">
                  <span title="Total Blocks">
                    <i className="bi bi-diagram-3 me-1 text-primary" />
                    <strong>{hsBlocks.length || 4}</strong> Blocks
                  </span>
                  <span title="Classrooms Assigned">
                    <i className="bi bi-building me-1 text-primary" />
                    <strong>Lecture</strong> Rooms
                  </span>
                </div>
                <Link href="/scheduler/schedule" className="text-decoration-none fw-semibold text-primary">
                  Edit Block &rarr;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
