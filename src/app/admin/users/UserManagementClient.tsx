// src/app/admin/users/UserManagementClient.tsx
'use client';

import React, { useState, useTransition } from 'react';
import type { Profile, UserRole } from '@/types/database';
import {
  approveUserAction,
  rejectUserAction,
  updateUserRoleAction,
  disableUserAction,
} from './actions';

interface UserManagementClientProps {
  currentUserId: string;
  initialUsers: Profile[];
}

export function UserManagementClient({
  currentUserId,
  initialUsers,
}: UserManagementClientProps) {
  const [users, setUsers] = useState<Profile[]>(initialUsers);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const pendingUsers = users.filter((u) => u.status === 'pending');
  const otherUsers = users.filter((u) => u.status !== 'pending');

  const handleApprove = (userId: string, name: string) => {
    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      try {
        await approveUserAction(userId);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status: 'active' } : u))
        );
        setActionSuccess(`User "${name}" has been approved and activated.`);
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Failed to approve user.');
      }
    });
  };

  const handleReject = (userId: string, name: string) => {
    if (!confirm(`Are you sure you want to REJECT and permanently delete the registration for "${name}"?`)) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      try {
        await rejectUserAction(userId);
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setActionSuccess(`Registration for "${name}" was rejected.`);
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Failed to reject user.');
      }
    });
  };

  const handleRoleChange = (userId: string, role: UserRole, name: string) => {
    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      try {
        await updateUserRoleAction(userId, role);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role } : u))
        );
        setActionSuccess(`Role for "${name}" updated to ${role.toUpperCase()}.`);
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Failed to update role.');
      }
    });
  };

  const handleDisable = (userId: string, name: string) => {
    if (!confirm(`Disable account access for "${name}"? They will no longer be able to log in.`)) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    startTransition(async () => {
      try {
        await disableUserAction(userId);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, status: 'disabled' } : u))
        );
        setActionSuccess(`User "${name}" has been disabled.`);
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Failed to disable user.');
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Feedback Alerts */}
      {actionError && (
        <div className="alert alert-danger py-2.5 px-3 small d-flex align-items-center gap-2" role="alert">
          <i className="bi bi-exclamation-triangle-fill" />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="alert alert-success py-2.5 px-3 small d-flex align-items-center gap-2" role="alert">
          <i className="bi bi-check-circle-fill" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Section 1: Pending Registrations */}
      <div className="card shadow-sm border-0 bg-white mb-4 overflow-hidden">
        <div className="card-header bg-white border-bottom py-3 px-4 d-flex justify-content-between align-items-center">
          <div>
            <h2 className="h5 fw-bold text-dark mb-0 d-flex align-items-center gap-2">
              <span>Pending Instructor Applications</span>
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
            User Roles & Status Management
          </h2>
          <p className="text-secondary small mb-0 mt-0.5">
            Promote active members to Scheduler or Admin, or disable departing users.
          </p>
        </div>

        <div className="table-responsive">
          <table className="table table-hover table-striped align-middle mb-0">
            <thead className="table-light text-uppercase small" style={{ fontSize: '0.75rem' }}>
              <tr>
                <th scope="col" className="py-2.5 px-3">Name / Email</th>
                <th scope="col" className="py-2.5 px-3">Current Role</th>
                <th scope="col" className="py-2.5 px-3">Status</th>
                <th scope="col" className="py-2.5 px-3">Change Role</th>
                <th scope="col" className="py-2.5 px-3 text-end">Account Control</th>
              </tr>
            </thead>
            <tbody>
              {otherUsers.map((user) => {
                const isSelf = user.id === currentUserId;
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
    </div>
  );
}
