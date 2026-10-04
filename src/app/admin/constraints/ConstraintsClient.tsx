// src/app/admin/constraints/ConstraintsClient.tsx
'use client';

import React, { useState, useTransition } from 'react';
import type { FixedConstraint, AcademicTerm, Room } from '@/types/database';
import { DataTable, type Column } from '@/components/DataTable';
import { FormModal } from '@/components/FormModal';
import {
  saveFixedConstraintAction,
  deleteFixedConstraintAction,
} from './actions';
import type { FixedConstraintInput } from '@/lib/validators/academic';

interface ConstraintsClientProps {
  constraints: (FixedConstraint & { rooms?: Room | null; academic_terms?: AcademicTerm | null })[];
  terms: AcademicTerm[];
  rooms: Room[];
  isReadOnly?: boolean;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function ConstraintsClient({
  constraints,
  terms,
  rooms,
  isReadOnly = false,
}: ConstraintsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConstraint, setEditingConstraint] = useState<FixedConstraint | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  const currentTerm = terms.find((t) => t.is_current) || terms[0];

  const [formData, setFormData] = useState<FixedConstraintInput>({
    term_id: currentTerm?.id || '',
    room_id: rooms[0]?.id || '',
    label: '',
    source: 'high_school',
    day_of_week: 1,
    start_time: '08:00',
    end_time: '10:00',
  });

  const handleOpenAdd = () => {
    setEditingConstraint(null);
    setFormData({
      term_id: currentTerm?.id || terms[0]?.id || '',
      room_id: rooms[0]?.id || '',
      label: '',
      source: 'high_school',
      day_of_week: 1,
      start_time: '08:00',
      end_time: '10:00',
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: FixedConstraint) => {
    setEditingConstraint(c);
    setFormData({
      term_id: c.term_id,
      room_id: c.room_id || '',
      label: c.label,
      source: c.source,
      day_of_week: c.day_of_week,
      start_time: c.start_time.slice(0, 5),
      end_time: c.end_time.slice(0, 5),
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (formData.end_time <= formData.start_time) {
      setModalError('End time must be later than start time.');
      return;
    }

    startTransition(async () => {
      try {
        await saveFixedConstraintAction(
          editingConstraint ? editingConstraint.id : null,
          formData
        );
        setIsModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Constraint "${formData.label}" saved successfully.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to save constraint.');
      }
    });
  };

  const handleDelete = (c: FixedConstraint) => {
    if (!confirm(`Delete fixed constraint "${c.label}"?`)) return;

    startTransition(async () => {
      try {
        await deleteFixedConstraintAction(c.id);
        setBannerNotice({
          type: 'success',
          message: `Deleted constraint "${c.label}".`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete constraint.',
        });
      }
    });
  };

  const columns: Column<FixedConstraint & { rooms?: Room | null; academic_terms?: AcademicTerm | null }>[] = [
    {
      header: 'Label / Purpose',
      accessorKey: 'label',
      render: (c) => <span className="font-semibold text-white">{c.label}</span>,
    },
    {
      header: 'Source Origin',
      accessorKey: 'source',
      render: (c) => (
        <span
          className={`pill-status ${
            c.source === 'high_school'
              ? 'pill-status-pending'
              : c.source === 'non_bsit'
              ? 'pill-status-progress'
              : 'pill-status-archived'
          }`}
        >
          {c.source.replace('_', ' ')}
        </span>
      ),
    },
    {
      header: 'Reserved Room',
      render: (c) => {
        const room = rooms.find((r) => r.id === c.room_id);
        return room ? (
          <span className="fw-semibold text-dark">{room.name}</span>
        ) : (
          <span className="small text-muted">General / All Rooms</span>
        );
      },
    },
    {
      header: 'Schedule Window',
      render: (c) => (
        <div className="small font-monospace text-secondary">
          <span className="fw-bold text-dark me-1">
            {DAY_NAMES[c.day_of_week]}
          </span>
          <span>
            {c.start_time.slice(0, 5)} - {c.end_time.slice(0, 5)}
          </span>
        </div>
      ),
    },
    {
      header: 'Academic Term',
      render: (c) => {
        const term = terms.find((t) => t.id === c.term_id);
        return term ? (
          <span className="small text-muted">
            {term.school_year} ({term.semester})
          </span>
        ) : (
          <span className="small text-muted">N/A</span>
        );
      },
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

      {isReadOnly && (
        <div className="alert alert-info rounded-4 border-0 shadow-sm py-3 px-4 mb-4 small">
          <strong>Read-Only Scheduler View:</strong> Fixed constraints are pre-defined by administration (e.g. High School or institutional room blockouts) and cannot be modified from the scheduler console.
        </div>
      )}

      <DataTable
        title="Fixed External Constraints"
        description="External room and time reservations (High School, Non-BSIT departments, assemblies) that block timetable slots."
        data={constraints}
        columns={columns}
        keyExtractor={(c) => c.id}
        searchPlaceholder="Filter constraint label or source..."
        searchFilter={(c, q) =>
          c.label.toLowerCase().includes(q) || c.source.toLowerCase().includes(q)
        }
        onAdd={!isReadOnly ? handleOpenAdd : undefined}
        addLabel="Add Fixed Constraint"
        actions={
          !isReadOnly
            ? (c) => (
                <div className="d-flex align-items-center gap-2">
                  <button
                    onClick={() => handleOpenEdit(c)}
                    disabled={isPending}
                    className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={isPending}
                    className="btn btn-sm btn-outline-danger rounded-pill px-3 fw-semibold"
                  >
                    Delete
                  </button>
                </div>
              )
            : undefined
        }
      />

      {!isReadOnly && (
        <FormModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={editingConstraint ? 'Edit Fixed Constraint' : 'Create Fixed Constraint'}
          description="Register room or institutional blackouts for schedule conflict prevention."
          onSubmit={handleSubmit}
          isSubmitting={isPending}
          error={modalError}
          submitLabel={editingConstraint ? 'Save Constraint' : 'Create Constraint'}
        >
          <div className="mb-3">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Constraint Label / Reason
            </label>
            <input
              type="text"
              required
              placeholder="e.g. High School Morning Assembly"
              value={formData.label}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, label: e.target.value }))
              }
              className="form-control ref-form-control"
            />
          </div>

          <div className="row g-3 mb-3">
            <div className="col-6">
              <label className="form-label small fw-semibold text-secondary mb-1">
                Source Department
              </label>
              <select
                value={formData.source}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    source: e.target.value as 'high_school' | 'non_bsit' | 'other',
                  }))
                }
                className="form-select ref-form-control"
              >
                <option value="high_school">High School Department</option>
                <option value="non_bsit">Non-BSIT College Program</option>
                <option value="other">Institutional / Other</option>
              </select>
            </div>

            <div className="col-6">
              <label className="form-label small fw-semibold text-secondary mb-1">
                Academic Term
              </label>
              <select
                value={formData.term_id}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, term_id: e.target.value }))
                }
                className="form-select ref-form-control"
              >
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.school_year} ({t.semester}) {t.is_current ? '★' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Reserved Room
            </label>
            <select
              value={formData.room_id || ''}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, room_id: e.target.value || null }))
              }
              className="form-select ref-form-control"
            >
              <option value="">-- No specific room (General constraint) --</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.room_type}) {r.is_shared ? '[Shared]' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="row g-2 mb-2">
            <div className="col-4">
              <label className="form-label small fw-semibold text-secondary mb-1">
                Day of Week
              </label>
              <select
                value={formData.day_of_week}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    day_of_week: parseInt(e.target.value) || 0,
                  }))
                }
                className="form-select ref-form-control"
              >
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
                <option value={0}>Sunday</option>
              </select>
            </div>

            <div className="col-4">
              <label className="form-label small fw-semibold text-secondary mb-1">
                Start Time
              </label>
              <input
                type="time"
                required
                value={formData.start_time}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, start_time: e.target.value }))
                }
                className="form-control ref-form-control"
              />
            </div>

            <div className="col-4">
              <label className="form-label small fw-semibold text-secondary mb-1">
                End Time
              </label>
              <input
                type="time"
                required
                value={formData.end_time}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, end_time: e.target.value }))
                }
                className="form-control ref-form-control"
              />
            </div>
          </div>
        </FormModal>
      )}
    </div>
  );
}
