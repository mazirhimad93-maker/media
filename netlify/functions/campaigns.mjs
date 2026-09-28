import { jsonResponse, publicError, requireUser, supabaseRequest } from './_shared.mjs';

const safe=async path=>supabaseRequest(path).catch(()=>[]);

export default async (request) => {
  try{
    await requireUser(request);
    const [campaigns,pools,memberships,accounts,variants,assets,queue,history,metrics]=await Promise.all([
      safe('content_campaigns?select=*&limit=500'),
      safe('content_distribution_pools?select=*&limit=200'),
      safe('content_distribution_pool_accounts?select=pool_id,account_id,is_active,priority,weight&limit=2000'),
      safe('content_accounts?select=id,platform,username,display_name,status,is_active&limit=1000'),
      safe('clip_variants?select=id,campaign_id,status,created_at&limit=2000'),
      safe('content_assets?select=id,campaign_id,clip_variant_id,media_publish_approved,publish_count,status,created_at&limit=2000'),
      safe('content_publish_queue?select=id,campaign_id,asset_id,platform,status,external_post_id,external_post_url,selected_account_id,account_id,created_at,finished_at&limit=5000'),
      safe('content_history?select=id,queue_id,event_type,created_at&order=created_at.desc&limit=7000'),
      safe('post_metrics_snapshots?select=history_id,captured_at,views,likes,comments,shares,saves&order=captured_at.desc&limit=10000')
    ]);

    const poolById=new Map((pools||[]).map(x=>[x.id,x]));
    const accountById=new Map((accounts||[]).map(x=>[x.id,x]));
    const variantCampaign=new Map((variants||[]).map(v=>[v.id,v.campaign_id]));

    const historyByQueue=new Map();
    for(const h of history||[]){
      if(h.queue_id && !historyByQueue.has(h.queue_id)) historyByQueue.set(h.queue_id,h);
    }
    const metricByHistory=new Map();
    for(const m of metrics||[]){
      if(m.history_id && !metricByHistory.has(m.history_id)) metricByHistory.set(m.history_id,m);
    }

    const rows=(campaigns||[]).map(c=>{
      const campaignVariants=(variants||[]).filter(v=>v.campaign_id===c.id);
      const variantIds=new Set(campaignVariants.map(v=>v.id));
      const campaignAssets=(assets||[]).filter(a=>a.campaign_id===c.id || (a.clip_variant_id && variantIds.has(a.clip_variant_id)));
      const assetIds=new Set(campaignAssets.map(a=>a.id));
      const campaignQueue=(queue||[]).filter(q=>q.campaign_id===c.id || assetIds.has(q.asset_id));
      const published=campaignQueue.filter(q=>q.status==='done'||q.external_post_id||q.external_post_url);
      const failed=campaignQueue.filter(q=>q.status==='failed');
      const ready=campaignQueue.filter(q=>q.status==='ready');
      const running=campaignQueue.filter(q=>q.status==='running');

      let views=0,likes=0,comments=0,shares=0,saves=0;
      for(const q of published){
        const h=historyByQueue.get(q.id);
        const m=h?metricByHistory.get(h.id):null;
        if(!m) continue;
        views+=Number(m.views||0);
        likes+=Number(m.likes||0);
        comments+=Number(m.comments||0);
        shares+=Number(m.shares||0);
        saves+=Number(m.saves||0);
      }

      const channelIds=new Set();
      for(const q of campaignQueue){
        const id=q.selected_account_id||q.account_id;
        if(id) channelIds.add(id);
      }
      if(c.distribution_pool_id){
        for(const m of memberships||[]){
          if(m.pool_id===c.distribution_pool_id && m.is_active!==false) channelIds.add(m.account_id);
        }
      }
      const channels=[...channelIds].map(id=>accountById.get(id)).filter(Boolean);

      return {
        id:c.id,
        name:c.name||'Untitled campaign',
        status:c.status||'unknown',
        description:c.description||null,
        distribution_pool_id:c.distribution_pool_id||null,
        pool_name:poolById.get(c.distribution_pool_id)?.name||null,
        created_at:c.created_at||null,
        updated_at:c.updated_at||null,
        clips:campaignVariants.length || campaignAssets.length,
        assets:campaignAssets.length,
        needs_approval:campaignAssets.filter(a=>a.media_publish_approved===false).length,
        approved:campaignAssets.filter(a=>a.media_publish_approved!==false).length,
        queue_jobs:campaignQueue.length,
        ready:ready.length,
        running:running.length,
        failed:failed.length,
        published:published.length,
        views,likes,comments,shares,saves,
        platforms:[...new Set(campaignQueue.map(q=>q.platform).filter(Boolean))],
        channels:channels.map(a=>({id:a.id,platform:a.platform,username:a.username||a.display_name||a.id})),
        published_urls:published.map(q=>({platform:q.platform,url:q.external_post_url,id:q.external_post_id,status:q.status})).filter(x=>x.url||x.id)
      };
    });

    rows.sort((a,b)=>{
      const at=new Date(a.updated_at||a.created_at||0).getTime();
      const bt=new Date(b.updated_at||b.created_at||0).getTime();
      return bt-at;
    });

    return jsonResponse({
      campaigns:rows,
      summary:{
        total:rows.length,
        active:rows.filter(x=>x.status==='active').length,
        clips:rows.reduce((n,x)=>n+x.clips,0),
        needs_approval:rows.reduce((n,x)=>n+x.needs_approval,0),
        published:rows.reduce((n,x)=>n+x.published,0),
        views:rows.reduce((n,x)=>n+x.views,0)
      }
    });
  }catch(error){
    return publicError(error,error.status||500);
  }
};