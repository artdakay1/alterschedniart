'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function LogoutButton() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      className="circle-action-btn"
      title="Sign out of your session"
    >
      <i className="bi bi-box-arrow-right text-danger" style={{ fontSize: '0.9rem' }} />
    </button>
  );
}
