// src/app/scheduler/schedules/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { MasterSchedulesClient } from './MasterSchedulesClient';
import { getOrCreateDraftVersionAction } from '../schedule/actions';
import type {
  AcademicTerm,
  Block,
  Room,
  Instructor,
  Subject,
  ClassOffering,
  FixedConstraint,
  ScheduleEntry,
  ScheduleVersion,
} from '@/types/database';
import { syncAllBlockOfferingsForTerm } from '@/lib/academic/curriculum-connector';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    termId?: string;
    versionId?: string;
  }>;
}

export default async function SchedulerSchedulesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Load active academic terms
  const { data: termsData } = await supabase
    .from('academic_terms')
    .select('*')
    .order('school_year', { ascending: false });

  const terms = (termsData || []) as AcademicTerm[];
  const selectedTerm =
    (params.termId ? terms.find((t) => t.id === params.termId) : null) ||
    terms.find((t) => t.is_current) ||
    terms[0];

  if (!selectedTerm) {
    return (
      <div className="p-8 border border-dashed border-slate-800 rounded-2xl bg-slate-900/40 text-center text-slate-400 text-sm">
        No academic terms found. An administrator must define an academic term first.
      </div>
    );
  }

  // Load student blocks
  const { data: blocksData } = await supabase
    .from('blocks')
    .select('*, programs(*)')
    .order('year_level', { ascending: true })
    .order('section', { ascending: true });

  const blocks = (blocksData || []) as (Block & { programs?: { code: string; name: string } | null })[];

  // Load all versions for the selected term
  const { data: versionsData } = await supabase
    .from('schedule_versions')
    .select('*')
    .eq('term_id', selectedTerm.id)
    .order('version_number', { ascending: false });

  let versions = (versionsData || []) as ScheduleVersion[];

  // Determine active version
  let activeVersion: ScheduleVersion | undefined;
  if (params.versionId) {
    activeVersion = versions.find((v) => v.id === params.versionId);
  }

  if (!activeVersion) {
    // Default to the latest published version if available
    activeVersion = versions.find((v) => v.status === 'published');
  }

  if (!activeVersion) {
    // Or the latest draft version
    activeVersion = versions.find((v) => v.status === 'draft');
  }

  if (!activeVersion) {
    // If no versions exist at all, initialize draft version
    const createdDraft = await getOrCreateDraftVersionAction(selectedTerm.id);
    activeVersion = createdDraft;
    versions = [createdDraft];
  }

  // Load offerings, rooms, instructors, subjects, fixed constraints, and schedule entries
  const [
    offeringsRes,
    roomsRes,
    instructorsRes,
    subjectsRes,
    constraintsRes,
    entriesRes,
  ] = await Promise.all([
    supabase
      .from('class_offerings')
      .select('*, subjects(*), blocks(*)')
      .eq('term_id', selectedTerm.id),
    supabase.from('rooms').select('*').order('name', { ascending: true }),
    supabase
      .from('instructors')
      .select('*, instructor_qualifications(*), instructor_availability(*)')
      .order('full_name', { ascending: true }),
    supabase.from('subjects').select('*').order('code', { ascending: true }),
    supabase
      .from('fixed_constraints')
      .select('*')
      .eq('term_id', selectedTerm.id),
    supabase
      .from('schedule_entries')
      .select('*, class_offerings(*, subjects(*), blocks(*)), instructors(*), rooms(*)')
      .eq('version_id', activeVersion.id),
  ]);

  let offerings = (offeringsRes.data || []) as (ClassOffering & { subjects?: Subject | null })[];

  // Ensure curriculum offerings exist for all blocks in the selected term
  if (offerings.length === 0 && blocks.length > 0) {
    await syncAllBlockOfferingsForTerm(supabase, selectedTerm.id);
    const { data: newOfferings } = await supabase
      .from('class_offerings')
      .select('*, subjects(*), blocks(*)')
      .eq('term_id', selectedTerm.id);
    if (newOfferings) {
      offerings = newOfferings as (ClassOffering & { subjects?: Subject | null })[];
    }
  }

  return (
    <div className="space-y-4">
      <MasterSchedulesClient
        terms={terms}
        currentTermId={selectedTerm.id}
        versions={versions}
        selectedVersionId={activeVersion.id}
        entries={(entriesRes.data || []) as (ScheduleEntry & {
          class_offerings?: (ClassOffering & { subjects?: Subject | null; blocks?: Block | null }) | null;
          instructors?: Instructor | null;
          rooms?: Room | null;
        })[]}
        offerings={offerings}
        rooms={(roomsRes.data || []) as Room[]}
        instructors={(instructorsRes.data || []) as (Instructor & {
          instructor_qualifications?: { subject_id: string }[];
          instructor_availability?: { day_of_week: number; start_time: string; end_time: string }[];
        })[]}
        subjects={(subjectsRes.data || []) as Subject[]}
        blocks={blocks}
        fixedConstraints={(constraintsRes.data || []) as FixedConstraint[]}
      />
    </div>
  );
}
