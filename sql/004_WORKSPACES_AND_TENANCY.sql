-- ============================================================
-- ALCHEMIC MEDIA V2 — WORKSPACES / TENANT OWNERSHIP
-- Run once on the Media/Clipper Supabase project.
-- Safe to re-run.
--
-- Existing data is assigned to the current active OWNER account.
-- New users receive a new empty workspace automatically in the app.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.media_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid not null,
  status text not null default 'active'
    check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_workspace_members (
  workspace_id uuid not null references public.media_workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  status text not null default 'active'
    check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

alter table if exists public.app_users
  add column if not exists default_workspace_id uuid references public.media_workspaces(id);

-- Root + derived Media/Clipper tables.
alter table if exists public.content_campaigns add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.distribution_campaigns add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.campaign_sources add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.viral_moments add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.clip_variants add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.content_assets add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.content_publish_queue add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.content_history add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.post_metrics_snapshots add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.content_accounts add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.content_distribution_pools add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.content_distribution_pool_accounts add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.social_contacts add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.social_conversations add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.social_messages add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.social_outbox add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.social_webhook_events add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.tracked_links add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.tracked_link_clicks add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.growth_events add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.clip_presets add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.clip_preset_versions add column if not exists workspace_id uuid references public.media_workspaces(id);
alter table if exists public.funnel_leads add column if not exists workspace_id uuid references public.media_workspaces(id);

do $migration$
declare
  v_owner uuid;
  v_workspace uuid;
  v_slug text := 'alchemic-legacy';
begin
  select user_id into v_owner
  from public.app_users
  where status='active' and role='owner'
  order by created_at asc
  limit 1;

  if v_owner is null then
    select user_id into v_owner
    from public.app_users
    where status='active'
    order by created_at asc
    limit 1;
  end if;

  if v_owner is null then
    raise exception 'No active app_users account exists. Sign in once before running this migration.';
  end if;

  select id into v_workspace
  from public.media_workspaces
  where slug=v_slug
  limit 1;

  if v_workspace is null then
    insert into public.media_workspaces(name,slug,owner_user_id)
    values ('Alchemic Media',v_slug,v_owner)
    returning id into v_workspace;
  else
    update public.media_workspaces
    set owner_user_id=v_owner, updated_at=now()
    where id=v_workspace;
  end if;

  insert into public.media_workspace_members(workspace_id,user_id,role,status)
  values(v_workspace,v_owner,'owner','active')
  on conflict(workspace_id,user_id)
  do update set role='owner',status='active';

  update public.app_users
  set default_workspace_id=v_workspace, role='owner', updated_at=now()
  where user_id=v_owner;

  -- Existing business data belongs to the owner's legacy workspace.
  if to_regclass('public.content_campaigns') is not null then
    update public.content_campaigns set workspace_id=v_workspace where workspace_id is null;
  end if;
  if to_regclass('public.distribution_campaigns') is not null then
    update public.distribution_campaigns set workspace_id=v_workspace where workspace_id is null;
  end if;
  if to_regclass('public.content_accounts') is not null then
    update public.content_accounts set workspace_id=v_workspace where workspace_id is null;
  end if;
  if to_regclass('public.content_distribution_pools') is not null then
    update public.content_distribution_pools set workspace_id=v_workspace where workspace_id is null;
  end if;
  if to_regclass('public.tracked_links') is not null then
    update public.tracked_links set workspace_id=v_workspace where workspace_id is null;
  end if;
  if to_regclass('public.funnel_leads') is not null then
    update public.funnel_leads set workspace_id=v_workspace where workspace_id is null;
  end if;

  -- Presets marked as system remain global. Existing custom presets belong to Alchemic.
  if to_regclass('public.clip_presets') is not null then
    update public.clip_presets
    set workspace_id=v_workspace
    where workspace_id is null and coalesce(is_system,false)=false;
  end if;

  -- Derived Clipper rows.
  if to_regclass('public.campaign_sources') is not null then
    update public.campaign_sources s
    set workspace_id=coalesce(
      (select workspace_id from public.distribution_campaigns c where c.id=s.campaign_id),
      v_workspace
    )
    where s.workspace_id is null;
  end if;

  if to_regclass('public.viral_moments') is not null then
    update public.viral_moments m
    set workspace_id=coalesce(
      (select workspace_id from public.distribution_campaigns c where c.id=m.campaign_id),
      v_workspace
    )
    where m.workspace_id is null;
  end if;

  if to_regclass('public.clip_variants') is not null then
    update public.clip_variants v
    set workspace_id=coalesce(
      (select workspace_id from public.distribution_campaigns c where c.id=v.campaign_id),
      (select workspace_id from public.content_campaigns c where c.id=v.campaign_id),
      (select workspace_id from public.campaign_sources s where s.id=v.source_id),
      v_workspace
    )
    where v.workspace_id is null;
  end if;

  if to_regclass('public.content_assets') is not null then
    update public.content_assets a
    set workspace_id=coalesce(
      (select workspace_id from public.content_campaigns c where c.id=a.campaign_id),
      (select workspace_id from public.distribution_campaigns c where c.id=a.campaign_id),
      (select workspace_id from public.clip_variants v where v.id=a.clip_variant_id),
      v_workspace
    )
    where a.workspace_id is null;
  end if;

  if to_regclass('public.content_publish_queue') is not null then
    update public.content_publish_queue q
    set workspace_id=coalesce(
      (select workspace_id from public.content_campaigns c where c.id=q.campaign_id),
      (select workspace_id from public.distribution_campaigns c where c.id=q.campaign_id),
      (select workspace_id from public.content_assets a where a.id=q.asset_id),
      (select workspace_id from public.content_accounts a where a.id=coalesce(q.selected_account_id,q.account_id)),
      v_workspace
    )
    where q.workspace_id is null;
  end if;

  if to_regclass('public.content_history') is not null then
    update public.content_history h
    set workspace_id=coalesce(
      (select workspace_id from public.content_publish_queue q where q.id=h.queue_id),
      (select workspace_id from public.content_accounts a where a.id=h.account_id),
      (select workspace_id from public.content_campaigns c where c.id=h.campaign_id),
      (select workspace_id from public.distribution_campaigns c where c.id=h.campaign_id),
      v_workspace
    )
    where h.workspace_id is null;
  end if;

  if to_regclass('public.post_metrics_snapshots') is not null then
    update public.post_metrics_snapshots m
    set workspace_id=coalesce(
      (select workspace_id from public.content_history h where h.id=m.history_id),
      v_workspace
    )
    where m.workspace_id is null;
  end if;

  if to_regclass('public.content_distribution_pool_accounts') is not null then
    update public.content_distribution_pool_accounts m
    set workspace_id=coalesce(
      (select workspace_id from public.content_distribution_pools p where p.id=m.pool_id),
      (select workspace_id from public.content_accounts a where a.id=m.account_id),
      v_workspace
    )
    where m.workspace_id is null;
  end if;

  -- Social / Inbox rows.
  if to_regclass('public.social_conversations') is not null then
    update public.social_conversations c
    set workspace_id=coalesce(
      (select workspace_id from public.content_accounts a where a.id=c.account_id),
      v_workspace
    )
    where c.workspace_id is null;
  end if;

  if to_regclass('public.social_contacts') is not null then
    update public.social_contacts c
    set workspace_id=coalesce(
      (select sc.workspace_id from public.social_conversations sc where sc.contact_id=c.id order by sc.created_at asc limit 1),
      v_workspace
    )
    where c.workspace_id is null;
  end if;

  if to_regclass('public.social_messages') is not null then
    update public.social_messages m
    set workspace_id=coalesce(
      (select workspace_id from public.social_conversations c where c.id=m.conversation_id),
      (select workspace_id from public.content_accounts a where a.id=m.account_id),
      v_workspace
    )
    where m.workspace_id is null;
  end if;

  if to_regclass('public.social_outbox') is not null then
    update public.social_outbox o
    set workspace_id=coalesce(
      (select workspace_id from public.social_conversations c where c.id=o.conversation_id),
      (select workspace_id from public.content_accounts a where a.id=o.account_id),
      v_workspace
    )
    where o.workspace_id is null;
  end if;

  if to_regclass('public.social_webhook_events') is not null then
    update public.social_webhook_events e
    set workspace_id=coalesce(
      (select workspace_id from public.content_accounts a where a.platform_account_id=e.account_platform_id limit 1),
      v_workspace
    )
    where e.workspace_id is null;
  end if;

  if to_regclass('public.tracked_link_clicks') is not null then
    update public.tracked_link_clicks c
    set workspace_id=coalesce(
      (select workspace_id from public.tracked_links l where l.id=c.tracked_link_id),
      v_workspace
    )
    where c.workspace_id is null;
  end if;

  if to_regclass('public.growth_events') is not null then
    update public.growth_events g
    set workspace_id=coalesce(
      (select workspace_id from public.content_accounts a where a.id=g.account_id),
      (select workspace_id from public.social_conversations c where c.id=g.social_conversation_id),
      (select workspace_id from public.tracked_links l where l.id=g.tracked_link_id),
      (select workspace_id from public.content_campaigns c where c.id=g.campaign_id),
      (select workspace_id from public.distribution_campaigns c where c.id=g.campaign_id),
      v_workspace
    )
    where g.workspace_id is null;
  end if;

  if to_regclass('public.clip_preset_versions') is not null then
    update public.clip_preset_versions v
    set workspace_id=coalesce(
      (select workspace_id from public.clip_presets p where p.id=v.preset_id),
      v_workspace
    )
    where v.workspace_id is null
      and exists(select 1 from public.clip_presets p where p.id=v.preset_id and coalesce(p.is_system,false)=false);
  end if;
end
$migration$;

-- Propagate workspace ownership automatically for rows created by n8n/workers.
create or replace function public.alchemic_inherit_workspace()
returns trigger
language plpgsql
set search_path=public
as $fn$
begin
  if new.workspace_id is not null then return new; end if;

  case tg_table_name
    when 'campaign_sources' then
      select workspace_id into new.workspace_id from distribution_campaigns where id=new.campaign_id;
    when 'viral_moments' then
      select workspace_id into new.workspace_id from distribution_campaigns where id=new.campaign_id;
    when 'clip_variants' then
      select coalesce(
        (select workspace_id from distribution_campaigns where id=new.campaign_id),
        (select workspace_id from content_campaigns where id=new.campaign_id),
        (select workspace_id from campaign_sources where id=new.source_id)
      ) into new.workspace_id;
    when 'content_assets' then
      select coalesce(
        (select workspace_id from content_campaigns where id=new.campaign_id),
        (select workspace_id from distribution_campaigns where id=new.campaign_id),
        (select workspace_id from clip_variants where id=new.clip_variant_id)
      ) into new.workspace_id;
    when 'content_publish_queue' then
      select coalesce(
        (select workspace_id from content_campaigns where id=new.campaign_id),
        (select workspace_id from distribution_campaigns where id=new.campaign_id),
        (select workspace_id from content_assets where id=new.asset_id),
        (select workspace_id from content_accounts where id=coalesce(new.selected_account_id,new.account_id))
      ) into new.workspace_id;
    when 'content_history' then
      select coalesce(
        (select workspace_id from content_publish_queue where id=new.queue_id),
        (select workspace_id from content_accounts where id=new.account_id),
        (select workspace_id from content_campaigns where id=new.campaign_id),
        (select workspace_id from distribution_campaigns where id=new.campaign_id)
      ) into new.workspace_id;
    when 'post_metrics_snapshots' then
      select workspace_id into new.workspace_id from content_history where id=new.history_id;
    when 'content_distribution_pool_accounts' then
      select coalesce(
        (select workspace_id from content_distribution_pools where id=new.pool_id),
        (select workspace_id from content_accounts where id=new.account_id)
      ) into new.workspace_id;
    when 'social_conversations' then
      select workspace_id into new.workspace_id from content_accounts where id=new.account_id;
    when 'social_messages' then
      select coalesce(
        (select workspace_id from social_conversations where id=new.conversation_id),
        (select workspace_id from content_accounts where id=new.account_id)
      ) into new.workspace_id;
    when 'social_outbox' then
      select coalesce(
        (select workspace_id from social_conversations where id=new.conversation_id),
        (select workspace_id from content_accounts where id=new.account_id)
      ) into new.workspace_id;
    when 'social_webhook_events' then
      select workspace_id into new.workspace_id
      from content_accounts where platform_account_id=new.account_platform_id limit 1;
    when 'tracked_link_clicks' then
      select workspace_id into new.workspace_id from tracked_links where id=new.tracked_link_id;
    when 'growth_events' then
      select coalesce(
        (select workspace_id from content_accounts where id=new.account_id),
        (select workspace_id from social_conversations where id=new.social_conversation_id),
        (select workspace_id from tracked_links where id=new.tracked_link_id),
        (select workspace_id from content_campaigns where id=new.campaign_id),
        (select workspace_id from distribution_campaigns where id=new.campaign_id)
      ) into new.workspace_id;
    else
      null;
  end case;

  return new;
end
$fn$;

do $triggers$
declare
  t text;
begin
  foreach t in array array[
    'campaign_sources','viral_moments','clip_variants','content_assets',
    'content_publish_queue','content_history','post_metrics_snapshots',
    'content_distribution_pool_accounts','social_conversations','social_messages',
    'social_outbox','social_webhook_events','tracked_link_clicks','growth_events'
  ]
  loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_alchemic_workspace on public.%I',t);
      execute format(
        'create trigger trg_alchemic_workspace before insert or update on public.%I for each row execute function public.alchemic_inherit_workspace()',
        t
      );
    end if;
  end loop;
end
$triggers$;

-- A person may legitimately message channels owned by different workspaces.
-- Keep those CRM/contact records isolated per workspace.
do $contact_unique$
declare r record;
begin
  if to_regclass('public.social_contacts') is not null then
    for r in
      select conname
      from pg_constraint
      where conrelid='public.social_contacts'::regclass
        and contype='u'
        and pg_get_constraintdef(oid) ilike '%(platform, platform_user_id)%'
    loop
      execute format('alter table public.social_contacts drop constraint %I',r.conname);
    end loop;
  end if;
end
$contact_unique$;

create unique index if not exists social_contacts_workspace_platform_user_uidx
on public.social_contacts(workspace_id,platform,platform_user_id);

create index if not exists media_workspace_members_user_idx on public.media_workspace_members(user_id,status);
create index if not exists content_campaigns_workspace_idx on public.content_campaigns(workspace_id) where workspace_id is not null;
create index if not exists distribution_campaigns_workspace_idx on public.distribution_campaigns(workspace_id) where workspace_id is not null;
create index if not exists content_accounts_workspace_idx on public.content_accounts(workspace_id) where workspace_id is not null;
create index if not exists content_publish_queue_workspace_idx on public.content_publish_queue(workspace_id) where workspace_id is not null;
create index if not exists clip_variants_workspace_idx on public.clip_variants(workspace_id) where workspace_id is not null;
create index if not exists social_conversations_workspace_idx on public.social_conversations(workspace_id) where workspace_id is not null;

alter table public.media_workspaces enable row level security;
alter table public.media_workspace_members enable row level security;
revoke all on public.media_workspaces from anon,authenticated;
revoke all on public.media_workspace_members from anon,authenticated;
grant select,insert,update,delete on public.media_workspaces to service_role;
grant select,insert,update,delete on public.media_workspace_members to service_role;

-- Final verification.
select
  w.id as workspace_id,
  w.name,
  w.owner_user_id,
  (select count(*) from public.content_campaigns c where c.workspace_id=w.id) as content_campaigns,
  (select count(*) from public.distribution_campaigns c where c.workspace_id=w.id) as clipper_campaigns,
  (select count(*) from public.content_accounts a where a.workspace_id=w.id) as channels,
  (select count(*) from public.clip_variants v where v.workspace_id=w.id) as clips
from public.media_workspaces w
order by w.created_at;
