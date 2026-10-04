-- Migration 14: Patch schedule entries with notes and nullable room_id
-- AlterSched Phase 0/3/4 Patch

-- 1. Allow room_id to be NULL for off-site or no-room sessions
ALTER TABLE public.schedule_entries
  ALTER COLUMN room_id DROP NOT NULL;

-- 2. Add free-text scheduler notes (never validated, ignored by conflict engine & AI)
ALTER TABLE public.schedule_entries
  ADD COLUMN IF NOT EXISTS notes text NULL;

-- 3. Document canonical grid reference in comment
COMMENT ON COLUMN public.schedule_entries.notes IS 'Free-text scheduler notes (e.g. Off-campus field work). Ignored by conflict engine and AI.';
COMMENT ON COLUMN public.schedule_entries.room_id IS 'Assigned facility. NULL indicates off-site or non-room session (e.g. Capstone field work).';
