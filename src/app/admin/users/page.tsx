import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { UserManagementClient } from './UserManagementClient';
import type { Profile, Subject, DepartmentType } from '@/types/database';

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

  // Fetch all profiles and all subjects
  const [profilesRes, subjectsRes] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('subjects').select('*').order('code', { ascending: true }),
  ]);

  if (profilesRes.error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
        <h2 className="text-lg font-bold mb-1">Error Loading Users</h2>
        <p className="text-sm">{profilesRes.error.message}</p>
      </div>
    );
  }

  // Retrieve user_metadata from auth admin
  let authUsersMap: Record<string, { department?: DepartmentType | null; allowed_subject_ids?: string[] | null }> = {};
  try {
    const adminClient = createAdminClient();
    const { data: authUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    if (authUsers && authUsers.users) {
      for (const u of authUsers.users) {
        authUsersMap[u.id] = {
          department: (u.user_metadata?.department as DepartmentType) || null,
          allowed_subject_ids: (u.user_metadata?.allowed_subject_ids as string[]) || null,
        };
      }
    }
  } catch {
    // If admin auth client is unavailable in dev, continue gracefully
  }

  const profilesList = ((profilesRes.data || []) as Profile[]).map((p) => {
    const meta = authUsersMap[p.id];
    return {
      ...p,
      department: meta?.department ?? (p as any).department ?? (p.role === 'scheduler' ? 'BSIT' : null),
      allowed_subject_ids: meta?.allowed_subject_ids ?? (p as any).allowed_subject_ids ?? null,
    };
  });

  return (
    <div className="space-y-4">
      <UserManagementClient
        currentUserId={user.id}
        initialUsers={profilesList}
        allSubjects={(subjectsRes.data || []) as Subject[]}
      />
    </div>
  );
}
