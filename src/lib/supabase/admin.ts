// src/lib/supabase/admin.ts
// SERVER-ONLY admin client using SUPABASE_SERVICE_ROLE_KEY.
// This client bypasses RLS and must NEVER be imported or used in Client Components!

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'Security Exception: SUPABASE_SERVICE_ROLE_KEY cannot be accessed or executed in browser environments.'
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase admin environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
    );
  }

  const cleanUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

  return createClient<Database>(cleanUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
