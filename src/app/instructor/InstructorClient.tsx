// src/app/instructor/InstructorClient.tsx
'use client';

import React, { useTransition } from 'react';
import Link from 'next/link';
import { markNotificationAsReadAction } from '@/app/actions/notification-actions';
import type { AcademicTerm, ScheduleVersion } from '@/types/database';

interface InstructorScheduleItem {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type: string;
  subject_code: string;
  subject_title: string;
  block_name: string;
  room_name: string;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

interface InstructorClientProps {
  instructorName: string;
  term: AcademicTerm | null;
  publishedVersion: ScheduleVersion | null;
  scheduleItems: InstructorScheduleItem[];
  notifications: NotificationItem[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function InstructorClient({
  instructorName,
  term,
  publishedVersion,
  scheduleItems,
  notifications,
}: InstructorClientProps) {
  const [isPending, startTransition] = useTransition();

  const handleMarkAsRead = (id: string) => {
    startTransition(async () => {
      await markNotificationAsReadAction(id);
    });
  };

  const unreadNotifications = notifications.filter((n) => !n.is_read);

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="card shadow-sm border-0 p-4 bg-white mb-4">
        <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-3">
          <div>
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
              <span className="badge bg-success text-uppercase px-2.5 py-1">
                Faculty Portal
              </span>
              {publishedVersion && (
                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2.5 py-1">
                  Version v{publishedVersion.version_number} Published
                </span>
              )}
            </div>
            <p className="text-secondary small mb-0">
              {term
                ? `Academic Term: School Year ${term.school_year} — ${term.semester}`
                : 'No active academic term configured'}
            </p>
          </div>

          {publishedVersion && (
            <div className="d-flex align-items-center gap-2">
              <a
                href={`/api/schedule/export?versionId=${publishedVersion.id}&format=pdf`}
                download
                className="btn btn-sm btn-outline-danger d-inline-flex align-items-center gap-1.5 px-3 py-1.5 fw-semibold"
              >
                <i className="bi bi-file-earmark-pdf" />
                <span>Export PDF</span>
              </a>

              <a
                href={`/api/schedule/export?versionId=${publishedVersion.id}&format=excel`}
                download
                className="btn btn-sm btn-outline-success d-inline-flex align-items-center gap-1.5 px-3 py-1.5 fw-semibold"
              >
                <i className="bi bi-file-earmark-spreadsheet" />
                <span>Export Excel</span>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Notifications Tray */}
      {unreadNotifications.length > 0 && (
        <div className="card shadow-sm border-0 p-3 bg-primary-subtle text-primary-emphasis mb-4">
          <div className="d-flex align-items-center gap-2 mb-2">
            <i className="bi bi-bell-fill text-primary" />
            <h2 className="h6 fw-bold mb-0">
              Recent Schedule Notifications ({unreadNotifications.length})
            </h2>
          </div>

          <div className="space-y-2">
            {unreadNotifications.map((n) => (
              <div
                key={n.id}
                className="p-3 bg-white border rounded d-flex justify-content-between align-items-start gap-3"
              >
                <div>
                  <div className="fw-bold small text-dark">{n.title}</div>
                  <div className="small text-secondary mt-0.5">{n.body}</div>
                  <small className="text-muted font-monospace" style={{ fontSize: '0.72rem' }}>
                    {new Date(n.created_at).toLocaleString()}
                  </small>
                </div>

                <button
                  type="button"
                  onClick={() => handleMarkAsRead(n.id)}
                  disabled={isPending}
                  className="btn btn-sm btn-outline-primary text-nowrap"
                  style={{ fontSize: '0.75rem' }}
                >
                  Mark Read
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Teaching Timetable Card */}
      <div className="card shadow-sm border-0 p-4 bg-white">
        <div className="d-flex justify-content-between align-items-center mb-3 pb-3 border-bottom">
          <div>
            <h2 className="h5 fw-bold text-dark mb-0">Official Teaching Timetable</h2>
            <p className="text-secondary small mb-0">
              Confirmed class assignments for the active academic term.
            </p>
          </div>

          <span className="badge bg-secondary-subtle text-secondary border px-2.5 py-1">
            {scheduleItems.length} Weekly Sessions
          </span>
        </div>

        {!publishedVersion ? (
          <div className="p-5 text-center bg-light rounded border border-dashed">
            <i className="bi bi-calendar-x text-secondary" style={{ fontSize: '2.5rem' }} />
            <h3 className="h6 fw-bold text-dark mt-2 mb-1">No Published Schedule Yet</h3>
            <p className="text-secondary small max-w-sm mx-auto mb-3">
              The department scheduler is currently preparing the draft. Once officially published, your confirmed teaching assignments will appear here.
            </p>
            <Link
              href="/instructor/availability"
              prefetch={true}
              className="btn btn-sm btn-primary"
            >
              Update My Weekly Availability
            </Link>
          </div>
        ) : scheduleItems.length === 0 ? (
          <div className="p-4 text-center text-secondary small bg-light rounded border">
            You do not have any teaching sessions assigned in the published schedule version.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table-striped align-middle mb-0">
              <thead className="table-light text-uppercase small" style={{ fontSize: '0.75rem' }}>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Time</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Type</th>
                  <th scope="col">Student Block</th>
                  <th scope="col">Room</th>
                </tr>
              </thead>
              <tbody>
                {scheduleItems.map((item) => (
                  <tr key={item.id}>
                    <td className="fw-bold text-dark">
                      {DAY_NAMES[item.day_of_week] || `Day ${item.day_of_week}`}
                    </td>
                    <td className="font-monospace text-primary fw-semibold small">
                      {item.start_time.slice(0, 5)} - {item.end_time.slice(0, 5)}
                    </td>
                    <td>
                      <div className="fw-bold text-dark">{item.subject_code}</div>
                      <div className="text-secondary small">{item.subject_title}</div>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          item.session_type === 'lab'
                            ? 'bg-purple-subtle text-purple border'
                            : 'bg-primary-subtle text-primary border'
                        }`}
                      >
                        {item.session_type}
                      </span>
                    </td>
                    <td className="fw-medium text-dark">
                      {item.block_name}
                    </td>
                    <td className="font-monospace text-secondary small">
                      {item.room_name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
