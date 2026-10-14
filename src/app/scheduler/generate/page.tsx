// src/app/scheduler/generate/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GenerateClient } from './GenerateClient';
import type { AcademicTerm, Block, Instructor, Subject } from '@/types/database';
import { getCurriculumMetadataMap } from '@/lib/academic/curriculum-connector';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{
    termId?: string;
    blockId?: string;
  }>;
}

export default async function SchedulerGeneratePage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: termsData } = await supabase
    .from('academic_terms')
    .select('*')
    .order('school_year', { ascending: false });

  const terms = (termsData || []) as AcademicTerm[];
  const currentTerm = (params.termId ? terms.find((t) => t.id === params.termId) : null) || terms.find((t) => t.is_current) || terms[0];

  const [profileRes, blocksRes, instructorsRes, subjectsRes, offeringsRes, versionsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('role, department, allowed_subjects')
      .eq('id', user.id)
      .single(),
    supabase
      .from('blocks')
      .select('*, programs(*)')
      .order('year_level', { ascending: true })
      .order('section', { ascending: true }),
    supabase
      .from('instructors')
      .select('*, profiles(department), instructor_qualifications(subject_id)')
      .order('full_name', { ascending: true }),
    supabase
      .from('subjects')
      .select('*')
      .order('code', { ascending: true }),
    supabase
      .from('class_offerings')
      .select('id, block_id, subject_id, term_id')
      .eq('term_id', currentTerm?.id || ''),
    supabase
      .from('schedule_versions')
      .select('id, status, version_number')
      .eq('term_id', currentTerm?.id || '')
      .order('version_number', { ascending: false }),
  ]);

  const profile = profileRes.data;
  const userRole = profile?.role || 'scheduler';
  const schedulerDepartment =
    (user.user_metadata?.department as any) || profile?.department || 'BSIT';
  const allowedSubjectIds =
    (user.user_metadata?.allowed_subject_ids as string[]) || profile?.allowed_subjects || null;

  const blocks = (blocksRes.data || []) as (Block & { programs?: { code: string; name: string } | null })[];
  const instructors = (instructorsRes.data || []) as (Instructor & {
    profiles?: { department?: string | null } | null;
    instructor_qualifications?: { subject_id: string }[];
  })[];
  const subjects = (subjectsRes.data || []) as Subject[];
  const offerings = (offeringsRes.data || []) as { id: string; block_id: string; subject_id: string; term_id: string }[];

  const versions = versionsRes.data || [];
  const activeVersion =
    versions.find((v) => v.status === 'draft') ||
    versions.find((v) => v.status === 'published') ||
    versions[0];

  let existingEntries: { id: string; offering_id: string; start_time: string; end_time: string }[] = [];
  if (activeVersion) {
    const { data: entriesData } = await supabase
      .from('schedule_entries')
      .select('id, offering_id, start_time, end_time')
      .eq('version_id', activeVersion.id);
    existingEntries = entriesData || [];
  }

  return (
    <div className="space-y-4">
      <GenerateClient
        terms={terms}
        blocks={blocks}
        instructors={instructors}
        subjects={subjects}
        offerings={offerings}
        existingEntries={existingEntries}
        metadataMap={getCurriculumMetadataMap()}
        currentTermId={currentTerm?.id || ''}
        initialBlockId={params.blockId || null}
        userRole={userRole}
        schedulerDepartment={schedulerDepartment}
        allowedSubjectIds={allowedSubjectIds}
      />
    </div>
  );
}
