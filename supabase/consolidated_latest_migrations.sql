-- ====================================================================
-- AlterSched Ni Art - Consolidated Migrations (Phase: Department Scoping & Rooms)
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run
-- ====================================================================

-- 1. PROFILES: Add department & allowed_subjects columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department text CHECK (department IN ('BSIT', 'High School'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allowed_subjects text[] DEFAULT NULL;

-- 2. SCHEDULER_ALLOWED_SUBJECTS: Join table for fine-grained subject permissions
CREATE TABLE IF NOT EXISTS public.scheduler_allowed_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_scheduler_allowed_subjects UNIQUE (profile_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduler_allowed_subjects_profile_id 
  ON public.scheduler_allowed_subjects(profile_id);

CREATE INDEX IF NOT EXISTS idx_scheduler_allowed_subjects_subject_id 
  ON public.scheduler_allowed_subjects(subject_id);

-- Enable Row Level Security
ALTER TABLE public.scheduler_allowed_subjects ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'scheduler_allowed_subjects' 
      AND policyname = 'Allow authenticated read on scheduler_allowed_subjects'
  ) THEN
    CREATE POLICY "Allow authenticated read on scheduler_allowed_subjects"
      ON public.scheduler_allowed_subjects FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'scheduler_allowed_subjects' 
      AND policyname = 'Allow admin full access on scheduler_allowed_subjects'
  ) THEN
    CREATE POLICY "Allow admin full access on scheduler_allowed_subjects"
      ON public.scheduler_allowed_subjects FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles 
          WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
      );
  END IF;
END $$;

-- 3. ROOMS: Add allowed_departments column
ALTER TABLE public.rooms 
  ADD COLUMN IF NOT EXISTS allowed_departments text[] NOT NULL DEFAULT ARRAY['BSIT']::text[];

-- Update existing shared rooms to include both BSIT and High School
UPDATE public.rooms 
  SET allowed_departments = ARRAY['BSIT', 'High School']::text[] 
  WHERE is_shared = true;

-- Update existing non-shared rooms to BSIT
UPDATE public.rooms 
  SET allowed_departments = ARRAY['BSIT']::text[] 
  WHERE is_shared = false AND (allowed_departments IS NULL OR allowed_departments = ARRAY[]::text[]);
