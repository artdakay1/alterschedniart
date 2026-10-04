-- Migration 05: Class Offerings, Schedule Versions, and Schedule Entries
-- AlterSched Phase 0

-- 1. Class Offerings
create table public.class_offerings (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.academic_terms(id) on delete cascade,
  block_id uuid not null references public.blocks(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_class_offerings_term_block_subject unique (term_id, block_id, subject_id)
);

create index idx_class_offerings_term_id on public.class_offerings(term_id);
create index idx_class_offerings_block_id on public.class_offerings(block_id);
create index idx_class_offerings_subject_id on public.class_offerings(subject_id);

-- 2. Schedule Versions
create table public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.academic_terms(id) on delete cascade,
  version_number int not null check (version_number >= 1),
  status public.schedule_version_status not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_schedule_versions_term_number unique (term_id, version_number)
);

create index idx_schedule_versions_term_id on public.schedule_versions(term_id);
create index idx_schedule_versions_status on public.schedule_versions(status);
create index idx_schedule_versions_created_by on public.schedule_versions(created_by);

create trigger set_schedule_versions_updated_at
  before update on public.schedule_versions
  for each row execute function public.handle_updated_at();

-- 3. Schedule Entries
create table public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.schedule_versions(id) on delete cascade,
  offering_id uuid not null references public.class_offerings(id) on delete cascade,
  instructor_id uuid not null references public.instructors(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  session_type public.session_type not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint chk_schedule_entries_time check (end_time > start_time)
);

-- Foreign key indexes
create index idx_schedule_entries_version_id on public.schedule_entries(version_id);
create index idx_schedule_entries_offering_id on public.schedule_entries(offering_id);
create index idx_schedule_entries_instructor_id on public.schedule_entries(instructor_id);
create index idx_schedule_entries_room_id on public.schedule_entries(room_id);

-- Key index for conflict detection and schedule lookups
create index idx_schedule_entries_day_start_time on public.schedule_entries(day_of_week, start_time);

create trigger set_schedule_entries_updated_at
  before update on public.schedule_entries
  for each row execute function public.handle_updated_at();

-- RLS Enforcement
alter table public.class_offerings enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.schedule_entries enable row level security;
