-- Run AFTER 001_social_hub.sql on the CONTENT / DISTRIBUTOR database.
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in ('social_contacts','social_conversations','social_messages','social_outbox','social_webhook_events','tracked_links','tracked_link_clicks','growth_events')
order by table_name;

select id, platform, username, scope, capabilities_json, webhook_status
from public.content_accounts
order by created_at desc;

select count(*) as social_contacts from public.social_contacts;
select count(*) as social_conversations from public.social_conversations;
select count(*) as social_messages from public.social_messages;
select count(*) as queued_social_replies from public.social_outbox where status = 'pending';
