-- Alchemic Social Hub
-- Comment keyword -> immediate private DM automation.
-- Additive migration. Safe to run after sql/001_social_hub.sql.

create extension if not exists pgcrypto;

create table if not exists public.social_comment_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  account_id uuid references public.content_accounts(id) on delete cascade,
  name text not null default 'Comment automation',
  keyword text not null,
  match_type text not null default 'contains'
    check (match_type in ('contains','exact')),
  dm_message text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_comment_automations_lookup_idx
  on public.social_comment_automations(workspace_id, account_id, is_active, created_at);

create table if not exists public.social_comment_automation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  automation_id uuid references public.social_comment_automations(id) on delete set null,
  account_id uuid not null references public.content_accounts(id) on delete cascade,
  conversation_id uuid references public.social_conversations(id) on delete set null,
  contact_id uuid references public.social_contacts(id) on delete set null,
  comment_id text not null,
  media_id text,
  comment_text text,
  matched_keyword text,
  outbox_id uuid references public.social_outbox(id) on delete set null,
  platform_message_id text,
  status text not null default 'matched'
    check (status in ('matched','sending','sent','failed','skipped')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Meta allows only one private reply for a given comment. This unique index
-- also makes webhook retries safe and prevents duplicate automated DMs.
create unique index if not exists social_comment_automation_events_comment_uidx
  on public.social_comment_automation_events(account_id, comment_id);

create index if not exists social_comment_automation_events_time_idx
  on public.social_comment_automation_events(workspace_id, created_at desc);

alter table public.social_comment_automations enable row level security;
alter table public.social_comment_automation_events enable row level security;

revoke all on table public.social_comment_automations from anon, authenticated;
revoke all on table public.social_comment_automation_events from anon, authenticated;

grant select, insert, update, delete on table public.social_comment_automations to service_role;
grant select, insert, update, delete on table public.social_comment_automation_events to service_role;

-- Seed the requested TRAINING automation for currently connected Instagram
-- accounts. The rule is account-scoped, so each account can later customize
-- or disable it independently.
do $$
declare
  has_workspace boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='content_accounts'
      and column_name='workspace_id'
  ) into has_workspace;

  if has_workspace then
    execute $seed$
      insert into public.social_comment_automations (
        workspace_id, account_id, name, keyword, match_type, dm_message, is_active, metadata
      )
      select
        ca.workspace_id,
        ca.id,
        'TRAINING -> DM',
        'TRAINING',
        'contains',
        'Hey! Saw you commented TRAINING — I’ve got you. I’ll send it over here.',
        true,
        jsonb_build_object('seeded_by','002_comment_automation_and_daily_metrics')
      from public.content_accounts ca
      where ca.platform='instagram_reels'
        and not exists (
          select 1
          from public.social_comment_automations a
          where a.account_id=ca.id
            and lower(a.keyword)='training'
            and a.is_active=true
        )
    $seed$;
  else
    insert into public.social_comment_automations (
      workspace_id, account_id, name, keyword, match_type, dm_message, is_active, metadata
    )
    select
      null,
      ca.id,
      'TRAINING -> DM',
      'TRAINING',
      'contains',
      'Hey! Saw you commented TRAINING — I’ve got you. I’ll send it over here.',
      true,
      jsonb_build_object('seeded_by','002_comment_automation_and_daily_metrics')
    from public.content_accounts ca
    where ca.platform='instagram_reels'
      and not exists (
        select 1
        from public.social_comment_automations a
        where a.account_id=ca.id
          and lower(a.keyword)='training'
          and a.is_active=true
      );
  end if;
end
$$;

comment on table public.social_comment_automations is
'Immediate social comment keyword automations. Matching comments create a private-reply outbox item.';

comment on table public.social_comment_automation_events is
'Idempotency and delivery audit for automated comment private replies.';
