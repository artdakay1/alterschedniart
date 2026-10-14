import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InstructorsClient, type InstructorWithDetails } from './InstructorsClient';
import type { Subject } from '@/types/database';

import { getCurriculumMetadataMap } from '@/lib/academic/curriculum-connector';
import { getInstructorDepartment } from '@/lib/academic/instructor-departments';
import { syncActiveInstructorProfiles } from '@/lib/academic/sync-instructors';

export const dynamic = 'force-dynamic';

export default async function AdminInstructorsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Ensure active instructor profiles are synced to instructors table
  try {
    await syncActiveInstructorProfiles();
  } catch (err) {
    console.error('Failed to auto-sync instructor profiles:', err);
  }

  const metadataMap = getCurriculumMetadataMap();

  const [instructorsRes, qualsRes, availRes, subjectsRes] = await Promise.all([
    supabase
      .from('instructors')
      .select('*, profiles(*)')
      .order('full_name', { ascending: true }),
    supabase.from('instructor_qualifications').select('*'),
    supabase.from('instructor_availability').select('*'),
    supabase.from('subjects').select('*').order('code', { ascending: true }),
  ]);

  if (instructorsRes.error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Instructors</h2>
        <p className="text-sm">{instructorsRes.error.message}</p>
      </div>
    );
  }

  const instructorsList: InstructorWithDetails[] = (instructorsRes.data || []).map((inst) => {
    const qualIds = (qualsRes.data || [])
      .filter((q) => q.instructor_id === inst.id)
      .map((q) => q.subject_id);

    const slots = (availRes.data || [])
      .filter((a) => a.instructor_id === inst.id)
      .map((a) => ({
        day_of_week: a.day_of_week,
        start_time: a.start_time,
        end_time: a.end_time,
      }));

    const dept = getInstructorDepartment(
      inst.id,
      (inst as any).department,
      (inst.profiles as any)?.department
    );

    return {
      ...inst,
      department: dept,
      profile: inst.profiles,
      qualifications: qualIds,
      availability: slots,
    };
  });

  return (
    <div className="space-y-4 w-100 min-w-0">
      <InstructorsClient
        instructors={instructorsList}
        allSubjects={(subjectsRes.data || []) as Subject[]}
        metadataMap={metadataMap}
      />
    </div>
  );
}
