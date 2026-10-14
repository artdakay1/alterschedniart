// src/lib/supabase/middleware.ts
// Middleware helper to refresh Supabase sessions and handle route guarding
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/types/database';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const cleanUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

  const supabase = createServerClient<Database>(cleanUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, {
            ...options,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          })
        );
      },
    },
  });

  // IMPORTANT: Do not run code between createServerClient and supabase.auth.getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute =
    pathname.startsWith('/login') || pathname.startsWith('/register');
  const isProtectedRoleRoute =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/scheduler') ||
    pathname.startsWith('/instructor');
  const isDashboardOrRoot =
    pathname.startsWith('/dashboard') || pathname === '/';

  // 1. Unauthenticated users cannot access any protected routes
  if (!user) {
    if (isProtectedRoleRoute || isDashboardOrRoot) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // 2. Authenticated users: verify profile role and active status
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single();

  if (!profile || profile.status !== 'active') {
    // Inactive, pending, rejected, or disabled users are blocked
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  const userRole = profile.role; // 'admin' | 'scheduler' | 'instructor'
  const roleDashboard = `/${userRole}`;

  // 3. Block cross-role route access (redirect to own role dashboard)
  if (pathname.startsWith('/admin') && userRole !== 'admin') {
    const url = request.nextUrl.clone();
    url.pathname = roleDashboard;
    return NextResponse.redirect(url);
  }

  // Admin users have full access to /scheduler routes (Schedule Editor, Generator, etc.)
  if (pathname.startsWith('/scheduler') && userRole !== 'scheduler' && userRole !== 'admin') {
    const url = request.nextUrl.clone();
    url.pathname = roleDashboard;
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith('/instructor') && userRole !== 'instructor') {
    const url = request.nextUrl.clone();
    url.pathname = roleDashboard;
    return NextResponse.redirect(url);
  }

  // 4. Authenticated users visiting auth routes, root, or /dashboard redirect to their role dashboard
  if (isAuthRoute || isDashboardOrRoot) {
    const url = request.nextUrl.clone();
    url.pathname = roleDashboard;
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
