-- Migration 12: Phase 7 Public QR View and Token Management
-- AlterSched Phase 7

-- 1. Ensure qr_tokens structure and indexes
alter table public.qr_tokens
  add column if not exists revoked_at timestamptz;

create index if not exists idx_qr_tokens_token_lookup
  on public.qr_tokens(token);

create index if not exists idx_qr_tokens_version_block
  on public.qr_tokens(version_id, block_id);

-- 2. Secure RPC for Public Timetable Lookup by Token
-- Accessible by anonymous public users without login.
-- Scoped STRICTLY to the specific block and version resolved by the provided token.
-- Prevents any enumeration of other tokens, blocks, or administrative data.

create or replace function public.get_public_schedule_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id uuid;
  v_block_id uuid;
  v_version_id uuid;
  v_revoked_at timestamptz;
  v_token_created_at timestamptz;
  
  v_version_number int;
  v_version_status public.schedule_version_status;
  v_published_at timestamptz;
  v_term_id uuid;
  v_school_year text;
  v_semester text;
  
  v_year_level int;
  v_section text;
  v_program_code text;
  v_program_name text;
  v_student_count int;
  
  v_is_latest_published boolean := false;
  v_entries jsonb;
  v_result jsonb;
begin
  -- 1. Look up token
  select
    id, block_id, version_id, revoked_at, created_at
  into
    v_token_id, v_block_id, v_version_id, v_revoked_at, v_token_created_at
  from public.qr_tokens
  where token = p_token;

  if not found then
    return jsonb_build_object(
      'status', 'not_found',
      'message', 'The requested timetable link does not exist.'
    );
  end if;

  -- 2. Check if revoked
  if v_revoked_at is not null then
    return jsonb_build_object(
      'status', 'revoked',
      'revoked_at', v_revoked_at,
      'message', 'This timetable link is no longer active.'
    );
  end if;

  -- 3. Fetch version & academic term details
  select
    v.version_number, v.status, v.published_at, v.term_id,
    t.school_year, t.semester
  into
    v_version_number, v_version_status, v_published_at, v_term_id,
    v_school_year, v_semester
  from public.schedule_versions v
  join public.academic_terms t on t.id = v.term_id
  where v.id = v_version_id;

  if not found then
    return jsonb_build_object(
      'status', 'not_found',
      'message', 'Schedule version associated with this token was not found.'
    );
  end if;

  -- Check if this version is the currently published one for the term
  select (v_version_status = 'published') into v_is_latest_published;

  -- 4. Fetch block details
  select
    b.year_level, b.section, b.student_count,
    p.code, p.name
  into
    v_year_level, v_section, v_student_count,
    v_program_code, v_program_name
  from public.blocks b
  join public.programs p on p.id = b.program_id
  where b.id = v_block_id;

  -- 5. Fetch scheduled entries for this specific block and version
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'day_of_week', e.day_of_week,
        'start_time', e.start_time,
        'end_time', e.end_time,
        'session_type', e.session_type,
        'subject_code', s.code,
        'subject_title', s.title,
        'subject_units', (s.lecture_hours + s.lab_hours),
        'room_name', coalesce(r.name, 'TBA'),
        'room_type', r.room_type,
        'instructor_name', coalesce(i.full_name, 'TBA')
      )
      order by e.day_of_week asc, e.start_time asc
    ),
    '[]'::jsonb
  )
  into v_entries
  from public.schedule_entries e
  join public.class_offerings o on o.id = e.offering_id
  join public.subjects s on s.id = o.subject_id
  left join public.rooms r on r.id = e.room_id
  left join public.instructors i on i.id = e.instructor_id
  where e.version_id = v_version_id
    and o.block_id = v_block_id;

  -- 6. Build response
  v_result := jsonb_build_object(
    'status', 'valid',
    'token', jsonb_build_object(
      'id', v_token_id,
      'token', p_token,
      'created_at', v_token_created_at
    ),
    'block', jsonb_build_object(
      'id', v_block_id,
      'year_level', v_year_level,
      'section', v_section,
      'program_code', v_program_code,
      'program_name', v_program_name,
      'student_count', v_student_count
    ),
    'version', jsonb_build_object(
      'id', v_version_id,
      'version_number', v_version_number,
      'status', v_version_status,
      'published_at', v_published_at,
      'is_archived', (v_version_status = 'archived')
    ),
    'term', jsonb_build_object(
      'id', v_term_id,
      'school_year', v_school_year,
      'semester', v_semester
    ),
    'entries', v_entries
  );

  return v_result;
end;
$$;

-- Grant execution to anon and authenticated roles
grant execute on function public.get_public_schedule_by_token(text) to anon, authenticated;
