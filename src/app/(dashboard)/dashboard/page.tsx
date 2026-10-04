import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/types/database';

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  const userProfile = profile as Profile | null;

  if (!userProfile || userProfile.status !== 'active') {
    redirect('/login');
  }

  if (userProfile.role === 'admin') {
    redirect('/admin');
  } else if (userProfile.role === 'scheduler') {
    redirect('/scheduler');
  } else {
    redirect('/instructor');
  }
}
