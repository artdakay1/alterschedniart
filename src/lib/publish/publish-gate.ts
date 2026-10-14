// src/lib/publish/publish-gate.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkSchedule,
  type ScheduleEntryInput,
  type ScheduleContext,
  type Violation,
} from '../conflict-engine/index.ts';
import type {
  ScheduleVersion,
  ScheduleEntry,
  ClassOffering,
  Subject,
  Block,
  Instructor,
  Room,
  FixedConstraint,
} from '../../types/database.ts';
import { getCurriculumMetadataMap } from '../academic/curriculum-connector.ts';

export interface PublishValidationResult {
  canPublish: boolean;
  hasHardViolations: boolean;
  hasSoftViolations: boolean;
  hardViolationsCount: number;
  softViolationsCount: number;
  hardViolationsByBlock: Record<string, { blockName: string; violations: Violation[] }>;
  softViolationsByBlock: Record<string, { blockName: string; violations: Violation[] }>;
  allViolations: Violation[];
  totalEntriesCount: number;
}

/**
 * Runs the deterministic conflict engine across ALL schedule entries in a draft version.
 * Returns comprehensive hard and soft violation breakdowns grouped by student block.
 */
export async function validateDraftForPublish(
  supabase: SupabaseClient,
  versionId: string
): Promise<PublishValidationResult> {
  // 1. Fetch version details
  const { data: versionData, error: versionErr } = await supabase
    .from('schedule_versions')
    .select('*')
    .eq('id', versionId)
    .single();

  if (versionErr || !versionData) {
    throw new Error(`Schedule version not found: ${versionErr?.message || 'unknown'}`);
  }

  const version = versionData as ScheduleVersion;

  // 2. Fetch all entries in this version with related entities
  const { data: entriesData, error: entriesErr } = await supabase
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
      ),
      instructors (*),
      rooms (*)
    `)
    .eq('version_id', versionId);

  if (entriesErr) {
    throw new Error(`Failed to load schedule entries: ${entriesErr.message}`);
  }

  type JoinedEntry = ScheduleEntry & {
    class_offerings?: (ClassOffering & { subjects?: Subject | null; blocks?: Block | null }) | null;
    instructors?: Instructor | null;
    rooms?: Room | null;
  };

  const rawEntries = (entriesData || []) as JoinedEntry[];

  // 3. Fetch context data: rooms, instructors (with quals & availability), fixed constraints, subjects, blocks
  const [roomsRes, instructorsRes, constraintsRes, blocksRes, subjectsRes] = await Promise.all([
    supabase.from('rooms').select('*'),
    supabase
      .from('instructors')
      .select('*, instructor_qualifications(*), instructor_availability(*)'),
    supabase
      .from('fixed_constraints')
      .select('*')
      .eq('term_id', version.term_id),
    supabase.from('blocks').select('*'),
    supabase.from('subjects').select('*'),
  ]);

  const rooms = (roomsRes.data || []) as Room[];
  const instructors = (instructorsRes.data || []) as (Instructor & {
    instructor_qualifications?: { subject_id: string }[];
    instructor_availability?: { day_of_week: number; start_time: string; end_time: string }[];
  })[];
  const fixedConstraints = (constraintsRes.data || []) as FixedConstraint[];
  const blocks = (blocksRes.data || []) as Block[];
  const subjects = (subjectsRes.data || []) as Subject[];

  const blockMap = new Map<string, string>();
  for (const b of blocks) {
    blockMap.set(b.id, `${b.program_id ? '' : ''}${b.year_level}-${b.section}`);
  }

  // 4. Map entries into ScheduleEntryInput format for conflict engine
  const mappedEntries: ScheduleEntryInput[] = rawEntries.map((e) => {
    const offering = e.class_offerings;
    return {
      id: e.id,
      offeringId: e.offering_id,
      blockId: offering?.block_id || '',
      subjectId: offering?.subject_id || '',
      instructorId: e.instructor_id,
      roomId: e.room_id,
      dayOfWeek: e.day_of_week,
      startTime: (e.start_time || '').slice(0, 5),
      endTime: (e.end_time || '').slice(0, 5),
      sessionType: e.session_type,
    };
  });

  // 5. Build conflict engine context matching ScheduleContext exactly
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

  // 6. Run checkSchedule
  const allViolations = checkSchedule(mappedEntries, context);

  const hardViolationsByBlock: Record<string, { blockName: string; violations: Violation[] }> = {};
  const softViolationsByBlock: Record<string, { blockName: string; violations: Violation[] }> = {};

  let hardCount = 0;
  let softCount = 0;

  // Helper to locate block name for a violation
  const findBlockForViolation = (v: Violation): { id: string; name: string } => {
    // If violation has entryIds, look up first entry's block
    if (v.entryIds && v.entryIds.length > 0) {
      for (const entryId of v.entryIds) {
        const entry = mappedEntries.find((e) => e.id === entryId);
        if (entry && entry.blockId) {
          return {
            id: entry.blockId,
            name: blockMap.get(entry.blockId) || `Block ${entry.blockId.slice(0, 6)}`,
          };
        }
      }
    }
    return { id: 'general', name: 'General / Across Blocks' };
  };

  for (const v of allViolations) {
    const { id: bId, name: bName } = findBlockForViolation(v);

    if (v.severity === 'hard') {
      hardCount++;
      if (!hardViolationsByBlock[bId]) {
        hardViolationsByBlock[bId] = { blockName: bName, violations: [] };
      }
      hardViolationsByBlock[bId].violations.push(v);
    } else {
      softCount++;
      if (!softViolationsByBlock[bId]) {
        softViolationsByBlock[bId] = { blockName: bName, violations: [] };
      }
      softViolationsByBlock[bId].violations.push(v);
    }
  }

  const hasHardViolations = hardCount > 0;
  const hasSoftViolations = softCount > 0;

  return {
    canPublish: !hasHardViolations,
    hasHardViolations,
    hasSoftViolations,
    hardViolationsCount: hardCount,
    softViolationsCount: softCount,
    hardViolationsByBlock,
    softViolationsByBlock,
    allViolations,
    totalEntriesCount: mappedEntries.length,
  };
}
