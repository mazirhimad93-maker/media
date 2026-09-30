-- Alchemic Media
-- Repair/bootstrap the TRAINING comment-to-DM funnel for existing Instagram channels.
-- Safe to run multiple times after 002_comment_automation_and_daily_metrics.sql.

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
        'Hey! Saw you commented TRAINING 👋 Reply YES and I’ll send it here.',
        true,
        jsonb_build_object(
          'seeded_by','003_comment_conversation_funnel',
          'conversation_starter',true
        )
      from public.content_accounts ca
      where ca.platform='instagram_reels'
        and coalesce(ca.is_active,true)=true
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
      'Hey! Saw you commented TRAINING 👋 Reply YES and I’ll send it here.',
      true,
      jsonb_build_object(
        'seeded_by','003_comment_conversation_funnel',
        'conversation_starter',true
      )
    from public.content_accounts ca
    where ca.platform='instagram_reels'
      and coalesce(ca.is_active,true)=true
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

-- Upgrade only the exact default text created by migration 002.
-- User-edited CTA messages are intentionally left untouched.
update public.social_comment_automations
set
  dm_message='Hey! Saw you commented TRAINING 👋 Reply YES and I’ll send it here.',
  metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'conversation_starter',true,
    'upgraded_by','003_comment_conversation_funnel'
  ),
  updated_at=now()
where lower(keyword)='training'
  and dm_message='Hey! Saw you commented TRAINING — I’ve got you. I’ll send it over here.'
  and coalesce(metadata->>'seeded_by','')='002_comment_automation_and_daily_metrics';

select
  a.id,
  a.workspace_id,
  a.account_id,
  ca.username,
  a.keyword,
  a.match_type,
  a.dm_message,
  a.is_active
from public.social_comment_automations a
left join public.content_accounts ca on ca.id=a.account_id
where lower(a.keyword)='training'
order by ca.username nulls last, a.created_at;
