-- Migration 03: Academic Terms, Programs, Blocks, Subjects, and Rooms
-- AlterSched Phase 0

-- 1. Academic Terms
create table public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  school_year text not null,
  semester text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_academic_terms_year_semester unique (school_year, semester)
);

create trigger set_academic_terms_updated_at
  before update on public.academic_terms
  for each row execute function public.handle_updated_at();

-- 2. Programs
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create trigger set_programs_updated_at
  before update on public.programs
  for each row execute function public.handle_updated_at();

-- 3. Blocks
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  year_level int not null check (year_level >= 1 and year_level <= 5),
  section text not null,
  student_count int not null check (student_count > 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_blocks_program_year_section unique (program_id, year_level, section)
);

create index idx_blocks_program_id on public.blocks(program_id);

create trigger set_blocks_updated_at
  before update on public.blocks
  for each row execute function public.handle_updated_at();

-- 4. Subjects
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  units numeric(3,1) not null check (units > 0),
  lecture_hours numeric(3,1) not null default 0 check (lecture_hours >= 0),
  lab_hours numeric(3,1) not null default 0 check (lab_hours >= 0),
  requires_lab boolean not null default false,
  is_bsit boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint chk_subjects_total_hours check (lecture_hours + lab_hours > 0)
);

create trigger set_subjects_updated_at
  before update on public.subjects
  for each row execute function public.handle_updated_at();

-- 5. Rooms
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  room_type public.room_type not null,
  capacity int not null check (capacity > 0),
  is_shared boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create trigger set_rooms_updated_at
  before update on public.rooms
  for each row execute function public.handle_updated_at();

-- RLS Enforcement
alter table public.academic_terms enable row level security;
alter table public.programs enable row level security;
alter table public.blocks enable row level security;
alter table public.subjects enable row level security;
alter table public.rooms enable row level security;
