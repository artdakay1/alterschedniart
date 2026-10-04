// src/app/scheduler/generate/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GenerateClient } from './GenerateClient';
import type { AcademicTerm, Block } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function SchedulerGeneratePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [termsRes, blocksRes] = await Promise.all([
    supabase
      .from('academic_terms')
      .select('*')
      .order('school_year', { ascending: false }),
    supabase
      .from('blocks')
      .select('*, programs(*)')
      .order('year_level', { ascending: true })
      .order('section', { ascending: true }),
  ]);

  const terms = (termsRes.data || []) as AcademicTerm[];
  const blocks = (blocksRes.data || []) as (Block & { programs?: { code: string; name: string } | null })[];
  const currentTerm = terms.find((t) => t.is_current) || terms[0];

  return (
    <div className="space-y-4">
      <GenerateClient
        terms={terms}
        blocks={blocks}
        currentTermId={currentTerm?.id || ''}
      />
    </div>
  );
}
