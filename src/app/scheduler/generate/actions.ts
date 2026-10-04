// src/app/scheduler/generate/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  executeBlockDraft,
  checkRateLimit,
  type SchedulerPreferences,
  type BlockDraftPayload,
  type BlockDraftResult,
} from '@/lib/ai';
import {
  type ScheduleContext,
  type ScheduleEntryInput,
} from '@/lib/conflict-engine';
import { getOrCreateDraftVersionAction } from '@/app/scheduler/schedule/actions';
import type {
  Block,
  Subject,
  Room,
  Instructor,
  ClassOffering,
  FixedConstraint,
  ScheduleEntry,
} from '@/types/database';
import { ensureOfferingsForBlock, getCurriculumMetadataMap } from '@/lib/academic/curriculum-connector';

async function assertSchedulerOrAdminCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    profile.status !== 'active' ||
    (profile.role !== 'scheduler' && profile.role !== 'admin')
  ) {
    throw new Error(
      'Unauthorized: Caller must be an active scheduler or administrator.'
    );
  }

  return { supabase, user };
}

/**
 * Server action to generate an AI draft schedule for selected blocks.
 */
export async function generateAiDraftAction(
  termId: string,
  blockIds: string[],
  preferences: SchedulerPreferences,
  mode: 'new' | 'refine' = 'new'
): Promise<{
  success: boolean;
  versionId: string;
  results: BlockDraftResult[];
  firstBlockId: string;
  unassignedWarnings: {
    blockName: string;
    subjectCode: string;
    reason: string;
  }[];
}> {
  const { supabase, user } = await assertSchedulerOrAdminCaller();

  // 1. Check rate limit
  const rateLimit = await checkRateLimit(supabase, user.id);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded: please wait ${rateLimit.waitSeconds || 5} seconds before generating again.`
    );
  }

  if (!blockIds || blockIds.length === 0) {
    throw new Error('Please select at least one student block.');
  }

  // 2. Ensure draft schedule version exists
  const draftVersion = await getOrCreateDraftVersionAction(termId);

  // 3. Load full academic data for the term
  const [
    blocksRes,
    offeringsRes,
    roomsRes,
    instructorsRes,
    subjectsRes,
    constraintsRes,
    existingEntriesRes,
  ] = await Promise.all([
    supabase.from('blocks').select('*, programs(*)').in('id', blockIds),
    supabase
      .from('class_offerings')
      .select('*, subjects(*)')
      .eq('term_id', termId)
      .in('block_id', blockIds),
    supabase.from('rooms').select('*').order('capacity', { ascending: false }),
    supabase
      .from('instructors')
      .select('*, instructor_qualifications(*), instructor_availability(*)')
      .order('full_name', { ascending: true }),
    supabase.from('subjects').select('*'),
    supabase.from('fixed_constraints').select('*').eq('term_id', termId),
    supabase.from('schedule_entries').select('*').eq('version_id', draftVersion.id),
  ]);

  const blocks = (blocksRes.data || []) as (Block & { programs?: { code: string; name: string } | null })[];
  const rooms = (roomsRes.data || []) as Room[];
  const instructors = (instructorsRes.data || []) as (Instructor & {
    instructor_qualifications?: { subject_id: string }[];
    instructor_availability?: { day_of_week: number; start_time: string; end_time: string }[];
  })[];
  const subjects = (subjectsRes.data || []) as Subject[];
  const fixedConstraints = (constraintsRes.data || []) as FixedConstraint[];
  let offerings = (offeringsRes.data || []) as (ClassOffering & { subjects?: Subject | null })[];

  // Connect curriculum subjects per semester and per year level for each block
  const refreshedOfferings: (ClassOffering & { subjects?: Subject | null })[] = [];
  for (const block of blocks) {
    const blockOfferings = await ensureOfferingsForBlock(supabase, termId, block.id);
    refreshedOfferings.push(...blockOfferings);
  }
  offerings = refreshedOfferings.length > 0 ? refreshedOfferings : offerings;

  const metaMap = getCurriculumMetadataMap();

  // Build engine context
  const engineContext: ScheduleContext = {
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      roomType: r.room_type,
      capacity: r.capacity,
      isShared: r.is_shared,
    })),
    subjects: subjects.map((s) => {
      const meta = metaMap[s.id] || metaMap[s.code.toUpperCase()] || metaMap[s.code];
      return {
        id: s.id,
        code: s.code,
        title: s.title,
        requiresLab: s.requires_lab,
        facilityType: meta?.facility || (s.requires_lab ? 'lab' : 'lecture'),
        lectureHours: s.lecture_hours,
        labHours: s.lab_hours,
      };
    }),
    instructors: instructors.map((i) => ({
      id: i.id,
      name: i.full_name,
      needsLabEquipment: i.needs_lab_equipment,
      qualifications: (i.instructor_qualifications || []).map((q) => q.subject_id),
      availability: (i.instructor_availability || []).map((a) => ({
        dayOfWeek: a.day_of_week,
        startTime: a.start_time,
        endTime: a.end_time,
      })),
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      name: b.programs ? `${b.programs.code} ${b.year_level}-${b.section}` : `Block ${b.id}`,
      studentCount: b.student_count,
    })),
    fixedConstraints: fixedConstraints.map((c) => ({
      id: c.id,
      termId: c.term_id,
      roomId: c.room_id,
      label: c.label,
      source: c.source,
      dayOfWeek: c.day_of_week,
      startTime: c.start_time,
      endTime: c.end_time,
    })),
  };

  // Convert existing schedule entries to engine format
  const currentDraftEntries: ScheduleEntryInput[] = ((existingEntriesRes.data || []) as ScheduleEntry[]).map(
    (e) => {
      const off = offerings.find((o) => o.id === e.offering_id);
      return {
        id: e.id,
        offeringId: e.offering_id,
        blockId: off?.block_id || '',
        subjectId: off?.subject_id || '',
        instructorId: e.instructor_id,
        roomId: e.room_id,
        dayOfWeek: e.day_of_week,
        startTime: e.start_time.slice(0, 5),
        endTime: e.end_time.slice(0, 5),
        sessionType: e.session_type,
      };
    }
  );

  const results: BlockDraftResult[] = [];
  const unassignedWarnings: {
    blockName: string;
    subjectCode: string;
    reason: string;
  }[] = [];

  // 4. Process each selected block
  for (const block of blocks) {
    const blockLabel = block.programs
      ? `${block.programs.code} ${block.year_level}-${block.section}`
      : `Block ${block.id}`;
    const blockOfferings = offerings.filter((o) => o.block_id === block.id);

    if (blockOfferings.length === 0) {
      unassignedWarnings.push({
        blockName: blockLabel,
        subjectCode: 'All Cohort Subjects',
        reason: 'No subjects configured in the curriculum map for this block year level and semester.',
      });
      continue;
    }

    // Identify subjects that have 0 qualified instructors in the database
    for (const off of blockOfferings) {
      const sub = subjects.find((s) => s.id === off.subject_id);
      const qual = instructors.filter((inst) =>
        (inst.instructor_qualifications || []).some((q) => q.subject_id === sub?.id)
      );
      if (qual.length === 0 && sub) {
        unassignedWarnings.push({
          blockName: blockLabel,
          subjectCode: sub.code,
          reason: `No qualified instructors assigned in database for ${sub.code} (${sub.title}).`,
        });
      }
    }

    // Filter out subjects if the scheduler explicitly requested to leave them out in custom notes
    let activeBlockOfferings = blockOfferings;
    if (preferences.customNotes) {
      const excludeRegex = /(?:leave\s+out|exclude|omit|skip|without|except)\s+(?:these\s+|this\s+)?(?:\d+\s+)?(?:subjects?\s+|courses?\s+)?[:\s]*([A-Za-z0-9\s,\/\-]+?)(?:\.|\n|$|Make|Please|And\s+the)/i;
      const match = preferences.customNotes.match(excludeRegex);
      if (match && match[1]) {
        const rawTokens = match[1]
          .split(/[,;]|\band\b/i)
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s.length > 0 && !['THE', 'THIS', 'THESE', 'SUBJECTS', 'COURSES'].includes(s));

        if (rawTokens.length > 0) {
          activeBlockOfferings = blockOfferings.filter((off) => {
            const sub = subjects.find((s) => s.id === off.subject_id);
            if (!sub) return true;
            const codeUpper = (sub.code || '').toUpperCase().trim();
            const codeCondensed = codeUpper.replace(/\s+/g, '');
            const isExcluded = rawTokens.some((tok) => {
              const tokCondensed = tok.replace(/\s+/g, '');
              return (
                codeUpper === tok ||
                codeCondensed === tokCondensed ||
                (tok.length >= 3 && codeUpper.includes(tok))
              );
            });
            return !isExcluded;
          });
        }
      }
    }

    if (activeBlockOfferings.length === 0) continue;

    const blockPayload: BlockDraftPayload = {
      termId,
      block: {
        id: block.id,
        name: blockLabel,
        studentCount: block.student_count,
      },
      offerings: activeBlockOfferings.map((off) => {
        const sub = subjects.find((s) => s.id === off.subject_id)!;
        const qualifiedInsts = instructors.filter((inst) =>
          (inst.instructor_qualifications || []).some((q) => q.subject_id === sub.id)
        );

        const subMeta = metaMap[sub.id] || metaMap[sub.code.toUpperCase()] || metaMap[sub.code];
        return {
          id: off.id,
          subject: {
            id: sub.id,
            code: sub.code,
            title: sub.title,
            requiresLab: sub.requires_lab,
            facilityType: subMeta?.facility || (sub.requires_lab ? 'lab' : 'lecture'),
            lectureHours: sub.lecture_hours,
            labHours: sub.lab_hours,
          },
          qualifiedInstructors: qualifiedInsts.map((i) => ({
            id: i.id,
            name: i.full_name,
            availability: (i.instructor_availability || []).map((a) => ({
              dayOfWeek: a.day_of_week,
              startTime: a.start_time,
              endTime: a.end_time,
            })),
          })),
          eligibleRooms: rooms.map((r) => ({
            id: r.id,
            name: r.name,
            roomType: r.room_type,
            capacity: r.capacity,
          })),
        };
      }),
      fixedConstraints: engineContext.fixedConstraints,
      existingEntries: currentDraftEntries,
      preferences: {
        ...preferences,
        splitTwoDays: preferences.splitTwoDays !== false,
        isRefineMode: mode === 'refine',
      },
    };

    const blockResult = await executeBlockDraft(
      supabase,
      draftVersion.id,
      user.id,
      blockPayload,
      engineContext,
      currentDraftEntries
    );

    results.push(blockResult);

    // Collect any unassigned items
    for (const u of blockResult.unassigned) {
      if (!unassignedWarnings.some((w) => w.blockName === blockLabel && w.subjectCode === u.subjectCode)) {
        unassignedWarnings.push({
          blockName: blockLabel,
          subjectCode: u.subjectCode,
          reason: u.reason,
        });
      }
    }

    // Append newly written entries to cumulative baseline for subsequent blocks
    for (const written of blockResult.entriesWritten) {
      currentDraftEntries.push(written);
    }
  }

  // 5. Write audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: mode === 'refine' ? 'AI_REFINE_SCHEDULE' : 'AI_GENERATE_SCHEDULE',
    entity_type: 'schedule_versions',
    entity_id: draftVersion.id,
    before: null,
    after: {
      mode,
      blocksCount: blockIds.length,
      entriesCreated: results.reduce((acc, r) => acc + r.entriesWritten.length, 0),
      unassignedCount: results.reduce((acc, r) => acc + r.unassigned.length, 0),
    },
  });

  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/generate');

  return {
    success: true,
    versionId: draftVersion.id,
    results,
    firstBlockId: blockIds[0] || '',
    unassignedWarnings,
  };
}
