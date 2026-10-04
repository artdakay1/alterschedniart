import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/AppShell';
import type { Profile } from '@/types/database';

export default async function AdminLayout({
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

  if (!userProfile || userProfile.status !== 'active' || userProfile.role !== 'admin') {
    redirect('/login');
  }

  // Fetch admin notifications
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, title, body, is_read, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const navLinks = [
    { label: 'Dashboard', href: '/admin', icon: 'bi-grid-fill' },
    { label: 'Terms', href: '/admin/terms', icon: 'bi-calendar-range' },
    { label: 'Programs & Blocks', href: '/admin/blocks', icon: 'bi-mortarboard' },
    { label: 'Subjects', href: '/admin/subjects', icon: 'bi-book' },
    { label: 'Rooms', href: '/admin/rooms', icon: 'bi-building' },
    { label: 'Instructors', href: '/admin/instructors', icon: 'bi-people' },
    { label: 'Constraints', href: '/admin/constraints', icon: 'bi-shield-check' },
    { label: 'Alterations', href: '/admin/alterations', icon: 'bi-arrow-left-right' },
    { label: 'QR Sheets', href: '/admin/qr-sheets', icon: 'bi-qr-code' },
    { label: 'Users', href: '/admin/users', icon: 'bi-person-gear' },
  ];

  return (
    <AppShell
      role="admin"
      userName={userProfile.full_name || 'Admin'}
      userEmail={userProfile.email}
      links={navLinks}
      notifications={notifications || []}
    >
      {children}
    </AppShell>
  );
}

