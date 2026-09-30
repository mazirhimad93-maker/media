-- ============================================================
-- ALCHEMIC MEDIA — DEMO WORKSPACE SUPPORT
-- Adds an explicit sample-data flag so the demo can look complete without
-- presenting synthetic performance as real customer results.
-- Safe to re-run.
-- ============================================================

alter table if exists public.media_workspaces
  add column if not exists is_demo boolean not null default false;

alter table if exists public.media_workspaces
  add column if not exists demo_note text;

create index if not exists media_workspaces_is_demo_idx
  on public.media_workspaces(is_demo)
  where is_demo = true;

comment on column public.media_workspaces.is_demo is
'True for sample workspaces whose metrics, leads and conversations are synthetic demonstration data.';

comment on column public.media_workspaces.demo_note is
'Short disclosure rendered in the UI for sample/demo workspaces.';
