// src/app/scheduler/schedule/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ScheduleEditorClient } from './ScheduleEditorClient';
import { getOrCreateDraftVersionAction } from './actions';
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
  DepartmentType,
} from '@/types/database';
import { syncAllBlockOfferingsForTerm, getCurriculumMetadataMap } from '@/lib/academic/curriculum-connector';
import { getRoomAllowedDepartments } from '@/lib/academic/room-departments';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    termId?: string;
    versionId?: string;
    blockId?: string;
    masterlist?: string;
  }>;
}

export default async function SchedulerSchedulePage({ searchParams }: PageProps) {
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

  if (blocks.length === 0) {
    return (
      <div className="p-8 border border-dashed border-slate-800 rounded-2xl bg-slate-900/40 text-center text-slate-400 text-sm">
        No student blocks found. An administrator must define student blocks first.
      </div>
    );
  }

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
    // Default to the latest draft version if available
    activeVersion = versions.find((v) => v.status === 'draft');
  }

  if (!activeVersion) {
    // Or the latest published version
    activeVersion = versions.find((v) => v.status === 'published');
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
    profileRes,
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
    supabase
      .from('profiles')
      .select('role, department, allowed_subjects')
      .eq('id', user.id)
      .single(),
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

  const userProfile = profileRes.data;
  const userRole = userProfile?.role || 'scheduler';
  const schedulerDepartment =
    (user.user_metadata?.department as DepartmentType) || userProfile?.department || 'BSIT';
  const allowedSubjectIds =
    (user.user_metadata?.allowed_subject_ids as string[]) || userProfile?.allowed_subjects || null;

  const rawRooms = (roomsRes.data || []) as Room[];
  const enrichedRooms = rawRooms.map((r) => ({
    ...r,
    allowed_departments: getRoomAllowedDepartments(r as any),
  })) as Room[];

  return (
    <div className="space-y-4">
      <ScheduleEditorClient
        terms={terms}
        blocks={blocks}
        currentTermId={selectedTerm.id}
        draftVersion={activeVersion}
        versions={versions}
        entries={(entriesRes.data || []) as (ScheduleEntry & {
          class_offerings?: (ClassOffering & { subjects?: Subject | null; blocks?: Block | null }) | null;
          instructors?: Instructor | null;
          rooms?: Room | null;
        })[]}
        offerings={offerings}
        rooms={enrichedRooms}
        instructors={(instructorsRes.data || []) as (Instructor & {
          instructor_qualifications?: { subject_id: string }[];
          instructor_availability?: { day_of_week: number; start_time: string; end_time: string }[];
        })[]}
        subjects={(subjectsRes.data || []) as Subject[]}
        fixedConstraints={(constraintsRes.data || []) as FixedConstraint[]}
        initialBlockId={params.masterlist === 'true' ? undefined : params.blockId}
        initialShowMasterlist={params.masterlist === 'true'}
        metadataMap={getCurriculumMetadataMap()}
        userRole={userRole}
        schedulerDepartment={schedulerDepartment}
        allowedSubjectIds={allowedSubjectIds}
      />
    </div>
  );
}
