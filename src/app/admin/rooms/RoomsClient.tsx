// src/app/admin/rooms/RoomsClient.tsx
'use client';

import React, { useState, useTransition } from 'react';
import type { Room, RoomType } from '@/types/database';
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
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  const [formData, setFormData] = useState<RoomInput>({
    name: '',
    room_type: 'lecture',
    capacity: 40,
    is_shared: false,
  });

  const handleOpenAdd = () => {
    setEditingRoom(null);
    setFormData({
      name: '',
      room_type: 'lecture',
      capacity: 40,
      is_shared: false,
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (room: Room) => {
    setEditingRoom(room);
    setFormData({
      name: room.name,
      room_type: room.room_type,
      capacity: room.capacity,
      is_shared: room.is_shared,
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    startTransition(async () => {
      try {
        await saveRoomAction(editingRoom ? editingRoom.id : null, formData);
        setIsModalOpen(false);
        setBannerNotice({
          type: 'success',
          message: `Room ${formData.name} saved successfully.`,
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
          message: `Deleted room ${room.name}.`,
        });
      } catch (err: unknown) {
        setBannerNotice({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to delete room.',
        });
      }
    });
  };

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
          {r.room_type}
        </span>
      ),
    },
    {
      header: 'Department Sharing',
      accessorKey: 'is_shared',
      render: (r) =>
        r.is_shared ? (
          <span className="pill-status pill-status-archived">
            Shared with HS / External
          </span>
        ) : (
          <span className="small text-muted">BSIT Exclusive</span>
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
        title="Classrooms & Laboratories"
        description="Physical facilities available for lecture and computer laboratory scheduling."
        data={rooms}
        columns={columns}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search room name or type..."
        searchFilter={(r, q) =>
          r.name.toLowerCase().includes(q) || r.room_type.toLowerCase().includes(q)
        }
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
        description="Configure classroom or laboratory attributes and student capacity."
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

        <div className="pt-2">
          <div className="form-check">
            <input
              type="checkbox"
              id="is_shared"
              checked={formData.is_shared}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, is_shared: e.target.checked }))
              }
              className="form-check-input"
            />
            <label htmlFor="is_shared" className="form-check-label small text-secondary">
              Shared with other departments or High School (subject to fixed external constraints)
            </label>
          </div>
        </div>
      </FormModal>
    </div>
  );
}
