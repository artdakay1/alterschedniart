'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { UserRole, UserStatus } from '@/types/database';

/**
 * Helper to verify that the calling user is authenticated and has an active admin role.
 * Throws an error if the caller is unauthorized.
 */
async function assertActiveAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Authentication required.');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active' || profile.role !== 'admin') {
    throw new Error('Unauthorized: Caller must be an active administrator.');
  }

  return { supabase, adminUser: user };
}

/**
 * Approve a pending user (sets status to 'active').
 * Writes event to audit_log.
 */
export async function approveUserAction(userId: string) {
  const { supabase, adminUser } = await assertActiveAdmin();

  // 1. Fetch current user state for audit log
  const { data: beforeUser, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchErr || !beforeUser) {
    throw new Error('Target user not found.');
  }

  // 2. Update status to active
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ status: 'active' as UserStatus })
    .eq('id', userId);

  if (updateErr) {
    throw new Error(`Failed to approve user: ${updateErr.message}`);
  }

  // 3. Write to audit_log
  await supabase.from('audit_log').insert({
    actor_id: adminUser.id,
    action: 'APPROVE_USER',
    entity_type: 'profiles',
    entity_id: userId,
    before: { status: beforeUser.status, role: beforeUser.role },
    after: { status: 'active', role: beforeUser.role },
  });

  revalidatePath('/admin/users');
}

/**
 * Reject a pending user (sets status to 'rejected').
 * Writes event to audit_log.
 */
export async function rejectUserAction(userId: string) {
  const { supabase, adminUser } = await assertActiveAdmin();

  const { data: beforeUser, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchErr || !beforeUser) {
    throw new Error('Target user not found.');
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ status: 'rejected' as UserStatus })
    .eq('id', userId);

  if (updateErr) {
    throw new Error(`Failed to reject user: ${updateErr.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: adminUser.id,
    action: 'REJECT_USER',
    entity_type: 'profiles',
    entity_id: userId,
    before: { status: beforeUser.status },
    after: { status: 'rejected' },
  });

  revalidatePath('/admin/users');
}

/**
 * Promote an active user to scheduler or admin.
 * Writes event to audit_log.
 */
export async function updateUserRoleAction(userId: string, newRole: UserRole) {
  const { supabase, adminUser } = await assertActiveAdmin();

  const { data: beforeUser, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchErr || !beforeUser) {
    throw new Error('Target user not found.');
  }

  if (beforeUser.status !== 'active') {
    throw new Error('Only active users can have their roles updated.');
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  if (updateErr) {
    throw new Error(`Failed to update role: ${updateErr.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: adminUser.id,
    action: 'PROMOTE_USER_ROLE',
    entity_type: 'profiles',
    entity_id: userId,
    before: { role: beforeUser.role },
    after: { role: newRole },
  });

  revalidatePath('/admin/users');
}

/**
 * Disable a user (sets status to 'disabled').
 * Writes event to audit_log.
 */
export async function disableUserAction(userId: string) {
  const { supabase, adminUser } = await assertActiveAdmin();

  if (userId === adminUser.id) {
    throw new Error('Security Error: Administrators cannot disable their own account.');
  }

  const { data: beforeUser, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchErr || !beforeUser) {
    throw new Error('Target user not found.');
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ status: 'disabled' as UserStatus })
    .eq('id', userId);

  if (updateErr) {
    throw new Error(`Failed to disable user: ${updateErr.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: adminUser.id,
    action: 'DISABLE_USER',
    entity_type: 'profiles',
    entity_id: userId,
    before: { status: beforeUser.status },
    after: { status: 'disabled' },
  });

  revalidatePath('/admin/users');
}
