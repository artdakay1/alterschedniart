import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import type { Profile } from '@/types/database';

export default async function InstructorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const userProfile = profile as Profile | null;

  if (!userProfile || userProfile.status !== 'active' || userProfile.role !== 'instructor') {
    redirect('/login');
  }

  // Fetch instructor notifications
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, title, body, is_read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const navLinks = [
    { label: 'Dashboard', href: '/instructor', icon: 'bi-grid-fill' },
    { label: 'My Availability', href: '/instructor/availability', icon: 'bi-clock-history' },
    { label: 'Alterations', href: '/instructor/alterations', icon: 'bi-arrow-left-right' },
  ];

  return (
    <AppShell
      role="instructor"
      userName={userProfile.full_name || 'Instructor'}
      userEmail={userProfile.email}
      links={navLinks}
      notifications={notifications || []}
    >
      {children}
    </AppShell>
  );
}

