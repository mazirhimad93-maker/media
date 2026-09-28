-- ============================================================
-- ALCHEMIC MEDIA AUTH / USER SYSTEM
-- Run on the SAME Supabase project as the Media/Clipper database.
-- Safe to re-run.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  user_id uuid primary key,
  email text,
  full_name text,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  status text not null default 'active'
    check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists app_users_email_lower_uidx
on public.app_users ((lower(email)))
where email is not null;

create index if not exists app_users_role_status_idx
on public.app_users(role,status);

alter table public.app_users enable row level security;

revoke all on table public.app_users from anon, authenticated;
grant select, insert, update, delete on table public.app_users to service_role;

-- Verification
select
  to_regclass('public.app_users') as app_users_table,
  count(*) as current_users
from public.app_users;
