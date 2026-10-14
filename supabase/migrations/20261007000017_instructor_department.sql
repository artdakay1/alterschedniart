-- Migration 17: Add department to instructors table
-- AlterSched Phase 0

alter table public.instructors
add column if not exists department text default 'BSIT';

-- Index for department filtering
create index if not exists idx_instructors_department on public.instructors(department);
