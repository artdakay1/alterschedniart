// src/app/admin/instructors/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  instructorProfileSchema,
  instructorAvailabilitySlotSchema,
  type InstructorProfileInput,
  type InstructorAvailabilitySlotInput,
} from '@/lib/validators/academic';
import type { Instructor } from '@/types/database';

import { saveInstructorDepartmentToConfig } from '@/lib/academic/instructor-departments';

async function getCallerProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active') {
    throw new Error('Unauthorized: Active account required.');
  }

  return { supabase, user, profile };
}

export async function updateInstructorAction(
  instructorId: string,
  rawInput: InstructorProfileInput
) {
  const { supabase, user, profile } = await getCallerProfile();

  if (profile.role !== 'admin') {
    throw new Error('Unauthorized: Only administrators can update instructor settings.');
  }

  const parsed = instructorProfileSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid instructor settings.');
  }
  const data = parsed.data;

  const { data: before } = await supabase
    .from('instructors')
    .select('*')
    .eq('id', instructorId)
    .single();

  if (!before) throw new Error('Instructor record not found.');

  // Save to local JSON config immediately
  saveInstructorDepartmentToConfig(instructorId, data.department);

  // Attempt update with department column
  let { error } = await supabase
    .from('instructors')
    .update({
      employment_type: data.employment_type,
      needs_lab_equipment: data.needs_lab_equipment,
      department: data.department,
    } as any)
    .eq('id', instructorId);

  // Fallback if department column is missing (error 42703)
  if (error && (error as any).code === '42703') {
    const fallbackRes = await supabase
      .from('instructors')
      .update({
        employment_type: data.employment_type,
        needs_lab_equipment: data.needs_lab_equipment,
      })
      .eq('id', instructorId);
    error = fallbackRes.error;
  }

  if (error) {
    throw new Error(`Failed to update instructor: ${error.message}`);
  }

  // If instructor has a profile_id and department is single, best-effort sync profile.department
  if (before.profile_id && (data.department === 'BSIT' || data.department === 'High School')) {
    try {
      await supabase
        .from('profiles')
        .update({ department: data.department })
        .eq('id', before.profile_id);
    } catch {
      // Ignore if column doesn't match
    }
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'UPDATE_INSTRUCTOR',
    entity_type: 'instructors',
    entity_id: instructorId,
    before: JSON.parse(JSON.stringify(before)),
    after: JSON.parse(JSON.stringify(data)),
  });

  revalidatePath('/admin/instructors');
}

export async function saveQualificationsAction(
  instructorId: string,
  subjectIds: string[]
) {
  const { supabase, user, profile } = await getCallerProfile();

  if (profile.role !== 'admin') {
    throw new Error('Unauthorized: Only administrators can assign teaching qualifications.');
  }

  // Get current qualifications for audit log
  const { data: currentQuals } = await supabase
    .from('instructor_qualifications')
    .select('subject_id')
    .eq('instructor_id', instructorId);

  const beforeIds = (currentQuals || []).map((q) => q.subject_id);

  // Remove existing
  await supabase
    .from('instructor_qualifications')
    .delete()
    .eq('instructor_id', instructorId);

  // Insert new if any
  if (subjectIds.length > 0) {
    const toInsert = subjectIds.map((subId) => ({
      instructor_id: instructorId,
      subject_id: subId,
    }));

    const { error: insertErr } = await supabase
      .from('instructor_qualifications')
      .insert(toInsert);

    if (insertErr) {
      throw new Error(`Failed to assign qualifications: ${insertErr.message}`);
    }
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'UPDATE_INSTRUCTOR_QUALIFICATIONS',
    entity_type: 'instructor_qualifications',
    entity_id: instructorId,
    before: { subject_ids: beforeIds },
    after: { subject_ids: subjectIds },
  });

  revalidatePath('/admin/instructors');
}

export async function saveAvailabilityAction(
  instructorId: string,
  rawSlots: InstructorAvailabilitySlotInput[]
) {
  const { supabase, user, profile } = await getCallerProfile();

  // Validate authorization: Admin can edit any; Instructor can ONLY edit their own!
  if (profile.role === 'instructor') {
    const { data: linkedInstructor } = await supabase
      .from('instructors')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    if (!linkedInstructor || linkedInstructor.id !== instructorId) {
      throw new Error(
        'Security Violation: Instructors are only authorized to update their own availability schedule.'
      );
    }
  } else if (profile.role !== 'admin') {
    throw new Error('Unauthorized: Insufficient permissions to edit availability.');
  }

  // Validate all slots with Zod
  const validatedSlots: InstructorAvailabilitySlotInput[] = [];
  for (const slot of rawSlots) {
    const parsed = instructorAvailabilitySlotSchema.safeParse(slot);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || 'Invalid availability slot format.');
    }
    validatedSlots.push(parsed.data);
  }

  // Fetch before state for audit log
  const { data: currentSlots } = await supabase
    .from('instructor_availability')
    .select('*')
    .eq('instructor_id', instructorId);

  // Replace slots
  await supabase
    .from('instructor_availability')
    .delete()
    .eq('instructor_id', instructorId);

  if (validatedSlots.length > 0) {
    const rows = validatedSlots.map((s) => ({
      instructor_id: instructorId,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    }));

    const { error } = await supabase.from('instructor_availability').insert(rows);
    if (error) {
      throw new Error(`Failed to save availability: ${error.message}`);
    }
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'UPDATE_INSTRUCTOR_AVAILABILITY',
    entity_type: 'instructor_availability',
    entity_id: instructorId,
    before: currentSlots ? JSON.parse(JSON.stringify(currentSlots)) : null,
    after: JSON.parse(JSON.stringify(validatedSlots)),
  });

  revalidatePath('/admin/instructors');
  revalidatePath('/instructor/availability');
}
