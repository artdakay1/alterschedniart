-- Migration 04: Instructors, Qualifications, Availability, and Fixed Constraints
-- AlterSched Phase 0

-- 1. Instructors
create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  full_name text not null,
  employment_type public.employment_type not null,
  needs_lab_equipment boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index idx_instructors_profile_id on public.instructors(profile_id);

create trigger set_instructors_updated_at
  before update on public.instructors
  for each row execute function public.handle_updated_at();

-- 2. Instructor Qualifications
create table public.instructor_qualifications (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint uq_instructor_qualifications unique (instructor_id, subject_id)
);

create index idx_instructor_qualifications_instructor on public.instructor_qualifications(instructor_id);
create index idx_instructor_qualifications_subject on public.instructor_qualifications(subject_id);

-- 3. Instructor Availability
create table public.instructor_availability (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint chk_instructor_availability_time check (end_time > start_time)
);

create index idx_instructor_availability_instructor on public.instructor_availability(instructor_id);
create index idx_instructor_availability_day_time on public.instructor_availability(day_of_week, start_time);

-- 4. Fixed Constraints (e.g. High School or Non-BSIT room reservations)
create table public.fixed_constraints (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.academic_terms(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  label text not null,
  source public.constraint_source not null,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint chk_fixed_constraints_time check (end_time > start_time)
);

create index idx_fixed_constraints_term_id on public.fixed_constraints(term_id);
create index idx_fixed_constraints_room_id on public.fixed_constraints(room_id);
create index idx_fixed_constraints_day_time on public.fixed_constraints(day_of_week, start_time);

create trigger set_fixed_constraints_updated_at
  before update on public.fixed_constraints
  for each row execute function public.handle_updated_at();

-- RLS Enforcement
alter table public.instructors enable row level security;
alter table public.instructor_qualifications enable row level security;
alter table public.instructor_availability enable row level security;
alter table public.fixed_constraints enable row level security;
