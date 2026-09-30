-- ============================================================
-- ALCHEMIC MEDIA V4 — COMMENT -> DM AUTOMATIONS
-- Run on the Media / Clipper Supabase project.
-- Safe to re-run.
-- ============================================================

create table if not exists public.comment_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.media_workspaces(id) on delete cascade,
  account_id uuid references public.content_accounts(id) on delete cascade,
  name text not null,
  platform text not null default 'instagram_reels',
  keyword text not null,
  match_type text not null default 'exact'
    check (match_type in ('exact','contains','starts_with')),
  reply_body text not null,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(keyword)) between 1 and 80),
  check (length(trim(reply_body)) between 1 and 1000)
);

create index if not exists comment_automations_workspace_active_idx
  on public.comment_automations(workspace_id, is_active, priority desc);

create table if not exists public.comment_automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.media_workspaces(id) on delete cascade,
  automation_id uuid not null references public.comment_automations(id) on delete cascade,
  account_id uuid not null references public.content_accounts(id) on delete cascade,
  comment_platform_id text not null,
  social_contact_id uuid references public.social_contacts(id) on delete set null,
  social_conversation_id uuid references public.social_conversations(id) on delete set null,
  source_history_id uuid,
  outbox_id uuid references public.social_outbox(id) on delete set null,
  status text not null default 'reserved'
    check (status in ('reserved','queued','sent','failed','skipped')),
  error_message text,
  matched_text text,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, comment_platform_id)
);

create index if not exists comment_automation_runs_workspace_created_idx
  on public.comment_automation_runs(workspace_id, created_at desc);

alter table public.comment_automations enable row level security;
alter table public.comment_automation_runs enable row level security;

revoke all on table public.comment_automations from anon, authenticated;
revoke all on table public.comment_automation_runs from anon, authenticated;
grant select, insert, update, delete on table public.comment_automations to service_role;
grant select, insert, update, delete on table public.comment_automation_runs to service_role;
