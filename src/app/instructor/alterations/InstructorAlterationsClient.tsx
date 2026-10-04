'use client';

import React, { useState, useTransition } from 'react';
import {
  submitAlterationRequestAction,
  previewAlterationAction,
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

interface EnrichedEntry extends ScheduleEntry {
  class_offerings?: {
    subjects?: { code: string; title: string } | null;
    blocks?: { year_level: number; section: string; programs?: { code: string } | null } | null;
  } | null;
  rooms?: { name: string; room_type?: string } | null;
  instructors?: { full_name: string } | null;
}

interface EnrichedRequest extends AlterationRequest {
  schedule_entries?: EnrichedEntry | null;
  reviewer?: { full_name: string; email: string } | null;
}

interface InstructorAlterationsClientProps {
  currentTerm: AcademicTerm | null;
  publishedVersion: ScheduleVersion | null;
  myEntries: EnrichedEntry[];
  allInstructors: Instructor[];
  allRooms: Room[];
  initialRequests: EnrichedRequest[];
  currentUserId: string;
}

export function InstructorAlterationsClient({
  currentTerm,
  publishedVersion,
  myEntries,
  allInstructors,
  allRooms,
  initialRequests,
  currentUserId,
}: InstructorAlterationsClientProps) {
  const [requests, setRequests] = useState<EnrichedRequest[]>(initialRequests);
  const [filterTab, setFilterTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, startTransition] = useTransition();

  // Form State
  const [selectedEntryId, setSelectedEntryId] = useState<string>('');
  const [changeInstructor, setChangeInstructor] = useState(false);
  const [newInstructorId, setNewInstructorId] = useState<string>('');
  const [changeRoom, setChangeRoom] = useState(false);
  const [newRoomId, setNewRoomId] = useState<string>('');
  const [changeTime, setChangeTime] = useState(false);
  const [newDayOfWeek, setNewDayOfWeek] = useState<number>(1);
  const [newStartTime, setNewStartTime] = useState<string>('08:00');
  const [newEndTime, setNewEndTime] = useState<string>('09:30');
  const [newSessionType, setNewSessionType] = useState<'lecture' | 'lab'>('lecture');
  const [reason, setReason] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  // Preview state for the form
  const [previewResult, setPreviewResult] = useState<AlterationPreviewResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // Status banner
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const selectedEntry = myEntries.find((e) => e.id === selectedEntryId);

  const handleOpenModal = () => {
    setSelectedEntryId(myEntries.length > 0 ? myEntries[0].id : '');
    setChangeInstructor(false);
    setNewInstructorId('');
    setChangeRoom(false);
    setNewRoomId('');
    setChangeTime(false);
    setNewDayOfWeek(1);
    setNewStartTime('08:00');
    setNewEndTime('09:30');
    setNewSessionType('lecture');
    setReason('');
    setFormError(null);
    setPreviewResult(null);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedEntryId) {
      setFormError('Please select a scheduled class entry to alter.');
      return;
    }

    if (!changeInstructor && !changeRoom && !changeTime) {
      setFormError('Please enable and configure at least one proposed change (Instructor, Room, or Day/Time).');
      return;
    }

    if (changeInstructor && !newInstructorId) {
      setFormError('Please choose a replacement instructor.');
      return;
    }

    if (changeRoom && !newRoomId) {
      setFormError('Please choose a replacement room.');
      return;
    }

    if (!reason.trim()) {
      setFormError('Please enter a clear explanation/reason for this alteration request.');
      return;
    }

    const proposed: ProposedChanges = {};
    if (changeInstructor) proposed.instructor_id = newInstructorId;
    if (changeRoom) proposed.room_id = newRoomId;
    if (changeTime) {
      proposed.day_of_week = newDayOfWeek;
      proposed.start_time = newStartTime;
      proposed.end_time = newEndTime;
      proposed.session_type = newSessionType;
    }

    startTransition(async () => {
      try {
        const res = await submitAlterationRequestAction({
          entryId: selectedEntryId,
          proposedChanges: proposed,
          reason: reason.trim(),
        });

        if (res.success) {
          setIsModalOpen(false);
          setBanner({
            type: 'success',
            message: 'Alteration request submitted successfully. Schedulers will review your request shortly.',
          });

          // Optimistically insert new pending request
          const newReq: EnrichedRequest = {
            id: res.requestId,
            entry_id: selectedEntryId,
            requested_by: currentUserId,
            proposed_changes: proposed as any,
            reason: reason.trim(),
            status: 'pending',
            reviewed_by: null,
            reviewed_at: null,
            rejection_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            schedule_entries: selectedEntry,
          };
          setRequests((prev) => [newReq, ...prev]);
        }
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : 'Failed to submit alteration request.');
      }
    });
  };

  const filteredRequests = requests.filter((r) => {
    if (filterTab === 'all') return true;
    return r.status === filterTab;
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16">
      {/* Top Banner Notice */}
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

      {/* Header toolbar */}
      <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-3 pb-3 mb-4 border-bottom border-light-subtle">
        <div>
          {publishedVersion && (
            <span className="pill-status-progress">
              Published v{publishedVersion.version_number}
            </span>
          )}
        </div>

        <button
          onClick={handleOpenModal}
          disabled={!publishedVersion || myEntries.length === 0}
          className="btn-ref-primary"
        >
          <i className="bi bi-plus-lg me-1"></i>
          Request Alteration
        </button>
      </div>

      {/* Published Status Info Card */}
      {!publishedVersion ? (
        <div className="bg-white rounded-4 p-5 text-center shadow-sm border border-white">
          <p className="fw-semibold text-warning mb-1">No Published Schedule for Current Term</p>
          <p className="text-muted small mb-0">
            Alteration requests can only be submitted once the academic schedule has been published by the scheduler.
          </p>
        </div>
      ) : myEntries.length === 0 ? (
        <div className="bg-white rounded-4 p-5 text-center shadow-sm border border-white">
          <p className="fw-semibold text-dark mb-1">No Scheduled Classes Found</p>
          <p className="text-muted small mb-0">
            You do not currently have any assigned classes in Published Version v{publishedVersion.version_number}.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-4 p-3 shadow-sm border border-white d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3 text-secondary small">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="badge rounded-circle bg-success p-1"></span>
            <span>
              Current Term: <strong className="text-dark">{currentTerm ? `${currentTerm.school_year} (${currentTerm.semester})` : 'Active Term'}</strong>
            </span>
            <span className="text-muted">|</span>
            <span>
              Assigned Classes: <strong className="text-dark">{myEntries.length}</strong>
            </span>
          </div>
          <div className="text-muted small">
            Policy: Published timetables are immutable. Approved changes generate a new version automatically.
          </div>
        </div>
      )}

      {/* Tabs & Requests List */}
      <div className="mt-4">
        <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-3 mb-3">
          <div className="ref-segment-control">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`ref-segment-btn ${filterTab === tab ? 'active' : ''} text-capitalize`}
              >
                {tab} (
                {tab === 'all'
                  ? requests.length
                  : requests.filter((r) => r.status === tab).length}
                )
              </button>
            ))}
          </div>
          <div className="text-muted small">
            Showing {filteredRequests.length} request(s)
          </div>
        </div>

        {filteredRequests.length === 0 ? (
          <div className="p-5 text-center bg-white rounded-4 shadow-sm border border-white">
            <i className="bi bi-journal-text text-muted fs-1 mb-2 d-block"></i>
            <p className="fw-semibold text-dark mb-1">No alteration requests found</p>
            <p className="text-muted small mb-0">
              {filterTab === 'all'
                ? 'You have not submitted any timetable alteration requests yet.'
                : `No requests with status '${filterTab}'.`}
            </p>
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {filteredRequests.map((req) => {
              const proposed = (req.proposed_changes || {}) as ProposedChanges;
              const entry = req.schedule_entries;
              const sub = entry?.class_offerings?.subjects;
              const blk = entry?.class_offerings?.blocks;
              const oldRoom = entry?.rooms?.name || 'Assigned Room';

              const newRoom = allRooms.find((r) => r.id === proposed.room_id);
              const newInst = allInstructors.find((i) => i.id === proposed.instructor_id);

              return (
                <div
                  key={req.id}
                  className="bg-white rounded-4 shadow-sm border border-white p-4"
                >
                  <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2 border-bottom border-light pb-3 mb-3">
                    <div className="d-flex align-items-center gap-2">
                      <span className="fw-bold text-dark">
                        {sub ? `${sub.code} — ${sub.title}` : 'Scheduled Class'}
                      </span>
                      {blk && (
                        <span className="badge bg-light text-secondary border font-monospace">
                          {blk.year_level}-{blk.section}
                        </span>
                      )}
                    </div>

                    <div>
                      {req.status === 'pending' && (
                        <span className="pill-status-pending">
                          Pending Review
                        </span>
                      )}
                      {req.status === 'approved' && (
                        <span className="pill-status-progress">
                          Approved &amp; Published
                        </span>
                      )}
                      {req.status === 'rejected' && (
                        <span className="pill-status-archived text-danger">
                          Rejected
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Diff View */}
                  <div className="row g-3 small">
                    {/* Current Entry Details */}
                    <div className="col-12 col-md-6">
                      <div className="p-3 bg-light rounded-3 border border-light-subtle h-100">
                        <p className="fw-bold text-muted text-uppercase small mb-2">
                          Original Assignment
                        </p>
                        <div className="text-secondary mb-1">
                          <span className="text-muted">Day &amp; Time:</span>{' '}
                          <strong className="text-dark">
                            {entry ? `${DAYS[entry.day_of_week]}, ${entry.start_time.slice(0, 5)} - ${entry.end_time.slice(0, 5)}` : 'N/A'}
                          </strong>
                        </div>
                        <div className="text-secondary mb-1">
                          <span className="text-muted">Room:</span> <strong className="text-dark">{oldRoom}</strong>
                        </div>
                        <div className="text-secondary">
                          <span className="text-muted">Type:</span>{' '}
                          <span className="badge bg-white text-secondary border text-capitalize">{entry?.session_type || 'lecture'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Proposed Changes */}
                    <div className="col-12 col-md-6">
                      <div className="p-3 bg-light rounded-3 border border-primary border-opacity-25 h-100">
                        <p className="fw-bold text-primary text-uppercase small mb-2">
                          Proposed Alteration
                        </p>
                        {proposed.day_of_week !== undefined || proposed.start_time ? (
                          <div className="text-secondary mb-1">
                            <span className="text-muted">New Day &amp; Time:</span>{' '}
                            <strong className="text-primary">
                              {DAYS[proposed.day_of_week ?? entry?.day_of_week ?? 0]},{' '}
                              {(proposed.start_time || entry?.start_time || '').slice(0, 5)} -{' '}
                              {(proposed.end_time || entry?.end_time || '').slice(0, 5)}
                            </strong>
                          </div>
                        ) : null}

                        {proposed.room_id ? (
                          <div className="text-secondary mb-1">
                            <span className="text-muted">New Room:</span>{' '}
                            <strong className="text-primary">{newRoom?.name || proposed.room_id}</strong>
                          </div>
                        ) : null}

                        {proposed.instructor_id ? (
                          <div className="text-secondary mb-1">
                            <span className="text-muted">New Instructor:</span>{' '}
                            <strong className="text-primary">{newInst?.full_name || proposed.instructor_id}</strong>
                          </div>
                        ) : null}

                        {proposed.session_type ? (
                          <div className="text-secondary">
                            <span className="text-muted">Session Type:</span>{' '}
                            <span className="badge bg-primary-subtle text-primary border text-capitalize">{proposed.session_type}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="p-3 bg-light rounded-3 border border-light-subtle mt-3 small">
                    <span className="text-muted fw-semibold">Justification: </span>
                    <span className="text-dark fst-italic">&ldquo;{req.reason}&rdquo;</span>
                  </div>

                  {/* Reviewer Note / Rejection Reason */}
                  {req.status === 'rejected' && (
                    <div className="p-3 bg-danger-subtle border border-danger-subtle rounded-3 text-danger small mt-2">
                      <span className="fw-bold">Reviewer Rejection Note: </span>
                      <span>
                        {req.rejection_reason ||
                          (req.proposed_changes as any)?.rejection_reason ||
                          'No reason specified.'}
                      </span>
                    </div>
                  )}

                  {/* Footer metadata */}
                  <div className="d-flex align-items-center justify-content-between small text-muted pt-3 mt-3 border-top border-light">
                    <span>Submitted: {new Date(req.created_at).toLocaleDateString()}</span>
                    {req.reviewed_at && (
                      <span>
                        Reviewed on: {new Date(req.reviewed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Request Form Modal */}
      {isModalOpen && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)', backdropFilter: 'blur(4px)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content border-0 shadow-lg rounded-5 p-3">
              <div className="modal-header border-0 pb-2">
                <div>
                  <h5 className="modal-title fw-bold text-dark">Propose Schedule Alteration</h5>
                  <p className="text-muted small mb-0">Select your class and configure the requested modification.</p>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setIsModalOpen(false)}
                ></button>
              </div>

              {formError && (
                <div className="alert alert-danger mx-3 py-2 small mb-3">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="modal-body pt-1">
                  {/* Step 1: Select Target Entry */}
                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary">
                      Select Scheduled Class <span className="text-danger">*</span>
                    </label>
                    <select
                      value={selectedEntryId}
                      onChange={(e) => setSelectedEntryId(e.target.value)}
                      className="form-select ref-form-control"
                    >
                      {myEntries.map((e) => {
                        const s = e.class_offerings?.subjects;
                        const b = e.class_offerings?.blocks;
                        return (
                          <option key={e.id} value={e.id}>
                            {s ? `${s.code} - ${s.title}` : 'Class'} ({b ? `${b.year_level}-${b.section}` : 'Block'}) —{' '}
                            {DAYS[e.day_of_week]} {e.start_time.slice(0, 5)}-{e.end_time.slice(0, 5)} [{e.rooms?.name || 'Room'}]
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Current Details Snapshot */}
                  {selectedEntry && (
                    <div className="p-3 bg-light rounded-4 border border-light-subtle small mb-4">
                      <span className="text-uppercase fw-bold text-muted small d-block mb-1">
                        Current Placement
                      </span>
                      <div className="d-flex flex-wrap gap-3">
                        <span>
                          Day &amp; Time:{' '}
                          <strong className="text-dark">
                            {DAYS[selectedEntry.day_of_week]}, {selectedEntry.start_time.slice(0, 5)} -{' '}
                            {selectedEntry.end_time.slice(0, 5)}
                          </strong>
                        </span>
                        <span>
                          Room: <strong className="text-dark">{selectedEntry.rooms?.name || 'N/A'}</strong>
                        </span>
                        <span>
                          Type: <strong className="text-dark text-capitalize">{selectedEntry.session_type}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Proposed Changes Controls */}
                  <div className="mb-4">
                    <h6 className="fw-bold text-dark small mb-3">
                      What would you like to change? (Select at least one)
                    </h6>

                    {/* Change Room */}
                    <div className="p-3 bg-light rounded-4 border border-light-subtle mb-3">
                      <div className="form-check">
                        <input
                          id="chkRoom"
                          type="checkbox"
                          checked={changeRoom}
                          onChange={(e) => setChangeRoom(e.target.checked)}
                          className="form-check-input"
                        />
                        <label htmlFor="chkRoom" className="form-check-label fw-semibold text-dark small">
                          Change Assigned Room
                        </label>
                      </div>

                      {changeRoom && (
                        <div className="pt-2">
                          <select
                            value={newRoomId}
                            onChange={(e) => setNewRoomId(e.target.value)}
                            className="form-select ref-form-control"
                          >
                            <option value="">Select replacement room...</option>
                            {allRooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.room_type})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    {/* Change Day / Time */}
                    <div className="p-3 bg-light rounded-4 border border-light-subtle mb-3">
                      <div className="form-check mb-2">
                        <input
                          id="chkTime"
                          type="checkbox"
                          checked={changeTime}
                          onChange={(e) => setChangeTime(e.target.checked)}
                          className="form-check-input"
                        />
                        <label htmlFor="chkTime" className="form-check-label fw-semibold text-dark small">
                          Change Day or Time
                        </label>
                      </div>

                      {changeTime && (
                        <div className="row g-2 pt-1">
                          <div className="col-12 col-sm-4">
                            <label className="form-label small text-muted mb-1">New Day</label>
                            <select
                              value={newDayOfWeek}
                              onChange={(e) => setNewDayOfWeek(Number(e.target.value))}
                              className="form-select ref-form-control"
                            >
                              {DAYS.map((d, idx) => (
                                <option key={idx} value={idx}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="col-12 col-sm-4">
                            <label className="form-label small text-muted mb-1">Start Time</label>
                            <input
                              type="time"
                              value={newStartTime}
                              onChange={(e) => setNewStartTime(e.target.value)}
                              className="form-control ref-form-control"
                            />
                          </div>

                          <div className="col-12 col-sm-4">
                            <label className="form-label small text-muted mb-1">End Time</label>
                            <input
                              type="time"
                              value={newEndTime}
                              onChange={(e) => setNewEndTime(e.target.value)}
                              className="form-control ref-form-control"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Change Instructor */}
                    <div className="p-3 bg-light rounded-4 border border-light-subtle">
                      <div className="form-check">
                        <input
                          id="chkInst"
                          type="checkbox"
                          checked={changeInstructor}
                          onChange={(e) => setChangeInstructor(e.target.checked)}
                          className="form-check-input"
                        />
                        <label htmlFor="chkInst" className="form-check-label fw-semibold text-dark small">
                          Reassign Instructor
                        </label>
                      </div>

                      {changeInstructor && (
                        <div className="pt-2">
                          <select
                            value={newInstructorId}
                            onChange={(e) => setNewInstructorId(e.target.value)}
                            className="form-select ref-form-control"
                          >
                            <option value="">Select replacement instructor...</option>
                            {allInstructors.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.full_name} ({i.employment_type})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Step 3: Justification Reason */}
                  <div className="mb-3">
                    <label className="form-label small fw-semibold text-secondary">
                      Reason for Alteration <span className="text-danger">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Provide an explanation for the scheduler (e.g., room capacity inadequate for student roster, departmental schedule adjustment, medical leave replacement...)"
                      className="form-control ref-form-control"
                    />
                  </div>
                </div>

                <div className="modal-footer border-0 pt-0">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="btn-ref-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-ref-primary"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                        Submitting...
                      </>
                    ) : (
                      'Submit Alteration Request'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
