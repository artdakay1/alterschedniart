-- Migration 06: Alteration Requests, Audit Log, Notifications, and QR Tokens
-- AlterSched Phase 0

-- 1. Alteration Requests
create table public.alteration_requests (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.schedule_entries(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  proposed_changes jsonb not null default '{}'::jsonb,
  reason text not null,
  status public.alteration_status not null default 'pending',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index idx_alteration_requests_entry_id on public.alteration_requests(entry_id);
create index idx_alteration_requests_requested_by on public.alteration_requests(requested_by);
create index idx_alteration_requests_status on public.alteration_requests(status);

create trigger set_alteration_requests_updated_at
  before update on public.alteration_requests
  for each row execute function public.handle_updated_at();

-- 2. Audit Log
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index idx_audit_log_actor_id on public.audit_log(actor_id);
create index idx_audit_log_entity on public.audit_log(entity_type, entity_id);
create index idx_audit_log_created_at on public.audit_log(created_at);

-- 3. Notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index idx_notifications_user_id on public.notifications(user_id);
create index idx_notifications_is_read on public.notifications(user_id, is_read);

create trigger set_notifications_updated_at
  before update on public.notifications
  for each row execute function public.handle_updated_at();

-- 4. QR Tokens
create table public.qr_tokens (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references public.blocks(id) on delete cascade,
  version_id uuid not null references public.schedule_versions(id) on delete cascade,
  token text not null unique,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index idx_qr_tokens_block_version on public.qr_tokens(block_id, version_id);
create index idx_qr_tokens_token on public.qr_tokens(token);

-- RLS Enforcement
alter table public.alteration_requests enable row level security;
alter table public.audit_log enable row level security;
alter table public.notifications enable row level security;
alter table public.qr_tokens enable row level security;
