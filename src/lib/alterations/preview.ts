// src/lib/alterations/preview.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkSchedule,
  type ScheduleEntryInput,
  type ScheduleContext,
  type Violation,
} from '../conflict-engine/index.ts';
import type {
  AlterationRequest,
  ScheduleEntry,
  ScheduleVersion,
  ClassOffering,
  Subject,
  Block,
  Instructor,
  Room,
  FixedConstraint,
} from '../../types/database.ts';
import { getCurriculumMetadataMap } from '../academic/curriculum-connector.ts';

export interface ProposedChanges {
  instructor_id?: string;
  room_id?: string;
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  session_type?: 'lecture' | 'lab';
}

export interface AlterationPreviewResult {
  requestId: string;
  canApprove: boolean;
  hasHardViolations: boolean;
  hasSoftViolations: boolean;
  hardViolationsCount: number;
  softViolationsCount: number;
  hardViolations: Violation[];
  softViolations: Violation[];
  allViolations: Violation[];
  targetEntry: ScheduleEntry;
  proposedChanges: ProposedChanges;
}

/**
 * Evaluates the impact of a proposed alteration request against the deterministic conflict engine.
 * Takes the current published schedule, swaps the target entry with the proposed changes,
 * and runs checkSchedule to return any hard or soft violations.
 */
export async function previewAlterationImpact(
  supabase: SupabaseClient,
  requestId: string
): Promise<AlterationPreviewResult> {
  // 1. Fetch alteration request
  const { data: requestData, error: reqErr } = await supabase
    .from('alteration_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (reqErr || !requestData) {
    throw new Error(`Alteration request not found: ${reqErr?.message || 'unknown'}`);
  }

  const request = requestData as AlterationRequest;
  const proposed = (request.proposed_changes || {}) as ProposedChanges;

  // 2. Fetch target entry
  const { data: entryData, error: entryErr } = await supabase
    .from('schedule_entries')
    .select(`
      *,
      class_offerings (
        id,
        term_id,
        block_id,
        subject_id,
        subjects (*),
        blocks (*)
      )
    `)
    .eq('id', request.entry_id)
    .single();

  if (entryErr || !entryData) {
    throw new Error(`Target schedule entry not found: ${entryErr?.message || 'unknown'}`);
  }

  const targetEntry = entryData as ScheduleEntry & {
    class_offerings?: (ClassOffering & { subjects?: Subject | null; blocks?: Block | null }) | null;
  };

  const versionId = targetEntry.version_id;

  // 3. Fetch version details
  const { data: versionData, error: verErr } = await supabase
    .from('schedule_versions')
    .select('*, academic_terms(*)')
    .eq('id', versionId)
    .single();

  if (verErr || !versionData) {
    throw new Error(`Schedule version not found: ${verErr?.message || 'unknown'}`);
  }

  const version = versionData as ScheduleVersion;

  // 4. Fetch all entries from this version
  const { data: allVersionEntries, error: allEntriesErr } = await supabase
    .from('schedule_entries')
    .select(`
      *,
      class_offerings (
        id,
        block_id,
        subject_id
      )
    `)
    .eq('version_id', versionId);

  if (allEntriesErr || !allVersionEntries) {
    throw new Error(`Failed to load version entries: ${allEntriesErr?.message || 'unknown'}`);
  }

  // 5. Fetch full context: rooms, subjects, instructors, blocks, fixed_constraints
  const [roomsRes, subsRes, instRes, blocksRes, constraintsRes] = await Promise.all([
    supabase.from('rooms').select('*'),
    supabase.from('subjects').select('*'),
    supabase
      .from('instructors')
      .select('*, instructor_qualifications(*), instructor_availability(*)'),
    supabase.from('blocks').select('*'),
    supabase.from('fixed_constraints').select('*').eq('term_id', version.term_id),
  ]);

  const rooms = (roomsRes.data || []) as Room[];
  const subjects = (subsRes.data || []) as Subject[];
  const instructors = (instRes.data || []) as (Instructor & {
    instructor_qualifications?: { subject_id: string }[];
    instructor_availability?: { day_of_week: number; start_time: string; end_time: string }[];
  })[];
  const blocks = (blocksRes.data || []) as Block[];
  const fixedConstraints = (constraintsRes.data || []) as FixedConstraint[];

  // 6. Build hypothetical entry set: replace target entry with proposed changes
  const hypotheticalEntries: ScheduleEntryInput[] = allVersionEntries.map((e) => {
    const isTarget = e.id === request.entry_id;
    const offering = e.class_offerings;

    const instructorId = isTarget && proposed.instructor_id ? proposed.instructor_id : e.instructor_id;
    const roomId = isTarget && proposed.room_id ? proposed.room_id : e.room_id;
    const dayOfWeek = isTarget && proposed.day_of_week !== undefined ? proposed.day_of_week : e.day_of_week;
    const rawStartTime = isTarget && proposed.start_time ? proposed.start_time : e.start_time;
    const rawEndTime = isTarget && proposed.end_time ? proposed.end_time : e.end_time;
    const sessionType = isTarget && proposed.session_type ? proposed.session_type : e.session_type;

    return {
      id: e.id,
      offeringId: e.offering_id,
      blockId: offering?.block_id || '',
      subjectId: offering?.subject_id || '',
      instructorId,
      roomId,
      dayOfWeek,
      startTime: (rawStartTime || '').slice(0, 5),
      endTime: (rawEndTime || '').slice(0, 5),
      sessionType,
    };
  });

  // 7. Build ScheduleContext matching conflict-engine types
  const metaMap = getCurriculumMetadataMap();
  const context: ScheduleContext = {
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
        startTime: (a.start_time || '').slice(0, 5),
        endTime: (a.end_time || '').slice(0, 5),
      })),
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      name: `${b.year_level}-${b.section}`,
      studentCount: b.student_count,
    })),
    fixedConstraints: fixedConstraints.map((c) => ({
      id: c.id,
      termId: c.term_id,
      roomId: c.room_id,
      label: c.label,
      source: c.source,
      dayOfWeek: c.day_of_week,
      startTime: (c.start_time || '').slice(0, 5),
      endTime: (c.end_time || '').slice(0, 5),
    })),
  };

  // 8. Run checkSchedule against hypothetical timetable
  const allViolations = checkSchedule(hypotheticalEntries, context);
  const hardViolations = allViolations.filter((v) => v.severity === 'hard');
  const softViolations = allViolations.filter((v) => v.severity === 'soft');

  const hasHardViolations = hardViolations.length > 0;
  const hasSoftViolations = softViolations.length > 0;

  return {
    requestId,
    canApprove: !hasHardViolations,
    hasHardViolations,
    hasSoftViolations,
    hardViolationsCount: hardViolations.length,
    softViolationsCount: softViolations.length,
    hardViolations,
    softViolations,
    allViolations,
    targetEntry,
    proposedChanges: proposed,
  };
}
