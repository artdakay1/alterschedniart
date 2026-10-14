// src/app/admin/rooms/RoomsClient.tsx
'use client';

import React, { useState, useMemo, useTransition } from 'react';
import type { Room, RoomType, DepartmentType } from '@/types/database';
import { DataTable, type Column } from '@/components/DataTable';
import { FormModal } from '@/components/FormModal';
import { saveRoomAction, deleteRoomAction } from './actions';
import type { RoomInput } from '@/lib/validators/academic';

interface RoomsClientProps {
  rooms: Room[];
}

export function RoomsClient({ rooms }: RoomsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [departmentFilter, setDepartmentFilter] = useState<'all' | 'BSIT' | 'High School' | 'shared'>('all');
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  const [formData, setFormData] = useState<RoomInput>({
    name: '',
    room_type: 'lecture',
    capacity: 40,
    is_shared: false,
    allowed_departments: ['BSIT'],
  });

  const handleOpenAdd = () => {
    setEditingRoom(null);
    setFormData({
      name: '',
      room_type: 'lecture',
      capacity: 40,
      is_shared: false,
      allowed_departments: ['BSIT'],
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (room: Room) => {
    const depts =
      room.allowed_departments && room.allowed_departments.length > 0
        ? room.allowed_departments
        : room.is_shared
        ? ['BSIT', 'High School']
        : ['BSIT'];

    setEditingRoom(room);
    setFormData({
      name: room.name,
      room_type: room.room_type,
      capacity: room.capacity,
      is_shared: room.is_shared,
      allowed_departments: depts as ('BSIT' | 'High School')[],
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleToggleDept = (dept: 'BSIT' | 'High School') => {
    setFormData((prev) => {
      const current = prev.allowed_departments || [];
      const exists = current.includes(dept);
      let next: ('BSIT' | 'High School')[];
      if (exists) {
        next = current.filter((d) => d !== dept);
      } else {
        next = [...current, dept];
      }
      return {
        ...prev,
        allowed_departments: next,
        is_shared: next.includes('BSIT') && next.includes('High School'),
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!formData.allowed_departments || formData.allowed_departments.length === 0) {
      setModalError('Please check at least one department allowed to use this room.');
      return;
    }

    startTransition(async () => {
      try {
        await saveRoomAction(editingRoom ? editingRoom.id : null, formData);
        setIsModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Room "${formData.name}" saved successfully.`,
        });
      } catch (err: unknown) {
        setModalError(err instanceof Error ? err.message : 'Failed to save room.');
      }
    });
  };

  const handleDelete = (room: Room) => {
    if (!confirm(`Are you sure you want to delete room "${room.name}"?`)) return;

    startTransition(async () => {
      try {
        await deleteRoomAction(room.id);
        setBannerNotice({
          type: 'success',
          message: `Deleted room "${room.name}".`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete room.',
        });
      }
    });
  };

  // Department counts
  const counts = useMemo(() => {
    let bsitCount = 0;
    let hsCount = 0;
    let sharedCount = 0;

    for (const r of rooms) {
      const depts = r.allowed_departments || (r.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
      if (depts.includes('BSIT')) bsitCount++;
      if (depts.includes('High School')) hsCount++;
      if (depts.includes('BSIT') && depts.includes('High School')) sharedCount++;
    }

    return {
      all: rooms.length,
      bsit: bsitCount,
      hs: hsCount,
      shared: sharedCount,
    };
  }, [rooms]);

  // Filtered rooms based on active department tab
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      const depts = r.allowed_departments || (r.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
      if (departmentFilter === 'all') return true;
      if (departmentFilter === 'BSIT') return depts.includes('BSIT');
      if (departmentFilter === 'High School') return depts.includes('High School');
      if (departmentFilter === 'shared') return depts.includes('BSIT') && depts.includes('High School');
      return true;
    });
  }, [rooms, departmentFilter]);

  const columns: Column<Room>[] = [
    {
      header: 'Room Name',
      accessorKey: 'name',
      render: (r) => <span className="fw-bold text-dark">{r.name}</span>,
    },
    {
      header: 'Type',
      accessorKey: 'room_type',
      render: (r) => (
        <span
          className={`pill-status ${
            r.room_type === 'laboratory'
              ? 'pill-status-pending'
              : 'pill-status-progress'
          }`}
        >
          {r.room_type === 'laboratory' ? 'Computer Laboratory' : 'Lecture Room'}
        </span>
      ),
    },
    {
      header: 'Allowed Departments',
      accessorKey: 'allowed_departments',
      render: (r) => {
        const depts =
          r.allowed_departments && r.allowed_departments.length > 0
            ? r.allowed_departments
            : r.is_shared
            ? ['BSIT', 'High School']
            : ['BSIT'];
        const isBoth = depts.includes('BSIT') && depts.includes('High School');

        if (isBoth) {
          return (
            <div className="d-flex align-items-center gap-1.5 flex-wrap">
              <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle px-2 py-1 fw-bold">
                <i className="bi bi-diagram-3-fill me-1"></i>Shared
              </span>
              <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-1.5 py-0.5" style={{ fontSize: '10.5px' }}>
                BSIT
              </span>
              <span className="badge bg-success-subtle text-success border border-success-subtle px-1.5 py-0.5" style={{ fontSize: '10.5px' }}>
                High School
              </span>
            </div>
          );
        }

        if (depts.includes('High School')) {
          return (
            <span className="badge bg-success-subtle text-success border border-success-subtle px-2 py-1 fw-semibold">
              <i className="bi bi-mortarboard-fill me-1"></i>High School Exclusive
            </span>
          );
        }

        return (
          <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 fw-semibold">
            <i className="bi bi-laptop me-1"></i>BSIT Exclusive
          </span>
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

      {/* Department Filter Pills */}
      <div className="bg-white p-3 rounded-4 shadow-sm border border-light-subtle d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
        <div className="d-flex align-items-center gap-2">
          <span className="small fw-bold text-secondary text-uppercase tracking-wider">
            Filter by Department:
          </span>
          <div className="btn-group" role="group">
            <button
              type="button"
              onClick={() => setDepartmentFilter('all')}
              className={`btn btn-sm ${
                departmentFilter === 'all'
                  ? 'btn-dark'
                  : 'btn-outline-secondary'
              } rounded-pill px-3 me-1.5`}
            >
              All Rooms <span className="badge bg-light text-dark ms-1">{counts.all}</span>
            </button>
            <button
              type="button"
              onClick={() => setDepartmentFilter('BSIT')}
              className={`btn btn-sm ${
                departmentFilter === 'BSIT'
                  ? 'btn-primary'
                  : 'btn-outline-primary'
              } rounded-pill px-3 me-1.5`}
            >
              BSIT <span className="badge bg-white text-primary ms-1">{counts.bsit}</span>
            </button>
            <button
              type="button"
              onClick={() => setDepartmentFilter('High School')}
              className={`btn btn-sm ${
                departmentFilter === 'High School'
                  ? 'btn-success'
                  : 'btn-outline-success'
              } rounded-pill px-3 me-1.5`}
            >
              High School <span className="badge bg-white text-success ms-1">{counts.hs}</span>
            </button>
            <button
              type="button"
              onClick={() => setDepartmentFilter('shared')}
              className={`btn btn-sm ${
                departmentFilter === 'shared'
                  ? 'btn-warning text-dark'
                  : 'btn-outline-warning text-dark'
              } rounded-pill px-3`}
            >
              Shared Both <span className="badge bg-dark text-white ms-1">{counts.shared}</span>
            </button>
          </div>
        </div>

        <button
          onClick={handleOpenAdd}
          className="btn btn-primary rounded-pill px-4 fw-semibold shadow-sm"
        >
          <i className="bi bi-plus-circle me-1.5"></i>
          Add Room
        </button>
      </div>

      <DataTable
        title="Classrooms & Laboratories"
        description="Physical facilities allocated for lecture and computer laboratory scheduling across departments."
        data={filteredRooms}
        columns={columns}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search room name, type, or department..."
        searchFilter={(r, q) => {
          const depts = r.allowed_departments || (r.is_shared ? ['BSIT', 'High School'] : ['BSIT']);
          return (
            r.name.toLowerCase().includes(q) ||
            r.room_type.toLowerCase().includes(q) ||
            depts.some((d) => d.toLowerCase().includes(q))
          );
        }}
        onAdd={handleOpenAdd}
        addLabel="Add Room"
        actions={(r) => (
          <div className="d-flex align-items-center gap-2">
            <button
              onClick={() => handleOpenEdit(r)}
              disabled={isPending}
              className="btn btn-sm btn-light border rounded-pill px-3 shadow-sm text-dark fw-semibold"
            >
              Edit
            </button>
            <button
              onClick={() => handleDelete(r)}
              disabled={isPending}
              className="btn btn-sm btn-outline-danger rounded-pill px-3 fw-semibold"
            >
              Delete
            </button>
          </div>
        )}
      />

      <FormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRoom ? 'Edit Room' : 'Create Room'}
        description="Configure classroom or laboratory attributes and department authorization."
        onSubmit={handleSubmit}
        isSubmitting={isPending}
        error={modalError}
        submitLabel={editingRoom ? 'Save Room' : 'Create Room'}
      >
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-1">
            Room Name / Number
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Room 301 or Lab 1"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            className="form-control ref-form-control"
          />
        </div>

        <div className="row g-3 mb-3">
          <div className="col-12">
            <label className="form-label small fw-semibold text-secondary mb-1">
              Room Type
            </label>
            <select
              value={formData.room_type}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  room_type: e.target.value as RoomType,
                }))
              }
              className="form-select ref-form-control"
            >
              <option value="lecture">Lecture Room</option>
              <option value="laboratory">Computer Laboratory</option>
            </select>
          </div>
        </div>

        {/* Department Access Configuration with Check Buttons */}
        <div className="mb-3">
          <label className="form-label small fw-semibold text-secondary mb-2 d-flex justify-content-between align-items-center">
            <span>Allowed Departments</span>
            <span className="text-muted" style={{ fontSize: '11px' }}>
              Check which department(s) can schedule this room
            </span>
          </label>

          {/* Quick Preset Buttons */}
          <div className="d-flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  allowed_departments: ['BSIT'],
                  is_shared: false,
                }))
              }
              className={`btn btn-sm ${
                formData.allowed_departments?.length === 1 &&
                formData.allowed_departments.includes('BSIT')
                  ? 'btn-primary'
                  : 'btn-outline-secondary'
              } rounded-pill px-3`}
              style={{ fontSize: '11.5px' }}
            >
              BSIT Only
            </button>
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  allowed_departments: ['High School'],
                  is_shared: false,
                }))
              }
              className={`btn btn-sm ${
                formData.allowed_departments?.length === 1 &&
                formData.allowed_departments.includes('High School')
                  ? 'btn-success'
                  : 'btn-outline-secondary'
              } rounded-pill px-3`}
              style={{ fontSize: '11.5px' }}
            >
              High School Only
            </button>
            <button
              type="button"
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  allowed_departments: ['BSIT', 'High School'],
                  is_shared: true,
                }))
              }
              className={`btn btn-sm ${
                formData.allowed_departments?.includes('BSIT') &&
                formData.allowed_departments?.includes('High School')
                  ? 'btn-warning text-dark fw-bold'
                  : 'btn-outline-secondary'
              } rounded-pill px-3`}
              style={{ fontSize: '11.5px' }}
            >
              Shared (Both)
            </button>
          </div>

          {/* Individual Check Buttons / Checkboxes */}
          <div className="p-3 rounded-3 border bg-light-subtle d-flex flex-column gap-2.5">
            <div
              onClick={() => handleToggleDept('BSIT')}
              className={`form-check d-flex align-items-center justify-content-between p-2 rounded-2 border transition ${
                formData.allowed_departments?.includes('BSIT')
                  ? 'bg-primary-subtle border-primary shadow-xs'
                  : 'bg-white border-light-subtle'
              }`}
              style={{ cursor: 'pointer' }}
            >
              <div className="d-flex align-items-center gap-2">
                <input
                  type="checkbox"
                  id="dept_bsit_check"
                  checked={formData.allowed_departments?.includes('BSIT') ?? false}
                  onChange={() => handleToggleDept('BSIT')}
                  onClick={(e) => e.stopPropagation()}
                  className="form-check-input mt-0"
                  style={{ cursor: 'pointer' }}
                />
                <label
                  htmlFor="dept_bsit_check"
                  className="form-check-label small fw-semibold text-dark mb-0 cursor-pointer"
                >
                  BSIT Department
                  <div className="text-muted font-normal" style={{ fontSize: '11px' }}>
                    College degree program subjects & technical labs
                  </div>
                </label>
              </div>
              <span className="badge bg-primary text-white px-2 py-1">BSIT</span>
            </div>

            <div
              onClick={() => handleToggleDept('High School')}
              className={`form-check d-flex align-items-center justify-content-between p-2 rounded-2 border transition ${
                formData.allowed_departments?.includes('High School')
                  ? 'bg-success-subtle border-success shadow-xs'
                  : 'bg-white border-light-subtle'
              }`}
              style={{ cursor: 'pointer' }}
            >
              <div className="d-flex align-items-center gap-2">
                <input
                  type="checkbox"
                  id="dept_hs_check"
                  checked={formData.allowed_departments?.includes('High School') ?? false}
                  onChange={() => handleToggleDept('High School')}
                  onClick={(e) => e.stopPropagation()}
                  className="form-check-input mt-0"
                  style={{ cursor: 'pointer' }}
                />
                <label
                  htmlFor="dept_hs_check"
                  className="form-check-label small fw-semibold text-dark mb-0 cursor-pointer"
                >
                  High School Department
                  <div className="text-muted font-normal" style={{ fontSize: '11px' }}>
                    Junior & Senior High School (Grades 7 to 12)
                  </div>
                </label>
              </div>
              <span className="badge bg-success text-white px-2 py-1">High School</span>
            </div>
          </div>
        </div>
      </FormModal>
    </div>
  );
}
