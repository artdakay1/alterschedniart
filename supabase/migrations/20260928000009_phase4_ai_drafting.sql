-- Migration 09: Phase 4 AI Drafting Pipeline
-- AlterSched Phase 4

-- 1. Add created_by_ai flag to schedule_entries
alter table public.schedule_entries
  add column if not exists created_by_ai boolean not null default false;

-- 2. Create ai_generation_log table
create table if not exists public.ai_generation_log (
  id uuid default gen_random_uuid() primary key,
  term_id uuid not null references public.academic_terms(id) on delete cascade,
  block_id uuid not null references public.blocks(id) on delete cascade,
  input_payload jsonb not null default '{}'::jsonb,
  raw_output jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 1,
  entries_written jsonb not null default '[]'::jsonb,
  final_unassigned jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Indexes for performance and rate-limiting lookups
create index if not exists idx_ai_generation_log_user_time
  on public.ai_generation_log(created_by, created_at desc);

create index if not exists idx_ai_generation_log_term_block
  on public.ai_generation_log(term_id, block_id);

create index if not exists idx_schedule_entries_created_by_ai
  on public.schedule_entries(created_by_ai);

-- Enable RLS
alter table public.ai_generation_log enable row level security;

-- Policies:
-- Schedulers and Admins can view and insert into ai_generation_log
drop policy if exists "ai_generation_log_select_policy" on public.ai_generation_log;
create policy "ai_generation_log_select_policy"
  on public.ai_generation_log for select
  using (
    public.is_active() and (
      public.current_role() in ('admin', 'scheduler')
    )
  );

drop policy if exists "ai_generation_log_insert_policy" on public.ai_generation_log;
create policy "ai_generation_log_insert_policy"
  on public.ai_generation_log for insert
  with check (
    public.is_active() and (
      public.current_role() in ('admin', 'scheduler')
    )
  );
