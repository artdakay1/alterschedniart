-- Migration 01: Core Types and Helper Functions
-- AlterSched Phase 0

-- Ensure pgcrypto is available
create extension if not exists pgcrypto;

-- Enums
create type public.user_role as enum ('admin', 'scheduler', 'instructor');
create type public.user_status as enum ('pending', 'active', 'rejected', 'disabled');
create type public.room_type as enum ('lecture', 'laboratory');
create type public.employment_type as enum ('full_time', 'part_time');
create type public.schedule_version_status as enum ('draft', 'published', 'archived');
create type public.session_type as enum ('lecture', 'lab');
create type public.constraint_source as enum ('high_school', 'non_bsit', 'other');
create type public.alteration_status as enum ('pending', 'approved', 'rejected');

-- Shared trigger function to update updated_at timestamp
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;
