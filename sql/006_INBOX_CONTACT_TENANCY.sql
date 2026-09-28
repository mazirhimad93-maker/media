-- ============================================================
-- ALCHEMIC MEDIA V6 — INBOX CONTACT TENANCY
-- Run once on the Media Supabase project. Safe to re-run.
-- ============================================================

-- Old Social Hub schema made an Instagram/Facebook person globally unique.
-- Multi-workspace Media needs the same person to be able to contact different
-- customer workspaces independently.

alter table if exists public.social_contacts
  drop constraint if exists social_contacts_platform_platform_user_id_key;

create unique index if not exists social_contacts_workspace_platform_user_uidx
  on public.social_contacts(workspace_id, platform, platform_user_id)
  where workspace_id is not null;

-- Keep legacy/null-workspace rows protected until they are migrated.
create unique index if not exists social_contacts_legacy_platform_user_uidx
  on public.social_contacts(platform, platform_user_id)
  where workspace_id is null;

select
  count(*) as contacts,
  count(*) filter (where workspace_id is null) as contacts_without_workspace
from public.social_contacts;
