// src/lib/academic/sync-instructors.ts
import { createAdminClient } from '@/lib/supabase/admin';
import type { InstructorDepartmentType } from '@/types/database';

/**
 * Ensures an instructor record and default availability exist for a given active instructor profile.
 */
export async function ensureInstructorRecordForProfile(profile: {
  id: string;
  full_name?: string | null;
  department?: string | null;
}) {
  const adminClient = createAdminClient();

  const { data: existingInst } = await adminClient
    .from('instructors')
    .select('id')
    .eq('profile_id', profile.id)
    .maybeSingle();

  if (existingInst) {
    return existingInst;
  }

  const dept = (profile.department as InstructorDepartmentType) || 'BSIT';
  const { data: newInst, error: instErr } = await adminClient
    .from('instructors')
    .insert({
      profile_id: profile.id,
      full_name: profile.full_name || 'Instructor',
      employment_type: 'full_time',
      needs_lab_equipment: false,
      department: dept,
    })
    .select()
    .single();

  if (instErr || !newInst) {
    return null;
  }

  // Insert standard Monday-Saturday default availability (08:00-12:30, 13:00-20:30)
  const slots = [];
  for (let d = 1; d <= 6; d++) {
    slots.push({
      instructor_id: newInst.id,
      day_of_week: d,
      start_time: '08:00:00',
      end_time: '12:30:00',
    });
    slots.push({
      instructor_id: newInst.id,
      day_of_week: d,
      start_time: '13:00:00',
      end_time: '20:30:00',
    });
  }

  await adminClient.from('instructor_availability').insert(slots);

  return newInst;
}

/**
 * Checks all active instructor profiles and auto-provisions any missing instructors records.
 */
export async function syncActiveInstructorProfiles() {
  const adminClient = createAdminClient();

  const [{ data: activeProfiles }, { data: existingInstructors }] = await Promise.all([
    adminClient
      .from('profiles')
      .select('id, full_name, department')
      .eq('role', 'instructor')
      .eq('status', 'active'),
    adminClient.from('instructors').select('profile_id'),
  ]);

  if (!activeProfiles || !existingInstructors) return;

  const existingProfileIds = new Set(
    existingInstructors.map((i) => i.profile_id).filter(Boolean)
  );

  const missing = activeProfiles.filter((p) => !existingProfileIds.has(p.id));
  for (const m of missing) {
    await ensureInstructorRecordForProfile(m);
  }
}
