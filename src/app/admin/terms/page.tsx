import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TermsClient } from './TermsClient';
import type { AcademicTerm, Program, Subject, ClassOffering, Block } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AdminTermsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [termsRes, programsRes, subjectsRes, offeringsRes] = await Promise.all([
    supabase
      .from('academic_terms')
      .select('*')
      .order('school_year', { ascending: false })
      .order('semester', { ascending: true }),
    supabase.from('programs').select('*').order('code'),
    supabase.from('subjects').select('*').order('code'),
    supabase.from('class_offerings').select(`
      *,
      subjects (*),
      blocks (
        *,
        programs (*)
      )
    `),
  ]);

  if (termsRes.error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Academic Terms</h2>
        <p className="text-sm">{termsRes.error.message}</p>
      </div>
    );
  }

  const terms = (termsRes.data || []) as AcademicTerm[];
  const programs = (programsRes.data || []) as Program[];
  const subjects = (subjectsRes.data || []) as Subject[];
  const offerings = (offeringsRes.data || []) as (ClassOffering & {
    subjects?: Subject | null;
    blocks?: (Block & { programs?: Program | null }) | null;
  })[];

  return (
    <div className="space-y-4">
      <TermsClient
        terms={terms}
        programs={programs}
        subjects={subjects}
        offerings={offerings}
      />
    </div>
  );
}
