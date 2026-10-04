// src/app/s/[token]/page.tsx
import React from 'react';
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPublicScheduleByToken } from '@/lib/qr/token-service';

export const dynamic = 'force-dynamic';

interface PublicSchedulePageProps {
  params: Promise<{
    token: string;
  }>;
}

export async function generateMetadata({
  params,
}: PublicSchedulePageProps): Promise<Metadata> {
  const { token } = await params;
  const adminClient = createAdminClient();
  const schedule = await getPublicScheduleByToken(adminClient, token);

  if (schedule.status === 'valid' && schedule.block) {
    return {
      title: `${schedule.block.name} Class Schedule | AlterSched`,
      description: `Official class schedule for ${schedule.block.name} — ${schedule.term?.school_year || ''} (${schedule.term?.semester || ''})`,
    };
  }

  return {
    title: 'Class Schedule | AlterSched',
    description: 'Official academic class timetable',
  };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function PublicSchedulePage({ params }: PublicSchedulePageProps) {
  const { token } = await params;
  const adminClient = createAdminClient();

  const schedule = await getPublicScheduleByToken(adminClient, token);

  // 1. Not Found State
  if (schedule.status === 'not_found') {
    return (
      <div className="min-vh-100 bg-body-tertiary d-flex align-items-center justify-content-center p-3">
        <div className="card shadow-sm border p-4 text-center" style={{ maxWidth: '420px', width: '100%' }}>
          <div
            className="rounded-circle bg-secondary-subtle text-secondary d-flex align-items-center justify-content-center mx-auto mb-3"
            style={{ width: '56px', height: '56px', fontSize: '1.5rem' }}
          >
            <i className="bi bi-question-circle" />
          </div>
          <h1 className="h5 fw-bold text-dark mb-2">Timetable Link Not Found</h1>
          <p className="text-secondary small mb-3">
            The timetable link you accessed does not exist or may have expired. Please verify the URL or scan the official printed QR code again.
          </p>
          <a
            href="/login"
            className="btn btn-outline-primary btn-sm mx-auto"
          >
            Go to AlterSched Portal
          </a>
        </div>
      </div>
    );
  }

  // 2. Revoked State
  if (schedule.status === 'revoked') {
    return (
      <div className="min-vh-100 bg-body-tertiary d-flex align-items-center justify-content-center p-3">
        <div className="card shadow-sm border border-warning p-4 text-center" style={{ maxWidth: '420px', width: '100%' }}>
          <div
            className="rounded-circle bg-warning-subtle text-warning d-flex align-items-center justify-content-center mx-auto mb-3"
            style={{ width: '56px', height: '56px', fontSize: '1.5rem' }}
          >
            <i className="bi bi-exclamation-triangle" />
          </div>
          <h1 className="h5 fw-bold text-dark mb-2">This Link is No Longer Active</h1>
          <p className="text-secondary small mb-2">
            This public timetable link has been deactivated by the academic scheduling department.
          </p>
          <div className="p-2 bg-light rounded text-muted small font-monospace mb-3" style={{ fontSize: '0.75rem' }}>
            {schedule.revoked_at
              ? `Deactivated on: ${new Date(schedule.revoked_at).toLocaleDateString()}`
              : 'Link deactivated'}
          </div>
          <p className="text-secondary small mb-0">
            Please check your student council or department bulletin board for the updated schedule QR code.
          </p>
        </div>
      </div>
    );
  }

  // 3. Valid Schedule State
  const { block, version, term, entries = [] } = schedule;
  const isArchived = Boolean(version?.is_archived);

  // Group entries by day of week
  const entriesByDay = new Map<number, typeof entries>();
  for (let d = 0; d < 7; d++) {
    entriesByDay.set(d, []);
  }
  for (const entry of entries) {
    const list = entriesByDay.get(entry.day_of_week) || [];
    list.push(entry);
    entriesByDay.set(entry.day_of_week, list);
  }

  // Find active days
  const activeDays = [1, 2, 3, 4, 5, 6, 0].filter(
    (d) => (entriesByDay.get(d) || []).length > 0
  );

  const formattedPublishedAt = version?.published_at
    ? new Date(version.published_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Recently';

  return (
    <div className="min-vh-100 bg-body-tertiary text-dark d-flex flex-column">
      {/* Top Banner if version is archived */}
      {isArchived && (
        <div className="alert alert-warning mb-0 text-center rounded-0 border-start-0 border-end-0 border-top-0 d-flex align-items-center justify-content-center gap-2 small fw-medium py-2 px-3">
          <i className="bi bi-info-circle-fill text-warning-emphasis" />
          <span>
            <strong>Older Version Notice:</strong> This timetable is an older version (v{version?.version_number}). A newer official schedule has been published.
          </span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-grow-1 container py-4 py-sm-5" style={{ maxWidth: '860px' }}>
        {/* Header Card */}
        <div className="card shadow-sm border-0 p-4 bg-white mb-4">
          <div className="d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-3 pb-3 border-bottom mb-3">
            <div>
              <div className="d-flex align-items-center gap-2 text-primary small fw-semibold text-uppercase">
                <span>AlterSched Timetable</span>
                <span>&bull;</span>
                <span>{term ? `${term.school_year} (${term.semester})` : 'Academic Schedule'}</span>
              </div>
              <h1 className="h3 fw-bold text-dark mt-1 mb-0">
                {block?.name}
              </h1>
              {block?.program_name && (
                <p className="text-secondary small mb-0 mt-0.5">{block.program_name}</p>
              )}
            </div>

            <span
              className={`badge px-3 py-1.5 fw-semibold ${
                isArchived
                  ? 'bg-warning-subtle text-warning-emphasis border border-warning-subtle'
                  : 'bg-success-subtle text-success border border-success-subtle'
              }`}
            >
              {isArchived ? `Archived (v${version?.version_number})` : `Official Live (v${version?.version_number})`}
            </span>
          </div>

          <div className="d-flex flex-wrap align-items-center gap-3 text-secondary small">
            <div>
              Total Classes: <strong className="text-dark">{entries.length}</strong>
            </div>
            <span>&bull;</span>
            <div>
              Class Days: <strong className="text-dark">{activeDays.length} days/week</strong>
            </div>
          </div>
        </div>

        {/* Schedule Entries Grouped By Day */}
        {entries.length === 0 ? (
          <div className="card shadow-sm border-0 p-5 text-center bg-white">
            <i className="bi bi-calendar-x text-secondary" style={{ fontSize: '2.5rem' }} />
            <p className="fw-semibold text-dark mt-2 mb-1">No Classes Scheduled</p>
            <p className="text-secondary small mb-0">
              There are currently no class sessions scheduled for this student block.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeDays.map((dayNum) => {
              const dayEntries = entriesByDay.get(dayNum) || [];
              const dayName = DAYS[dayNum];

              return (
                <div key={dayNum} className="card shadow-sm border-0 overflow-hidden mb-3">
                  {/* Day Header */}
                  <div className="card-header bg-light border-bottom py-2.5 px-3 d-flex justify-content-between align-items-center">
                    <h2 className="h6 fw-bold text-dark mb-0 d-flex align-items-center gap-2">
                      <span className="badge bg-primary p-1 rounded-circle" />
                      <span>{dayName}</span>
                    </h2>
                    <span className="badge bg-secondary-subtle text-secondary small">
                      {dayEntries.length} class{dayEntries.length === 1 ? '' : 'es'}
                    </span>
                  </div>

                  {/* Class List */}
                  <div className="list-group list-group-flush">
                    {dayEntries.map((item) => (
                      <div
                        key={item.id}
                        className="list-group-item d-flex flex-column flex-sm-row justify-content-between align-items-start align-items-sm-center gap-2 py-3 px-3"
                      >
                        {/* Time & Session */}
                        <div className="me-3" style={{ minWidth: '150px' }}>
                          <div className="fw-bold font-monospace text-primary small">
                            {item.start_time.slice(0, 5)} - {item.end_time.slice(0, 5)}
                          </div>
                          <span
                            className={`badge text-uppercase mt-1 ${
                              item.session_type === 'lab'
                                ? 'bg-purple-subtle text-purple border'
                                : 'bg-primary-subtle text-primary border'
                            }`}
                            style={{ fontSize: '0.68rem' }}
                          >
                            {item.session_type}
                          </span>
                        </div>

                        {/* Subject Title */}
                        <div className="flex-grow-1">
                          <div className="fw-bold text-dark small">
                            {item.subject_code} &bull; {item.subject_title}
                          </div>
                          <div className="small text-secondary mt-0.5 d-flex align-items-center gap-1">
                            <i className="bi bi-person text-secondary" />
                            <span>{item.instructor_name}</span>
                          </div>
                        </div>

                        {/* Room Location */}
                        <div className="text-sm-end mt-2 mt-sm-0">
                          <span className="badge bg-light text-dark border px-2.5 py-1.5 font-monospace small">
                            <i className="bi bi-geo-alt me-1 text-primary" />
                            {item.room_name}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer info note */}
        <footer className="pt-4 border-top text-center text-secondary small">
          <p className="mb-1">
            Schedule as of <strong>{formattedPublishedAt}</strong>
          </p>
          <small className="text-muted">
            AlterSched Academic Scheduling System &bull; Official Read-Only Timetable
          </small>
        </footer>
      </main>
    </div>
  );
}
