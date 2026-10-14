'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { UserRole, UserStatus } from '@/types/database';
import { ensureInstructorRecordForProfile } from '@/lib/academic/sync-instructors';

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

  // Auto-sync instructor record if user has instructor role
  if (beforeUser.role === 'instructor') {
    try {
      await ensureInstructorRecordForProfile(beforeUser);
    } catch (e) {
      console.error('Failed to provision instructor record for approved user:', e);
    }
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
  revalidatePath('/admin/instructors');
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

  if (newRole === 'instructor') {
    try {
      await ensureInstructorRecordForProfile(beforeUser);
    } catch (e) {
      console.error('Failed to provision instructor record for role update:', e);
    }
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
  revalidatePath('/admin/instructors');
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

/**
 * Assigns a department (BSIT or High School) to a scheduler.
 */
export async function updateSchedulerDepartmentAction(
  userId: string,
  department: 'BSIT' | 'High School' | null
) {
  const { supabase, adminUser } = await assertActiveAdmin();
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const adminClient = createAdminClient();

  // 1. Fetch user to verify they are a scheduler
  const { data: targetProfile, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchErr || !targetProfile) {
    throw new Error('Target user not found.');
  }

  if (targetProfile.role !== 'scheduler') {
    throw new Error('Department assignment is only applicable to users with the Scheduler role.');
  }

  // 2. Update user_metadata via Auth Admin API (stores instantly and synced with sessions)
  const { data: authUser, error: authErr } = await adminClient.auth.admin.getUserById(userId);
  if (authErr) {
    throw new Error(`Auth lookup failed: ${authErr.message}`);
  }

  const existingMeta = authUser.user.user_metadata || {};
  const updatedMeta = {
    ...existingMeta,
    department: department,
  };

  const { error: updateAuthErr } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: updatedMeta,
  });

  if (updateAuthErr) {
    throw new Error(`Failed to update scheduler department in auth metadata: ${updateAuthErr.message}`);
  }

  // 3. Best-effort update on profiles table column if present
  try {
    await (adminClient.from('profiles') as any)
      .update({ department: department })
      .eq('id', userId);
  } catch {
    // Ignore if column not yet added to DB
  }

  // 4. Log to audit_log
  await supabase.from('audit_log').insert({
    actor_id: adminUser.id,
    action: 'UPDATE_SCHEDULER_DEPARTMENT',
    entity_type: 'profiles',
    entity_id: userId,
    before: { department: existingMeta.department || null },
    after: { department },
  });

  revalidatePath('/admin/users');
  revalidatePath('/scheduler');
  revalidatePath('/scheduler/schedule');
}

/**
 * Configures specific allowed subjects for a department scheduler.
 * Pass null or empty array to reset to default department supervision.
 */
export async function updateSchedulerAllowedSubjectsAction(
  userId: string,
  allowedSubjectIds: string[] | null
) {
  const { supabase, adminUser } = await assertActiveAdmin();
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const adminClient = createAdminClient();

  const { data: targetProfile, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchErr || !targetProfile) {
    throw new Error('Target user not found.');
  }

  if (targetProfile.role !== 'scheduler') {
    throw new Error('Subject scope assignment is only applicable to users with the Scheduler role.');
  }

  // 1. Update user_metadata via Auth Admin API
  const { data: authUser, error: authErr } = await adminClient.auth.admin.getUserById(userId);
  if (authErr) {
    throw new Error(`Auth lookup failed: ${authErr.message}`);
  }

  const existingMeta = authUser.user.user_metadata || {};
  const updatedMeta = {
    ...existingMeta,
    allowed_subject_ids: allowedSubjectIds,
  };

  const { error: updateAuthErr } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: updatedMeta,
  });

  if (updateAuthErr) {
    throw new Error(`Failed to update allowed subjects in auth metadata: ${updateAuthErr.message}`);
  }

  // 2. Best-effort sync with scheduler_allowed_subjects table if present
  try {
    await (adminClient as any)
      .from('scheduler_allowed_subjects')
      .delete()
      .eq('profile_id', userId);

    if (allowedSubjectIds && allowedSubjectIds.length > 0) {
      const rows = allowedSubjectIds.map((subId) => ({
        profile_id: userId,
        subject_id: subId,
      }));
      await (adminClient as any).from('scheduler_allowed_subjects').insert(rows);
    }
  } catch {
    // Ignore if table is not yet migrated in remote DB
  }

  // 3. Log to audit_log
  await supabase.from('audit_log').insert({
    actor_id: adminUser.id,
    action: 'UPDATE_SCHEDULER_ALLOWED_SUBJECTS',
    entity_type: 'profiles',
    entity_id: userId,
    before: { allowed_subject_ids: existingMeta.allowed_subject_ids || null },
    after: { allowed_subject_ids: allowedSubjectIds },
  });

  revalidatePath('/admin/users');
  revalidatePath('/scheduler');
  revalidatePath('/scheduler/schedule');
}

