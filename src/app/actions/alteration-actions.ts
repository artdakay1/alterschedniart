// src/app/actions/alteration-actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  previewAlterationImpact,
  type ProposedChanges,
  type AlterationPreviewResult,
} from '@/lib/alterations/preview';
import {
  executeSubmitAlteration,
  executeApproveAlteration,
  executeRejectAlteration,
  type SubmitAlterationServiceInput,
} from '@/lib/alterations/alteration-service';
import type { Profile } from '@/types/database';

async function assertAuthenticatedActiveUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, status, email, full_name')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active') {
    throw new Error('Unauthorized: User profile is inactive or missing.');
  }

  return { supabase, user, profile: profile as Profile };
}

async function assertApproverCaller() {
  const { supabase, user, profile } = await assertAuthenticatedActiveUser();

  if (profile.role !== 'scheduler' && profile.role !== 'admin') {
    throw new Error('Unauthorized: Only schedulers or administrators can approve or reject alteration requests.');
  }

  return { supabase, user, profile };
}

export type SubmitAlterationInput = SubmitAlterationServiceInput;

/**
 * Submits an alteration request proposing changes to a published schedule entry.
 */
export async function submitAlterationRequestAction(input: SubmitAlterationInput) {
  const { user, profile } = await assertAuthenticatedActiveUser();
  const adminClient = createAdminClient();

  const result = await executeSubmitAlteration(
    adminClient,
    { id: user.id, role: profile.role, email: profile.email, full_name: profile.full_name },
    input
  );

  revalidatePath('/instructor/alterations');
  revalidatePath('/scheduler/alterations');
  revalidatePath('/admin/alterations');

  return result;
}

/**
 * Previews the engine impact for an alteration request (server-side, calling checkSchedule).
 */
export async function previewAlterationAction(requestId: string): Promise<AlterationPreviewResult> {
  await assertAuthenticatedActiveUser();
  const adminClient = createAdminClient();

  return await previewAlterationImpact(adminClient, requestId);
}

/**
 * Approves an alteration request:
 * 1. Checks that conflict preview has 0 hard violations.
 * 2. Clones published entries into a new schedule_version with the proposed changes applied.
 * 3. Immediately publishes the new version, archives previous published version.
 * 4. Updates alteration_request to 'approved'.
 * 5. Logs to audit_log (before/after snapshot).
 * 6. Dispatches notifications to instructors.
 */
export async function approveAlterationAction(requestId: string) {
  const { user, profile } = await assertApproverCaller();
  const adminClient = createAdminClient();

  const result = await executeApproveAlteration(
    adminClient,
    { id: user.id, role: profile.role, email: profile.email, full_name: profile.full_name },
    requestId
  );

  revalidatePath('/scheduler/alterations');
  revalidatePath('/admin/alterations');
  revalidatePath('/instructor/alterations');
  revalidatePath('/instructor');
  revalidatePath('/scheduler/schedule');

  return result;
}

/**
 * Rejects an alteration request:
 * 1. Requires short rejection reason.
 * 2. Updates alteration_requests status to 'rejected', reviewed_by, reviewed_at, rejection_reason.
 * 3. Writes to audit_log.
 * 4. Notifies the requesting instructor (in-app + email).
 * 5. Does NOT touch schedule_entries.
 */
export async function rejectAlterationAction(requestId: string, rejectionReason: string) {
  const { user, profile } = await assertApproverCaller();
  const adminClient = createAdminClient();

  const result = await executeRejectAlteration(
    adminClient,
    { id: user.id, role: profile.role, email: profile.email, full_name: profile.full_name },
    requestId,
    rejectionReason
  );

  revalidatePath('/scheduler/alterations');
  revalidatePath('/admin/alterations');
  revalidatePath('/instructor/alterations');

  return result;
}
