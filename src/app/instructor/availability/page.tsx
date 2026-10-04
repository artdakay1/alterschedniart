import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InstructorAvailabilityClient } from './InstructorAvailabilityClient';

export const dynamic = 'force-dynamic';

export default async function InstructorSelfAvailabilityPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Find linked instructor record
  const { data: instructor } = await supabase
    .from('instructors')
    .select('*')
    .eq('profile_id', user.id)
    .single();

  if (!instructor) {
    return (
      <div className="p-8 border border-dashed border-slate-800 rounded-2xl bg-slate-900/40 text-center text-slate-400 text-sm">
        No linked instructor profile record found for your user account. Please contact an administrator.
      </div>
    );
  }

  // Fetch current availability slots
  const { data: slots } = await supabase
    .from('instructor_availability')
    .select('*')
    .eq('instructor_id', instructor.id)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });

  const initialSlots = (slots || []).map((s) => ({
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
  }));

  return (
    <div className="space-y-4">
      <InstructorAvailabilityClient
        instructorId={instructor.id}
        instructorName={instructor.full_name}
        initialSlots={initialSlots}
      />
    </div>
  );
}
