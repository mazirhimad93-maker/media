-- Alchemic Media: current post metrics and observed daily growth.
-- Run this entire file in the Media project's Supabase SQL Editor.
-- Safe to run again. Existing counts are retained; no views are invented.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index if not exists media_metrics_workspace_history_latest_idx
  on public.post_metrics_snapshots(workspace_id, history_id, captured_at desc, id desc);
create index if not exists media_metrics_history_latest_idx
  on public.post_metrics_snapshots(history_id, captured_at desc, id desc);

create or replace view public.v_media_latest_post_metrics
with (security_invoker = true) as
select distinct on (m.history_id)
  m.id, m.history_id, h.workspace_id, m.captured_at,
  m.views, m.likes, m.comments, m.shares, m.saves,
  coalesce(m.raw_json->>'insights_ok' = 'true', false) as insights_ok
from public.post_metrics_snapshots m
join public.content_history h on h.id = m.history_id
where h.event_type = 'published'
  and (m.workspace_id = h.workspace_id or m.workspace_id is null)
order by m.history_id, m.captured_at desc, m.id desc;

-- Instagram's first measured lifetime count is a baseline, not daily views.
-- Only increases after a previous valid measurement are recorded as growth.
-- A provider count correction followed by recovery must not count twice.
create or replace view public.v_media_post_metric_growth
with (security_invoker = true) as
with valid as (
  select m.id, m.history_id, h.workspace_id, m.captured_at,
    case when h.platform = 'instagram_reels'
               and coalesce(m.raw_json->>'insights_ok', 'false') <> 'true'
         then null else m.views end as views,
    m.likes, m.comments, m.shares, m.saves
  from public.post_metrics_snapshots m
  join public.content_history h on h.id = m.history_id
  where h.event_type = 'published'
    and (m.workspace_id = h.workspace_id or m.workspace_id is null)
), sampled as (
  select *,
    max(views) over previous as prior_views,
    max(likes) over previous as prior_likes,
    max(comments) over previous as prior_comments,
    max(shares) over previous as prior_shares,
    max(saves) over previous as prior_saves
  from valid
  window previous as (
    partition by history_id order by captured_at, id
    rows between unbounded preceding and 1 preceding
  )
)
select workspace_id, history_id, (captured_at at time zone 'UTC')::date as metric_date,
  sum(case when prior_views is null or views is null then 0 else greatest(views-prior_views,0) end)::bigint as views,
  sum(case when prior_likes is null then 0 else greatest(likes-prior_likes,0) end)::bigint as likes,
  sum(case when prior_comments is null then 0 else greatest(comments-prior_comments,0) end)::bigint as comments,
  sum(case when prior_shares is null then 0 else greatest(shares-prior_shares,0) end)::bigint as shares,
  sum(case when prior_saves is null then 0 else greatest(saves-prior_saves,0) end)::bigint as saves
from sampled
group by workspace_id, history_id, (captured_at at time zone 'UTC')::date;

revoke all on public.v_media_latest_post_metrics from public, anon, authenticated;
revoke all on public.v_media_post_metric_growth from public, anon, authenticated;
grant select on public.v_media_latest_post_metrics to service_role;
grant select on public.v_media_post_metric_growth to service_role;

notify pgrst, 'reload schema';
commit;

-- Verification: current measured totals for each workspace and platform.
select w.name as workspace, h.platform,
  count(*) as measured_posts,
  sum(case when h.platform <> 'instagram_reels' or m.insights_ok then m.views else null end) as measured_lifetime_views,
  max(m.captured_at) as latest_capture
from public.v_media_latest_post_metrics m
join public.content_history h on h.id = m.history_id
join public.media_workspaces w on w.id = m.workspace_id
group by w.name, h.platform
order by w.name, h.platform;
