import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RoomsClient } from './RoomsClient';
import type { Room } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AdminRoomsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: rooms, error } = await supabase
    .from('rooms')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Facilities</h2>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RoomsClient rooms={(rooms || []) as Room[]} />
    </div>
  );
}
