// src/lib/alterations/alteration-service.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  previewAlterationImpact,
  type ProposedChanges,
} from './preview.ts';
import { notifyInstructorsOnPublish } from '../notifications/publish-notify.ts';
import { sendEmailNotification } from '../notifications/email.ts';
import { generateTokensForPublishedVersion } from '../qr/token-service.ts';
import type {
  AlterationRequest,
  ScheduleEntry,
  ScheduleVersion,
  AcademicTerm,
} from '../../types/database.ts';

export interface SubmitAlterationServiceInput {
  entryId: string;
  proposedChanges: ProposedChanges;
  reason: string;
}

export interface UserContext {
  id: string;
  role: string;
  email?: string;
  full_name?: string;
}

/**
 * Submits an alteration request proposing changes to a published schedule entry.
 */
export async function executeSubmitAlteration(
  supabase: SupabaseClient,
  user: UserContext,
  input: SubmitAlterationServiceInput
) {
  const { entryId, proposedChanges, reason } = input;

  if (!entryId) {
    throw new Error('Target schedule entry ID is required.');
  }

  const trimmedReason = (reason || '').trim();
  if (!trimmedReason) {
    throw new Error('A reason explaining the alteration request is required.');
  }

  // Ensure at least one change is proposed
  const hasChange =
    Boolean(proposedChanges.instructor_id) ||
    Boolean(proposedChanges.room_id) ||
    proposedChanges.day_of_week !== undefined ||
    Boolean(proposedChanges.start_time) ||
    Boolean(proposedChanges.end_time) ||
    Boolean(proposedChanges.session_type);

  if (!hasChange) {
    throw new Error('At least one change (instructor, room, day, or time) must be proposed.');
  }

  // Fetch the target entry
  const { data: entryData, error: entryErr } = await supabase
    .from('schedule_entries')
    .select('*, schedule_versions(*)')
    .eq('id', entryId)
    .single();

  if (entryErr || !entryData) {
    throw new Error('Target schedule entry does not exist.');
  }

  const targetEntry = entryData as ScheduleEntry & {
    schedule_versions?: ScheduleVersion | null;
  };

  // Must belong to a published version
  if (!targetEntry.schedule_versions || targetEntry.schedule_versions.status !== 'published') {
    throw new Error('Alteration requests can only be submitted against currently published schedule versions.');
  }

  // If instructor, verify that this entry belongs to them
  if (user.role === 'instructor') {
    const { data: instData } = await supabase
      .from('instructors')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (!instData || targetEntry.instructor_id !== instData.id) {
      throw new Error('Instructors can only request alterations for their own scheduled classes.');
    }
  }

  // Insert alteration request with status 'pending'
  const insertPayload = {
    entry_id: entryId,
    requested_by: user.id,
    proposed_changes: proposedChanges as any,
    reason: trimmedReason,
    status: 'pending' as const,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('alteration_requests')
    .insert(insertPayload)
    .select('id')
    .single();

  if (insertErr || !inserted) {
    throw new Error(`Failed to submit alteration request: ${insertErr?.message || 'unknown error'}`);
  }

  // Write audit log for the submission
  try {
    await supabase.from('audit_log').insert({
      actor_id: user.id,
      action: 'request_alteration',
      entity_type: 'alteration_request',
      entity_id: inserted.id,
      before: null,
      after: {
        request_id: inserted.id,
        entry_id: entryId,
        proposed_changes: proposedChanges,
        reason: trimmedReason,
        status: 'pending',
      } as any,
    });
  } catch (auditErr: any) {
    console.error('Failed to log alteration request submission to audit_log:', auditErr?.message);
  }

  return { success: true, requestId: inserted.id };
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
export async function executeApproveAlteration(
  adminClient: SupabaseClient,
  user: UserContext,
  requestId: string
) {
  // 1. Fetch request
  const { data: reqData, error: reqErr } = await adminClient
    .from('alteration_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (reqErr || !reqData) {
    throw new Error('Alteration request not found.');
  }

  const request = reqData as AlterationRequest;
  if (request.status !== 'pending') {
    throw new Error(`Cannot approve request with status '${request.status}'. Only pending requests can be approved.`);
  }

  // 2. Run deterministic conflict engine impact preview
  const preview = await previewAlterationImpact(adminClient, requestId);

  if (preview.hasHardViolations) {
    return {
      success: false,
      blocked: true,
      error: 'Approval blocked: The proposed changes introduce hard constraint violations. Ask instructor to revise the request.',
      violations: preview.hardViolations,
    };
  }

  // 3. Find published version & term
  const targetEntry = preview.targetEntry;
  const oldVersionId = targetEntry.version_id;

  const { data: oldVersionData, error: verErr } = await adminClient
    .from('schedule_versions')
    .select('*, academic_terms(*)')
    .eq('id', oldVersionId)
    .single();

  if (verErr || !oldVersionData) {
    throw new Error('Original published schedule version not found.');
  }

  const oldVersion = oldVersionData as ScheduleVersion & { academic_terms?: AcademicTerm | null };
  const termId = oldVersion.term_id;
  const termName = oldVersion.academic_terms
    ? `${oldVersion.academic_terms.school_year} (${oldVersion.academic_terms.semester})`
    : 'Academic Term';

  // 4. Determine next version number
  const { data: versions } = await adminClient
    .from('schedule_versions')
    .select('version_number')
    .eq('term_id', termId);

  const maxVersion = versions?.reduce((max, v) => (v.version_number > max ? v.version_number : max), 0) || 0;
  const nextVersionNumber = maxVersion + 1;

  // 5. Create new version as draft first
  const now = new Date().toISOString();
  const { data: newVersion, error: newVerErr } = await adminClient
    .from('schedule_versions')
    .insert({
      term_id: termId,
      version_number: nextVersionNumber,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single();

  if (newVerErr || !newVersion) {
    throw new Error(`Failed to create new schedule version: ${newVerErr?.message || 'unknown error'}`);
  }

  // 6. Fetch all entries from the old published version
  const { data: oldEntries, error: oldEntriesErr } = await adminClient
    .from('schedule_entries')
    .select('*')
    .eq('version_id', oldVersionId);

  if (oldEntriesErr || !oldEntries) {
    throw new Error(`Failed to read entries from previous version: ${oldEntriesErr?.message || 'unknown'}`);
  }

  // 7. Prepare cloned entries, applying proposed changes to target entry
  const proposed = (request.proposed_changes || {}) as ProposedChanges;
  const clonedEntries = oldEntries.map((e) => {
    const isTarget = e.id === request.entry_id;
    return {
      version_id: newVersion.id,
      offering_id: e.offering_id,
      instructor_id: isTarget && proposed.instructor_id ? proposed.instructor_id : e.instructor_id,
      room_id: isTarget && proposed.room_id ? proposed.room_id : e.room_id,
      day_of_week: isTarget && proposed.day_of_week !== undefined ? proposed.day_of_week : e.day_of_week,
      start_time: isTarget && proposed.start_time ? proposed.start_time : e.start_time,
      end_time: isTarget && proposed.end_time ? proposed.end_time : e.end_time,
      session_type: isTarget && proposed.session_type ? proposed.session_type : e.session_type,
    };
  });

  const { data: insertedEntries, error: insErr } = await adminClient
    .from('schedule_entries')
    .insert(clonedEntries)
    .select();

  if (insErr) {
    // Clean up draft on failure
    await adminClient.from('schedule_versions').delete().eq('id', newVersion.id);
    throw new Error(`Failed to clone entries into new version: ${insErr.message}`);
  }

  // Find newly cloned target entry
  const clonedTargetEntry = insertedEntries?.find((e) => {
    const orig = oldEntries.find((o) => o.id === request.entry_id);
    return orig && e.offering_id === orig.offering_id;
  });

  // 8. Publish the new version and archive previous published version
  const { error: pubErr } = await adminClient
    .from('schedule_versions')
    .update({
      status: 'published',
      published_at: now,
      updated_at: now,
    })
    .eq('id', newVersion.id);

  if (pubErr) {
    throw new Error(`Failed to publish new version: ${pubErr.message}`);
  }

  const { error: archErr } = await adminClient
    .from('schedule_versions')
    .update({
      status: 'archived',
      updated_at: now,
    })
    .eq('id', oldVersionId);

  if (archErr) {
    console.error('Failed to archive old published version:', archErr.message);
  }

  // 9. Update alteration request status
  const { error: reqUpdateErr } = await adminClient
    .from('alteration_requests')
    .update({
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: now,
    })
    .eq('id', requestId);

  if (reqUpdateErr) {
    console.error('Failed to update alteration request status to approved:', reqUpdateErr.message);
  }

  // 10. Write to audit_log (before/after snapshot of the changed entry)
  const beforeSnapshot = {
    request_id: requestId,
    entry_id: targetEntry.id,
    instructor_id: targetEntry.instructor_id,
    room_id: targetEntry.room_id,
    day_of_week: targetEntry.day_of_week,
    start_time: targetEntry.start_time,
    end_time: targetEntry.end_time,
    session_type: targetEntry.session_type,
    version_id: oldVersionId,
    status: 'pending',
  };

  const afterSnapshot = {
    request_id: requestId,
    entry_id: clonedTargetEntry?.id || null,
    instructor_id: clonedTargetEntry?.instructor_id || proposed.instructor_id || targetEntry.instructor_id,
    room_id: clonedTargetEntry?.room_id || proposed.room_id || targetEntry.room_id,
    day_of_week: clonedTargetEntry?.day_of_week !== undefined ? clonedTargetEntry.day_of_week : (proposed.day_of_week ?? targetEntry.day_of_week),
    start_time: clonedTargetEntry?.start_time || proposed.start_time || targetEntry.start_time,
    end_time: clonedTargetEntry?.end_time || proposed.end_time || targetEntry.end_time,
    session_type: clonedTargetEntry?.session_type || proposed.session_type || targetEntry.session_type,
    version_id: newVersion.id,
    version_number: nextVersionNumber,
    status: 'approved',
    reviewed_by: user.id,
    reviewed_at: now,
  };

  try {
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      action: 'approve_alteration',
      entity_type: 'alteration_request',
      entity_id: requestId,
      before: beforeSnapshot,
      after: afterSnapshot as any,
    });
  } catch (auditErr: any) {
    console.error('Failed to insert audit_log entry for approval:', auditErr?.message);
  }

  // 11. Trigger notifications (both general publish notification + direct approval notice)
  try {
    await notifyInstructorsOnPublish(adminClient, newVersion.id, termName, nextVersionNumber, false);
  } catch (notifErr: any) {
    console.error('Failed to dispatch publish notifications:', notifErr?.message);
  }

  // Direct in-app notification to the requesting instructor
  try {
    await adminClient.from('notifications').insert({
      user_id: request.requested_by,
      title: 'Alteration Request Approved',
      body: `Your alteration request for ${termName} has been approved and published in Version ${nextVersionNumber}. The updated timetable is now live.`,
      is_read: false,
    });
  } catch (notifErr: any) {
    console.error('Failed to send approval notification to requester:', notifErr?.message);
  }

  // 12. Generate QR tokens for all blocks in the newly published version
  try {
    await generateTokensForPublishedVersion(adminClient, newVersion.id);
  } catch (qrErr: any) {
    console.error('Failed to generate QR tokens on alteration approval publish:', qrErr?.message);
  }

  return {
    success: true,
    newVersionId: newVersion.id,
    versionNumber: nextVersionNumber,
  };
}

/**
 * Rejects an alteration request:
 * 1. Requires short rejection reason.
 * 2. Updates alteration_requests status to 'rejected', reviewed_by, reviewed_at, rejection_reason.
 * 3. Writes to audit_log.
 * 4. Notifies the requesting instructor (in-app + email).
 * 5. Does NOT touch schedule_entries.
 */
export async function executeRejectAlteration(
  adminClient: SupabaseClient,
  user: UserContext,
  requestId: string,
  rejectionReason: string
) {
  const trimmedReason = (rejectionReason || '').trim();
  if (!trimmedReason) {
    throw new Error('A rejection reason is required.');
  }

  // Fetch request
  const { data: reqData, error: reqErr } = await adminClient
    .from('alteration_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (reqErr || !reqData) {
    throw new Error('Alteration request not found.');
  }

  const request = reqData as AlterationRequest;
  if (request.status !== 'pending') {
    throw new Error(`Cannot reject request with status '${request.status}'. Only pending requests can be rejected.`);
  }

  const now = new Date().toISOString();

  // Try updating with rejection_reason column
  const updatePayload: Record<string, any> = {
    status: 'rejected',
    reviewed_by: user.id,
    reviewed_at: now,
    rejection_reason: trimmedReason,
  };

  let { error: updateErr } = await adminClient
    .from('alteration_requests')
    .update(updatePayload as any)
    .eq('id', requestId);

  // Fallback: if rejection_reason column doesn't exist yet on DB, store in proposed_changes
  if (updateErr && updateErr.message?.includes('rejection_reason')) {
    const proposed = (request.proposed_changes || {}) as Record<string, any>;
    const fallbackRes = await adminClient
      .from('alteration_requests')
      .update({
        status: 'rejected',
        reviewed_by: user.id,
        reviewed_at: now,
        proposed_changes: { ...proposed, rejection_reason: trimmedReason },
      } as any)
      .eq('id', requestId);
    updateErr = fallbackRes.error;
  }

  if (updateErr) {
    throw new Error(`Failed to reject alteration request: ${updateErr.message}`);
  }

  // Write to audit_log
  try {
    await adminClient.from('audit_log').insert({
      actor_id: user.id,
      action: 'reject_alteration',
      entity_type: 'alteration_request',
      entity_id: requestId,
      before: {
        request_id: requestId,
        entry_id: request.entry_id,
        status: 'pending',
      },
      after: {
        request_id: requestId,
        entry_id: request.entry_id,
        status: 'rejected',
        rejection_reason: trimmedReason,
        reviewed_by: user.id,
        reviewed_at: now,
      } as any,
    });
  } catch (auditErr: any) {
    console.error('Failed to log rejection in audit_log:', auditErr?.message);
  }

  // In-app notification to requesting instructor
  try {
    await adminClient.from('notifications').insert({
      user_id: request.requested_by,
      title: 'Alteration Request Rejected',
      body: `Your timetable alteration request was rejected. Reason: ${trimmedReason}`,
      is_read: false,
    });
  } catch (notifErr: any) {
    console.error('Failed to send rejection in-app notification:', notifErr?.message);
  }

  // Email notification (optional, reuse existing notification service)
  try {
    const { data: requesterProfile } = await adminClient
      .from('profiles')
      .select('email, full_name')
      .eq('id', request.requested_by)
      .single();

    if (requesterProfile?.email) {
      await sendEmailNotification({
        toEmail: requesterProfile.email,
        recipientName: requesterProfile.full_name || 'Instructor',
        subject: '[AlterSched] Alteration Request Update',
        textBody: `Hello ${requesterProfile.full_name || 'Instructor'},\n\nYour timetable alteration request has been reviewed and rejected.\n\nReviewer Decision:\n${trimmedReason}\n\nIf you need to adjust your request, please submit a revised request via your Instructor Portal.\n\nThank you,\nAlterSched Academic Scheduling Team`,
      });
    }
  } catch (emailErr: any) {
    console.error('Failed to send rejection email notification:', emailErr?.message);
  }

  return { success: true };
}
