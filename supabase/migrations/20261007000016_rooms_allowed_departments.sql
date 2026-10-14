-- Migration 16: Add allowed_departments column to public.rooms
-- Allows administrators to assign rooms to specific departments (BSIT, High School, or both/shared)

ALTER TABLE public.rooms 
  ADD COLUMN IF NOT EXISTS allowed_departments text[] NOT NULL DEFAULT ARRAY['BSIT']::text[];

-- Update existing shared rooms to include both BSIT and High School
UPDATE public.rooms 
  SET allowed_departments = ARRAY['BSIT', 'High School']::text[] 
  WHERE is_shared = true;

-- Update non-shared existing rooms to BSIT
UPDATE public.rooms 
  SET allowed_departments = ARRAY['BSIT']::text[] 
  WHERE is_shared = false;
