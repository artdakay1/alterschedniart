-- Migration 11: Phase 6 Alteration Requests Workflow
-- AlterSched Phase 6

-- 1. Add rejection_reason column to alteration_requests
alter table public.alteration_requests
  add column if not exists rejection_reason text;

-- 2. Indexes for fast status lookups and instructor request history
create index if not exists idx_alteration_requests_status_created
  on public.alteration_requests(status, created_at desc);

create index if not exists idx_alteration_requests_user_status
  on public.alteration_requests(requested_by, status);
