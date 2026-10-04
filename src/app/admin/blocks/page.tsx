import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { BlocksClient } from './BlocksClient';
import { getYearLevelConfigs } from '@/lib/academic/year-levels';
import type { Program, Block, AcademicTerm } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AdminBlocksPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [programsRes, blocksRes, activeTermRes, yearLevels] = await Promise.all([
    supabase.from('programs').select('*').order('code', { ascending: true }),
    supabase
      .from('blocks')
      .select('*, programs(*)')
      .order('year_level', { ascending: true })
      .order('section', { ascending: true }),
    supabase
      .from('academic_terms')
      .select('*')
      .eq('is_current', true)
      .maybeSingle(),
    getYearLevelConfigs(),
  ]);

  if (programsRes.error || blocksRes.error) {
    const errorMsg = programsRes.error?.message || blocksRes.error?.message;
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Programs & Blocks</h2>
        <p className="text-sm">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BlocksClient
        programs={(programsRes.data || []) as Program[]}
        blocks={(blocksRes.data || []) as (Block & { programs?: Program | null })[]}
        activeTerm={(activeTermRes.data || null) as AcademicTerm | null}
        initialYearLevelConfigs={yearLevels}
      />
    </div>
  );
}

