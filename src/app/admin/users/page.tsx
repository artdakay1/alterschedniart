import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UserManagementClient } from './UserManagementClient';
import type { Profile } from '@/types/database';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Double check admin role
  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!currentProfile || currentProfile.status !== 'active' || currentProfile.role !== 'admin') {
    redirect('/login');
  }

  // Fetch all profiles (allowed by RLS for active admins)
  const { data: users, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Users</h2>
        <p className="text-sm">{error.message}</p>
      </div>
    );
  }

  const profilesList = (users || []) as Profile[];

  return (
    <div className="space-y-4">
      <UserManagementClient
        currentUserId={user.id}
        initialUsers={profilesList}
      />
    </div>
  );
}
