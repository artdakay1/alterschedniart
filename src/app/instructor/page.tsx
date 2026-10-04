// src/app/instructor/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InstructorClient } from './InstructorClient';
import type { AcademicTerm, ScheduleVersion } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function InstructorPage() {
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

  // Fetch published schedule version for the current term (if any)
  let publishedVersion: ScheduleVersion | null = null;
  let scheduleItems: any[] = [];

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

      // If instructor profile is linked, load their entries
      if (instData) {
        const { data: entries } = await supabase
          .from('schedule_entries')
          .select(`
            id,
            day_of_week,
            start_time,
            end_time,
            session_type,
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
              code
            )
          `)
          .eq('version_id', publishedVersion.id)
          .eq('instructor_id', instData.id)
          .order('day_of_week', { ascending: true })
          .order('start_time', { ascending: true });

        if (entries) {
          scheduleItems = entries.map((e: any) => {
            const block = e.class_offerings?.blocks;
            const prog = block?.programs?.code || 'BSIT';
            const blockName = block ? `${prog} ${block.year_level}-${block.section}` : 'N/A';
            return {
              id: e.id,
              day_of_week: e.day_of_week,
              start_time: e.start_time,
              end_time: e.end_time,
              session_type: e.session_type,
              subject_code: e.class_offerings?.subjects?.code || 'N/A',
              subject_title: e.class_offerings?.subjects?.title || 'Unknown Subject',
              block_name: blockName,
              room_name: e.rooms?.name || e.rooms?.code || 'N/A',
            };
          });
        }
      }
    }
  }

  // Fetch instructor notifications
  const { data: notifs } = await supabase
    .from('notifications')
    .select('id, title, body, is_read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <InstructorClient
      instructorName={instData?.full_name || 'Instructor'}
      term={currentTerm}
      publishedVersion={publishedVersion}
      scheduleItems={scheduleItems}
      notifications={notifs || []}
    />
  );
}
