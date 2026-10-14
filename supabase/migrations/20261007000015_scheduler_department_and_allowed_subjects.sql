-- Migration 15: Scheduler Department Assignment & Allowed Subjects Scoping
-- Allows assigning schedulers to 'BSIT' or 'High School', and configuring allowed subjects

-- 1. Add department column to public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department text CHECK (department IN ('BSIT', 'High School'));

-- 2. Add allowed_subjects array to public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS allowed_subjects text[] DEFAULT NULL;

-- 3. Create join table for scheduler allowed subjects
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

-- Policies for scheduler_allowed_subjects
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
