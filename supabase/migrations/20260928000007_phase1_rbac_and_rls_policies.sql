-- Migration 07: Phase 1 Role-Based Access Control (RBAC) and Comprehensive RLS Policies
-- AlterSched Phase 1

-- 1. Helper functions to retrieve caller's role and status
-- Both functions use SECURITY DEFINER with public search_path to bypass RLS recursion on public.profiles.

create or replace function public.current_role()
returns public.user_role
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role public.user_role;
begin
  if auth.uid() is null then
    return null;
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  return v_role;
end;
$$;

create or replace function public.is_active()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_status public.user_status;
begin
  if auth.uid() is null then
    return false;
  end if;

  select status into v_status
  from public.profiles
  where id = auth.uid();

  return (v_status = 'active');
end;
$$;

-- 2. Clean up Phase 0 minimal policies on public.profiles
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "Admins can update all profiles" on public.profiles;

-- 3. PROFILES POLICIES
-- Inactive, pending, rejected or disabled users get no access to anything.
-- Active users read their own profile; active admins read all profiles.
create policy "profiles_select_policy"
  on public.profiles
  for select
  using (
    public.is_active() and (auth.uid() = id or public.current_role() = 'admin')
  );

-- Only active admins can update profiles (ensures users cannot change their own role or status).
create policy "profiles_update_policy"
  on public.profiles
  for update
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

create policy "profiles_delete_policy"
  on public.profiles
  for delete
  using (public.is_active() and public.current_role() = 'admin');

-- 4. SETUP TABLES (academic_terms, programs, blocks, subjects, rooms, instructors, instructor_qualifications, fixed_constraints)
-- Read by active admin, scheduler, and instructor.
-- Write (insert/update/delete) only by active admin.

-- academic_terms
create policy "academic_terms_select_policy"
  on public.academic_terms for select
  using (public.is_active());

create policy "academic_terms_admin_all"
  on public.academic_terms for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- programs
create policy "programs_select_policy"
  on public.programs for select
  using (public.is_active());

create policy "programs_admin_all"
  on public.programs for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- blocks
create policy "blocks_select_policy"
  on public.blocks for select
  using (public.is_active());

create policy "blocks_admin_all"
  on public.blocks for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- subjects
create policy "subjects_select_policy"
  on public.subjects for select
  using (public.is_active());

create policy "subjects_admin_all"
  on public.subjects for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- rooms
create policy "rooms_select_policy"
  on public.rooms for select
  using (public.is_active());

create policy "rooms_admin_all"
  on public.rooms for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- instructors
create policy "instructors_select_policy"
  on public.instructors for select
  using (public.is_active());

create policy "instructors_admin_all"
  on public.instructors for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- instructor_qualifications
create policy "instructor_qualifications_select_policy"
  on public.instructor_qualifications for select
  using (public.is_active());

create policy "instructor_qualifications_admin_all"
  on public.instructor_qualifications for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- fixed_constraints (schedulers and instructors read; admin full access)
create policy "fixed_constraints_select_policy"
  on public.fixed_constraints for select
  using (public.is_active());

create policy "fixed_constraints_admin_all"
  on public.fixed_constraints for all
  using (public.is_active() and public.current_role() = 'admin')
  with check (public.is_active() and public.current_role() = 'admin');

-- qr_tokens (scheduler and admin full access)
create policy "qr_tokens_admin_scheduler_all"
  on public.qr_tokens for all
  using (public.is_active() and public.current_role() in ('admin', 'scheduler'))
  with check (public.is_active() and public.current_role() in ('admin', 'scheduler'));

-- 5. INSTRUCTOR AVAILABILITY
-- Admin: full access
-- Scheduler: read all (part of setup/scheduling planning)
-- Instructor: read and update ONLY their own availability
create policy "instructor_availability_select_policy"
  on public.instructor_availability for select
  using (
    public.is_active() and (
      public.current_role() in ('admin', 'scheduler')
      or (
        public.current_role() = 'instructor'
        and instructor_id in (select id from public.instructors where profile_id = auth.uid())
      )
    )
  );

create policy "instructor_availability_insert_policy"
  on public.instructor_availability for insert
  with check (
    public.is_active() and (
      public.current_role() = 'admin'
      or (
        public.current_role() = 'instructor'
        and instructor_id in (select id from public.instructors where profile_id = auth.uid())
      )
    )
  );

create policy "instructor_availability_update_policy"
  on public.instructor_availability for update
  using (
    public.is_active() and (
      public.current_role() = 'admin'
      or (
        public.current_role() = 'instructor'
        and instructor_id in (select id from public.instructors where profile_id = auth.uid())
      )
    )
  )
  with check (
    public.is_active() and (
      public.current_role() = 'admin'
      or (
        public.current_role() = 'instructor'
        and instructor_id in (select id from public.instructors where profile_id = auth.uid())
      )
    )
  );

create policy "instructor_availability_delete_policy"
  on public.instructor_availability for delete
  using (
    public.is_active() and (
      public.current_role() = 'admin'
      or (
        public.current_role() = 'instructor'
        and instructor_id in (select id from public.instructors where profile_id = auth.uid())
      )
    )
  );

-- 6. SCHEDULING TABLES (class_offerings, schedule_versions, schedule_entries)
-- Admin & Scheduler: full access
-- Instructor: read only published schedule_entries, plus read offerings/versions for context

-- class_offerings
create policy "class_offerings_select_policy"
  on public.class_offerings for select
  using (public.is_active());

create policy "class_offerings_admin_scheduler_modify"
  on public.class_offerings for all
  using (public.is_active() and public.current_role() in ('admin', 'scheduler'))
  with check (public.is_active() and public.current_role() in ('admin', 'scheduler'));

-- schedule_versions
create policy "schedule_versions_select_policy"
  on public.schedule_versions for select
  using (
    public.is_active() and (
      public.current_role() in ('admin', 'scheduler')
      or (public.current_role() = 'instructor' and status = 'published')
    )
  );

create policy "schedule_versions_admin_scheduler_modify"
  on public.schedule_versions for all
  using (public.is_active() and public.current_role() in ('admin', 'scheduler'))
  with check (public.is_active() and public.current_role() in ('admin', 'scheduler'));

-- schedule_entries
create policy "schedule_entries_select_policy"
  on public.schedule_entries for select
  using (
    public.is_active() and (
      public.current_role() in ('admin', 'scheduler')
      or (
        public.current_role() = 'instructor'
        and version_id in (select id from public.schedule_versions where status = 'published')
      )
    )
  );

create policy "schedule_entries_admin_scheduler_modify"
  on public.schedule_entries for all
  using (public.is_active() and public.current_role() in ('admin', 'scheduler'))
  with check (public.is_active() and public.current_role() in ('admin', 'scheduler'));

-- 7. ALTERATION REQUESTS
-- Instructor: create alteration_requests and read ONLY their own
-- Scheduler: read all, approve or reject alteration_requests (update)
-- Admin: full access
create policy "alteration_requests_select_policy"
  on public.alteration_requests for select
  using (
    public.is_active() and (
      public.current_role() in ('admin', 'scheduler')
      or (public.current_role() = 'instructor' and requested_by = auth.uid())
    )
  );

create policy "alteration_requests_insert_policy"
  on public.alteration_requests for insert
  with check (
    public.is_active() and (
      public.current_role() = 'admin'
      or (public.current_role() = 'instructor' and requested_by = auth.uid())
    )
  );

create policy "alteration_requests_update_policy"
  on public.alteration_requests for update
  using (public.is_active() and public.current_role() in ('admin', 'scheduler'))
  with check (public.is_active() and public.current_role() in ('admin', 'scheduler'));

create policy "alteration_requests_delete_policy"
  on public.alteration_requests for delete
  using (public.is_active() and public.current_role() = 'admin');

-- 8. AUDIT LOG
-- Insert-only for all active users (actor_id must be caller)
-- Read for admin and scheduler
-- Never updated or deleted (immutable)
create policy "audit_log_select_policy"
  on public.audit_log for select
  using (public.is_active() and public.current_role() in ('admin', 'scheduler'));

create policy "audit_log_insert_policy"
  on public.audit_log for insert
  with check (
    public.is_active() and (actor_id is null or actor_id = auth.uid())
  );

-- 9. NOTIFICATIONS
-- Active users read and update only their own notifications
-- Admin and Scheduler can insert notifications
create policy "notifications_select_policy"
  on public.notifications for select
  using (
    public.is_active() and (public.current_role() = 'admin' or user_id = auth.uid())
  );

create policy "notifications_insert_policy"
  on public.notifications for insert
  with check (
    public.is_active() and public.current_role() in ('admin', 'scheduler')
  );

create policy "notifications_update_policy"
  on public.notifications for update
  using (
    public.is_active() and (public.current_role() = 'admin' or user_id = auth.uid())
  )
  with check (
    public.is_active() and (public.current_role() = 'admin' or user_id = auth.uid())
  );

create policy "notifications_delete_policy"
  on public.notifications for delete
  using (
    public.is_active() and (public.current_role() = 'admin' or user_id = auth.uid())
  );
