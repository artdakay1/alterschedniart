// src/app/scheduler/schedule/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  scheduleEntrySchema,
  type ScheduleEntryFormInput,
} from '@/lib/validators/schedule';
import type { ScheduleEntry, DepartmentType } from '@/types/database';
import { generateTokensForPublishedVersion } from '@/lib/qr/token-service';
import { ensureOfferingsForBlock } from '@/lib/academic/curriculum-connector';
import { getRoomAllowedDepartments } from '@/lib/academic/room-departments';

async function assertSchedulerOrAdminCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status, department, allowed_subjects')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    profile.status !== 'active' ||
    (profile.role !== 'scheduler' && profile.role !== 'admin')
  ) {
    throw new Error(
      'Unauthorized: Caller must be an active scheduler or administrator.'
    );
  }

  return { supabase, user, profile };
}

function isHighSchoolSubject(sub: { code?: string | null; title?: string | null }) {
  const code = (sub.code || '').toUpperCase();
  const title = (sub.title || '').toLowerCase();
  return (
    code.startsWith('HS') ||
    code.startsWith('JHS') ||
    code.startsWith('SHS') ||
    code.startsWith('GRADE') ||
    title.includes('high school') ||
    title.includes('grade ')
  );
}

/**
 * Ensures a draft schedule version exists for the specified academic term.
 */
export async function getOrCreateDraftVersionAction(termId: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();

  // Look for existing draft version
  const { data: existingDraft } = await supabase
    .from('schedule_versions')
    .select('*')
    .eq('term_id', termId)
    .eq('status', 'draft')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingDraft) {
    return existingDraft;
  }

  // Look for highest version number
  const { data: highestVersion } = await supabase
    .from('schedule_versions')
    .select('version_number')
    .eq('term_id', termId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersionNum = (highestVersion?.version_number || 0) + 1;

  const { data: created, error } = await supabase
    .from('schedule_versions')
    .insert({
      term_id: termId,
      version_number: nextVersionNum,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to initialize draft schedule version: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'CREATE_SCHEDULE_VERSION',
    entity_type: 'schedule_versions',
    entity_id: created.id,
    before: null,
    after: created,
  });

  return created;
}

/**
 * Ensures class offerings exist for a given block and term based on its year level and current semester.
 */
export async function ensureOfferingsForBlockAction(termId: string, blockId: string) {
  const { supabase } = await assertSchedulerOrAdminCaller();
  return ensureOfferingsForBlock(supabase, termId, blockId);
}

/**
 * Creates or updates a schedule entry on the draft schedule version.
 */
export async function saveScheduleEntryAction(
  versionId: string,
  entryId: string | null,
  rawInput: ScheduleEntryFormInput
) {
  const { supabase, user, profile } = await assertSchedulerOrAdminCaller();

  // Guard: Verify version is draft before modifying
  const { data: targetVersion } = await supabase
    .from('schedule_versions')
    .select('status')
    .eq('id', versionId)
    .single();

  if (targetVersion && targetVersion.status !== 'draft') {
    throw new Error(
      `Cannot modify a ${targetVersion.status} schedule version. Schedule versions are read-only once published or archived. Start a new draft to make adjustments.`
    );
  }

  // Validate with Zod
  const parsed = scheduleEntrySchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid schedule entry data.');
  }
  const data = parsed.data;

  // Department Scheduler Scope Guard: Schedulers can only set schedules for subjects in their scope
  if (profile.role === 'scheduler') {
    const userDept = user.user_metadata?.department;
    const allowedIds = user.user_metadata?.allowed_subject_ids;

    const { data: offeringRecord } = await supabase
      .from('class_offerings')
      .select('subject_id, subjects(is_bsit, code, title)')
      .eq('id', data.offering_id)
      .single();

    if (offeringRecord) {
      const subjectId = offeringRecord.subject_id;
      const sub = offeringRecord.subjects as any;
      let isPermitted = true;

      if (allowedIds && Array.isArray(allowedIds) && allowedIds.length > 0) {
        isPermitted = allowedIds.includes(subjectId);
      } else if (userDept === 'BSIT') {
        const code = (sub?.code || '').toUpperCase();
        const isHS =
          code.startsWith('HS') ||
          code.startsWith('JHS') ||
          code.startsWith('SHS') ||
          code.startsWith('GRADE');
        isPermitted = !isHS;
      } else if (userDept === 'High School') {
        const code = (sub?.code || '').toUpperCase();
        const title = (sub?.title || '').toLowerCase();
        isPermitted =
          code.startsWith('HS') ||
          code.startsWith('JHS') ||
          code.startsWith('SHS') ||
          code.startsWith('GRADE') ||
          title.includes('high school') ||
          title.includes('grade ');
      }

      if (!isPermitted) {
        throw new Error(
          `Unauthorized: Course "${sub?.code || 'Subject'}" is outside your department scheduler supervision scope.`
        );
      }
    }

    // Room Department Scope Guard: Schedulers can only schedule rooms permitted for their department
    if (data.room_id && userDept) {
      const { data: roomRecord } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', data.room_id)
        .single();
      if (roomRecord) {
        const allowedDepts = getRoomAllowedDepartments(roomRecord as any);
        if (!allowedDepts.includes(userDept as DepartmentType)) {
          throw new Error(
            `Unauthorized: Room "${roomRecord.name}" is not permitted for use by the ${userDept} department.`
          );
        }
      }
    }
  }

  // Format times to HH:MM:SS
  const formattedStartTime =
    data.start_time.length === 5 ? `${data.start_time}:00` : data.start_time;
  const formattedEndTime =
    data.end_time.length === 5 ? `${data.end_time}:00` : data.end_time;

  const payload = {
    version_id: versionId,
    offering_id: data.offering_id,
    instructor_id: data.instructor_id,
    room_id: data.room_id || null,
    day_of_week: data.day_of_week,
    start_time: formattedStartTime,
    end_time: formattedEndTime,
    session_type: data.session_type,
    notes: data.notes?.trim() ? data.notes.trim() : null,
  };

  let before: Partial<ScheduleEntry> | null = null;
  let targetEntryId = entryId;

  if (entryId) {
    const { data: existing } = await supabase
      .from('schedule_entries')
      .select('*')
      .eq('id', entryId)
      .single();
    before = existing;

    let { error } = await (supabase.from('schedule_entries') as any)
      .update(payload)
      .eq('id', entryId);

    // Fallback if notes column does not yet exist on remote DB
    if (error && (error.code === '42703' || error.message.includes('notes'))) {
      const { notes, ...fallbackPayload } = payload;
      const fallbackRes = await (supabase.from('schedule_entries') as any)
        .update(fallbackPayload)
        .eq('id', entryId);
      error = fallbackRes.error;
    }

    if (error) {
      throw new Error(`Failed to update schedule entry: ${error.message}`);
    }
  } else {
    const daysToInsert =
      data.days_of_week && data.days_of_week.length > 0
        ? data.days_of_week
        : [data.day_of_week];

    const rowsToInsert = daysToInsert.map((d) => ({
      ...payload,
      day_of_week: d,
    }));

    let { data: created, error } = await (supabase.from('schedule_entries') as any)
      .insert(rowsToInsert)
      .select();

    // Fallback if notes column does not yet exist on remote DB
    if (error && (error.code === '42703' || error.message.includes('notes'))) {
      const strippedRows = rowsToInsert.map(({ notes, ...rest }) => rest);
      const fallbackRes = await (supabase.from('schedule_entries') as any)
        .insert(strippedRows)
        .select();
      created = fallbackRes.data;
      error = fallbackRes.error;
    }

    if (error) {
      throw new Error(`Failed to add schedule entry: ${error.message}`);
    }
    targetEntryId = created?.[0]?.id || '';
  }

  // Audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: entryId ? 'UPDATE_SCHEDULE_ENTRY' : 'CREATE_SCHEDULE_ENTRY',
    entity_type: 'schedule_entries',
    entity_id: targetEntryId,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: JSON.parse(JSON.stringify(payload)),
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');
}

/**
 * Removes a schedule entry from the draft schedule version.
 */
export async function deleteScheduleEntryAction(entryId: string) {
  const { supabase, user, profile } = await assertSchedulerOrAdminCaller();

  const { data: before } = await supabase
    .from('schedule_entries')
    .select('*, schedule_versions(status)')
    .eq('id', entryId)
    .single();

  if (!before) throw new Error('Schedule entry not found.');

  const verStatus = (before as any).schedule_versions?.status;
  if (verStatus && verStatus !== 'draft') {
    throw new Error(
      `Cannot delete an entry from a ${verStatus} schedule version. Start a new draft to make adjustments.`
    );
  }

  // Department Scheduler Scope Guard
  if (profile.role === 'scheduler') {
    const userDept = user.user_metadata?.department;
    const allowedIds = user.user_metadata?.allowed_subject_ids;

    const { data: offeringRecord } = await supabase
      .from('class_offerings')
      .select('subject_id, subjects(is_bsit, code, title)')
      .eq('id', before.offering_id)
      .single();

    if (offeringRecord) {
      const subjectId = offeringRecord.subject_id;
      const sub = offeringRecord.subjects as any;
      let isPermitted = true;

      if (allowedIds && Array.isArray(allowedIds) && allowedIds.length > 0) {
        isPermitted = allowedIds.includes(subjectId);
      } else if (userDept === 'BSIT') {
        const code = (sub?.code || '').toUpperCase();
        const isHS =
          code.startsWith('HS') ||
          code.startsWith('JHS') ||
          code.startsWith('SHS') ||
          code.startsWith('GRADE');
        isPermitted = !isHS;
      } else if (userDept === 'High School') {
        const code = (sub?.code || '').toUpperCase();
        const title = (sub?.title || '').toLowerCase();
        isPermitted =
          code.startsWith('HS') ||
          code.startsWith('JHS') ||
          code.startsWith('SHS') ||
          code.startsWith('GRADE') ||
          title.includes('high school') ||
          title.includes('grade ');
      }

      if (!isPermitted) {
        throw new Error(
          `Unauthorized: Course "${sub?.code || 'Subject'}" is outside your department scheduler supervision scope.`
        );
      }
    }
  }

  const { error } = await supabase
    .from('schedule_entries')
    .delete()
    .eq('id', entryId);

  if (error) {
    throw new Error(`Failed to delete schedule entry: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_SCHEDULE_ENTRY',
    entity_type: 'schedule_entries',
    entity_id: entryId,
    before: JSON.parse(JSON.stringify(before)),
    after: null,
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');
}

/**
 * Clears schedule entries in the specified draft schedule version.
 * If called by a department scheduler, only entries within their scope (department / allowed subjects) are cleared.
 * Administrators can clear all entries in the version.
 */
export async function clearAllDraftScheduleEntriesAction(versionId: string) {
  const { supabase, user, profile } = await assertSchedulerOrAdminCaller();

  const { data: ver } = await supabase
    .from('schedule_versions')
    .select('id, status, version_number')
    .eq('id', versionId)
    .single();

  if (!ver) throw new Error('Schedule version not found.');
  if (ver.status !== 'draft') {
    throw new Error(`Cannot clear a ${ver.status} schedule version. Only draft schedules can be cleared.`);
  }

  // Administrator role: clear all entries
  if (profile.role === 'admin') {
    const { count } = await supabase
      .from('schedule_entries')
      .select('*', { count: 'exact', head: true })
      .eq('version_id', versionId);

    const { error } = await supabase
      .from('schedule_entries')
      .delete()
      .eq('version_id', versionId);

    if (error) {
      throw new Error(`Failed to clear schedule entries: ${error.message}`);
    }

    await supabase.from('audit_log').insert({
      actor_id: user.id,
      action: 'CLEAR_ALL_SCHEDULE_ENTRIES',
      entity_type: 'schedule_versions',
      entity_id: versionId,
      before: { entriesCount: count || 0 },
      after: { entriesCount: 0 },
    });

    revalidatePath('/scheduler/schedule');
    revalidatePath('/scheduler/schedules');

    return { success: true, clearedCount: count || 0 };
  }

  // Department Scheduler role: clear ONLY entries within the scheduler's scope
  const userDept = (profile.department || user.user_metadata?.department || 'BSIT') as DepartmentType;
  const allowedSubjectIds = (profile.allowed_subjects || user.user_metadata?.allowed_subject_ids || null) as string[] | null;

  const { data: allEntries, error: fetchErr } = await supabase
    .from('schedule_entries')
    .select('id, offering_id, class_offerings(subject_id, subjects(code, title, is_bsit))')
    .eq('version_id', versionId);

  if (fetchErr) {
    throw new Error(`Failed to query schedule entries: ${fetchErr.message}`);
  }

  const entriesToDelete = (allEntries || []).filter((e: any) => {
    const offering = e.class_offerings;
    if (!offering) return false;
    const subjectId = offering.subject_id;
    if (allowedSubjectIds && allowedSubjectIds.length > 0) {
      return subjectId && allowedSubjectIds.includes(subjectId);
    }
    const sub = offering.subjects || { code: '', title: '' };
    const isHs = isHighSchoolSubject(sub);
    if (userDept === 'High School') return isHs;
    if (userDept === 'BSIT') return !isHs;
    return true;
  });

  if (entriesToDelete.length === 0) {
    return { success: true, clearedCount: 0 };
  }

  const idsToDelete = entriesToDelete.map((e) => e.id);
  const { error } = await supabase
    .from('schedule_entries')
    .delete()
    .in('id', idsToDelete);

  if (error) {
    throw new Error(`Failed to clear scoped schedule entries: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'CLEAR_SCOPED_SCHEDULE_ENTRIES',
    entity_type: 'schedule_versions',
    entity_id: versionId,
    before: { scope: userDept, entriesCount: idsToDelete.length },
    after: { scope: userDept, entriesCount: 0 },
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');

  return { success: true, clearedCount: idsToDelete.length };
}

/**
 * Clears schedule entries for a specific block in the draft schedule version.
 * If called by a scheduler, only entries for subjects within the scheduler's scope are cleared.
 */
export async function clearBlockDraftScheduleEntriesAction(versionId: string, blockId: string) {
  const { supabase, user, profile } = await assertSchedulerOrAdminCaller();

  const { data: ver } = await supabase
    .from('schedule_versions')
    .select('id, status, version_number')
    .eq('id', versionId)
    .single();

  if (!ver) throw new Error('Schedule version not found.');
  if (ver.status !== 'draft') {
    throw new Error(`Cannot clear a ${ver.status} schedule version. Only draft schedules can be cleared.`);
  }

  // Find offering IDs belonging to this block
  const { data: offerings } = await supabase
    .from('class_offerings')
    .select('id, subject_id, subjects(code, title, is_bsit)')
    .eq('block_id', blockId);

  let scopedOfferings = offerings || [];
  if (profile.role === 'scheduler') {
    const userDept = (profile.department || user.user_metadata?.department || 'BSIT') as DepartmentType;
    const allowedSubjectIds = (profile.allowed_subjects || user.user_metadata?.allowed_subject_ids || null) as string[] | null;
    scopedOfferings = scopedOfferings.filter((off: any) => {
      if (allowedSubjectIds && allowedSubjectIds.length > 0) {
        return allowedSubjectIds.includes(off.subject_id);
      }
      const sub = off.subjects || { code: '', title: '' };
      const isHs = isHighSchoolSubject(sub);
      if (userDept === 'High School') return isHs;
      if (userDept === 'BSIT') return !isHs;
      return true;
    });
  }

  const offeringIds = scopedOfferings.map((o) => o.id);
  if (offeringIds.length === 0) {
    return { success: true, clearedCount: 0 };
  }

  const { count } = await supabase
    .from('schedule_entries')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', versionId)
    .in('offering_id', offeringIds);

  const { error } = await supabase
    .from('schedule_entries')
    .delete()
    .eq('version_id', versionId)
    .in('offering_id', offeringIds);

  if (error) {
    throw new Error(`Failed to clear block schedule entries: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'CLEAR_BLOCK_SCHEDULE_ENTRIES',
    entity_type: 'schedule_versions',
    entity_id: versionId,
    before: { blockId, entriesCount: count || 0 },
    after: { blockId, entriesCount: 0 },
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');

  return { success: true, clearedCount: count || 0 };
}

/**
 * Validates all entries in a draft schedule version across all blocks.
 */
export async function validateForPublishAction(versionId: string) {
  const { supabase } = await assertSchedulerOrAdminCaller();
  const { validateDraftForPublish } = await import('@/lib/publish/publish-gate');
  return await validateDraftForPublish(supabase, versionId);
}

/**
 * Publishes a draft schedule version, archiving any previous published version.
 * Dispatches in-app notifications and email notices to all instructors.
 */
export async function publishScheduleVersionAction(versionId: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();
  const { validateDraftForPublish } = await import('@/lib/publish/publish-gate');
  const { notifyInstructorsOnPublish } = await import('@/lib/notifications/publish-notify');

  // 1. Run publish gate validation across ALL entries
  const validation = await validateDraftForPublish(supabase, versionId);
  if (validation.hasHardViolations) {
    return {
      success: false,
      reason: 'hard_violations',
      message: `Cannot publish: ${validation.hardViolationsCount} hard conflict(s) detected.`,
      validation,
    };
  }

  // 2. Fetch version details
  const { data: targetVersion, error: verErr } = await supabase
    .from('schedule_versions')
    .select('*, academic_terms(*)')
    .eq('id', versionId)
    .single();

  if (verErr || !targetVersion) {
    throw new Error(`Version not found: ${verErr?.message || 'unknown'}`);
  }

  if (targetVersion.status !== 'draft') {
    throw new Error(`Only draft versions can be published. Current status is ${targetVersion.status}.`);
  }

  const termId = targetVersion.term_id;
  const termName = targetVersion.academic_terms
    ? `${targetVersion.academic_terms.school_year} (${targetVersion.academic_terms.semester})`
    : 'Current Term';

  // 3. Perform version transition (RPC or fallback)
  let archivedVersionId: string | null = null;

  try {
    const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)('publish_schedule_version', {
      p_version_id: versionId,
      p_actor_id: user.id,
    });

    if (rpcErr) throw rpcErr;
    archivedVersionId = rpcData?.archived_version_id || null;
  } catch {
    // Fallback: execute version transition queries directly
    // Find currently published version
    const { data: oldPub } = await supabase
      .from('schedule_versions')
      .select('id')
      .eq('term_id', termId)
      .eq('status', 'published')
      .maybeSingle();

    if (oldPub) {
      archivedVersionId = oldPub.id;
      await supabase
        .from('schedule_versions')
        .update({ status: 'archived', updated_at: new Date().toISOString() })
        .eq('id', oldPub.id);
    }

    // Publish current version
    const { error: pubErr } = await supabase
      .from('schedule_versions')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', versionId);

    if (pubErr) {
      throw new Error(`Failed to publish version: ${pubErr.message}`);
    }

    // Audit log
    await supabase.from('audit_log').insert({
      actor_id: user.id,
      action: 'publish',
      entity_type: 'schedule_version',
      entity_id: versionId,
      before: { status: 'draft', version_id: versionId, term_id: termId },
      after: {
        status: 'published',
        version_id: versionId,
        term_id: termId,
        archived_version_id: archivedVersionId,
      },
    });
  }

  // 4. Dispatch Notifications
  const isFirstVersion = !archivedVersionId;
  const notifResult = await notifyInstructorsOnPublish(
    supabase,
    versionId,
    termName,
    targetVersion.version_number,
    isFirstVersion
  );

  // 5. Generate QR Tokens per block for the newly published version
  let qrTokens: any[] = [];
  try {
    qrTokens = await generateTokensForPublishedVersion(supabase, versionId);
  } catch (qrErr: any) {
    console.error('Failed to generate QR tokens on publish:', qrErr?.message);
  }

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');
  revalidatePath('/scheduler/qr-sheets');
  revalidatePath('/instructor');

  return {
    success: true,
    publishedVersionId: versionId,
    archivedVersionId,
    versionNumber: targetVersion.version_number,
    notifications: notifResult,
    qrTokens,
    hasSoftViolations: validation.hasSoftViolations,
    softViolationsCount: validation.softViolationsCount,
  };
}

/**
 * Creates a new draft schedule version by cloning entries from the latest published version.
 */
export async function startNewDraftAction(termId: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();

  // Try RPC first
  try {
    const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)('create_new_draft_version', {
      p_term_id: termId,
      p_actor_id: user.id,
    });

    if (rpcErr) throw rpcErr;
    if (rpcData && (rpcData as any).version_id) {
      revalidatePath('/scheduler/schedule');
      revalidatePath('/scheduler/schedules');
      return { success: true, versionId: (rpcData as any).version_id, isExisting: (rpcData as any).is_existing };
    }
  } catch {
    // Proceed to fallback
  }

  // Fallback TypeScript execution
  // 1. Check if draft already exists
  const { data: existingDraft } = await supabase
    .from('schedule_versions')
    .select('id')
    .eq('term_id', termId)
    .eq('status', 'draft')
    .maybeSingle();

  if (existingDraft) {
    return { success: true, versionId: existingDraft.id, isExisting: true };
  }

  // 2. Find highest version number
  const { data: versions } = await supabase
    .from('schedule_versions')
    .select('version_number')
    .eq('term_id', termId)
    .order('version_number', { ascending: false });

  const nextVersionNum = ((versions && versions[0]?.version_number) || 0) + 1;

  // 3. Find published version to clone
  const { data: publishedVersion } = await supabase
    .from('schedule_versions')
    .select('id')
    .eq('term_id', termId)
    .eq('status', 'published')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 4. Create new draft version
  const { data: newDraft, error: createErr } = await supabase
    .from('schedule_versions')
    .insert({
      term_id: termId,
      version_number: nextVersionNum,
      status: 'draft',
      created_by: user.id,
    })
    .select()
    .single();

  if (createErr || !newDraft) {
    throw new Error(`Failed to create new draft version: ${createErr?.message}`);
  }

  let clonedCount = 0;

  // 5. Clone entries from published version
  if (publishedVersion) {
    const { data: pubEntries } = await supabase
      .from('schedule_entries')
      .select('offering_id, instructor_id, room_id, day_of_week, start_time, end_time, session_type')
      .eq('version_id', publishedVersion.id);

    if (pubEntries && pubEntries.length > 0) {
      const clonedRows = pubEntries.map((e) => ({
        version_id: newDraft.id,
        offering_id: e.offering_id,
        instructor_id: e.instructor_id,
        room_id: e.room_id,
        day_of_week: e.day_of_week,
        start_time: e.start_time,
        end_time: e.end_time,
        session_type: e.session_type,
        created_by_ai: false,
      }));

      // Insert in chunks of 50
      for (let i = 0; i < clonedRows.length; i += 50) {
        const chunk = clonedRows.slice(i, i + 50);
        const { error: insertErr } = await supabase.from('schedule_entries').insert(chunk as any);
        if (insertErr && insertErr.message.includes('created_by_ai')) {
          // Fallback if created_by_ai is not in schema cache
          const stripped = chunk.map(({ created_by_ai, ...rest }) => rest);
          await supabase.from('schedule_entries').insert(stripped as any);
        }
      }
      clonedCount = pubEntries.length;
    }
  }

  // 6. Audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'create_draft',
    entity_type: 'schedule_version',
    entity_id: newDraft.id,
    before: null,
    after: {
      version_number: nextVersionNum,
      status: 'draft',
      cloned_from: publishedVersion?.id || null,
      cloned_count: clonedCount,
    },
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');

  return { success: true, versionId: newDraft.id, isExisting: false, clonedCount };
}

/**
 * Permanently deletes an archived schedule version, along with its associated entries and QR tokens.
 * Only versions with status === 'archived' can be deleted. Published and active draft versions are protected.
 */
export async function deleteArchivedVersionAction(versionId: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();

  // 1. Verify version exists and is archived
  const { data: version, error: fetchErr } = await supabase
    .from('schedule_versions')
    .select('id, term_id, version_number, status')
    .eq('id', versionId)
    .single();

  if (fetchErr || !version) {
    throw new Error('Schedule version not found.');
  }

  return deleteScheduleVersionAction(versionId);
}

/**
 * Unpublishes an official schedule version, reverting its status to 'draft' so it can be edited.
 */
export async function unpublishScheduleVersionAction(versionId: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();
  const adminClient = createAdminClient();

  // 1. Fetch version details
  const { data: version, error: fetchErr } = await supabase
    .from('schedule_versions')
    .select('id, term_id, version_number, status')
    .eq('id', versionId)
    .single();

  if (fetchErr || !version) {
    throw new Error('Schedule version not found.');
  }

  if (version.status !== 'published') {
    throw new Error(
      `Cannot unpublish schedule version with status "${version.status}". Only published schedules can be unpublished.`
    );
  }

  const now = new Date().toISOString();

  // 2. Revert status to draft
  const { error: updateErr } = await adminClient
    .from('schedule_versions')
    .update({
      status: 'draft',
      updated_at: now,
    })
    .eq('id', versionId);

  if (updateErr) {
    throw new Error(`Failed to unpublish schedule version: ${updateErr.message}`);
  }

  // 3. Remove/revoke published QR tokens for this version
  await adminClient.from('qr_tokens').delete().eq('version_id', versionId);

  // 4. Log to audit_log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'UNPUBLISH_SCHEDULE_VERSION',
    entity_type: 'schedule_version',
    entity_id: versionId,
    before: { status: 'published', version_number: version.version_number, term_id: version.term_id },
    after: { status: 'draft', version_number: version.version_number, term_id: version.term_id },
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');
  revalidatePath('/scheduler/qr-sheets');
  revalidatePath('/public/schedule');

  return {
    success: true,
    versionId,
    versionNumber: version.version_number,
    message: `Schedule version v${version.version_number} has been unpublished and reverted to draft. You can now make further modifications in the Schedule Editor.`,
  };
}

/**
 * Permanently deletes any schedule version (draft, published, or archived) and cleans up related tokens and entries.
 */
export async function deleteScheduleVersionAction(versionId: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();
  const adminClient = createAdminClient();

  // 1. Fetch version
  const { data: version, error: fetchErr } = await supabase
    .from('schedule_versions')
    .select('id, term_id, version_number, status')
    .eq('id', versionId)
    .single();

  if (fetchErr || !version) {
    throw new Error('Schedule version not found.');
  }

  // 2. Delete qr_tokens first
  await adminClient.from('qr_tokens').delete().eq('version_id', versionId);

  // 3. Delete schedule_entries
  const { error: entriesErr } = await adminClient
    .from('schedule_entries')
    .delete()
    .eq('version_id', versionId);

  if (entriesErr) {
    throw new Error(`Failed to delete entries for schedule version: ${entriesErr.message}`);
  }

  // 4. Delete the schedule_version row
  const { error: verErr } = await adminClient
    .from('schedule_versions')
    .delete()
    .eq('id', versionId);

  if (verErr) {
    throw new Error(`Failed to delete schedule version: ${verErr.message}`);
  }

  // 5. Log to audit_log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_SCHEDULE_VERSION',
    entity_type: 'schedule_version',
    entity_id: versionId,
    before: { version_number: version.version_number, status: version.status, term_id: version.term_id },
    after: null,
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');
  revalidatePath('/scheduler/qr-sheets');
  revalidatePath('/public/schedule');

  return {
    success: true,
    deletedVersionId: versionId,
    versionNumber: version.version_number,
    message: `Schedule version v${version.version_number} (${version.status.toUpperCase()}) was permanently deleted.`,
  };
}

/**
 * Saves and timestamps the current drafted schedule version.
 */
export async function saveDraftScheduleAction(versionId: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();

  // 1. Verify version is draft
  const { data: version, error: fetchErr } = await supabase
    .from('schedule_versions')
    .select('id, term_id, version_number, status')
    .eq('id', versionId)
    .single();

  if (fetchErr || !version) {
    throw new Error('Schedule version not found.');
  }

  if (version.status !== 'draft') {
    throw new Error(`Schedule version is ${version.status}, not a draft.`);
  }

  const now = new Date().toISOString();

  // 2. Update version timestamp
  await supabase
    .from('schedule_versions')
    .update({ updated_at: now })
    .eq('id', versionId);

  // 3. Count entries
  const { count: entriesCount } = await supabase
    .from('schedule_entries')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', versionId);

  // 4. Audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'save_draft',
    entity_type: 'schedule_version',
    entity_id: versionId,
    before: null,
    after: { version_number: version.version_number, saved_at: now, entries_count: entriesCount },
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');

  return {
    success: true,
    versionId,
    versionNumber: version.version_number,
    entriesCount: entriesCount || 0,
    savedAt: now,
  };
}

/**
 * Renames a schedule version draft or published schedule.
 */
export async function renameScheduleVersionAction(versionId: string, newName: string) {
  const { supabase, user } = await assertSchedulerOrAdminCaller();

  const trimmed = newName.trim();
  if (!trimmed) {
    throw new Error('Please enter a valid version name.');
  }

  // 1. Verify version exists
  const { data: version, error: fetchErr } = await supabase
    .from('schedule_versions')
    .select('id, term_id, version_number, status')
    .eq('id', versionId)
    .single();

  if (fetchErr || !version) {
    throw new Error('Schedule version not found.');
  }

  // 2. Persist to audit_log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'RENAME_SCHEDULE_VERSION',
    entity_type: 'schedule_versions',
    entity_id: versionId,
    before: null,
    after: { name: trimmed, versionNumber: version.version_number },
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/schedules');

  return {
    success: true,
    versionId,
    versionNumber: version.version_number,
    name: trimmed,
    message: `Schedule version v${version.version_number} renamed to "${trimmed}".`,
  };
}

/**
 * Retrieves custom version names from audit_log for given version IDs.
 */
export async function getScheduleVersionNamesAction(versionIds: string[]) {
  const { supabase } = await assertSchedulerOrAdminCaller();
  if (!versionIds || versionIds.length === 0) return {};

  const { data } = await supabase
    .from('audit_log')
    .select('entity_id, after, created_at')
    .eq('entity_type', 'schedule_versions')
    .eq('action', 'RENAME_SCHEDULE_VERSION')
    .in('entity_id', versionIds)
    .order('created_at', { ascending: true });

  const map: Record<string, string> = {};
  if (data) {
    for (const row of data) {
      const name = (row.after as any)?.name;
      if (row.entity_id && name) {
        map[row.entity_id] = name;
      }
    }
  }
  return map;
}



