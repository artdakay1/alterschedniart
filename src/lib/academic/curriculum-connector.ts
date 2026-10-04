// src/lib/academic/curriculum-connector.ts
// Connects academic curriculum subjects per semester and per year level to their respective blocks.

import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Subject, Block, ClassOffering } from '@/types/database';

export interface SubjectMetaRecord {
  yearLevel: string;
  semester?: '1st Semester' | '2nd Semester';
  facility?: 'lecture' | 'lab' | 'unspecified';
  category?: 'bsit_major' | 'non_bsit_minor' | 'high_school';
  order?: number;
}

/**
 * Loads the subject metadata map from disk.
 */
export function getCurriculumMetadataMap(): Record<string, SubjectMetaRecord> {
  const filePath = path.join(process.cwd(), 'src', 'data', 'subject_year_levels.json');
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const parsed: Record<string, SubjectMetaRecord> = {};
      for (const [key, val] of Object.entries(raw)) {
        if (typeof val === 'string') {
          parsed[key] = {
            yearLevel: val,
            semester: '1st Semester',
            facility: 'lecture',
            order: 0,
          };
        } else if (val && typeof val === 'object') {
          const v = val as any;
          parsed[key] = {
            yearLevel: v.yearLevel || v.year_level || '1st Year',
            semester: v.semester === '2nd Semester' ? '2nd Semester' : '1st Semester',
            facility:
              v.facility === 'unspecified'
                ? 'unspecified'
                : v.facility === 'lab' || v.requires_lab
                ? 'lab'
                : 'lecture',
            category:
              v.category === 'bsit_major' || v.category === 'non_bsit_minor' || v.category === 'high_school'
                ? v.category
                : undefined,
            order: typeof v.order === 'number' ? v.order : 0,
          };
        }
      }
      return parsed;
    } catch {}
  }
  return {};
}

/**
 * Normalizes term semester string to '1st Semester' or '2nd Semester'.
 */
export function normalizeSemester(semesterStr?: string | null): '1st Semester' | '2nd Semester' {
  if (!semesterStr) return '1st Semester';
  if (/2nd|second/i.test(semesterStr)) {
    return '2nd Semester';
  }
  return '1st Semester';
}

/**
 * Derives target year level string from a block record.
 */
export function getBlockTargetYearLevel(block: {
  year_level: number;
  section?: string | null;
  programs?: { code: string } | null;
}): { targetYear: string; isHighSchool: boolean } {
  const progCode = block.programs?.code || '';
  const sec = (block.section || '').trim();
  const isHighSchool = progCode === 'HS' || /^Grade/i.test(sec);

  if (isHighSchool) {
    const match = sec.match(/Grade\s*(\d+)/i);
    const gradeNum = match ? match[1] : block.year_level >= 7 ? String(block.year_level) : '11';
    return { targetYear: `Grade ${gradeNum}`, isHighSchool: true };
  }

  // College / BSIT
  const yr = block.year_level;
  const targetYear =
    yr === 1 ? '1st Year' : yr === 2 ? '2nd Year' : yr === 3 ? '3rd Year' : '4th Year';
  return { targetYear, isHighSchool: false };
}

/**
 * Finds all subjects that strictly belong to the specified block's year level,
 * department, and academic semester.
 */
export function getSubjectsForBlockAndSemester({
  block,
  semester,
  subjects,
  metadataMap,
}: {
  block: Block & { programs?: { code: string } | null };
  semester: string;
  subjects: Subject[];
  metadataMap: Record<string, SubjectMetaRecord>;
}): Subject[] {
  const normSem = normalizeSemester(semester);
  const { targetYear, isHighSchool } = getBlockTargetYearLevel(block);

  return subjects
    .filter((s) => {
      const m = metadataMap[s.id] || metadataMap[s.code.toUpperCase()] || metadataMap[s.code];
      if (!m) return false;

      // Must match department (College vs High School)
      const isHsSubject =
        m.category === 'high_school' ||
        /grade|shs|jhs/i.test(m.yearLevel) ||
        s.code.toUpperCase().startsWith('HS') ||
        s.code.toUpperCase().startsWith('JHS') ||
        s.code.toUpperCase().startsWith('SHS') ||
        s.code.toUpperCase().startsWith('GRADE') ||
        s.code.toUpperCase() === 'ROBOTICS' ||
        s.code.toUpperCase() === 'IT 1';

      if (isHighSchool !== isHsSubject) return false;

      const yMatch = m.yearLevel && m.yearLevel.toLowerCase().includes(targetYear.toLowerCase());
      const sMatch = (m.semester || '1st Semester') === normSem;

      return yMatch && sMatch;
    })
    .sort((a, b) => {
      const ma = metadataMap[a.id] || metadataMap[a.code.toUpperCase()] || metadataMap[a.code];
      const mb = metadataMap[b.id] || metadataMap[b.code.toUpperCase()] || metadataMap[b.code];
      return (ma?.order || 0) - (mb?.order || 0);
    });
}

/**
 * Ensures class offerings exist for a given block according to its exact year level
 * and the active term's semester. Removes any mismatched/obsolete offerings that have no scheduled entries.
 */
export async function ensureOfferingsForBlock(
  supabase: SupabaseClient,
  termId: string,
  blockId: string
): Promise<(ClassOffering & { subjects?: Subject | null })[]> {
  // Fetch block, term, and subjects
  const [blockRes, termRes, subjectsRes] = await Promise.all([
    supabase.from('blocks').select('*, programs(*)').eq('id', blockId).single(),
    supabase.from('academic_terms').select('*').eq('id', termId).single(),
    supabase.from('subjects').select('*').order('code', { ascending: true }),
  ]);

  if (!blockRes.data || !termRes.data) {
    return [];
  }

  const block = blockRes.data as Block & { programs?: { code: string } | null };
  const term = termRes.data;
  const allSubjects = (subjectsRes.data || []) as Subject[];
  const metaMap = getCurriculumMetadataMap();

  const matchingSubjects = getSubjectsForBlockAndSemester({
    block,
    semester: term.semester,
    subjects: allSubjects,
    metadataMap: metaMap,
  });

  const matchingSubjectIds = new Set(matchingSubjects.map((s) => s.id));

  // Get existing offerings for this block in this term
  const { data: existingOfferings } = await supabase
    .from('class_offerings')
    .select('*, subjects(*)')
    .eq('term_id', termId)
    .eq('block_id', blockId);

  const currentOfferings = (existingOfferings || []) as (ClassOffering & { subjects?: Subject | null })[];
  const existingSubjectIds = new Set(currentOfferings.map((o) => o.subject_id));

  // Find subjects that need new offerings inserted
  const missingSubjects = matchingSubjects.filter((s) => !existingSubjectIds.has(s.id));

  if (missingSubjects.length > 0) {
    const toInsert = missingSubjects.map((s) => ({
      term_id: termId,
      block_id: blockId,
      subject_id: s.id,
    }));
    await supabase.from('class_offerings').insert(toInsert);
  }

  // Remove obsolete offerings for this block if they are not in matching subjects
  // and have NO schedule entries assigned
  const obsoleteOfferings = currentOfferings.filter(
    (o) => !matchingSubjectIds.has(o.subject_id)
  );

  if (obsoleteOfferings.length > 0) {
    for (const obs of obsoleteOfferings) {
      const { data: entries } = await supabase
        .from('schedule_entries')
        .select('id')
        .eq('offering_id', obs.id)
        .limit(1);

      if (!entries || entries.length === 0) {
        await supabase.from('class_offerings').delete().eq('id', obs.id);
      }
    }
  }

  // Reload clean offerings
  const { data: refreshed } = await supabase
    .from('class_offerings')
    .select('*, subjects(*)')
    .eq('term_id', termId)
    .eq('block_id', blockId);

  return (refreshed || []) as (ClassOffering & { subjects?: Subject | null })[];
}

/**
 * Syncs curriculum offerings for all blocks under the active term.
 */
export async function syncAllBlockOfferingsForTerm(
  supabase: SupabaseClient,
  termId: string
) {
  const { data: blocks } = await supabase.from('blocks').select('id');
  if (!blocks || blocks.length === 0) return;

  for (const b of blocks) {
    await ensureOfferingsForBlock(supabase, termId, b.id);
  }
}
