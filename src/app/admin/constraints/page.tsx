import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ConstraintsClient } from './ConstraintsClient';
import type { FixedConstraint, AcademicTerm, Room } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AdminConstraintsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [constraintsRes, termsRes, roomsRes] = await Promise.all([
    supabase
      .from('fixed_constraints')
      .select('*, rooms(*), academic_terms(*)')
      .order('day_of_week', { ascending: true })
      .order('start_time', { ascending: true }),
    supabase
      .from('academic_terms')
      .select('*')
      .order('school_year', { ascending: false }),
    supabase.from('rooms').select('*').order('name', { ascending: true }),
  ]);

  if (constraintsRes.error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Constraints</h2>
        <p className="text-sm">{constraintsRes.error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ConstraintsClient
        constraints={(constraintsRes.data || []) as (FixedConstraint & { rooms?: Room | null; academic_terms?: AcademicTerm | null })[]}
        terms={(termsRes.data || []) as AcademicTerm[]}
        rooms={(roomsRes.data || []) as Room[]}
        isReadOnly={false}
      />
    </div>
  );
}
