// src/app/scheduler/schedules/MasterSchedulesClient.tsx
'use client';

import React, { useState, useMemo } from 'react';
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
} from '@/lib/conflict-engine';
import { SpreadsheetScheduleView } from '../schedule/SpreadsheetScheduleView';
import {
  unpublishScheduleVersionAction,
  deleteScheduleVersionAction,
  deleteArchivedVersionAction,
  getScheduleVersionNamesAction,
} from '../schedule/actions';

interface MasterSchedulesClientProps {
  terms: AcademicTerm[];
  currentTermId: string;
  versions: ScheduleVersion[];
  selectedVersionId: string;
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
  fixedConstraints: FixedConstraint[];
}

export function MasterSchedulesClient({
  terms,
  currentTermId,
  versions,
  selectedVersionId,
  entries,
  offerings,
  rooms,
  instructors,
  subjects,
  blocks,
  fixedConstraints,
}: MasterSchedulesClientProps) {
  const router = useRouter();

  // Find active version
  const activeVersion =
    versions.find((v) => v.id === selectedVersionId) ||
    versions.find((v) => v.status === 'published') ||
    versions.find((v) => v.status === 'draft') ||
    versions[0];

  // Active status tab: 'published' | 'draft' | 'archived'
  const [activeTab, setActiveTab] = useState<'published' | 'draft' | 'archived'>(
    activeVersion?.status || 'published'
  );

  // Filter versions by status
  const publishedVersions = useMemo(() => versions.filter((v) => v.status === 'published'), [versions]);
  const draftVersions = useMemo(() => versions.filter((v) => v.status === 'draft'), [versions]);
  const archivedVersions = useMemo(
    () => versions.filter((v) => v.status === 'archived').sort((a, b) => b.version_number - a.version_number),
    [versions]
  );

  // Version Names map
  const [versionNames, setVersionNames] = useState<Record<string, string>>({});

  React.useEffect(() => {
    try {
      const cached = localStorage.getItem('altersched_version_names');
      if (cached) {
        setVersionNames(JSON.parse(cached));
      }
    } catch {}

    const vIds = versions.map((v) => v.id);
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
  }, [versions]);

  // Notice banner state
  const [bannerNotice, setBannerNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Archive deletion state
  const [targetArchiveToDelete, setTargetArchiveToDelete] = useState<ScheduleVersion | null>(null);
  const [isDeletingArchive, setIsDeletingArchive] = useState(false);

  // Schedule unpublish state
  const [targetVersionToUnpublish, setTargetVersionToUnpublish] = useState<ScheduleVersion | null>(null);
  const [isUnpublishing, setIsUnpublishing] = useState(false);

  // Generalized schedule version deletion state (published, draft, archived)
  const [targetVersionToDelete, setTargetVersionToDelete] = useState<ScheduleVersion | null>(null);
  const [isDeletingVersion, setIsDeletingVersion] = useState(false);

  // Conflict Engine Context
  const engineContext: ScheduleContext = useMemo(() => {
    return {
      rooms: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        roomType: r.room_type,
        capacity: r.capacity,
        isShared: r.is_shared,
      })),
      subjects: subjects.map((s) => ({
        id: s.id,
        code: s.code,
        title: s.title,
        units: s.units,
        requiresLab: s.requires_lab,
        lectureHours: s.lecture_hours,
        labHours: s.lab_hours,
        facilityType:
          (s as any).facility_type ||
          (s as any).facilityType ||
          (s.code.toUpperCase().includes('PE') ||
          s.code.toUpperCase().includes('PATHFIT') ||
          s.code.toUpperCase().includes('NSTP') ||
          s.code.toUpperCase().includes('ROTC') ||
          s.code.toUpperCase().includes('CWTS')
            ? 'unspecified'
            : undefined),
      })),
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
        name: b.programs ? `${b.programs.code} ${b.year_level}-${b.section}` : `Block ${b.id}`,
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

  // Convert entries to engine format
  const engineEntries: ScheduleEntryInput[] = useMemo(() => {
    return entries.map((e) => {
      const off = offerings.find((o) => o.id === e.offering_id);
      return {
        id: e.id,
        offeringId: e.offering_id,
        blockId: off?.block_id || '',
        subjectId: off?.subject_id || '',
        instructorId: e.instructor_id,
        roomId: e.room_id,
        dayOfWeek: e.day_of_week,
        startTime: e.start_time.slice(0, 5),
        endTime: e.end_time.slice(0, 5),
        sessionType: e.session_type,
      };
    });
  }, [entries, offerings]);

  // Run conflict engine violations
  const violations: Violation[] = useMemo(() => {
    return checkSchedule(engineEntries, engineContext);
  }, [engineEntries, engineContext]);

  const hardViolations = useMemo(() => violations.filter((v) => v.severity === 'hard'), [violations]);
  const softViolations = useMemo(() => violations.filter((v) => v.severity === 'soft'), [violations]);

  // Curriculum Completeness Analysis
  const completenessReport = useMemo(() => {
    const scheduledOfferingIds = new Set(entries.map((e) => e.offering_id));

    interface BlockCompleteness {
      block: (typeof blocks)[0];
      requiredOfferings: typeof offerings;
      scheduledOfferings: typeof offerings;
      unscheduledOfferings: typeof offerings;
      isComplete: boolean;
    }

    const blockReports: BlockCompleteness[] = [];
    let totalRequiredCount = 0;
    let totalScheduledCount = 0;
    let totalUnscheduledCount = 0;

    for (const b of blocks) {
      const bOfferings = offerings.filter((o) => o.block_id === b.id);
      if (bOfferings.length === 0) continue;

      const bScheduled = bOfferings.filter((o) => scheduledOfferingIds.has(o.id));
      const bUnscheduled = bOfferings.filter((o) => !scheduledOfferingIds.has(o.id));

      totalRequiredCount += bOfferings.length;
      totalScheduledCount += bScheduled.length;
      totalUnscheduledCount += bUnscheduled.length;

      blockReports.push({
        block: b,
        requiredOfferings: bOfferings,
        scheduledOfferings: bScheduled,
        unscheduledOfferings: bUnscheduled,
        isComplete: bUnscheduled.length === 0,
      });
    }

    const isFullyComplete = totalUnscheduledCount === 0 && totalRequiredCount > 0;
    const isFullyValidated = isFullyComplete && hardViolations.length === 0;

    return {
      blockReports,
      totalRequiredCount,
      totalScheduledCount,
      totalUnscheduledCount,
      isFullyComplete,
      isFullyValidated,
    };
  }, [entries, offerings, blocks, hardViolations]);

  // Delete archive handler
  const handleConfirmDeleteArchive = async () => {
    if (!targetArchiveToDelete) return;
    setIsDeletingArchive(true);
    try {
      const res = await deleteArchivedVersionAction(targetArchiveToDelete.id);
      if (res.success) {
        setBannerNotice({
          type: 'success',
          message: res.message,
        });
        setTargetArchiveToDelete(null);
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

  // Unpublish schedule handler
  const handleConfirmUnpublish = async () => {
    if (!targetVersionToUnpublish) return;
    setIsUnpublishing(true);
    try {
      const res = await unpublishScheduleVersionAction(targetVersionToUnpublish.id);
      if (res.success) {
        setBannerNotice({
          type: 'success',
          message: res.message,
        });
        setTargetVersionToUnpublish(null);
        router.refresh();
      }
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to unpublish schedule version.',
      });
    } finally {
      setIsUnpublishing(false);
    }
  };

  // Generalized delete version handler (published, draft, archived)
  const handleConfirmDeleteVersion = async () => {
    if (!targetVersionToDelete) return;
    setIsDeletingVersion(true);
    try {
      const res = await deleteScheduleVersionAction(targetVersionToDelete.id);
      if (res.success) {
        setBannerNotice({
          type: 'success',
          message: res.message,
        });
        setTargetVersionToDelete(null);
        router.refresh();
      }
    } catch (err: unknown) {
      setBannerNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete schedule version.',
      });
    } finally {
      setIsDeletingVersion(false);
    }
  };

  const currentTerm = terms.find((t) => t.id === currentTermId) || terms[0];

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

      {/* Top Header Card */}
      <div className="bg-white rounded-5 p-4 shadow-sm border border-light-subtle d-flex flex-column flex-lg-row align-items-start align-items-lg-center justify-content-between gap-4">
        <div>
          <div className="d-flex align-items-center gap-2 mb-1">
            <span
              className="d-inline-flex align-items-center justify-content-center text-white rounded-3 shadow-sm"
              style={{ width: '38px', height: '38px', backgroundColor: '#0E0AB8' }}
            >
              <i className="bi bi-table fs-5"></i>
            </span>
            <h4 className="fw-bold text-dark mb-0" style={{ letterSpacing: '-0.02em' }}>
              Master Schedule Programs
            </h4>
          </div>
          <p className="text-secondary small mb-0 ms-md-5 ps-md-1">
            Institutional spreadsheet timetables for published, saved drafts, and archived schedules.
          </p>
        </div>

        {/* Academic Term Switcher & Quick Navigation */}
        <div className="d-flex flex-wrap align-items-center gap-2.5">
          <div>
            <select
              value={currentTermId}
              onChange={(e) => {
                router.push(`/scheduler/schedules?termId=${e.target.value}`);
              }}
              className="form-select ref-form-control bg-white"
              style={{ minWidth: '220px' }}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.school_year} &bull; {t.semester} {t.is_current ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          <Link
            href={`/scheduler/schedule?termId=${currentTermId}`}
            className="btn-ref-primary small py-2 px-3 d-flex align-items-center gap-1.5"
          >
            <i className="bi bi-calendar-plus"></i>
            <span>Schedule Editor</span>
          </Link>
        </div>
      </div>

      {/* Status Category Tabs (Published vs Saved Drafts vs Archives) */}
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 border-bottom border-light pb-2">
        <ul className="nav nav-pills gap-2">
          {/* Tab 1: Published Live Schedules */}
          <li className="nav-item">
            <button
              onClick={() => {
                setActiveTab('published');
                const target = publishedVersions[0];
                if (target && target.id !== selectedVersionId) {
                  router.push(`/scheduler/schedules?termId=${currentTermId}&versionId=${target.id}`);
                }
              }}
              className={`nav-link rounded-4 py-2 px-3.5 fw-semibold d-flex align-items-center gap-2 ${
                activeTab === 'published'
                  ? 'active bg-success text-white shadow-sm'
                  : 'text-secondary bg-white border border-light-subtle'
              }`}
            >
              <i className="bi bi-broadcast"></i>
              <span>Official Live Published</span>
              <span className={`badge rounded-pill ${activeTab === 'published' ? 'bg-white text-success' : 'bg-light text-secondary'}`}>
                {publishedVersions.length}
              </span>
            </button>
          </li>

          {/* Tab 2: Saved Draft Schedules */}
          <li className="nav-item">
            <button
              onClick={() => {
                setActiveTab('draft');
                const target = draftVersions[0];
                if (target && target.id !== selectedVersionId) {
                  router.push(`/scheduler/schedules?termId=${currentTermId}&versionId=${target.id}`);
                }
              }}
              className={`nav-link rounded-4 py-2 px-3.5 fw-semibold d-flex align-items-center gap-2 ${
                activeTab === 'draft'
                  ? 'active bg-primary text-white shadow-sm'
                  : 'text-secondary bg-white border border-light-subtle'
              }`}
            >
              <i className="bi bi-journal-bookmark"></i>
              <span>Saved Draft Schedules</span>
              <span className={`badge rounded-pill ${activeTab === 'draft' ? 'bg-white text-primary' : 'bg-light text-secondary'}`}>
                {draftVersions.length}
              </span>
            </button>
          </li>

          {/* Tab 3: Archived Schedules */}
          <li className="nav-item">
            <button
              onClick={() => {
                setActiveTab('archived');
                const target = archivedVersions[0];
                if (target && target.id !== selectedVersionId) {
                  router.push(`/scheduler/schedules?termId=${currentTermId}&versionId=${target.id}`);
                }
              }}
              className={`nav-link rounded-4 py-2 px-3.5 fw-semibold d-flex align-items-center gap-2 ${
                activeTab === 'archived'
                  ? 'active bg-secondary text-white shadow-sm'
                  : 'text-secondary bg-white border border-light-subtle'
              }`}
            >
              <i className="bi bi-archive"></i>
              <span>Archived Schedules</span>
              <span className={`badge rounded-pill ${activeTab === 'archived' ? 'bg-white text-secondary' : 'bg-light text-secondary'}`}>
                {archivedVersions.length}
              </span>
            </button>
          </li>
        </ul>

        {/* Version Selector for Current Category */}
        <div className="d-flex align-items-center gap-2">
          <span className="small text-muted fw-semibold">Version:</span>
          <select
            value={activeVersion?.id || ''}
            onChange={(e) => {
              router.push(`/scheduler/schedules?termId=${currentTermId}&versionId=${e.target.value}`);
            }}
            className="form-select form-select-sm ref-form-control bg-white"
            style={{ minWidth: '170px' }}
          >
            {(activeTab === 'published'
              ? publishedVersions
              : activeTab === 'draft'
              ? draftVersions
              : archivedVersions
            ).map((v) => (
              <option key={v.id} value={v.id}>
                {versionNames[v.id] ? `${versionNames[v.id]} (v${v.version_number})` : `v${v.version_number}`} &bull; {v.status.toUpperCase()} ({new Date(v.updated_at).toLocaleDateString()})
              </option>
            ))}
            {activeTab === 'published' && publishedVersions.length === 0 && (
              <option disabled value="">No published schedule</option>
            )}
            {activeTab === 'draft' && draftVersions.length === 0 && (
              <option disabled value="">No active drafts</option>
            )}
            {activeTab === 'archived' && archivedVersions.length === 0 && (
              <option disabled value="">No archived schedules</option>
            )}
          </select>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ARCHIVE MANAGEMENT SECTION (When Viewing Archived Schedules)             */}
      {/* ========================================================================= */}
      {activeTab === 'archived' && (
        <div className="bg-white rounded-5 p-4 shadow-sm border border-light-subtle mb-4">
          <div className="d-flex align-items-center justify-content-between mb-3">
            <div>
              <h6 className="fw-bold text-dark text-uppercase small mb-1" style={{ letterSpacing: '0.05em' }}>
                <i className="bi bi-trash3 text-danger me-1.5"></i>
                Archived Schedules Management
              </h6>
              <p className="text-secondary small mb-0">
                Schedulers can review and permanently delete obsolete or superseded schedule archives.
              </p>
            </div>
            <span className="badge bg-secondary-subtle text-secondary py-1.5 px-3 rounded-pill">
              {archivedVersions.length} archived {archivedVersions.length === 1 ? 'version' : 'versions'}
            </span>
          </div>

          {archivedVersions.length === 0 ? (
            <div className="text-center py-4 text-muted small bg-light rounded-4">
              <i className="bi bi-archive fs-3 d-block mb-1 opacity-50"></i>
              No archived schedule versions for this academic term.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: '13px' }}>
                <thead className="table-light">
                  <tr>
                    <th style={{ width: '120px' }}>Version</th>
                    <th>Status</th>
                    <th>Archived Date</th>
                    <th>Target Academic Term</th>
                    <th className="text-end" style={{ width: '220px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedVersions.map((v) => {
                    const isSelected = v.id === activeVersion?.id;
                    return (
                      <tr key={v.id} className={isSelected ? 'table-primary-subtle' : ''}>
                        <td>
                          <span className="fw-bold text-dark">v{v.version_number}</span>
                          {isSelected && (
                            <span className="badge bg-primary ms-2" style={{ fontSize: '10px' }}>Viewing</span>
                          )}
                        </td>
                        <td>
                          <span className="pill-status pill-status-archived">ARCHIVED</span>
                        </td>
                        <td className="text-muted">
                          {new Date(v.updated_at).toLocaleString()}
                        </td>
                        <td className="text-muted">
                          {currentTerm?.school_year} &bull; {currentTerm?.semester}
                        </td>
                        <td className="text-end">
                          <div className="d-inline-flex align-items-center gap-2">
                            {!isSelected && (
                              <button
                                onClick={() => {
                                  router.push(`/scheduler/schedules?termId=${currentTermId}&versionId=${v.id}`);
                                }}
                                className="btn btn-sm btn-outline-primary py-1 px-2.5"
                                title="View this archive in spreadsheet"
                              >
                                <i className="bi bi-eye me-1"></i>
                                View
                              </button>
                            )}
                            <button
                              onClick={() => setTargetArchiveToDelete(v)}
                              className="btn btn-sm btn-outline-danger py-1 px-2.5 d-flex align-items-center gap-1"
                              title="Permanently delete this archived version"
                            >
                              <i className="bi bi-trash3"></i>
                              <span>Delete</span>
                            </button>
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
      )}

      {/* ========================================================================= */}
      {/* 1. MASTER SPREADSHEET SCHEDULE VIEW ACROSS ALL BLOCKS (AT THE TOP)        */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-5 p-4 shadow-sm border border-light-subtle mb-4">
        <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 mb-3 pb-2 border-bottom border-light">
          <div className="d-flex align-items-center gap-2">
            <h5 className="fw-bold text-dark mb-0">
              Spreadsheet View: {activeVersion?.id && versionNames[activeVersion.id] ? versionNames[activeVersion.id] : `Version v${activeVersion?.version_number || 1}`}
            </h5>
            <span
              className={
                activeVersion?.status === 'published'
                  ? 'pill-status pill-status-progress'
                  : activeVersion?.status === 'archived'
                  ? 'pill-status pill-status-archived'
                  : 'pill-status pill-status-pending'
              }
            >
              {activeVersion?.status?.toUpperCase()}
            </span>
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2">
            {/* Unpublish Schedule Button */}
            {activeVersion?.status === 'published' && (
              <button
                type="button"
                onClick={() => setTargetVersionToUnpublish(activeVersion)}
                className="btn btn-outline-warning btn-sm rounded-pill py-1.5 px-3 d-flex align-items-center gap-1.5 fw-semibold shadow-none"
                title="Revert published schedule back to draft mode to edit"
              >
                <i className="bi bi-arrow-counterclockwise"></i>
                <span>Unpublish to Draft</span>
              </button>
            )}

            {/* Delete Schedule Button */}
            {activeVersion && (
              <button
                type="button"
                onClick={() => setTargetVersionToDelete(activeVersion)}
                className="btn btn-outline-danger btn-sm rounded-pill py-1.5 px-3 d-flex align-items-center gap-1.5 fw-semibold shadow-none"
                title={`Delete this ${activeVersion.status} schedule`}
              >
                <i className="bi bi-trash3"></i>
                <span>Delete {activeVersion.status === 'draft' ? 'Draft' : 'Schedule'}</span>
              </button>
            )}

            <a
              href={`/api/schedule/export?versionId=${activeVersion?.id}&format=pdf`}
              download
              className="btn btn-outline-secondary btn-sm rounded-pill py-1.5 px-3 d-flex align-items-center gap-1.5 fw-semibold shadow-none bg-white"
              title="Export complete master schedule to PDF"
            >
              <i className="bi bi-file-earmark-pdf text-danger"></i>
              <span>Export PDF</span>
            </a>
            <a
              href={`/api/schedule/export?versionId=${activeVersion?.id}&format=excel`}
              download
              className="btn btn-outline-secondary btn-sm rounded-pill py-1.5 px-3 d-flex align-items-center gap-1.5 fw-semibold shadow-none bg-white"
              title="Export complete master schedule to Excel (.xlsx)"
            >
              <i className="bi bi-file-earmark-spreadsheet text-success"></i>
              <span>Export Excel</span>
            </a>
          </div>
        </div>

        {/* Embedded Spreadsheet View */}
        <SpreadsheetScheduleView
          entries={entries}
          offerings={offerings}
          rooms={rooms}
          instructors={instructors}
          subjects={subjects}
          blocks={blocks}
          selectedBlockId={blocks[0]?.id || ''}
          selectedTerm={currentTerm}
          isReadOnly={true}
          onEditEntry={() => {}}
          onDeleteEntry={() => {}}
          onAddEntry={() => {}}
        />
      </div>

      {/* ========================================================================= */}
      {/* 2. SCHEDULE VALIDATION & BLOCKS BREAKDOWN (AT THE BOTTOM)                 */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-5 p-4 shadow-sm border border-light-subtle mb-4">
        <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-3 mb-3">
          <div className="d-flex align-items-center gap-3">
            <span
              className={`d-inline-flex align-items-center justify-content-center text-white rounded-3 shadow-sm ${
                completenessReport.isFullyValidated ? 'bg-success' : 'bg-warning text-dark'
              }`}
              style={{ width: '42px', height: '42px' }}
            >
              <i className={`bi ${completenessReport.isFullyValidated ? 'bi-shield-check' : 'bi-exclamation-triangle-fill'} fs-4`}></i>
            </span>
            <div>
              <h5 className="fw-bold mb-0 text-dark">
                {completenessReport.isFullyValidated
                  ? 'Schedule is Fully Validated & Complete'
                  : completenessReport.isFullyComplete
                  ? 'Curriculum Scheduled &bull; Minor Conflict Warnings'
                  : 'Incomplete Schedule: Required Subjects Left Unscheduled'}
              </h5>
              <p className="text-secondary small mb-0">
                Validation &bull; {completenessReport.totalScheduledCount} of {completenessReport.totalRequiredCount} courses scheduled across {blocks.length} student blocks.
              </p>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            {completenessReport.isFullyValidated ? (
              <span className="badge bg-success-subtle text-success border border-success-subtle px-3 py-2 rounded-pill fw-semibold">
                <i className="bi bi-check-circle-fill me-1"></i>
                100% Conflict-Free &amp; Complete
              </span>
            ) : (
              <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-3 py-2 rounded-pill fw-semibold">
                <i className="bi bi-exclamation-circle-fill me-1"></i>
                {completenessReport.totalUnscheduledCount} Subjects Unscheduled
              </span>
            )}

            {activeVersion?.status === 'draft' && (
              <Link
                href={`/scheduler/schedule?termId=${currentTermId}&versionId=${activeVersion.id}`}
                className="btn-ref-primary small py-1.5 px-3"
              >
                <i className="bi bi-pencil-square me-1"></i>
                Edit in Schedule Editor
              </Link>
            )}
          </div>
        </div>

        {/* Breakdown of Unscheduled Subjects by Block / Year Level */}
        {!completenessReport.isFullyComplete && (
          <div className="p-3 bg-warning-subtle rounded-4 border border-warning border-opacity-25 mt-3">
            <h6 className="fw-bold text-dark mb-2 small text-uppercase" style={{ letterSpacing: '0.05em' }}>
              <i className="bi bi-exclamation-triangle-fill text-warning me-1.5"></i>
              Blocks with Unscheduled Subjects:
            </h6>
            <div className="row g-2">
              {completenessReport.blockReports
                .filter((r) => !r.isComplete)
                .map((r) => {
                  const bName = r.block.programs
                    ? `${r.block.programs.code} ${r.block.year_level}-${r.block.section}`
                    : `Block ${r.block.id}`;
                  return (
                    <div key={r.block.id} className="col-12 col-md-6 col-lg-4">
                      <div className="p-2.5 bg-white rounded-3 border border-warning border-opacity-50 h-100 shadow-xs">
                        <div className="fw-bold text-dark small mb-1 d-flex align-items-center justify-content-between">
                          <span>{bName}</span>
                          <span className="badge bg-danger-subtle text-danger" style={{ fontSize: '10px' }}>
                            {r.unscheduledOfferings.length} missing
                          </span>
                        </div>
                        <div className="d-flex flex-wrap gap-1">
                          {r.unscheduledOfferings.map((off) => {
                            const sub = subjects.find((s) => s.id === off.subject_id);
                            return (
                              <span
                                key={off.id}
                                className="badge bg-light text-secondary border"
                                style={{ fontSize: '11px' }}
                                title={sub?.title}
                              >
                                {sub?.code || 'Subj'}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Conflict Violations (if any) */}
        {hardViolations.length > 0 && (
          <div className="p-3 bg-danger-subtle rounded-4 border border-danger border-opacity-25 mt-3">
            <h6 className="fw-bold text-danger mb-1 small text-uppercase">
              <i className="bi bi-x-octagon-fill me-1.5"></i>
              {hardViolations.length} Hard Conflict Violations Detected:
            </h6>
            <ul className="mb-0 ps-3 small text-danger">
              {hardViolations.slice(0, 5).map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
              {hardViolations.length > 5 && (
                <li>...and {hardViolations.length - 5} more conflict violations.</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Unpublish Schedule Confirmation Modal */}
      <FormModal
        isOpen={Boolean(targetVersionToUnpublish)}
        onClose={() => setTargetVersionToUnpublish(null)}
        title={`Unpublish Schedule Version v${targetVersionToUnpublish?.version_number}`}
        description="Revert this official published schedule back to draft status."
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirmUnpublish();
        }}
        isSubmitting={isUnpublishing}
        submitLabel="Yes, Unpublish to Draft"
        size="md"
      >
        <div className="space-y-3">
          <div className="alert alert-warning d-flex align-items-center gap-2 mb-3">
            <i className="bi bi-exclamation-triangle-fill fs-5"></i>
            <div>
              <strong>Notice:</strong> Unpublishing <strong>Version v{targetVersionToUnpublish?.version_number}</strong> will revert it to draft mode. Public/student viewers and faculty will no longer see this as the official active schedule until it is re-published.
            </div>
          </div>
          <p className="text-secondary small mb-0">
            You will be able to edit, delete, or add class entries in the Schedule Editor immediately after unpublishing.
          </p>
        </div>
      </FormModal>

      {/* Generalized Delete Version Confirmation Modal */}
      <FormModal
        isOpen={Boolean(targetVersionToDelete)}
        onClose={() => setTargetVersionToDelete(null)}
        title={`Delete Schedule Version v${targetVersionToDelete?.version_number}`}
        description={`Permanently remove this ${targetVersionToDelete?.status} schedule version.`}
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirmDeleteVersion();
        }}
        isSubmitting={isDeletingVersion}
        submitLabel="Yes, Delete Permanently"
        size="md"
      >
        <div className="space-y-3">
          <div className="alert alert-danger d-flex align-items-center gap-2 mb-3">
            <i className="bi bi-exclamation-triangle-fill fs-5"></i>
            <div>
              <strong>Warning:</strong> You are about to permanently delete <strong>Schedule Version v{targetVersionToDelete?.version_number} ({targetVersionToDelete?.status?.toUpperCase()})</strong>. This action cannot be undone.
            </div>
          </div>
          <p className="text-secondary small mb-0">
            All timetable records, scheduled classes, and QR tokens associated with this version will be permanently wiped from the database.
          </p>
        </div>
      </FormModal>

      {/* Delete Archive Confirmation Modal */}
      <FormModal
        isOpen={Boolean(targetArchiveToDelete)}
        onClose={() => setTargetArchiveToDelete(null)}
        title={`Delete Archived Schedule v${targetArchiveToDelete?.version_number}`}
        description="Permanently remove this archived schedule version from the system."
        onSubmit={(e) => {
          e.preventDefault();
          handleConfirmDeleteArchive();
        }}
        isSubmitting={isDeletingArchive}
        submitLabel="Yes, Delete Archive"
        size="md"
      >
        <div className="space-y-3">
          <div className="alert alert-danger d-flex align-items-center gap-2 mb-3">
            <i className="bi bi-exclamation-triangle-fill fs-5"></i>
            <div>
              <strong>Warning:</strong> You are about to permanently delete <strong>Archived Schedule Version v{targetArchiveToDelete?.version_number}</strong>. This action cannot be undone.
            </div>
          </div>
          <p className="text-secondary small mb-0">
            All timetable records, scheduled classes, and QR tokens associated with this archived schedule version will be permanently removed.
          </p>
        </div>
      </FormModal>
    </div>
  );
}
