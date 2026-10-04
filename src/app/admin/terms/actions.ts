// src/app/admin/terms/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { academicTermSchema, type AcademicTermInput } from '@/lib/validators/academic';
import type { AcademicTerm } from '@/types/database';

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

/**
 * Automatically uploads/clones data from the previous academic term to the new/activated term:
 * - Copies class offerings (block + subject linkages)
 * - Copies fixed constraints (blackout hours and room constraints)
 * - Clones initial schedule entries into Version 1 Draft
 */
async function copyDataFromPreviousTerm(
  supabase: any,
  newTermId: string,
  userId: string
) {
  try {
    // 1. Find previous academic term (most recently active or created term other than newTermId)
    const { data: previousTerms } = await supabase
      .from('academic_terms')
      .select('id, school_year, semester, is_current')
      .neq('id', newTermId)
      .order('is_current', { ascending: false })
      .order('created_at', { ascending: false });

    if (!previousTerms || previousTerms.length === 0) {
      return; // No previous term to copy from
    }

    const sourceTerm = previousTerms[0];
    const sourceTermId = sourceTerm.id;

    // 2. Clone class_offerings if new term has none
    const { count: existingOfferingsCount } = await supabase
      .from('class_offerings')
      .select('id', { count: 'exact', head: true })
      .eq('term_id', newTermId);

    let insertedOfferings: { id: string; block_id: string; subject_id: string }[] = [];

    if (!existingOfferingsCount || existingOfferingsCount === 0) {
      const { data: sourceOfferings } = await supabase
        .from('class_offerings')
        .select('id, block_id, subject_id')
        .eq('term_id', sourceTermId);

      if (sourceOfferings && sourceOfferings.length > 0) {
        const offeringsToInsert = sourceOfferings.map((o: any) => ({
          term_id: newTermId,
          block_id: o.block_id,
          subject_id: o.subject_id,
        }));

        const { data: createdOfferings, error: offErr } = await supabase
          .from('class_offerings')
          .insert(offeringsToInsert)
          .select('id, block_id, subject_id');

        if (!offErr && createdOfferings) {
          insertedOfferings = createdOfferings;
        }
      }
    }

    // 3. Clone fixed_constraints if new term has none
    const { count: existingConstraintsCount } = await supabase
      .from('fixed_constraints')
      .select('id', { count: 'exact', head: true })
      .eq('term_id', newTermId);

    if (!existingConstraintsCount || existingConstraintsCount === 0) {
      const { data: sourceConstraints } = await supabase
        .from('fixed_constraints')
        .select('room_id, label, source, day_of_week, start_time, end_time')
        .eq('term_id', sourceTermId);

      if (sourceConstraints && sourceConstraints.length > 0) {
        const constraintsToInsert = sourceConstraints.map((c: any) => ({
          term_id: newTermId,
          room_id: c.room_id,
          label: c.label,
          source: c.source,
          day_of_week: c.day_of_week,
          start_time: c.start_time,
          end_time: c.end_time,
        }));

        await supabase.from('fixed_constraints').insert(constraintsToInsert);
      }
    }

    // 4. Clone Schedule Version & Entries if new term has no schedule versions
    const { count: existingVersionsCount } = await supabase
      .from('schedule_versions')
      .select('id', { count: 'exact', head: true })
      .eq('term_id', newTermId);

    if (!existingVersionsCount || existingVersionsCount === 0) {
      const { data: sourceVersions } = await supabase
        .from('schedule_versions')
        .select('id, status, version_number')
        .eq('term_id', sourceTermId)
        .order('status', { ascending: false })
        .order('version_number', { ascending: false })
        .limit(1);

      const sourceVersion = sourceVersions?.[0];
      if (sourceVersion) {
        const { data: sourceEntries } = await supabase
          .from('schedule_entries')
          .select('offering_id, instructor_id, room_id, day_of_week, start_time, end_time, session_type')
          .eq('version_id', sourceVersion.id);

        if (sourceEntries && sourceEntries.length > 0) {
          const { data: sourceOfferings } = await supabase
            .from('class_offerings')
            .select('id, block_id, subject_id')
            .eq('term_id', sourceTermId);

          let currentNewOfferings = insertedOfferings;
          if (currentNewOfferings.length === 0) {
            const { data: termOfferings } = await supabase
              .from('class_offerings')
              .select('id, block_id, subject_id')
              .eq('term_id', newTermId);
            currentNewOfferings = termOfferings || [];
          }

          const { data: newVersion, error: verErr } = await supabase
            .from('schedule_versions')
            .insert({
              term_id: newTermId,
              version_number: 1,
              status: 'draft',
              created_by: userId,
            })
            .select()
            .single();

          if (!verErr && newVersion && sourceOfferings) {
            const entriesToInsert = sourceEntries
              .map((se: any) => {
                const oldOff = sourceOfferings.find((so: any) => so.id === se.offering_id);
                if (!oldOff) return null;
                const newOff = currentNewOfferings.find(
                  (no) => no.block_id === oldOff.block_id && no.subject_id === oldOff.subject_id
                );
                if (!newOff) return null;
                return {
                  version_id: newVersion.id,
                  offering_id: newOff.id,
                  instructor_id: se.instructor_id,
                  room_id: se.room_id,
                  day_of_week: se.day_of_week,
                  start_time: se.start_time,
                  end_time: se.end_time,
                  session_type: se.session_type,
                };
              })
              .filter(Boolean);

            if (entriesToInsert.length > 0) {
              await supabase.from('schedule_entries').insert(entriesToInsert);
            }
          }
        }
      }
    }
  } catch (cloneErr) {
    console.error('Failed to auto-upload data from previous term:', cloneErr);
    // Non-fatal error; term remains created/activated
  }
}

export async function saveAcademicTermAction(
  id: string | null,
  rawInput: AcademicTermInput
) {
  const { supabase, user } = await assertAdminCaller();

  // Validate with Zod
  const parsed = academicTermSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid term data.');
  }
  const data = parsed.data;

  // If setting to is_current, unset all other terms
  if (data.is_current) {
    await supabase
      .from('academic_terms')
      .update({ is_current: false })
      .neq('id', id || '00000000-0000-0000-0000-000000000000');
  }

  let before: Partial<AcademicTerm> | null = null;
  let termId = id;

  if (id) {
    const { data: existing } = await supabase
      .from('academic_terms')
      .select('*')
      .eq('id', id)
      .single();
    before = existing;

    const { error } = await supabase
      .from('academic_terms')
      .update({
        school_year: data.school_year,
        semester: data.semester,
        is_current: data.is_current,
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') {
        throw new Error(
          `An academic term for ${data.school_year} (${data.semester}) already exists.`
        );
      }
      throw new Error(`Failed to update term: ${error.message}`);
    }

    if (data.is_current) {
      await copyDataFromPreviousTerm(supabase, id, user.id);
    }
  } else {
    const { data: created, error } = await supabase
      .from('academic_terms')
      .insert({
        school_year: data.school_year,
        semester: data.semester,
        is_current: data.is_current,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(
          `An academic term for ${data.school_year} (${data.semester}) already exists.`
        );
      }
      throw new Error(`Failed to create term: ${error.message}`);
    }
    termId = created.id;

    // Automatically upload data from previous academic term to this newly made term
    await copyDataFromPreviousTerm(supabase, termId, user.id);
  }

  // Audit log
  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: id ? 'UPDATE_ACADEMIC_TERM' : 'CREATE_ACADEMIC_TERM',
    entity_type: 'academic_terms',
    entity_id: termId,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: JSON.parse(JSON.stringify(data)),
  });

  revalidatePath('/admin');
  revalidatePath('/admin/terms');
  revalidatePath('/admin/blocks');
  revalidatePath('/admin/rooms');
  revalidatePath('/admin/subjects');
  revalidatePath('/admin/instructors');
  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/generate');
}

export async function deleteAcademicTermAction(id: string) {
  const { supabase, user } = await assertAdminCaller();

  const { data: before } = await supabase
    .from('academic_terms')
    .select('*')
    .eq('id', id)
    .single();

  if (!before) throw new Error('Term not found.');

  const { error } = await supabase
    .from('academic_terms')
    .delete()
    .eq('id', id);

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Cannot delete this academic term because it is referenced by active class offerings or schedules.'
      );
    }
    throw new Error(`Failed to delete term: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_ACADEMIC_TERM',
    entity_type: 'academic_terms',
    entity_id: id,
    before: JSON.parse(JSON.stringify(before)),
    after: null,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/terms');
  revalidatePath('/admin/blocks');
  revalidatePath('/admin/rooms');
  revalidatePath('/admin/subjects');
  revalidatePath('/admin/instructors');
  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/generate');
}

export async function setAcademicTermCurrentAction(id: string) {
  const { supabase, user } = await assertAdminCaller();

  const { data: before } = await supabase
    .from('academic_terms')
    .select('*')
    .eq('id', id)
    .single();

  if (!before) throw new Error('Term not found.');

  // Unset all others
  await supabase
    .from('academic_terms')
    .update({ is_current: false })
    .neq('id', id);

  // Set selected
  const { error } = await supabase
    .from('academic_terms')
    .update({ is_current: true })
    .eq('id', id);

  if (error) throw new Error(`Failed to activate term: ${error.message}`);

  // Automatically upload/ensure data from previous academic term is present in this activated term
  await copyDataFromPreviousTerm(supabase, id, user.id);

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'SET_CURRENT_TERM',
    entity_type: 'academic_terms',
    entity_id: id,
    before: JSON.parse(JSON.stringify(before)),
    after: { is_current: true },
  });

  revalidatePath('/admin');
  revalidatePath('/admin/terms');
  revalidatePath('/admin/blocks');
  revalidatePath('/admin/rooms');
  revalidatePath('/admin/subjects');
  revalidatePath('/admin/instructors');
  revalidatePath('/scheduler/schedule');
  revalidatePath('/scheduler/generate');
}
