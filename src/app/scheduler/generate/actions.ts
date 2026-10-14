// src/app/scheduler/generate/actions.ts
'use server';

export const maxDuration = 60;

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
  DepartmentType,
} from '@/types/database';
import { ensureOfferingsForBlock, getCurriculumMetadataMap } from '@/lib/academic/curriculum-connector';
import { getRoomAllowedDepartments } from '@/lib/academic/room-departments';

async function assertSchedulerOrAdminCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status, department, allowed_subjects')
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

  return { supabase, user, profile };
}

export interface SchedulingFilters {
  yearLevels?: (string | number)[];
  instructorIds?: string[];
  subjectIds?: string[];
  blockIds?: string[];
}

/**
 * Server action to generate an AI draft schedule for selected blocks with customizable filters.
 */
export async function generateAiDraftAction(
  termId: string,
  blockIds: string[],
  preferences: SchedulerPreferences,
  mode: 'new' | 'refine' = 'new',
  filters?: SchedulingFilters
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
  collisionError?: string;
}> {
  const { supabase, user, profile: callerProfile } = await assertSchedulerOrAdminCaller();

  // 1. Check rate limit
  const rateLimit = await checkRateLimit(supabase, user.id);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded: please wait ${rateLimit.waitSeconds || 5} seconds before generating again.`
    );
  }

  let targetBlockIds = blockIds;
  if (filters?.blockIds && filters.blockIds.length > 0) {
    targetBlockIds = targetBlockIds.filter((id) => filters.blockIds!.includes(id));
  }

  if (!targetBlockIds || targetBlockIds.length === 0) {
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
    supabase.from('blocks').select('*, programs(*)').in('id', targetBlockIds),
    supabase
      .from('class_offerings')
      .select('*, subjects(*)')
      .eq('term_id', termId),
    supabase.from('rooms').select('*').order('name', { ascending: true }),
    supabase
      .from('instructors')
      .select('*, profiles(department), instructor_qualifications(*), instructor_availability(*)')
      .order('full_name', { ascending: true }),
    supabase.from('subjects').select('*'),
    supabase.from('fixed_constraints').select('*').eq('term_id', termId),
    supabase.from('schedule_entries').select('*').eq('version_id', draftVersion.id),
  ]);

  let blocks = (blocksRes.data || []) as (Block & { programs?: { code: string; name: string } | null })[];

  // Enforce departmental scope for schedulers
  if (callerProfile.role !== 'admin') {
    const dept = ((user.user_metadata?.department as any) || callerProfile.department || 'BSIT') as DepartmentType;
    blocks = blocks.filter((b) => {
      const isHs =
        b.programs?.code === 'HS' ||
        b.year_level >= 7 ||
        (b.section || '').toLowerCase().startsWith('grade') ||
        (b.programs?.name || '').toLowerCase().includes('high school');
      return dept === 'High School' ? isHs : !isHs;
    });
  }

  if (filters?.yearLevels && filters.yearLevels.length > 0) {
    blocks = blocks.filter((b) => {
      const isHs =
        b.programs?.code === 'HS' ||
        b.year_level >= 7 ||
        (b.section || '').toLowerCase().startsWith('grade');
      return filters.yearLevels!.some((yl) => {
        const ylStr = String(yl).toLowerCase();
        if (ylStr === 'hs' || ylStr === 'high school') return isHs;
        return String(b.year_level) === String(yl);
      });
    });
  }

  if (blocks.length === 0) {
    throw new Error('No student blocks match the selected year level / block filters.');
  }

  const rooms = (roomsRes.data || []) as Room[];
  let instructors = (instructorsRes.data || []) as (Instructor & {
    profiles?: { department?: string | null } | null;
    instructor_qualifications?: { subject_id: string }[];
    instructor_availability?: { day_of_week: number; start_time: string; end_time: string }[];
  })[];

  if (callerProfile.role !== 'admin') {
    const dept = ((user.user_metadata?.department as any) || callerProfile.department || 'BSIT') as DepartmentType;
    instructors = instructors.filter((inst) => {
      const instDept = inst.department || inst.profiles?.department;
      if (!instDept || instDept === 'Both') return true;
      return instDept === dept;
    });
  }

  if (filters?.instructorIds && filters.instructorIds.length > 0) {
    instructors = instructors.filter((i) => filters.instructorIds!.includes(i.id));
  }

function isHighSchoolSubject(sub: { code?: string; title?: string }): boolean {
  const code = (sub.code || '').toUpperCase();
  const title = (sub.title || '').toLowerCase();
  return (
    code.startsWith('HS') ||
    code.startsWith('JHS') ||
    code.startsWith('SHS') ||
    code.startsWith('GRADE') ||
    title.includes('high school') ||
    title.includes('grade ')
  );
}

  let subjects = (subjectsRes.data || []) as Subject[];
  if (callerProfile.role !== 'admin') {
    const dept = ((user.user_metadata?.department as any) || callerProfile.department || 'BSIT') as DepartmentType;
    const allowedSubjectIds =
      (user.user_metadata?.allowed_subject_ids as string[]) || callerProfile.allowed_subjects || null;
    subjects = subjects.filter((sub) => {
      const isHs = isHighSchoolSubject(sub);
      const matchesDept = dept === 'High School' ? isHs : !isHs;
      if (!matchesDept) return false;
      if (allowedSubjectIds && allowedSubjectIds.length > 0) {
        return allowedSubjectIds.includes(sub.id);
      }
      return true;
    });
  }
  const fixedConstraints = (constraintsRes.data || []) as FixedConstraint[];
  let offerings = (offeringsRes.data || []) as (ClassOffering & { subjects?: Subject | null })[];

  // Connect curriculum subjects per semester and per year level for each block
  const refreshedOfferings: (ClassOffering & { subjects?: Subject | null })[] = [];
  for (const block of blocks) {
    const blockOfferings = await ensureOfferingsForBlock(supabase, termId, block.id);
    refreshedOfferings.push(...blockOfferings);
  }
  // Safely merge refreshed offerings with all existing term offerings
  const offeringsMap = new Map<string, ClassOffering & { subjects?: Subject | null }>();
  for (const off of offerings) {
    offeringsMap.set(off.id, off);
  }
  for (const off of refreshedOfferings) {
    offeringsMap.set(off.id, off);
  }
  offerings = Array.from(offeringsMap.values());

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
        units: s.units,
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

    // Scope Filter for Department Schedulers: only schedule subjects within assigned scope
    if (callerProfile?.role === 'scheduler') {
      const userDept = (user.user_metadata?.department as any) || callerProfile.department || 'BSIT';
      const allowedIds =
        (user.user_metadata?.allowed_subject_ids as string[]) || callerProfile.allowed_subjects || null;

      activeBlockOfferings = activeBlockOfferings.filter((off) => {
        if (allowedIds && Array.isArray(allowedIds) && allowedIds.length > 0) {
          return allowedIds.includes(off.subject_id);
        }
        const sub = subjects.find((s) => s.id === off.subject_id);
        if (!sub) return false;
        const isHs = isHighSchoolSubject(sub);
        if (userDept === 'High School') {
          return isHs;
        }
        if (userDept === 'BSIT') {
          return !isHs;
        }
        return true;
      });
    }

    // Explicit Subject Filter: only schedule subjects specifically chosen in filters
    if (filters?.subjectIds && filters.subjectIds.length > 0) {
      activeBlockOfferings = activeBlockOfferings.filter((off) =>
        filters.subjectIds!.includes(off.subject_id)
      );
    }

    // Safe guard: only keep offerings whose subject actually exists in `subjects`
    const validBlockOfferings = activeBlockOfferings.filter((off) =>
      subjects.some((s) => s.id === off.subject_id)
    );

    if (validBlockOfferings.length === 0) continue;

    const isHsBlock =
      block.programs?.code === 'HS' ||
      (block.section || '').toLowerCase().startsWith('grade') ||
      block.year_level >= 7;
    const blockDept: DepartmentType = isHsBlock ? 'High School' : 'BSIT';

    // Scoped rooms permitted for this block's department
    const departmentEligibleRooms = rooms.filter((r) => {
      const allowedDepts = getRoomAllowedDepartments(r as any);
      return allowedDepts.includes(blockDept);
    });

    const blockPayload: BlockDraftPayload = {
      termId,
      block: {
        id: block.id,
        name: blockLabel,
        studentCount: block.student_count,
      },
      offerings: validBlockOfferings.map((off) => {
        const sub = subjects.find((s) => s.id === off.subject_id)!;
        const qualifiedInsts = instructors.filter((inst) =>
          (inst.instructor_qualifications || []).some((q) => q.subject_id === sub.id)
        );

        const subMeta = metaMap[sub.id] || metaMap[sub.code.toUpperCase()] || metaMap[sub.code];

        // Read subject units, lecture hours, and lab hours before generating
        const units = typeof sub.units === 'number' && !isNaN(sub.units) ? sub.units : 0;
        let lecHours = typeof sub.lecture_hours === 'number' && !isNaN(sub.lecture_hours) ? sub.lecture_hours : 0;
        let labHours = typeof sub.lab_hours === 'number' && !isNaN(sub.lab_hours) ? sub.lab_hours : 0;

        // Fallback: derive hours from units if hours are unconfigured (0h)
        if (lecHours + labHours === 0 && units > 0) {
          if (sub.requires_lab) {
            lecHours = Math.max(1, units - 1);
            labHours = Math.min(3, units);
          } else {
            lecHours = units;
            labHours = 0;
          }
        }

        // Avoid adding more hours to a subject than what is in its units/curriculum specification
        if (units === 1) {
          lecHours = 1;
          labHours = 0;
        }

        return {
          id: off.id,
          subject: {
            id: sub.id,
            code: sub.code,
            title: sub.title,
            units: units,
            requiresLab: sub.requires_lab,
            facilityType: subMeta?.facility || (sub.requires_lab ? 'lab' : 'lecture'),
            lectureHours: lecHours,
            labHours: labHours,
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
          eligibleRooms: departmentEligibleRooms.map((r) => ({
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

  const collisionError = mode === 'refine' ? results.find((r) => !r.success && r.error)?.error : undefined;

  return {
    success: !collisionError,
    versionId: draftVersion.id,
    results,
    firstBlockId: blockIds[0] || '',
    unassignedWarnings,
    collisionError,
  };
}
