// src/app/admin/blocks/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  programSchema,
  blockSchema,
  type ProgramInput,
  type BlockInput,
} from '@/lib/validators/academic';
import type { Program, Block } from '@/types/database';

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

// --- PROGRAM ACTIONS ---

export async function saveProgramAction(id: string | null, rawInput: ProgramInput) {
  const { supabase, user } = await assertAdminCaller();

  const parsed = programSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid program data.');
  }
  const data = parsed.data;

  let before: Partial<Program> | null = null;
  let programId = id;

  if (id) {
    const { data: existing } = await supabase
      .from('programs')
      .select('*')
      .eq('id', id)
      .single();
    before = existing;

    const { error } = await supabase
      .from('programs')
      .update({
        code: data.code.toUpperCase(),
        name: data.name,
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') {
        throw new Error(`A program with code "${data.code}" already exists.`);
      }
      throw new Error(`Failed to update program: ${error.message}`);
    }
  } else {
    const { data: created, error } = await supabase
      .from('programs')
      .insert({
        code: data.code.toUpperCase(),
        name: data.name,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(`A program with code "${data.code}" already exists.`);
      }
      throw new Error(`Failed to create program: ${error.message}`);
    }
    programId = created.id;
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: id ? 'UPDATE_PROGRAM' : 'CREATE_PROGRAM',
    entity_type: 'programs',
    entity_id: programId,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: JSON.parse(JSON.stringify(data)),
  });

  revalidatePath('/admin/blocks');
}

export async function deleteProgramAction(id: string) {
  const { supabase, user } = await assertAdminCaller();

  const { data: before } = await supabase
    .from('programs')
    .select('*')
    .eq('id', id)
    .single();

  if (!before) throw new Error('Program not found.');

  const { error } = await supabase.from('programs').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Cannot delete this program because student blocks or class offerings are assigned to it.'
      );
    }
    throw new Error(`Failed to delete program: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_PROGRAM',
    entity_type: 'programs',
    entity_id: id,
    before: JSON.parse(JSON.stringify(before)),
    after: null,
  });

  revalidatePath('/admin/blocks');
}

// --- BLOCK ACTIONS ---

export async function saveBlockAction(id: string | null, rawInput: BlockInput) {
  const { supabase, user } = await assertAdminCaller();

  const parsed = blockSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid block data.');
  }
  const data = parsed.data;

  let before: Partial<Block> | null = null;
  let blockId = id;

  if (id) {
    const { data: existing } = await supabase
      .from('blocks')
      .select('*')
      .eq('id', id)
      .single();
    before = existing;

    const { error } = await supabase
      .from('blocks')
      .update({
        program_id: data.program_id,
        year_level: data.year_level,
        section: data.section.toUpperCase(),
        student_count: data.student_count,
      })
      .eq('id', id);

    if (error) {
      if (error.code === '23505') {
        throw new Error(
          `A block for Year ${data.year_level}, Block "${data.section.toUpperCase()}" already exists in this program.`
        );
      }
      throw new Error(`Failed to update block: ${error.message}`);
    }
  } else {
    const { data: created, error } = await supabase
      .from('blocks')
      .insert({
        program_id: data.program_id,
        year_level: data.year_level,
        section: data.section.toUpperCase(),
        student_count: data.student_count,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error(
          `A block for Year ${data.year_level}, Block "${data.section.toUpperCase()}" already exists in this program.`
        );
      }
      throw new Error(`Failed to create block: ${error.message}`);
    }
    blockId = created.id;
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: id ? 'UPDATE_BLOCK' : 'CREATE_BLOCK',
    entity_type: 'blocks',
    entity_id: blockId,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: JSON.parse(JSON.stringify(data)),
  });

  revalidatePath('/admin/blocks');
}

export async function deleteBlockAction(id: string) {
  const { supabase, user } = await assertAdminCaller();

  const { data: before } = await supabase
    .from('blocks')
    .select('*')
    .eq('id', id)
    .single();

  if (!before) throw new Error('Block not found.');

  const { error } = await supabase.from('blocks').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Cannot delete this block because it is referenced in class offerings or QR tokens.'
      );
    }
    throw new Error(`Failed to delete block: ${error.message}`);
  }

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    action: 'DELETE_BLOCK',
    entity_type: 'blocks',
    entity_id: id,
    before: JSON.parse(JSON.stringify(before)),
    after: null,
  });

  revalidatePath('/admin/blocks');
}

// --- YEAR LEVEL ACTIONS ---

export async function saveYearLevelAction(input: import('@/lib/academic/year-levels').YearLevelInput) {
  await assertAdminCaller();
  const { saveYearLevelConfig } = await import('@/lib/academic/year-levels');
  const result = await saveYearLevelConfig(input);
  revalidatePath('/admin/blocks');
  return result;
}

export async function deleteYearLevelAction(id: string) {
  await assertAdminCaller();
  const { deleteYearLevelConfig } = await import('@/lib/academic/year-levels');
  await deleteYearLevelConfig(id);
  revalidatePath('/admin/blocks');
}

