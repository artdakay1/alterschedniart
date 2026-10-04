'use client';

import React, { useState, useTransition } from 'react';
import {
  previewAlterationAction,
  approveAlterationAction,
  rejectAlterationAction,
} from '@/app/actions/alteration-actions';
import type {
  AlterationRequest,
  ScheduleEntry,
  AcademicTerm,
  ScheduleVersion,
  Room,
  Instructor,
} from '@/types/database';
import type { ProposedChanges, AlterationPreviewResult } from '@/lib/alterations/preview';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface EnrichedApproverRequest extends AlterationRequest {
  profiles?: { full_name: string; email: string } | null;
  reviewer?: { full_name: string; email: string } | null;
  schedule_entries?: (ScheduleEntry & {
    class_offerings?: {
      subjects?: { code: string; title: string } | null;
      blocks?: { year_level: number; section: string; programs?: { code: string } | null } | null;
    } | null;
    rooms?: { name: string; room_type?: string } | null;
    instructors?: { full_name: string } | null;
  }) | null;
}

interface AlterationsApproverClientProps {
  currentTerm: AcademicTerm | null;
  publishedVersion: ScheduleVersion | null;
  initialRequests: EnrichedApproverRequest[];
  allRooms: Room[];
  allInstructors: Instructor[];
  userRole: 'admin' | 'scheduler';
}

export function AlterationsApproverClient({
  currentTerm,
  publishedVersion,
  initialRequests,
  allRooms,
  allInstructors,
  userRole,
}: AlterationsApproverClientProps) {
  const [requests, setRequests] = useState<EnrichedApproverRequest[]>(initialRequests);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Preview State per request ID
  const [previews, setPreviews] = useState<Record<string, AlterationPreviewResult>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});

  // Action State
  const [isProcessing, startTransition] = useTransition();

  // Approve Confirmation Modal State
  const [approvingReq, setApprovingReq] = useState<EnrichedApproverRequest | null>(null);

  // Reject Modal State
  const [rejectingReq, setRejectingReq] = useState<EnrichedApproverRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [rejectError, setRejectError] = useState<string | null>(null);

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const historyRequests = requests.filter((r) => r.status !== 'pending');

  // Handle Preview Impact
  const handlePreview = async (requestId: string) => {
    setPreviewLoading((prev) => ({ ...prev, [requestId]: true }));
    try {
      const result = await previewAlterationAction(requestId);
      setPreviews((prev) => ({ ...prev, [requestId]: result }));
    } catch (err: unknown) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to preview alteration impact.',
      });
    } finally {
      setPreviewLoading((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  // Open Approve Confirmation
  const handleOpenApproveModal = async (req: EnrichedApproverRequest) => {
    // If preview hasn't been fetched yet, fetch it first
    let preview = previews[req.id];
    if (!preview) {
      setPreviewLoading((prev) => ({ ...prev, [req.id]: true }));
      try {
        preview = await previewAlterationAction(req.id);
        setPreviews((prev) => ({ ...prev, [req.id]: preview }));
      } catch (err: unknown) {
        setBanner({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to evaluate conflict engine preview.',
        });
        setPreviewLoading((prev) => ({ ...prev, [req.id]: false }));
        return;
      }
      setPreviewLoading((prev) => ({ ...prev, [req.id]: false }));
    }

    if (preview.hasHardViolations) {
      setBanner({
        type: 'error',
        message: 'Approval blocked: This alteration introduces hard constraint violations. Resolve or reject.',
      });
      return;
    }

    setApprovingReq(req);
  };

  // Confirm Approve Execution
  const handleConfirmApprove = () => {
    if (!approvingReq) return;
    const reqId = approvingReq.id;

    startTransition(async () => {
      try {
        const res = await approveAlterationAction(reqId);
        if (res.success) {
          setBanner({
            type: 'success',
            message: `Alteration approved! Version v${res.versionNumber} created and published live. All assigned instructors notified.`,
          });

          // Update local request status
          setRequests((prev) =>
            prev.map((r) =>
              r.id === reqId
                ? {
                    ...r,
                    status: 'approved' as const,
                    reviewed_at: new Date().toISOString(),
                  }
                : r
            )
          );
          setApprovingReq(null);
        } else if (res.blocked) {
          setBanner({
            type: 'error',
            message: res.error || 'Approval blocked by conflict engine.',
          });
          setApprovingReq(null);
        }
      } catch (err: unknown) {
        setBanner({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to approve alteration.',
        });
      }
    });
  };

  // Open Reject Modal
  const handleOpenRejectModal = (req: EnrichedApproverRequest) => {
    setRejectingReq(req);
    setRejectionReason('');
    setRejectError(null);
  };

  // Confirm Reject Execution
  const handleConfirmReject = () => {
    if (!rejectingReq) return;
    const reqId = rejectingReq.id;
    const reasonText = rejectionReason.trim();

    if (!reasonText) {
      setRejectError('A short reason for rejection is required to inform the instructor.');
      return;
    }

    startTransition(async () => {
      try {
        const res = await rejectAlterationAction(reqId, reasonText);
        if (res.success) {
          setBanner({
            type: 'success',
            message: 'Alteration request rejected. Instructor has been notified with the provided reason.',
          });

          setRequests((prev) =>
            prev.map((r) =>
              r.id === reqId
                ? {
                    ...r,
                    status: 'rejected' as const,
                    rejection_reason: reasonText,
                    reviewed_at: new Date().toISOString(),
                  }
                : r
            )
          );
          setRejectingReq(null);
        }
      } catch (err: unknown) {
        setRejectError(err instanceof Error ? err.message : 'Failed to reject alteration request.');
      }
    });
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16">
      {/* Banner Notice */}
      {banner && (
        <div
          className={`p-4 rounded-2xl flex items-center justify-between border ${
            banner.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-3">
            {banner.type === 'success' ? (
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            )}
            <span className="text-sm font-medium">{banner.message}</span>
          </div>
          <button
            onClick={() => setBanner(null)}
            className="text-xs text-slate-400 hover:text-white px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header toolbar section */}
      <div className="d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-3 pb-3 mb-4 border-bottom border-light-subtle">
        <div className="d-flex align-items-center gap-2">
          <span className="pill-status pill-status-progress">
            {userRole.toUpperCase()} PORTAL
          </span>
          {pendingRequests.length > 0 && (
            <span className="pill-status pill-status-review">
              {pendingRequests.length} Pending
            </span>
          )}
        </div>

        {publishedVersion && (
          <div className="d-flex align-items-center gap-2 px-3 py-1.5 bg-white border border-light-subtle rounded-3 small text-secondary">
            <span className="badge-bullet bg-success" />
            <span>
              Active Version: <strong className="text-dark">v{publishedVersion.version_number}</strong>
            </span>
            <span className="text-muted">|</span>
            <span>
              Term:{' '}
              <strong className="text-dark">
                {currentTerm ? `${currentTerm.school_year} (${currentTerm.semester})` : 'Current Term'}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="ref-segment-control mb-4">
        <button
          onClick={() => setActiveTab('pending')}
          className={`ref-segment-btn ${activeTab === 'pending' ? 'active' : ''}`}
        >
          <span>Pending Alterations</span>
          <span className="badge rounded-pill text-bg-secondary ms-2 small">
            {pendingRequests.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`ref-segment-btn ${activeTab === 'history' ? 'active' : ''}`}
        >
          <span>Decision History</span>
          <span className="badge rounded-pill text-bg-secondary ms-2 small">
            {historyRequests.length}
          </span>
        </button>
      </div>

      {/* Main Tab Content */}
      {activeTab === 'pending' ? (
        <div className="space-y-4">
          {pendingRequests.length === 0 ? (
            <div className="p-5 text-center bg-white border border-white rounded-5 shadow-sm space-y-2">
              <div
                className="d-flex align-items-center justify-content-center rounded-circle mx-auto mb-3"
                style={{ width: '50px', height: '50px', background: '#eefdf4', color: '#16a34a' }}
              >
                <i className="bi bi-check-circle fs-4" />
              </div>
              <h3 className="fs-5 fw-bold text-dark m-0">All Clear — No Pending Alterations</h3>
              <p className="small text-secondary max-w-sm mx-auto mb-0">
                No alteration requests are currently awaiting review. New instructor requests will appear here.
              </p>
            </div>
          ) : (
            <div className="d-flex flex-column gap-4">
              {pendingRequests.map((req) => {
                const proposed = (req.proposed_changes || {}) as ProposedChanges;
                const entry = req.schedule_entries;
                const sub = entry?.class_offerings?.subjects;
                const blk = entry?.class_offerings?.blocks;
                const currentInst = entry?.instructors?.full_name || 'Assigned Instructor';
                const currentRoom = entry?.rooms?.name || 'Assigned Room';

                const newRoom = allRooms.find((r) => r.id === proposed.room_id);
                const newInst = allInstructors.find((i) => i.id === proposed.instructor_id);

                const preview = previews[req.id];
                const isLoadingPreview = previewLoading[req.id];

                return (
                  <div
                    key={req.id}
                    className="p-4 p-md-5 rounded-5 bg-white border border-white shadow-sm space-y-4"
                  >
                    {/* Header */}
                    <div className="d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-2 border-bottom pb-3">
                      <div>
                        <div className="d-flex align-items-center gap-2">
                          <span className="fs-5 fw-bold text-dark">
                            {sub ? `${sub.code} — ${sub.title}` : 'Scheduled Class'}
                          </span>
                          {blk && (
                            <span className="pill-status pill-status-review">
                              {blk.programs?.code || ''} {blk.year_level}-{blk.section}
                            </span>
                          )}
                        </div>
                        <div className="small text-secondary mt-1 d-flex align-items-center gap-2">
                          <span>
                            Requester: <strong className="text-dark">{req.profiles?.full_name || 'Instructor'}</strong>
                          </span>
                          <span>&bull;</span>
                          <span>Submitted: {new Date(req.created_at).toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Status badge */}
                      <span className="pill-status pill-status-pending">
                        Pending Approval
                      </span>
                    </div>

                    {/* Comparison Details Grid */}
                    <div className="row g-3">
                      {/* Current Placement */}
                      <div className="col-12 col-md-6">
                        <div className="p-3 bg-light border rounded-4 h-100 space-y-2">
                          <div className="d-flex align-items-center justify-content-between">
                            <span className="small fw-bold text-secondary uppercase" style={{ fontSize: '11px' }}>
                              Current Published Assignment
                            </span>
                            <span className="small text-muted font-monospace">v{publishedVersion?.version_number}</span>
                          </div>
                          <div className="small text-secondary space-y-1">
                            <div>
                              <span className="text-muted">Instructor:</span>{' '}
                              <strong className="text-dark">{currentInst}</strong>
                            </div>
                            <div>
                              <span className="text-muted">Room:</span>{' '}
                              <strong className="text-dark">{currentRoom}</strong>
                            </div>
                            <div>
                              <span className="text-muted">Time:</span>{' '}
                              <strong className="text-dark">
                                {entry ? `${DAYS[entry.day_of_week]}, ${entry.start_time.slice(0, 5)} - ${entry.end_time.slice(0, 5)}` : 'N/A'}
                              </strong>
                            </div>
                            <div>
                              <span className="text-muted">Session Type:</span>{' '}
                              <span className="text-capitalize text-dark">{entry?.session_type || 'lecture'}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Proposed Changes Diff */}
                      <div className="col-12 col-md-6">
                        <div className="p-3 rounded-4 h-100 space-y-2" style={{ background: '#f5f3ff', border: '1px solid #ddd6fe' }}>
                          <div className="d-flex align-items-center justify-content-between">
                            <span className="small fw-bold text-primary uppercase" style={{ fontSize: '11px' }}>
                              Requested Alteration
                            </span>
                            <span className="badge rounded-pill text-bg-primary small" style={{ fontSize: '10px' }}>
                              PROPOSED DIFF
                            </span>
                          </div>
                          <div className="small space-y-1.5">
                            {proposed.instructor_id ? (
                              <div className="d-flex align-items-center justify-content-between text-dark">
                                <span className="text-secondary">New Instructor:</span>
                                <span className="fw-bold bg-white px-2 py-0.5 rounded border border-primary-subtle text-primary">
                                  {newInst?.full_name || proposed.instructor_id}
                                </span>
                              </div>
                            ) : (
                              <div className="text-muted">Instructor: Unchanged</div>
                            )}

                            {proposed.room_id ? (
                              <div className="d-flex align-items-center justify-content-between text-dark">
                                <span className="text-secondary">New Room:</span>
                                <span className="fw-bold bg-white px-2 py-0.5 rounded border border-primary-subtle text-primary">
                                  {newRoom?.name || proposed.room_id} ({newRoom?.room_type})
                                </span>
                              </div>
                            ) : (
                              <div className="text-muted">Room: Unchanged</div>
                            )}

                            {proposed.day_of_week !== undefined || proposed.start_time ? (
                              <div className="d-flex align-items-center justify-content-between text-dark">
                                <span className="text-secondary">New Day & Time:</span>
                                <span className="fw-bold bg-white px-2 py-0.5 rounded border border-primary-subtle text-primary">
                                  {DAYS[proposed.day_of_week ?? entry?.day_of_week ?? 0]},{' '}
                                  {(proposed.start_time || entry?.start_time || '').slice(0, 5)} -{' '}
                                  {(proposed.end_time || entry?.end_time || '').slice(0, 5)}
                                </span>
                              </div>
                            ) : (
                              <div className="text-muted">Day & Time: Unchanged</div>
                            )}

                            {proposed.session_type ? (
                              <div className="d-flex align-items-center justify-content-between text-dark">
                                <span className="text-secondary">New Type:</span>
                                <span className="text-capitalize fw-bold bg-white px-2 py-0.5 rounded border border-primary-subtle text-primary">
                                  {proposed.session_type}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Instructor's Stated Reason */}
                    <div className="p-3 bg-light border rounded-4 small">
                      <span className="fw-bold text-secondary uppercase d-block mb-1" style={{ fontSize: '11px' }}>
                        Instructor Justification
                      </span>
                      <p className="text-dark fst-italic mb-0">&ldquo;{req.reason}&rdquo;</p>
                    </div>

                    {/* Inline Conflict Engine Preview Display */}
                    {preview ? (
                      <div className="pt-2">
                        {preview.hasHardViolations ? (
                          <div className="p-3 rounded-4 bg-danger-subtle border border-danger-subtle space-y-2">
                            <div className="d-flex align-items-center justify-content-between">
                              <span className="small fw-bold text-danger">
                                Deterministic Engine: {preview.hardViolationsCount} Hard Conflict(s) Detected
                              </span>
                              <span className="badge rounded-pill text-bg-danger small">
                                APPROVAL BLOCKED
                              </span>
                            </div>

                            <p className="small text-danger mb-0">
                              This alteration causes hard constraint violations in the published schedule. Please ask the instructor to revise the requested slot.
                            </p>

                            <div className="ps-3 border-start border-danger border-2 mt-2">
                              {preview.hardViolations.map((v, idx) => (
                                <div key={idx} className="small text-danger">
                                  <span className="font-monospace fw-bold">[{v.rule}]</span> {v.message}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : preview.hasSoftViolations ? (
                          <div className="p-3 rounded-4 bg-warning-subtle border border-warning-subtle space-y-2">
                            <div className="d-flex align-items-center justify-content-between">
                              <span className="small fw-bold text-dark">
                                Zero Hard Conflicts. {preview.softViolationsCount} Soft Warning(s)
                              </span>
                              <span className="badge rounded-pill text-bg-warning small">
                                APPROVAL ALLOWED
                              </span>
                            </div>

                            <div className="ps-3 border-start border-warning border-2 mt-2">
                              {preview.softViolations.map((v, idx) => (
                                <div key={idx} className="small text-dark">
                                  <span className="font-monospace fw-bold">[{v.rule}]</span> {v.message}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 rounded-4 bg-success-subtle border border-success-subtle d-flex align-items-center justify-content-between">
                            <span className="small fw-bold text-success">
                              Deterministic Engine Verification Clean: 0 Hard Conflicts & 0 Soft Warnings
                            </span>
                            <span className="badge rounded-pill text-bg-success small">
                              READY TO PUBLISH
                            </span>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Action Bar */}
                    <div className="d-flex flex-column flex-sm-row align-items-start align-items-sm-center justify-content-between gap-2 pt-3 border-top">
                      {/* Preview Button */}
                      <button
                        onClick={() => handlePreview(req.id)}
                        disabled={isLoadingPreview}
                        className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold d-flex align-items-center gap-1.5"
                      >
                        {isLoadingPreview ? (
                          <>
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                            <span>Evaluating Engine...</span>
                          </>
                        ) : (
                          <>
                            <i className="bi bi-eye text-primary" />
                            <span>{preview ? 'Re-run Impact Preview' : 'Preview Impact'}</span>
                          </>
                        )}
                      </button>

                      {/* Decision Buttons */}
                      <div className="d-flex align-items-center gap-2">
                        {/* Reject */}
                        <button
                          onClick={() => handleOpenRejectModal(req)}
                          disabled={isProcessing}
                          className="btn btn-sm btn-outline-danger rounded-pill px-3 fw-semibold"
                        >
                          Reject
                        </button>

                        {/* Approve */}
                        <button
                          onClick={() => handleOpenApproveModal(req)}
                          disabled={isProcessing || (preview && preview.hasHardViolations)}
                          title={
                            preview?.hasHardViolations
                              ? 'Approval blocked: Hard constraint violations exist'
                              : 'Approve and publish updated schedule'
                          }
                          className="btn-ref-primary px-4 py-1.5 small"
                        >
                          Approve & Publish
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* History Tab */
        <div className="space-y-4">
          {historyRequests.length === 0 ? (
            <div className="p-12 text-center bg-slate-900/30 border border-slate-800/60 rounded-2xl">
              <p className="text-sm font-medium text-slate-400">No past alteration decisions recorded yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {historyRequests.map((req) => {
                const entry = req.schedule_entries;
                const sub = entry?.class_offerings?.subjects;
                const blk = entry?.class_offerings?.blocks;
                const proposed = (req.proposed_changes || {}) as ProposedChanges;

                return (
                  <div
                    key={req.id}
                    className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                      <div>
                        <span className="text-sm font-bold text-white">
                          {sub ? `${sub.code} — ${sub.title}` : 'Scheduled Class'}
                        </span>
                        <div className="text-xs text-slate-400 mt-0.5">
                          Requester: {req.profiles?.full_name || 'Instructor'} &bull; Submitted:{' '}
                          {new Date(req.created_at).toLocaleDateString()}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {req.status === 'approved' && (
                          <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                            Approved & Published
                          </span>
                        )}
                        {req.status === 'rejected' && (
                          <span className="pill-status pill-status-archived text-danger">
                            Rejected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="small text-secondary">
                      <span className="text-muted">Instructor Reason: </span>
                      <span className="fst-italic text-dark">&ldquo;{req.reason}&rdquo;</span>
                    </div>

                    {req.status === 'rejected' && (
                      <div className="p-3 bg-danger-subtle border border-danger-subtle rounded-3 small">
                        <span className="fw-bold text-danger d-block mb-1">Rejection Reason Provided:</span>
                        <p className="text-danger mb-0">
                          {req.rejection_reason ||
                            (req.proposed_changes as any)?.rejection_reason ||
                            'No reason specified.'}
                        </p>
                      </div>
                    )}

                    <div className="small text-muted pt-2 border-top d-flex align-items-center justify-content-between" style={{ fontSize: '11px' }}>
                      <span>Reviewed on: {req.reviewed_at ? new Date(req.reviewed_at).toLocaleString() : 'N/A'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Approve Confirmation Modal */}
      {approvingReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark bg-opacity-50 backdrop-blur-sm">
          <div className="bg-white border border-white rounded-5 w-full max-w-lg overflow-hidden shadow-2xl p-4 p-md-5 space-y-4">
            <div className="d-flex align-items-center gap-3 text-success">
              <div
                className="d-flex align-items-center justify-content-center rounded-circle"
                style={{ width: '48px', height: '48px', background: '#eefdf4', color: '#16a34a' }}
              >
                <i className="bi bi-check-circle-fill fs-4" />
              </div>
              <div>
                <h3 className="fs-5 fw-bold text-dark m-0">Confirm Alteration & Publish</h3>
                <p className="small text-secondary m-0">Atomic schedule version transition</p>
              </div>
            </div>

            <div className="p-3 rounded-4 bg-light border small text-secondary space-y-2 leading-relaxed">
              <p className="mb-2 fw-semibold text-dark">
                Approving this request will execute the following atomic database workflow:
              </p>
              <ul className="mb-0 ps-3 space-y-1 text-muted" style={{ fontSize: '12px' }}>
                <li>Create a <strong>new schedule version</strong> cloned from the currently published version.</li>
                <li>Apply the requested change directly to the target entry in the new version.</li>
                <li><strong>Immediately publish</strong> the new version and archive the previous version.</li>
                <li>Record a full before/after snapshot in the <strong>audit log</strong>.</li>
                <li>Dispatch in-app notifications and email summaries to all instructors.</li>
              </ul>
            </div>

            <div className="pt-3 d-flex align-items-center justify-content-end gap-2 border-top">
              <button
                type="button"
                onClick={() => setApprovingReq(null)}
                disabled={isProcessing}
                className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApprove}
                disabled={isProcessing}
                className="btn-ref-primary px-4 py-2"
              >
                {isProcessing ? 'Publishing Alteration...' : 'Confirm & Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectingReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark bg-opacity-50 backdrop-blur-sm">
          <div className="bg-white border border-white rounded-5 w-full max-w-lg overflow-hidden shadow-2xl p-4 p-md-5 space-y-4">
            <div className="d-flex align-items-center gap-3 text-danger">
              <div
                className="d-flex align-items-center justify-content-center rounded-circle"
                style={{ width: '48px', height: '48px', background: '#fef2f2', color: '#dc2626' }}
              >
                <i className="bi bi-x-circle-fill fs-4" />
              </div>
              <div>
                <h3 className="fs-5 fw-bold text-dark m-0">Reject Alteration Request</h3>
                <p className="small text-secondary m-0">The schedule will remain unchanged.</p>
              </div>
            </div>

            {rejectError && (
              <div className="alert alert-danger rounded-4 py-2 px-3 small border-0 shadow-sm">
                {rejectError}
              </div>
            )}

            <div>
              <label className="form-label small fw-semibold text-secondary mb-1">
                Rejection Reason <span className="text-danger">*</span>
              </label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain to the instructor why this alteration cannot be accommodated (e.g., room conflict, faculty committee overlap, department policy)..."
                className="form-control ref-form-control"
              />
            </div>

            <div className="pt-3 d-flex align-items-center justify-content-end gap-2 border-top">
              <button
                type="button"
                onClick={() => setRejectingReq(null)}
                disabled={isProcessing}
                className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                disabled={isProcessing}
                className="btn btn-sm btn-danger rounded-pill px-4 py-2 fw-semibold"
              >
                {isProcessing ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
