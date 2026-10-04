// src/app/scheduler/subjects/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SubjectsClient } from '@/app/admin/subjects/SubjectsClient';
import { getSubjectMetadataMap } from '@/app/admin/subjects/actions';
import type { Subject, Room } from '@/types/database';

export const dynamic = 'force-dynamic';

interface SchedulerSubjectsPageProps {
  searchParams?: Promise<{
    yearLevel?: string;
    year?: string;
    semester?: string;
    department?: string;
    dept?: string;
  }>;
}

export default async function SchedulerSubjectsPage({ searchParams }: SchedulerSubjectsPageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active' || (profile.role !== 'scheduler' && profile.role !== 'admin')) {
    redirect('/login');
  }

  const resolvedParams = searchParams ? await searchParams : {};
  const initialYearLevel = resolvedParams.yearLevel || resolvedParams.year || 'all';
  const initialSemester = resolvedParams.semester || '1st Semester';
  const initialDepartment =
    resolvedParams.department === 'high_school' || resolvedParams.dept === 'high_school'
      ? 'high_school'
      : 'college';

  const [subjectsRes, roomsRes, metadataMap] = await Promise.all([
    supabase.from('subjects').select('*').order('code', { ascending: true }),
    supabase.from('rooms').select('*').order('name', { ascending: true }),
    getSubjectMetadataMap(),
  ]);

  if (subjectsRes.error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Subjects</h2>
        <p className="text-sm">{subjectsRes.error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SubjectsClient
        subjects={(subjectsRes.data || []) as Subject[]}
        rooms={(roomsRes.data || []) as Room[]}
        initialYearLevel={initialYearLevel}
        initialSemester={initialSemester}
        initialDepartment={initialDepartment}
        initialMetadataMap={metadataMap}
        isScheduler={true}
      />
    </div>
  );
}
