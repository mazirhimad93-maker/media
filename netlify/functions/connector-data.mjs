import { jsonResponse, publicError, requireAdmin, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    requireAdmin(request);

    const accountsPromise = supabaseRequest(
      'content_accounts?select=id,platform,platform_account_id,username,display_name,status,is_active,health_status,daily_limit,weekly_limit,min_gap_minutes,last_used_at,token_expires_at,scope,capabilities_json,webhook_status,last_inbox_sync_at&order=created_at.desc'
    ).catch(async (error) => {
      // Backward compatibility with the pre-Social-Hub Distributor schema.
      // This lets the dashboard open before the migration has been applied.
      console.warn('Falling back to legacy content_accounts schema:', error.message);
      const legacy = await supabaseRequest(
        'content_accounts?select=id,platform,platform_account_id,username,status,is_active,health_status,daily_limit,weekly_limit,min_gap_minutes,last_used_at,token_expires_at&order=created_at.desc'
      );
      return (legacy || []).map((a) => ({
        ...a,
        display_name: null,
        scope: null,
        capabilities_json: { publish: true },
        webhook_status: 'not_configured',
        last_inbox_sync_at: null,
      }));
    });

    const [campaigns,pools,accounts,memberships] = await Promise.all([
      supabaseRequest('content_campaigns?select=id,name,status,distribution_pool_id&status=eq.active&order=name.asc')
        .catch(() => []),
      supabaseRequest('content_distribution_pools?select=id,name,slug,status&status=eq.active&order=name.asc')
        .catch(() => []),
      accountsPromise,
      supabaseRequest('content_distribution_pool_accounts?select=pool_id,account_id,is_active&is_active=eq.true')
        .catch(() => []),
    ]);

    const poolById=new Map((pools||[]).map(p=>[p.id,p]));
    const campaignByPool=new Map((campaigns||[]).filter(c=>c.distribution_pool_id).map(c=>[c.distribution_pool_id,c]));
    const memberByAccount=new Map((memberships||[]).map(m=>[m.account_id,m]));
    const safeAccounts=(accounts||[]).map(account=>{
      const member=memberByAccount.get(account.id);
      const pool=member?poolById.get(member.pool_id):null;
      const campaign=pool?campaignByPool.get(pool.id):null;
      return {...account,membership:{pool_id:pool?.id||null,pool_name:pool?.name||null,campaign_id:campaign?.id||null,campaign_name:campaign?.name||null}};
    });

    return jsonResponse({campaigns:campaigns||[],pools:pools||[],accounts:safeAccounts});
  } catch(error){ return publicError(error,error.status||500); }
};
