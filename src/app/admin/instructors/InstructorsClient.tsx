// src/app/admin/instructors/InstructorsClient.tsx
'use client';

import React, { useState, useTransition } from 'react';
import type { Instructor, Subject, Profile } from '@/types/database';
import { DataTable, type Column } from '@/components/DataTable';
import { FormModal } from '@/components/FormModal';
import { AvailabilityEditor } from '@/components/AvailabilityEditor';
import {
  updateInstructorAction,
  saveQualificationsAction,
  saveAvailabilityAction,
} from './actions';
import type {
  InstructorProfileInput,
  InstructorAvailabilitySlotInput,
} from '@/lib/validators/academic';

export type InstructorWithDetails = Instructor & {
  profile?: Profile | null;
  qualifications: string[]; // subject_ids
  availability: InstructorAvailabilitySlotInput[];
};

interface InstructorsClientProps {
  instructors: InstructorWithDetails[];
  allSubjects: Subject[];
}

export function InstructorsClient({
  instructors,
  allSubjects,
}: InstructorsClientProps) {
  const [isPending, startTransition] = useTransition();

  // Profile Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingInstructor, setEditingInstructor] = useState<InstructorWithDetails | null>(null);
  const [profileFormData, setProfileFormData] = useState<InstructorProfileInput>({
    employment_type: 'full_time',
    needs_lab_equipment: false,
  });

  // Qualifications Modal State
  const [isQualModalOpen, setIsQualModalOpen] = useState(false);
  const [qualInstructor, setQualInstructor] = useState<InstructorWithDetails | null>(null);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);

  // Availability Modal State
  const [isAvailModalOpen, setIsAvailModalOpen] = useState(false);
  const [availInstructor, setAvailInstructor] = useState<InstructorWithDetails | null>(null);

  const [modalError, setModalError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  // 1. Profile Edit Handlers
  const handleOpenEdit = (inst: InstructorWithDetails) => {
    setEditingInstructor(inst);
    setProfileFormData({
      employment_type: inst.employment_type,
      needs_lab_equipment: inst.needs_lab_equipment,
    });
    setModalError(null);
    setIsEditModalOpen(true);
  };

  const handleSubmitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInstructor) return;
    setModalError(null);

    startTransition(async () => {
      try {
        await updateInstructorAction(editingInstructor.id, profileFormData);
        setIsEditModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Settings updated for ${editingInstructor.full_name}.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to update instructor.');
      }
    });
  };

  // 2. Qualifications Handlers
  const handleOpenQualifications = (inst: InstructorWithDetails) => {
    setQualInstructor(inst);
    setSelectedSubjectIds(inst.qualifications);
    setModalError(null);
    setIsQualModalOpen(true);
  };

  const toggleSubjectSelection = (subjectId: string) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(subjectId)
        ? prev.filter((id) => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const handleSubmitQualifications = (e: React.FormEvent) => {
    e.preventDefault();
    if (!qualInstructor) return;
    setModalError(null);

    startTransition(async () => {
      try {
        await saveQualificationsAction(qualInstructor.id, selectedSubjectIds);
        setIsQualModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Updated qualifications for ${qualInstructor.full_name}.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to update qualifications.');
      }
    });
  };

  // 3. Availability Handlers
  const handleOpenAvailability = (inst: InstructorWithDetails) => {
    setAvailInstructor(inst);
    setIsAvailModalOpen(true);
  };

  const handleSaveAvailability = async (slots: InstructorAvailabilitySlotInput[]) => {
    if (!availInstructor) return;
    await saveAvailabilityAction(availInstructor.id, slots);
    setBannerNotice({
      type: 'success',
      message: `Availability updated for ${availInstructor.full_name}.`,
    });
  };

  const columns: Column<InstructorWithDetails>[] = [
    {
      header: 'Instructor Name',
      accessorKey: 'full_name',
      render: (i) => (
        <div>
          <div className="fw-bold text-dark">{i.full_name}</div>
          <div className="small text-muted font-monospace">
            {i.profile?.email || 'External'}
          </div>
        </div>
      ),
    },
    {
      header: 'Employment Type',
      accessorKey: 'employment_type',
      render: (i) => (
        <span
          className={`pill-status ${
            i.employment_type === 'full_time'
              ? 'pill-status-progress'
              : 'pill-status-pending'
          }`}
        >
          {i.employment_type.replace('_', ' ')}
        </span>
      ),
    },
    {
      header: 'Lab Equipment',
      accessorKey: 'needs_lab_equipment',
      render: (i) =>
        i.needs_lab_equipment ? (
          <span className="pill-status pill-status-review">Specialized Lab</span>
        ) : (
          <span className="small text-muted">Standard</span>
        ),
    },
    {
      header: 'Qualified Subjects',
      render: (i) => (
        <span className="small text-muted font-monospace">
          {i.qualifications.length} subjects
        </span>
      ),
    },
    {
      header: 'Availability Slots',
      render: (i) => (
        <span className="small text-muted font-monospace">
          {i.availability.length} active slots
        </span>
      ),
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

      <DataTable
        title="Department Instructors"
        description="Manage instructor profiles, teaching qualifications, and weekly availability constraints."
        data={instructors}
        columns={columns}
        keyExtractor={(i) => i.id}
        searchPlaceholder="Filter instructor name..."
        searchFilter={(i, q) =>
          i.full_name.toLowerCase().includes(q) ||
          Boolean(i.profile?.email.toLowerCase().includes(q))
        }
        actions={(i) => (
          <div className="d-flex align-items-center gap-2">
            <button
              onClick={() => handleOpenQualifications(i)}
              disabled={isPending}
              className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold"
            >
              Qualifications
            </button>
            <button
              onClick={() => handleOpenAvailability(i)}
              disabled={isPending}
              className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold"
            >
              Availability
            </button>
            <button
              onClick={() => handleOpenEdit(i)}
              disabled={isPending}
              className="btn btn-sm btn-outline-primary rounded-pill px-3 fw-semibold"
            >
              Edit
            </button>
          </div>
        )}
      />

      {/* Edit Profile Modal */}
      <FormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={`Edit ${editingInstructor?.full_name || 'Instructor'}`}
        description="Update instructor employment terms and laboratory facility requirements."
        onSubmit={handleSubmitProfile}
        isSubmitting={isPending}
        error={modalError}
        submitLabel="Save Changes"
      >
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Employment Type
          </label>
          <select
            value={profileFormData.employment_type}
            onChange={(e) =>
              setProfileFormData((prev) => ({
                ...prev,
                employment_type: e.target.value as 'full_time' | 'part_time',
              }))
            }
            className="form-select ref-form-control"
          >
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
          </select>
        </div>

        <div className="pt-2">
          <div className="form-check">
            <input
              type="checkbox"
              id="needs_lab_equipment"
              checked={profileFormData.needs_lab_equipment}
              onChange={(e) =>
                setProfileFormData((prev) => ({
                  ...prev,
                  needs_lab_equipment: e.target.checked,
                }))
              }
              className="form-check-input"
            />
            <label htmlFor="needs_lab_equipment" className="form-check-label small text-secondary">
              Instructor requires specialized computer laboratory workstation equipment
            </label>
          </div>
        </div>
      </FormModal>

      {/* Qualifications Modal */}
      <FormModal
        isOpen={isQualModalOpen}
        onClose={() => setIsQualModalOpen(false)}
        title={`Teaching Qualifications: ${qualInstructor?.full_name || ''}`}
        description="Select the curriculum subjects this instructor is certified and qualified to teach."
        onSubmit={handleSubmitQualifications}
        isSubmitting={isPending}
        error={modalError}
        submitLabel="Save Qualifications"
      >
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {allSubjects.map((sub) => {
            const isChecked = selectedSubjectIds.includes(sub.id);
            return (
              <label
                key={sub.id}
                className={`d-flex align-items-center justify-content-between p-3 rounded-4 border text-xs cursor-pointer transition ${
                  isChecked
                    ? 'bg-light border-primary'
                    : 'bg-white border-light-subtle'
                }`}
              >
                <div>
                  <span className="fw-bold me-2 text-primary">{sub.code}</span>
                  <span className="text-secondary">{sub.title}</span>
                </div>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleSubjectSelection(sub.id)}
                  className="form-check-input"
                />
              </label>
            );
          })}
        </div>
      </FormModal>

      {/* Availability Modal / Drawer */}
      {isAvailModalOpen && availInstructor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div
            className="fixed inset-0 bg-dark bg-opacity-50 backdrop-blur-sm"
            onClick={() => setIsAvailModalOpen(false)}
          />
          <div className="relative w-full max-w-4xl bg-white rounded-5 shadow-2xl p-6 z-10 max-h-[90vh] overflow-y-auto border border-white">
            <div className="d-flex align-items-center justify-between pb-3 border-bottom mb-4">
              <div>
                <h2 className="fs-5 fw-bold text-dark m-0">
                  Availability Matrix: {availInstructor.full_name}
                </h2>
                <p className="small text-secondary m-0 mt-1">
                  Configure recurring weekly time preferences for scheduling.
                </p>
              </div>
              <button
                onClick={() => setIsAvailModalOpen(false)}
                className="btn btn-sm btn-light rounded-circle p-2"
              >
                ✕
              </button>
            </div>

            <AvailabilityEditor
              instructorId={availInstructor.id}
              instructorName={availInstructor.full_name}
              initialSlots={availInstructor.availability}
              onSave={handleSaveAvailability}
            />
          </div>
        </div>
      )}
    </div>
  );
}
