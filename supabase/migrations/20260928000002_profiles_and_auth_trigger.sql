-- Migration 02: Profiles Table, Admin Helper, Auth Trigger, and Profiles RLS
-- AlterSched Phase 0

-- Profiles table
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  role public.user_role not null default 'instructor',
  status public.user_status not null default 'pending',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

-- Index for searching email and role/status
create index idx_profiles_email on public.profiles(email);
create index idx_profiles_role_status on public.profiles(role, status);

-- Trigger for updated_at
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Helper function to check if the current caller is an active admin.
-- Defined as SECURITY DEFINER with fixed search_path to prevent infinite RLS recursion.
create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role public.user_role;
  v_status public.user_status;
begin
  if auth.uid() is null then
    return false;
  end if;

  select role, status into v_role, v_status
  from public.profiles
  where id = auth.uid();

  return (v_role = 'admin' and v_status = 'active');
end;
$$;

-- Auth trigger function on auth.users insert:
-- Strictly enforces role='instructor' and status='pending' regardless of any metadata sent by client!
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    'instructor'::public.user_role,
    'pending'::public.user_status
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Drop trigger if exists and recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Enable RLS on profiles
alter table public.profiles enable row level security;

-- Policies for profiles:
-- 1. A user can read their own profile
create policy "Users can read own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

-- 2. Admins can read all profiles
create policy "Admins can read all profiles"
  on public.profiles
  for select
  using (public.is_admin());

-- 3. Admins can update all profiles (e.g. approve pending accounts or assign roles)
create policy "Admins can update all profiles"
  on public.profiles
  for update
  using (public.is_admin())
  with check (public.is_admin());
