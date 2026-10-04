// src/app/admin/subjects/actions.ts
'use server';

import fs from 'fs';
import path from 'path';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { subjectSchema, type SubjectInput } from '@/lib/validators/academic';
import type { Subject } from '@/types/database';

export type FacilityType = 'lecture' | 'lab' | 'unspecified';

export interface SubjectMetaRecord {
  yearLevel: string;
  semester?: '1st Semester' | '2nd Semester';
  facility?: FacilityType;
  preferredRoomId?: string;
  category?: 'bsit_major' | 'non_bsit_minor' | 'high_school';
  order?: number;
}

function getSubjectMetadataMapInternal(): Record<string, SubjectMetaRecord> {
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
            facility: v.facility === 'unspecified' ? 'unspecified' : v.facility === 'lab' || v.requires_lab ? 'lab' : 'lecture',
            preferredRoomId: v.preferredRoomId || v.preferred_room_id || undefined,
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

export async function getSubjectMetadataMap(): Promise<Record<string, SubjectMetaRecord>> {
  return getSubjectMetadataMapInternal();
}

function saveSubjectMetadataBatch(entries: Record<string, SubjectMetaRecord>) {
  const filePath = path.join(process.cwd(), 'src', 'data', 'subject_year_levels.json');
  const current = getSubjectMetadataMapInternal();
  const merged = { ...current, ...entries };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
}

function removeSubjectMetadata(keys: string[]) {
  const filePath = path.join(process.cwd(), 'src', 'data', 'subject_year_levels.json');
  const current = getSubjectMetadataMapInternal();
  for (const k of keys) {
    delete current[k];
  }
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8');
}

async function assertAdminCaller() {
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

  if (!profile || profile.status !== 'active' || profile.role !== 'admin') {
    throw new Error('Unauthorized: Caller must be an active administrator.');
  }

  return { supabase, user };
}

async function assertAdminOrSchedulerCaller() {
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
    (profile.role !== 'admin' && profile.role !== 'scheduler')
  ) {
    throw new Error('Unauthorized: Caller must be an active administrator or scheduler.');
  }

  return { supabase, user, role: profile.role as 'admin' | 'scheduler' };
}

export async function saveSubjectAction(
  id: string | null,
  rawInput: SubjectInput,
  meta?: Partial<SubjectMetaRecord>
) {
  const { supabase, user, role } = await assertAdminOrSchedulerCaller();

  // If scheduler is calling, only allow editing facilities, lecture hours, and lab hours
  if (role === 'scheduler') {
    if (!id) {
      throw new Error('Unauthorized: Schedulers cannot create new subjects.');
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('subjects')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      throw new Error('Subject not found.');
    }

    const lectureHours = Number(rawInput.lecture_hours);
    const labHours = Number(rawInput.lab_hours);
    if (isNaN(lectureHours) || isNaN(labHours) || lectureHours + labHours <= 0) {
      throw new Error('Total weekly hours (lecture + lab) must be greater than 0.');
    }

    const facility: FacilityType = meta?.facility || (labHours > 0 ? 'lab' : 'lecture');
    const requiresLab = facility === 'lab';

    const adminSupabase = createAdminClient();
    const { error: updateErr } = await adminSupabase
      .from('subjects')
      .update({
        lecture_hours: lectureHours,
        lab_hours: labHours,
        requires_lab: requiresLab,
      })
      .eq('id', id);

    if (updateErr) {
      throw new Error(`Failed to update subject hours: ${updateErr.message}`);
    }

    // Persist updated facility and preferred room in metadata map while retaining yearLevel, semester, order
    const currentMeta = getSubjectMetadataMapInternal();
    const existingMeta = currentMeta[id] || currentMeta[existing.code.toUpperCase()] || {
      yearLevel: '1st Year',
      semester: '1st Semester',
      facility: 'lecture',
      order: 0,
    };

    const preferredRoomId =
      meta?.preferredRoomId !== undefined ? meta.preferredRoomId : existingMeta.preferredRoomId;

    const updatedMeta: SubjectMetaRecord = {
      ...existingMeta,
      facility: facility,
      preferredRoomId: preferredRoomId || undefined,
    };

    saveSubjectMetadataBatch({
      [id]: updatedMeta,
      [existing.code.toUpperCase()]: updatedMeta,
    });

    await adminSupabase.from('audit_log').insert({
      actor_id: user.id,
      action: 'UPDATE_SUBJECT_FACILITY_HOURS',
      entity_type: 'subjects',
      entity_id: id,
      before: existing,
      after: {
        ...existing,
        lecture_hours: lectureHours,
        lab_hours: labHours,
        requires_lab: requiresLab,
        facility: facility,
      },
    });

    revalidatePath('/admin/subjects');
    revalidatePath('/scheduler/subjects');
    revalidatePath('/scheduler/schedule');
    return;
  }

  // Administrator full update or create flow
  const parsed = subjectSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid subject data.');
  }
  const data = parsed.data;

  const facility: FacilityType = meta?.facility || (data.requires_lab ? 'lab' : 'lecture');
  const requiresLab = facility === 'lab';

  let before: Partial<Subject> | null = null;
  let subjectId = id;

  if (id) {
    const { data: existing } = await supabase
      .from('subjects')
      .select('*')
      .eq('id', id)
      .single();
    before = existing;

    const { error } = await supabase
      .from('subjects')
      .update({
        code: data.code.toUpperCase(),
        title: data.title,
        units: data.units,
        lecture_hours: data.lecture_hours,
        lab_hours: data.lab_hours,
        requires_lab: requiresLab,
        is_bsit: data.is_bsit,
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') {
        throw new Error(`A subject with course code "${data.code}" already exists.`);
      }
      throw new Error(`Failed to update subject: ${error.message}`);
    }
  } else {
    const { data: created, error } = await supabase
      .from('subjects')
      .insert({
        code: data.code.toUpperCase(),
        title: data.title,
        units: data.units,
        lecture_hours: data.lecture_hours,
        lab_hours: data.lab_hours,
        requires_lab: requiresLab,
        is_bsit: data.is_bsit,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`A subject with course code "${data.code}" already exists.`);
      }
      throw new Error(`Failed to create subject: ${error.message}`);
    }
    subjectId = created.id;
  }

  // Persist extended metadata (yearLevel, semester, facility, preferredRoomId, order)
  const currentMeta = getSubjectMetadataMapInternal();
  const existingMeta = id ? currentMeta[id] || currentMeta[data.code.toUpperCase()] : undefined;
  const preferredRoomId =
    meta?.preferredRoomId !== undefined ? meta.preferredRoomId : existingMeta?.preferredRoomId;

  const metaRecord: SubjectMetaRecord = {
    yearLevel: meta?.yearLevel || existingMeta?.yearLevel || '1st Year',
    semester: meta?.semester || existingMeta?.semester || '1st Semester',
    facility: facility,
    preferredRoomId: preferredRoomId || undefined,
    category: meta?.category || existingMeta?.category,
    order: typeof meta?.order === 'number' ? meta.order : existingMeta?.order ?? 0,
  };

  const toSave: Record<string, SubjectMetaRecord> = {
    [data.code.toUpperCase()]: metaRecord,
  };
  if (subjectId) {
    toSave[subjectId] = metaRecord;
  }
  saveSubjectMetadataBatch(toSave);

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: id ? 'UPDATE_SUBJECT' : 'CREATE_SUBJECT',
    entity_type: 'subjects',
    entity_id: subjectId,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: { ...JSON.parse(JSON.stringify(data)), ...metaRecord },
  });

  revalidatePath('/admin/subjects');
  revalidatePath('/scheduler/subjects');
  revalidatePath('/scheduler/schedule');
}

export interface BatchSubjectInput {
  code: string;
  title: string;
  year_level: string;
  semester?: '1st Semester' | '2nd Semester';
  facility?: FacilityType;
  preferred_room_id?: string;
  category?: string;
  is_bsit: boolean;
  units: number;
  lecture_hours: number;
  lab_hours: number;
  order?: number;
}

export async function saveSubjectsBatchAction(rows: BatchSubjectInput[]) {
  const { supabase, user } = await assertAdminCaller();

  if (!rows || rows.length === 0) {
    throw new Error('No subjects to save.');
  }

  // Validate each row
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    if (!row.code || !row.code.trim()) {
      throw new Error(`Row #${idx + 1}: Course code is required.`);
    }
    if (!row.title || !row.title.trim()) {
      throw new Error(`Row #${idx + 1}: Subject title is required.`);
    }
    if (Number(row.units) <= 0) {
      throw new Error(`Row #${idx + 1}: Units must be greater than 0.`);
    }
    if (Number(row.lecture_hours) + Number(row.lab_hours) <= 0) {
      throw new Error(`Row #${idx + 1}: Total hours (lecture + lab) must be greater than 0.`);
    }
  }

  const toInsert = rows.map((r) => {
    const facility: FacilityType = r.facility || 'lecture';
    return {
      code: r.code.trim().toUpperCase(),
      title: r.title.trim(),
      units: Number(r.units),
      lecture_hours: Number(r.lecture_hours || 0),
      lab_hours: Number(r.lab_hours || 0),
      requires_lab: facility === 'lab',
      is_bsit: Boolean(r.is_bsit),
    };
  });

  const { data: created, error } = await supabase
    .from('subjects')
    .insert(toInsert)
    .select();

  if (error) {
    if (error.code === '23505') {
      throw new Error('One or more subjects have a duplicate course code that already exists.');
    }
    throw new Error(`Failed to save subjects: ${error.message}`);
  }

  // Persist extended metadata (yearLevel, semester, facility, preferredRoomId, order)
  const metaMapEntries: Record<string, SubjectMetaRecord> = {};
  rows.forEach((r, i) => {
    const code = r.code.trim().toUpperCase();
    const metaRecord: SubjectMetaRecord = {
      yearLevel: r.year_level || '1st Year',
      semester: r.semester || '1st Semester',
      facility: r.facility || 'lecture',
      preferredRoomId: r.preferred_room_id || undefined,
      order: typeof r.order === 'number' ? r.order : i,
    };
    metaMapEntries[code] = metaRecord;
    if (created && created[i]?.id) {
      metaMapEntries[created[i].id] = metaRecord;
    }
  });
  saveSubjectMetadataBatch(metaMapEntries);

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'BATCH_CREATE_SUBJECTS',
    entity_type: 'subjects',
    entity_id: null,
    before: null,
    after: { count: rows.length, codes: rows.map((r) => r.code.toUpperCase()) },
  });

  revalidatePath('/admin/subjects');
  revalidatePath('/scheduler/schedule');

  return { success: true, count: rows.length, metadataMap: metaMapEntries };
}

export async function saveSubjectsOrderAction(orderMap: Record<string, number>) {
  await assertAdminCaller();

  const filePath = path.join(process.cwd(), 'src', 'data', 'subject_year_levels.json');
  const current = getSubjectMetadataMapInternal();

  for (const [key, newOrder] of Object.entries(orderMap)) {
    if (current[key]) {
      current[key].order = newOrder;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8');
  revalidatePath('/admin/subjects');
  return { success: true };
}

export async function deleteSubjectAction(id: string) {
  const { supabase, user } = await assertAdminCaller();

  const { data: before } = await supabase
    .from('subjects')
    .select('*')
    .eq('id', id)
    .single();

  if (!before) throw new Error('Subject not found.');

  const { error } = await supabase.from('subjects').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Cannot delete this subject because it is referenced in class offerings or instructor qualifications.'
      );
    }
    throw new Error(`Failed to delete subject: ${error.message}`);
  }

  removeSubjectMetadata([id, before.code.toUpperCase()]);

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_SUBJECT',
    entity_type: 'subjects',
    entity_id: id,
    before: JSON.parse(JSON.stringify(before)),
    after: null,
  });

  revalidatePath('/admin/subjects');
}

export async function deleteSubjectsBulkAction(ids: string[]) {
  const { supabase, user } = await assertAdminCaller();

  if (!ids || ids.length === 0) {
    throw new Error('No subjects selected for deletion.');
  }

  // 1. Fetch existing subjects before deletion for audit trail
  const { data: beforeRows } = await supabase
    .from('subjects')
    .select('id, code, title')
    .in('id', ids);

  // 2. Perform bulk delete
  const { error } = await supabase.from('subjects').delete().in('id', ids);

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Some selected subjects could not be deleted because they are referenced in class offerings or instructor qualifications.'
      );
    }
    throw new Error(`Failed to delete selected subjects: ${error.message}`);
  }

  if (beforeRows && beforeRows.length > 0) {
    removeSubjectMetadata([
      ...ids,
      ...beforeRows.map((r) => r.code.toUpperCase()),
    ]);
  }

  // 3. Write audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'BULK_DELETE_SUBJECTS',
    entity_type: 'subjects',
    entity_id: null,
    before: beforeRows ? JSON.parse(JSON.stringify(beforeRows)) : null,
    after: { deleted_count: ids.length, deleted_ids: ids },
  });

  revalidatePath('/admin/subjects');
  revalidatePath('/scheduler/schedule');

  return { success: true, count: ids.length };
}
