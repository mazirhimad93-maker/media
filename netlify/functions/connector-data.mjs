import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const localDay=(value,offsetMinutes)=>{
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime()-offsetMinutes*60000).toISOString().slice(0,10);
};

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    const url=new URL(request.url);
    const offsetMinutes=Math.max(-840,Math.min(840,Number(url.searchParams.get('tzOffsetMinutes')||0)));

    const accountsPromise = supabaseRequest(
      scopedPath('content_accounts?select=id,platform,platform_account_id,username,display_name,status,is_active,health_status,daily_limit,weekly_limit,min_gap_minutes,last_used_at,token_expires_at,scope,capabilities_json,webhook_status,last_inbox_sync_at&order=created_at.desc',workspaceId)
    ).catch(async () => {
      const legacy=await supabaseRequest(
        scopedPath('content_accounts?select=id,platform,platform_account_id,username,status,is_active,health_status,daily_limit,weekly_limit,min_gap_minutes,last_used_at,token_expires_at&order=created_at.desc',workspaceId)
      );
      return (legacy||[]).map(a=>({...a,display_name:null,scope:null,capabilities_json:{publish:true},webhook_status:'not_configured',last_inbox_sync_at:null}));
    });

    const [campaigns,pools,accounts,memberships,queue]=await Promise.all([
      supabaseRequest(scopedPath('content_campaigns?select=id,name,status,distribution_pool_id&status=eq.active&order=name.asc',workspaceId)).catch(()=>[]),
      supabaseRequest(scopedPath('content_distribution_pools?select=id,name,slug,status&status=eq.active&order=name.asc',workspaceId)).catch(()=>[]),
      accountsPromise,
      supabaseRequest(scopedPath('content_distribution_pool_accounts?select=pool_id,account_id,is_active&is_active=eq.true',workspaceId)).catch(()=>[]),
      supabaseRequest(scopedPath('content_publish_queue?select=id,selected_account_id,account_id,status,external_post_id,external_post_url,finished_at,created_at&order=created_at.desc&limit=30000',workspaceId)).catch(()=>[])
    ]);

    const today=localDay(new Date(),offsetMinutes);
    const usage=new Map();
    for(const q of queue||[]){
      const accountId=q.selected_account_id||q.account_id;
      if(!accountId) continue;
      const u=usage.get(accountId)||{today:0,total:0,queued:0,failed:0};
      const published=q.status==='done'||Boolean(q.external_post_id)||Boolean(q.external_post_url);
      if(published){
        u.total++;
        const stamp=q.finished_at||q.created_at;
        if(stamp && localDay(stamp,offsetMinutes)===today) u.today++;
      } else if(q.status==='failed') u.failed++;
      else u.queued++;
      usage.set(accountId,u);
    }

    const poolById=new Map((pools||[]).map(p=>[p.id,p]));
    const campaignByPool=new Map((campaigns||[]).filter(c=>c.distribution_pool_id).map(c=>[c.distribution_pool_id,c]));
    const memberByAccount=new Map((memberships||[]).map(m=>[m.account_id,m]));

    const safeAccounts=(accounts||[]).map(account=>{
      const member=memberByAccount.get(account.id);
      const pool=member?poolById.get(member.pool_id):null;
      const campaign=pool?campaignByPool.get(pool.id):null;
      const u=usage.get(account.id)||{today:0,total:0,queued:0,failed:0};
      const daily=Number(account.daily_limit||0);
      const scope=String(account.scope||'');
      const caps=account.capabilities_json||{};
      const metaInbox=['instagram_reels','facebook_page','facebook'].includes(account.platform);
      const messagingPermission=account.platform==='instagram_reels'
        ? (scope.includes('instagram_business_manage_messages')||caps.messages_read===true||caps.messages_send===true)
        : ['facebook_page','facebook'].includes(account.platform)
          ? (scope.includes('pages_messaging')||caps.messages_read===true||caps.messages_send===true)
          : false;
      const insightsPermission=account.platform==='instagram_reels'
        ? (scope.includes('instagram_business_manage_insights')||caps.analytics===true)
        : account.platform==='youtube_shorts'
          ? scope.includes('yt-analytics.readonly')
          : true;

      return {
        id:account.id,
        platform:account.platform,
        username:account.username,
        display_name:account.display_name,
        status:account.status,
        is_active:account.is_active,
        health_status:account.health_status,
        daily_limit:daily,
        weekly_limit:account.weekly_limit,
        min_gap_minutes:account.min_gap_minutes,
        used_today:u.today,
        total_published:u.total,
        queued_now:u.queued,
        failed_total:u.failed,
        daily_remaining:daily>0?Math.max(0,daily-u.today):null,
        daily_usage_percent:daily>0?Math.min(100,Math.round((u.today/daily)*100)):0,
        last_used_at:account.last_used_at,
        token_expires_at:account.token_expires_at,
        capabilities_json:caps,
        webhook_status:account.webhook_status||'not_configured',
        messaging_permission:messagingPermission,
        insights_permission:insightsPermission,
        inbox_state:!metaInbox
          ? 'not_applicable'
          : !messagingPermission
            ? 'reconnect_required'
            : account.webhook_status==='subscribed'
              ? 'ready'
              : 'activate',
        membership:{pool_id:pool?.id||null,pool_name:pool?.name||null,campaign_id:campaign?.id||null,campaign_name:campaign?.name||null}
      };
    });

    return jsonResponse({
      campaigns:campaigns||[],
      pools:pools||[],
      accounts:safeAccounts,
      usage_summary:{
        used_today:safeAccounts.reduce((n,a)=>n+Number(a.used_today||0),0),
        total_published:safeAccounts.reduce((n,a)=>n+Number(a.total_published||0),0),
        queued_now:safeAccounts.reduce((n,a)=>n+Number(a.queued_now||0),0)
      }
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};
