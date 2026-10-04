// src/app/instructor/alterations/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InstructorAlterationsClient } from './InstructorAlterationsClient';
import type {
  AcademicTerm,
  ScheduleVersion,
  Room,
  Instructor,
} from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function InstructorAlterationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Fetch current academic term
  const { data: termData } = await supabase
    .from('academic_terms')
    .select('*')
    .eq('is_current', true)
    .maybeSingle();

  const currentTerm = termData as AcademicTerm | null;

  // Fetch instructor record linked to auth user profile
  const { data: instData } = await supabase
    .from('instructors')
    .select('*')
    .eq('profile_id', user.id)
    .maybeSingle();

  // Fetch latest published schedule version for the current term
  let publishedVersion: ScheduleVersion | null = null;
  let myEntries: any[] = [];

  if (currentTerm) {
    const { data: pubData } = await supabase
      .from('schedule_versions')
      .select('*')
      .eq('term_id', currentTerm.id)
      .eq('status', 'published')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pubData) {
      publishedVersion = pubData as ScheduleVersion;

      // Load instructor's entries in this version
      if (instData) {
        const { data: entries } = await supabase
          .from('schedule_entries')
          .select(`
            *,
            class_offerings (
              subjects (
                code,
                title
              ),
              blocks (
                year_level,
                section,
                programs (
                  code
                )
              )
            ),
            rooms (
              name,
              room_type
            )
          `)
          .eq('version_id', publishedVersion.id)
          .eq('instructor_id', instData.id)
          .order('day_of_week', { ascending: true })
          .order('start_time', { ascending: true });

        myEntries = entries || [];
      }
    }
  }

  // Fetch all instructors and rooms for dropdowns
  const [instructorsRes, roomsRes, requestsRes] = await Promise.all([
    supabase.from('instructors').select('id, full_name, employment_type').order('full_name'),
    supabase.from('rooms').select('id, name, room_type, capacity').order('name'),
    supabase
      .from('alteration_requests')
      .select(`
        *,
        schedule_entries (
          *,
          class_offerings (
            subjects (
              code,
              title
            ),
            blocks (
              year_level,
              section,
              programs (
                code
              )
            )
          ),
          rooms (
            name,
            room_type
          )
        )
      `)
      .eq('requested_by', user.id)
      .order('created_at', { ascending: false }),
  ]);

  const allInstructors = (instructorsRes.data || []) as Instructor[];
  const allRooms = (roomsRes.data || []) as Room[];
  const initialRequests = requestsRes.data || [];

  return (
    <InstructorAlterationsClient
      currentTerm={currentTerm}
      publishedVersion={publishedVersion}
      myEntries={myEntries}
      allInstructors={allInstructors}
      allRooms={allRooms}
      initialRequests={initialRequests as any}
      currentUserId={user.id}
    />
  );
}
