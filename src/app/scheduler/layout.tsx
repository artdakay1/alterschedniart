import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import type { Profile } from '@/types/database';

export default async function SchedulerLayout({
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

  if (!userProfile || userProfile.status !== 'active' || userProfile.role !== 'scheduler') {
    redirect('/login');
  }

  // Fetch notifications
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, title, body, is_read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const navLinks = [
    { label: 'Dashboard', href: '/scheduler', icon: 'bi-grid-fill' },
    { label: 'Schedule Editor', href: '/scheduler/schedule', icon: 'bi-calendar3' },
    { label: 'Published & Saved', href: '/scheduler/schedules', icon: 'bi-table' },
    { label: 'Subjects', href: '/scheduler/subjects', icon: 'bi-book' },
    { label: 'Alterations', href: '/scheduler/alterations', icon: 'bi-arrow-left-right' },
    { label: 'QR Sheets', href: '/scheduler/qr-sheets', icon: 'bi-qr-code' },
    { label: 'AI Generator', href: '/scheduler/generate', icon: 'bi-cpu' },
    { label: 'Fixed Constraints', href: '/scheduler/constraints', icon: 'bi-lock' },
  ];

  return (
    <AppShell
      role="scheduler"
      userName={userProfile.full_name || 'Scheduler'}
      userEmail={userProfile.email}
      links={navLinks}
      notifications={notifications || []}
    >
      {children}
    </AppShell>
  );
}

