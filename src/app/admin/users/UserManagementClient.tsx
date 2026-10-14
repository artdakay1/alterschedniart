// src/app/admin/users/UserManagementClient.tsx
'use client';

import React, { useState, useTransition, useMemo } from 'react';
import type { Profile, UserRole, Subject, DepartmentType } from '@/types/database';
import {
  approveUserAction,
  rejectUserAction,
  updateUserRoleAction,
  disableUserAction,
  updateSchedulerDepartmentAction,
  updateSchedulerAllowedSubjectsAction,
} from './actions';

interface UserManagementClientProps {
  currentUserId: string;
  initialUsers: (Profile & {
    department?: DepartmentType | null;
    allowed_subject_ids?: string[] | null;
  })[];
  allSubjects?: Subject[];
}

export function UserManagementClient({
  currentUserId,
  initialUsers,
  allSubjects = [],
}: UserManagementClientProps) {
  const [users, setUsers] = useState(initialUsers);
  const [isPending, startTransition] = useTransition();
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Subject Scope Modal State
  const [scopeModalUser, setScopeModalUser] = useState<(Profile & { department?: DepartmentType | null; allowed_subject_ids?: string[] | null }) | null>(null);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [scopeSearchQuery, setScopeSearchQuery] = useState('');
  const [scopeTabFilter, setScopeTabFilter] = useState<'all' | 'BSIT' | 'High School'>('all');

  const pendingUsers = useMemo(
    () => users.filter((u) => u.status === 'pending'),
    [users]
  );

  const otherUsers = useMemo(
    () => users.filter((u) => u.status !== 'pending'),
    [users]
  );

  // Categorize subjects by department (BSIT vs High School)
  const categorizedSubjects = useMemo(() => {
    return allSubjects.map((sub) => {
      const code = (sub.code || '').toUpperCase();
      const title = (sub.title || '').toLowerCase();
      let department: 'BSIT' | 'High School' = 'BSIT';

      if (
        code.startsWith('HS') ||
        code.startsWith('JHS') ||
        code.startsWith('SHS') ||
        code.startsWith('GRADE') ||
        code === 'ROBOTICS' ||
        title.includes('grade ') ||
        title.includes('high school')
      ) {
        department = 'High School';
      } else {
        department = 'BSIT';
      }

      return { ...sub, department };
    });
  }, [allSubjects]);

  const bsitCount = useMemo(
    () => categorizedSubjects.filter((s) => s.department === 'BSIT').length,
    [categorizedSubjects]
  );

  const hsCount = useMemo(
    () => categorizedSubjects.filter((s) => s.department === 'High School').length,
    [categorizedSubjects]
  );

  const filteredScopeSubjects = useMemo(() => {
    let list = categorizedSubjects;
    if (scopeTabFilter === 'BSIT') {
      list = list.filter((s) => s.department === 'BSIT');
    } else if (scopeTabFilter === 'High School') {
      list = list.filter((s) => s.department === 'High School');
    }

    if (scopeSearchQuery.trim()) {
      const q = scopeSearchQuery.trim().toLowerCase();
      list = list.filter(
        (s) => s.code.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)
      );
    }
    return list;
  }, [categorizedSubjects, scopeTabFilter, scopeSearchQuery]);

  const handleApprove = (userId: string, name: string) => {
    startTransition(async () => {
      try {
        await approveUserAction(userId);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status: 'active' } : u))
        );
        setBannerNotice({
          type: 'success',
          message: `Approved ${name || 'user'}. They can now sign in.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to approve user.',
        });
      }
    });
  };

  const handleReject = (userId: string, name: string) => {
    if (!confirm(`Are you sure you want to reject registration for ${name}?`)) return;
    startTransition(async () => {
      try {
        await rejectUserAction(userId);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status: 'rejected' } : u))
        );
        setBannerNotice({
          type: 'success',
          message: `Registration for ${name} has been rejected.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to reject user.',
        });
      }
    });
  };

  const handleRoleChange = (userId: string, newRole: UserRole, name: string) => {
    startTransition(async () => {
      try {
        await updateUserRoleAction(userId, newRole);
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  role: newRole,
                  department: newRole === 'scheduler' ? (u.department || 'BSIT') : u.department,
                }
              : u
          )
        );
        setBannerNotice({
          type: 'success',
          message: `Updated role for ${name} to ${newRole.toUpperCase()}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to update role.',
        });
      }
    });
  };

  const handleDepartmentChange = (userId: string, dept: DepartmentType, name: string) => {
    startTransition(async () => {
      try {
        await updateSchedulerDepartmentAction(userId, dept);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, department: dept } : u))
        );
        setBannerNotice({
          type: 'success',
          message: `Updated scheduler department for ${name} to ${dept}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to update department.',
        });
      }
    });
  };

  const handleDisable = (userId: string, name: string) => {
    if (!confirm(`Are you sure you want to disable ${name}? They will not be able to log in.`)) return;
    startTransition(async () => {
      try {
        await disableUserAction(userId);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status: 'disabled' } : u))
        );
        setBannerNotice({
          type: 'success',
          message: `Disabled ${name}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to disable user.',
        });
      }
    });
  };

  const handleOpenScopeModal = (user: Profile & { department?: DepartmentType | null; allowed_subject_ids?: string[] | null }) => {
    setScopeModalUser(user);
    const existing = user.allowed_subject_ids;
    if (existing && Array.isArray(existing) && existing.length > 0) {
      setSelectedSubjectIds([...existing]);
    } else {
      // Default based on department
      const dept = user.department || 'BSIT';
      const defaultIds = categorizedSubjects
        .filter((s) => s.department === dept)
        .map((s) => s.id);
      setSelectedSubjectIds(defaultIds);
    }
    setScopeSearchQuery('');
    setScopeTabFilter('all');
  };

  const handleSaveScopeModal = () => {
    if (!scopeModalUser) return;
    const targetUserId = scopeModalUser.id;
    const name = scopeModalUser.full_name || scopeModalUser.email;

    startTransition(async () => {
      try {
        await updateSchedulerAllowedSubjectsAction(targetUserId, selectedSubjectIds);
        setUsers((prev) =>
          prev.map((u) =>
            u.id === targetUserId ? { ...u, allowed_subject_ids: selectedSubjectIds } : u
          )
        );
        setScopeModalUser(null);
        setBannerNotice({
          type: 'success',
          message: `Updated subject scheduling scope for ${name} (${selectedSubjectIds.length} subjects allowed).`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to update subject scope.',
        });
      }
    });
  };

  const toggleSubject = (subjectId: string) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId) ? prev.filter((id) => id !== subjectId) : [...prev, subjectId]
    );
  };

  const selectAllDepartment = (dept: 'BSIT' | 'High School' | 'all') => {
    if (dept === 'all') {
      setSelectedSubjectIds(allSubjects.map((s) => s.id));
    } else if (dept === 'BSIT') {
      const bsitIds = categorizedSubjects.filter((s) => s.department === 'BSIT').map((s) => s.id);
      setSelectedSubjectIds((prev) => Array.from(new Set([...prev, ...bsitIds])));
    } else if (dept === 'High School') {
      const hsIds = categorizedSubjects.filter((s) => s.department === 'High School').map((s) => s.id);
      setSelectedSubjectIds((prev) => Array.from(new Set([...prev, ...hsIds])));
    }
  };

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

      {/* Section 1: Pending Registrations */}
      <div className="card shadow-sm border-0 bg-white overflow-hidden mb-4">
        <div className="card-header bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center">
          <div>
            <h2 className="h5 fw-bold text-dark mb-0 d-flex align-items-center gap-2">
              <span>Pending User Registrations</span>
              <span className="badge bg-warning text-dark rounded-pill">
                {pendingUsers.length}
              </span>
            </h2>
            <p className="text-secondary small mb-0 mt-0.5">
              New faculty registered via the portal. Review qualifications before granting access.
            </p>
          </div>
        </div>

        {pendingUsers.length === 0 ? (
          <div className="text-center py-4 text-secondary small">
            No pending instructor registrations at this time.
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover table-striped align-middle mb-0">
              <thead className="table-light text-uppercase small" style={{ fontSize: '0.75rem' }}>
                <tr>
                  <th scope="col" className="py-2.5 px-3">Full Name</th>
                  <th scope="col" className="py-2.5 px-3">Email</th>
                  <th scope="col" className="py-2.5 px-3">Requested Role</th>
                  <th scope="col" className="py-2.5 px-3 text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="py-2.5 px-3 fw-bold text-dark">
                      {user.full_name || 'N/A'}
                    </td>
                    <td className="py-2.5 px-3 font-monospace small text-secondary">
                      {user.email}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="badge bg-secondary-subtle text-secondary border text-uppercase">
                        {user.role}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-end text-nowrap">
                      <div className="d-inline-flex gap-1.5">
                        <button
                          onClick={() => handleApprove(user.id, user.full_name || user.email)}
                          disabled={isPending}
                          className="btn btn-sm btn-success"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(user.id, user.full_name || user.email)}
                          disabled={isPending}
                          className="btn btn-sm btn-outline-danger"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 2: Active & Managed Users */}
      <div className="card shadow-sm border-0 bg-white overflow-hidden">
        <div className="card-header bg-white border-bottom py-3 px-4">
          <h2 className="h5 fw-bold text-dark mb-0">
            User Roles & Department Schedulers
          </h2>
          <p className="text-secondary small mb-0 mt-0.5">
            Assign Department Schedulers (BSIT or High School) and configure which specific subjects they are permitted to schedule.
          </p>
        </div>

        <div className="table-responsive">
          <table className="table table-hover table-striped align-middle mb-0">
            <thead className="table-light text-uppercase small" style={{ fontSize: '0.75rem' }}>
              <tr>
                <th scope="col" className="py-2.5 px-3">Name / Email</th>
                <th scope="col" className="py-2.5 px-3">Current Role</th>
                <th scope="col" className="py-2.5 px-3">Department & Scope</th>
                <th scope="col" className="py-2.5 px-3">Status</th>
                <th scope="col" className="py-2.5 px-3">Change Role</th>
                <th scope="col" className="py-2.5 px-3 text-end">Account Control</th>
              </tr>
            </thead>
            <tbody>
              {otherUsers.map((user) => {
                const isSelf = user.id === currentUserId;
                const isScheduler = user.role === 'scheduler';
                const dept = user.department || (isScheduler ? 'BSIT' : null);
                const allowedCount = user.allowed_subject_ids?.length;

                return (
                  <tr key={user.id}>
                    <td className="py-2.5 px-3">
                      <div className="fw-bold text-dark d-flex align-items-center gap-1.5">
                        <span>{user.full_name || 'Unnamed'}</span>
                        {isSelf && (
                          <span className="badge bg-primary-subtle text-primary border border-primary-subtle" style={{ fontSize: '0.65rem' }}>
                            YOU
                          </span>
                        )}
                      </div>
                      <div className="small text-secondary font-monospace">{user.email}</div>
                    </td>

                    <td className="py-2.5 px-3">
                      <span
                        className={`badge text-uppercase ${
                          user.role === 'admin'
                            ? 'bg-primary'
                            : user.role === 'scheduler'
                            ? 'bg-info text-dark'
                            : 'bg-success'
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>

                    {/* Department & Scope Column */}
                    <td className="py-2.5 px-3">
                      {isScheduler && user.status === 'active' ? (
                        <div className="d-flex flex-column gap-1" style={{ maxWidth: '210px' }}>
                          <div className="d-flex align-items-center gap-1">
                            <span className="small text-muted fw-semibold" style={{ fontSize: '0.75rem' }}>Dept:</span>
                            <select
                              value={dept || 'BSIT'}
                              onChange={(e) =>
                                handleDepartmentChange(
                                  user.id,
                                  e.target.value as DepartmentType,
                                  user.full_name || user.email
                                )
                              }
                              disabled={isPending}
                              className="form-select form-select-sm py-0 px-2 fw-semibold"
                              style={{ fontSize: '0.78rem' }}
                            >
                              <option value="BSIT">BSIT</option>
                              <option value="High School">High School</option>
                            </select>
                          </div>

                          <div className="d-flex align-items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenScopeModal(user)}
                              className="btn btn-outline-primary btn-sm py-0.5 px-2 text-nowrap d-inline-flex align-items-center gap-1"
                              style={{ fontSize: '0.75rem' }}
                              title="Configure specific subjects this scheduler is allowed to schedule"
                            >
                              <i className="bi bi-sliders2" />
                              <span>Configure Scope</span>
                            </button>
                            <span
                              className="badge bg-light text-secondary border font-monospace"
                              style={{ fontSize: '0.7rem' }}
                            >
                              {allowedCount !== undefined && allowedCount !== null
                                ? `${allowedCount} subs`
                                : 'Dept Default'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted small">
                          {user.role === 'admin' ? 'Unrestricted (Global)' : '—'}
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3">
                      <span
                        className={`badge ${
                          user.status === 'active'
                            ? 'bg-success-subtle text-success border border-success-subtle'
                            : 'bg-danger-subtle text-danger border border-danger-subtle'
                        }`}
                      >
                        {user.status}
                      </span>
                    </td>

                    <td className="py-2.5 px-3">
                      {user.status === 'active' && !isSelf ? (
                        <select
                          value={user.role}
                          onChange={(e) =>
                            handleRoleChange(
                              user.id,
                              e.target.value as UserRole,
                              user.full_name || user.email
                            )
                          }
                          disabled={isPending}
                          className="form-select form-select-sm"
                          style={{ maxWidth: '140px' }}
                        >
                          <option value="instructor">Instructor</option>
                          <option value="scheduler">Scheduler</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <small className="text-secondary">
                          {isSelf ? 'Self (Locked)' : 'Inactive'}
                        </small>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-end text-nowrap">
                      {!isSelf && user.status === 'active' ? (
                        <button
                          onClick={() => handleDisable(user.id, user.full_name || user.email)}
                          disabled={isPending}
                          className="btn btn-sm btn-outline-danger"
                        >
                          Disable User
                        </button>
                      ) : !isSelf && user.status === 'disabled' ? (
                        <button
                          onClick={() => handleApprove(user.id, user.full_name || user.email)}
                          disabled={isPending}
                          className="btn btn-sm btn-outline-success"
                        >
                          Reactivate
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Scope Configuration Modal */}
      {scopeModalUser && (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1055 }}
        >
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content rounded-4 shadow">
              <div className="modal-header border-bottom py-3 px-4">
                <div>
                  <h5 className="modal-title fw-bold text-dark mb-0">
                    Subject Scheduling Scope
                  </h5>
                  <p className="text-muted small mb-0 mt-0.5">
                    Scheduler: <strong className="text-dark">{scopeModalUser.full_name || scopeModalUser.email}</strong> ({scopeModalUser.department || 'BSIT'})
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setScopeModalUser(null)}
                />
              </div>

              <div className="modal-body p-4">
                <div className="alert alert-info py-2 px-3 small rounded-3 mb-3 d-flex align-items-center gap-2">
                  <i className="bi bi-info-circle-fill fs-5" />
                  <div>
                    This department scheduler will only be able to add, modify, or auto-generate schedule entries for the subjects selected below. All other subjects on the timetable will be view-only (locked).
                  </div>
                </div>

                {/* Filter and search toolbar */}
                <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
                  <div className="d-flex align-items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setScopeTabFilter('all')}
                      className={`btn btn-sm rounded-pill px-3 py-1 fw-semibold ${
                        scopeTabFilter === 'all' ? 'btn-primary' : 'btn-outline-secondary'
                      }`}
                    >
                      All ({categorizedSubjects.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setScopeTabFilter('BSIT')}
                      className={`btn btn-sm rounded-pill px-3 py-1 fw-semibold ${
                        scopeTabFilter === 'BSIT' ? 'btn-primary' : 'btn-outline-secondary'
                      }`}
                    >
                      BSIT ({bsitCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setScopeTabFilter('High School')}
                      className={`btn btn-sm rounded-pill px-3 py-1 fw-semibold ${
                        scopeTabFilter === 'High School' ? 'btn-primary' : 'btn-outline-secondary'
                      }`}
                    >
                      High School ({hsCount})
                    </button>
                  </div>

                  <div className="position-relative" style={{ minWidth: '220px' }}>
                    <input
                      type="text"
                      className="form-control form-control-sm ps-4 rounded-pill"
                      placeholder="Search subject code/title..."
                      value={scopeSearchQuery}
                      onChange={(e) => setScopeSearchQuery(e.target.value)}
                    />
                    <i className="bi bi-search position-absolute top-50 start-0 translate-middle-y ms-2.5 text-muted small" />
                  </div>
                </div>

                {/* Quick actions */}
                <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between mb-3 p-2.5 bg-light rounded-3 border">
                  <div className="d-flex flex-wrap gap-2 align-items-center">
                    <span className="small fw-semibold text-secondary me-1">Quick Select:</span>
                    <button
                      type="button"
                      onClick={() => selectAllDepartment('BSIT')}
                      className="btn btn-outline-primary btn-sm py-0 px-2"
                      style={{ fontSize: '0.75rem' }}
                    >
                      Select All BSIT ({bsitCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => selectAllDepartment('High School')}
                      className="btn btn-outline-success btn-sm py-0 px-2"
                      style={{ fontSize: '0.75rem' }}
                    >
                      Select All High School ({hsCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => selectAllDepartment('all')}
                      className="btn btn-outline-dark btn-sm py-0 px-2"
                      style={{ fontSize: '0.75rem' }}
                    >
                      Select All ({allSubjects.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSubjectIds([])}
                      className="btn btn-outline-danger btn-sm py-0 px-2"
                      style={{ fontSize: '0.75rem' }}
                    >
                      Deselect All
                    </button>
                  </div>
                  <span className="small text-muted font-monospace" style={{ fontSize: '0.72rem' }}>
                    Showing {filteredScopeSubjects.length} subjects (scroll for more)
                  </span>
                </div>

                {/* Subjects Checkbox Table with Always-Visible Scrollbar */}
                <div
                  className="border rounded-3 custom-scrollbar"
                  style={{
                    maxHeight: '440px',
                    overflowY: 'scroll',
                    overflowX: 'hidden',
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#94a3b8 #f1f5f9',
                  }}
                >
                  <table className="table table-sm table-hover mb-0 align-middle">
                    <thead className="table-light sticky-top" style={{ fontSize: '0.75rem' }}>
                      <tr>
                        <th style={{ width: '40px' }} className="text-center">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={
                              filteredScopeSubjects.length > 0 &&
                              filteredScopeSubjects.every((s) => selectedSubjectIds.includes(s.id))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                const addIds = filteredScopeSubjects.map((s) => s.id);
                                setSelectedSubjectIds((prev) => Array.from(new Set([...prev, ...addIds])));
                              } else {
                                const removeIds = new Set(filteredScopeSubjects.map((s) => s.id));
                                setSelectedSubjectIds((prev) => prev.filter((id) => !removeIds.has(id)));
                              }
                            }}
                          />
                        </th>
                        <th style={{ width: '120px' }}>Code</th>
                        <th>Subject Title</th>
                        <th style={{ width: '120px' }}>Department</th>
                        <th style={{ width: '60px' }} className="text-center">Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredScopeSubjects.map((sub) => {
                        const isChecked = selectedSubjectIds.includes(sub.id);
                        return (
                          <tr
                            key={sub.id}
                            style={{ cursor: 'pointer' }}
                            onClick={() => toggleSubject(sub.id)}
                            className={isChecked ? 'table-primary' : ''}
                          >
                            <td className="text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={isChecked}
                                onChange={() => toggleSubject(sub.id)}
                              />
                            </td>
                            <td className="fw-bold font-monospace small">{sub.code}</td>
                            <td className="small">{sub.title}</td>
                            <td>
                              <span
                                className={`badge ${
                                  sub.department === 'BSIT'
                                    ? 'bg-primary-subtle text-primary border border-primary-subtle'
                                    : 'bg-success-subtle text-success border border-success-subtle'
                                }`}
                                style={{ fontSize: '0.7rem' }}
                              >
                                {sub.department}
                              </span>
                            </td>
                            <td className="text-center small font-monospace">{sub.units}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="modal-footer border-top py-2.5 px-4 d-flex justify-content-between align-items-center">
                <span className="small text-secondary">
                  <strong>{selectedSubjectIds.length}</strong> of {allSubjects.length} subjects allowed
                </span>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setScopeModalUser(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm px-4 fw-semibold"
                    disabled={isPending}
                    onClick={handleSaveScopeModal}
                  >
                    {isPending ? 'Saving...' : 'Save Allowed Scope'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
