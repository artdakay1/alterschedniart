// src/app/admin/alterations/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AlterationsApproverClient, type EnrichedApproverRequest } from '@/components/AlterationsApproverClient';
import type { AcademicTerm, ScheduleVersion, Room, Instructor } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AdminAlterationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Verify role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active' || profile.role !== 'admin') {
    redirect('/login');
  }

  // Fetch current academic term
  const { data: termData } = await supabase
    .from('academic_terms')
    .select('*')
    .eq('is_current', true)
    .maybeSingle();

  const currentTerm = termData as AcademicTerm | null;

  // Fetch published schedule version
  let publishedVersion: ScheduleVersion | null = null;
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
    }
  }

  // Fetch all rooms and instructors
  const [roomsRes, instructorsRes, requestsRes] = await Promise.all([
    supabase.from('rooms').select('*').order('name'),
    supabase.from('instructors').select('*').order('full_name'),
    supabase
      .from('alteration_requests')
      .select(`
        *,
        profiles:requested_by (
          full_name,
          email
        ),
        reviewer:reviewed_by (
          full_name,
          email
        ),
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
          ),
          instructors (
            full_name
          )
        )
      `)
      .order('created_at', { ascending: false }),
  ]);

  const allRooms = (roomsRes.data || []) as Room[];
  const allInstructors = (instructorsRes.data || []) as Instructor[];
  const initialRequests = (requestsRes.data || []) as EnrichedApproverRequest[];

  return (
    <AlterationsApproverClient
      currentTerm={currentTerm}
      publishedVersion={publishedVersion}
      initialRequests={initialRequests}
      allRooms={allRooms}
      allInstructors={allInstructors}
      userRole="admin"
    />
  );
}
