-- Migration 10: Phase 5 Versioning, Publish Gate, and Schedule Immutability
-- AlterSched Phase 5

-- 1. Tighten RLS policies on schedule_entries
-- Entries belonging to published or archived versions are immutable at the RLS level.
drop policy if exists "schedule_entries_admin_scheduler_modify" on public.schedule_entries;
drop policy if exists "schedule_entries_insert_draft_only" on public.schedule_entries;
drop policy if exists "schedule_entries_update_draft_only" on public.schedule_entries;
drop policy if exists "schedule_entries_delete_draft_only" on public.schedule_entries;

create policy "schedule_entries_insert_draft_only"
  on public.schedule_entries for insert
  with check (
    public.is_active() 
    and public.current_role() in ('admin', 'scheduler')
    and exists (
      select 1 from public.schedule_versions
      where id = version_id and status = 'draft'
    )
  );

create policy "schedule_entries_update_draft_only"
  on public.schedule_entries for update
  using (
    public.is_active() 
    and public.current_role() in ('admin', 'scheduler')
    and exists (
      select 1 from public.schedule_versions
      where id = version_id and status = 'draft'
    )
  )
  with check (
    public.is_active() 
    and public.current_role() in ('admin', 'scheduler')
    and exists (
      select 1 from public.schedule_versions
      where id = version_id and status = 'draft'
    )
  );

create policy "schedule_entries_delete_draft_only"
  on public.schedule_entries for delete
  using (
    public.is_active() 
    and public.current_role() in ('admin', 'scheduler')
    and exists (
      select 1 from public.schedule_versions
      where id = version_id and status = 'draft'
    )
  );

-- 2. Stored Procedure for Atomic Version Transition
-- Transitions a draft version to published, archives previous published version, and logs to audit_log.
create or replace function public.publish_schedule_version(
  p_version_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_term_id uuid;
  v_status public.schedule_version_status;
  v_version_number int;
  v_old_published_id uuid;
  v_result jsonb;
begin
  -- 1. Check target version existence
  select term_id, status, version_number
  into v_term_id, v_status, v_version_number
  from public.schedule_versions
  where id = p_version_id;

  if not found then
    raise exception 'Schedule version not found';
  end if;

  if v_status != 'draft' then
    raise exception 'Only draft schedule versions can be published (current status: %)', v_status;
  end if;

  -- 2. Find currently published version for this term if any
  select id
  into v_old_published_id
  from public.schedule_versions
  where term_id = v_term_id and status = 'published'
  limit 1;

  -- 3. Archive old published version
  if v_old_published_id is not null then
    update public.schedule_versions
    set status = 'archived',
        updated_at = timezone('utc'::text, now())
    where id = v_old_published_id;
  end if;

  -- 4. Publish target version
  update public.schedule_versions
  set status = 'published',
      published_at = timezone('utc'::text, now()),
      updated_at = timezone('utc'::text, now())
  where id = p_version_id;

  -- 5. Record audit_log entry
  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    before,
    after
  ) values (
    p_actor_id,
    'publish',
    'schedule_version',
    p_version_id,
    jsonb_build_object(
      'status', 'draft',
      'version_id', p_version_id,
      'term_id', v_term_id,
      'version_number', v_version_number
    ),
    jsonb_build_object(
      'status', 'published',
      'version_id', p_version_id,
      'term_id', v_term_id,
      'version_number', v_version_number,
      'archived_version_id', v_old_published_id
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'published_version_id', p_version_id,
    'archived_version_id', v_old_published_id,
    'term_id', v_term_id,
    'version_number', v_version_number
  );

  return v_result;
end;
$$;

-- 3. Stored Procedure for Creating a New Draft Version
-- Clones existing published entries into a fresh draft version.
create or replace function public.create_new_draft_version(
  p_term_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_draft_id uuid;
  v_published_id uuid;
  v_next_version_num int;
  v_new_version_id uuid;
  v_cloned_count int := 0;
begin
  -- 1. Check if a draft already exists for this term
  select id
  into v_existing_draft_id
  from public.schedule_versions
  where term_id = p_term_id and status = 'draft'
  limit 1;

  if v_existing_draft_id is not null then
    return jsonb_build_object(
      'success', true,
      'version_id', v_existing_draft_id,
      'is_existing', true,
      'message', 'Existing draft returned'
    );
  end if;

  -- 2. Find published version to clone from
  select id
  into v_published_id
  from public.schedule_versions
  where term_id = p_term_id and status = 'published'
  order by version_number desc limit 1;

  -- 3. Calculate next version number
  select coalesce(max(version_number), 0) + 1
  into v_next_version_num
  from public.schedule_versions
  where term_id = p_term_id;

  -- 4. Create new draft version
  insert into public.schedule_versions (
    term_id,
    version_number,
    status,
    created_by
  ) values (
    p_term_id,
    v_next_version_num,
    'draft',
    p_actor_id
  )
  returning id into v_new_version_id;

  -- 5. Clone entries from published version if present
  if v_published_id is not null then
    insert into public.schedule_entries (
      version_id,
      offering_id,
      instructor_id,
      room_id,
      day_of_week,
      start_time,
      end_time,
      session_type,
      created_by_ai
    )
    select
      v_new_version_id,
      offering_id,
      instructor_id,
      room_id,
      day_of_week,
      start_time,
      end_time,
      session_type,
      false -- Cloned entries are marked as clean baseline
    from public.schedule_entries
    where version_id = v_published_id;

    get diagnostics v_cloned_count = row_count;
  end if;

  -- 6. Record audit_log entry
  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    before,
    after
  ) values (
    p_actor_id,
    'create_draft',
    'schedule_version',
    v_new_version_id,
    null,
    jsonb_build_object(
      'version_number', v_next_version_num,
      'status', 'draft',
      'cloned_from', v_published_id,
      'cloned_entries_count', v_cloned_count
    )
  );

  return jsonb_build_object(
    'success', true,
    'version_id', v_new_version_id,
    'version_number', v_next_version_num,
    'cloned_count', v_cloned_count,
    'is_existing', false
  );
end;
$$;
