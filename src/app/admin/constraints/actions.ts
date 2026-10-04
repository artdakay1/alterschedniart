// src/app/admin/constraints/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  fixedConstraintSchema,
  type FixedConstraintInput,
} from '@/lib/validators/academic';
import type { FixedConstraint } from '@/types/database';

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

  if (!profile || profile.status !== 'active') {
    throw new Error('Unauthorized: Active account required.');
  }

  // Strict check: Only active admin can write to fixed constraints!
  // Schedulers can ONLY read!
  if (profile.role !== 'admin') {
    throw new Error(
      'Unauthorized Security Exception: Schedulers only have read-only access to fixed constraints. Modification requires administrator privileges.'
    );
  }

  return { supabase, user };
}

export async function saveFixedConstraintAction(
  id: string | null,
  rawInput: FixedConstraintInput
) {
  const { supabase, user } = await assertAdminCaller();

  const parsed = fixedConstraintSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid constraint data.');
  }
  const data = parsed.data;

  const formattedStartTime =
    data.start_time.length === 5 ? `${data.start_time}:00` : data.start_time;
  const formattedEndTime =
    data.end_time.length === 5 ? `${data.end_time}:00` : data.end_time;

  let before: Partial<FixedConstraint> | null = null;
  let constraintId = id;

  const payload = {
    term_id: data.term_id,
    room_id: data.room_id ? data.room_id : null,
    label: data.label,
    source: data.source,
    day_of_week: data.day_of_week,
    start_time: formattedStartTime,
    end_time: formattedEndTime,
  };

  if (id) {
    const { data: existing } = await supabase
      .from('fixed_constraints')
      .select('*')
      .eq('id', id)
      .single();
    before = existing;

    const { error } = await supabase
      .from('fixed_constraints')
      .update(payload)
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to update fixed constraint: ${error.message}`);
    }
  } else {
    const { data: created, error } = await supabase
      .from('fixed_constraints')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create fixed constraint: ${error.message}`);
    }
    constraintId = created.id;
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: id ? 'UPDATE_FIXED_CONSTRAINT' : 'CREATE_FIXED_CONSTRAINT',
    entity_type: 'fixed_constraints',
    entity_id: constraintId,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: JSON.parse(JSON.stringify(payload)),
  });

  revalidatePath('/admin/constraints');
  revalidatePath('/scheduler/constraints');
}

export async function deleteFixedConstraintAction(id: string) {
  const { supabase, user } = await assertAdminCaller();

  const { data: before } = await supabase
    .from('fixed_constraints')
    .select('*')
    .eq('id', id)
    .single();

  if (!before) throw new Error('Fixed constraint not found.');

  const { error } = await supabase
    .from('fixed_constraints')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete fixed constraint: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_FIXED_CONSTRAINT',
    entity_type: 'fixed_constraints',
    entity_id: id,
    before: JSON.parse(JSON.stringify(before)),
    after: null,
  });

  revalidatePath('/admin/constraints');
  revalidatePath('/scheduler/constraints');
}
