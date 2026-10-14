// src/app/admin/rooms/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { roomSchema, type RoomInput } from '@/lib/validators/academic';
import type { Room } from '@/types/database';

async function assertAdminCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active' || profile.role !== 'admin') {
    throw new Error('Unauthorized: Caller must be an active administrator.');
  }

  return { supabase, user };
}

import {
  saveRoomDepartmentsToConfig,
  removeRoomDepartmentsFromConfig,
} from '@/lib/academic/room-departments';

export async function saveRoomAction(id: string | null, rawInput: RoomInput) {
  const { supabase, user } = await assertAdminCaller();

  const parsed = roomSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid room data.');
  }
  const data = parsed.data;

  // Auto-compute is_shared: true if available for both BSIT and High School
  const isShared =
    data.allowed_departments.includes('BSIT') &&
    data.allowed_departments.includes('High School');

  let before: Partial<Room> | null = null;
  let roomId = id;

  const roomPayload: any = {
    name: data.name,
    room_type: data.room_type,
    capacity: data.capacity,
    is_shared: isShared,
  };

  if (id) {
    const { data: existing } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single();
    before = existing;

    // Try updating with allowed_departments
    let updateResult = await supabase
      .from('rooms')
      .update({
        ...roomPayload,
        allowed_departments: data.allowed_departments,
      })
      .eq('id', id);

    // If column allowed_departments doesn't exist yet on DB, fallback without it
    if (updateResult.error && updateResult.error.code === '42703') {
      updateResult = await supabase
        .from('rooms')
        .update(roomPayload)
        .eq('id', id);
    }

    if (updateResult.error) {
      if (updateResult.error.code === '23505') {
        throw new Error(`A room named "${data.name}" already exists.`);
      }
      throw new Error(`Failed to update room: ${updateResult.error.message}`);
    }
  } else {
    // Try inserting with allowed_departments
    let insertResult = await supabase
      .from('rooms')
      .insert({
        ...roomPayload,
        allowed_departments: data.allowed_departments,
      })
      .select()
      .single();

    // Fallback if column does not exist yet
    if (insertResult.error && insertResult.error.code === '42703') {
      insertResult = await supabase
        .from('rooms')
        .insert(roomPayload)
        .select()
        .single();
    }

    if (insertResult.error) {
      if (insertResult.error.code === '23505') {
        throw new Error(`A room named "${data.name}" already exists.`);
      }
      throw new Error(`Failed to create room: ${insertResult.error.message}`);
    }
    roomId = insertResult.data.id;
  }

  // Persist to room-departments config
  if (roomId) {
    await saveRoomDepartmentsToConfig(roomId, data.allowed_departments, data.name);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: id ? 'UPDATE_ROOM' : 'CREATE_ROOM',
    entity_type: 'rooms',
    entity_id: roomId,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: JSON.parse(JSON.stringify({ ...data, is_shared: isShared })),
  });

  revalidatePath('/admin/rooms');
  revalidatePath('/scheduler');
  revalidatePath('/scheduler/schedule');
}

export async function deleteRoomAction(id: string) {
  const { supabase, user } = await assertAdminCaller();

  const { data: before } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', id)
    .single();

  if (!before) throw new Error('Room not found.');

  const { error } = await supabase.from('rooms').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Cannot delete this room because active schedule entries or fixed constraints reference it.'
      );
    }
    throw new Error(`Failed to delete room: ${error.message}`);
  }

  await removeRoomDepartmentsFromConfig(id, before.name);

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_ROOM',
    entity_type: 'rooms',
    entity_id: id,
    before: JSON.parse(JSON.stringify(before)),
    after: null,
  });

  revalidatePath('/admin/rooms');
  revalidatePath('/scheduler');
  revalidatePath('/scheduler/schedule');
}
