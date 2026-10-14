// src/app/scheduler/constraints/page.tsx
import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ConstraintsClient } from '@/app/admin/constraints/ConstraintsClient';
import type { FixedConstraint, AcademicTerm, Room } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function SchedulerConstraintsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return (
    <div className="space-y-4">
      <ConstraintsClient userRole="scheduler" isReadOnly={true} />
    </div>
  );
}
