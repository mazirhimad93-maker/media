import { jsonResponse, publicError, supabaseRequest } from './_shared.mjs';

const safe=async path=>supabaseRequest(path).catch(()=>[]);

export default async () => {
  try {
    const [queue,assets,accounts,history,metrics,campaigns] = await Promise.all([
      safe('content_publish_queue?select=*&order=created_at.desc&limit=5000'),
      safe('content_assets?select=*&order=created_at.desc&limit=2000'),
      safe('content_accounts?select=id,platform,username,display_name,platform_account_id&limit=1000'),
      safe('content_history?select=*&order=created_at.desc&limit=7000'),
      safe('post_metrics_snapshots?select=*&order=captured_at.desc&limit=10000'),
      safe('content_campaigns?select=id,name,status&limit=500')
    ]);

    const assetById=new Map((assets||[]).map(x=>[x.id,x]));
    const accountById=new Map((accounts||[]).map(x=>[x.id,x]));
    const campaignById=new Map((campaigns||[]).map(x=>[x.id,x]));

    const historyByQueue=new Map();
    for(const h of history||[]){
      if(h.queue_id && !historyByQueue.has(h.queue_id)) historyByQueue.set(h.queue_id,h);
    }

    const metricByHistory=new Map();
    for(const m of metrics||[]){
      if(m.history_id && !metricByHistory.has(m.history_id)) metricByHistory.set(m.history_id,m);
    }

    const rows=(queue||[]).map(q=>{
      const asset=assetById.get(q.asset_id)||{};
      const account=accountById.get(q.selected_account_id||q.account_id)||{};
      const campaign=campaignById.get(q.campaign_id)||{};
      const h=historyByQueue.get(q.id)||null;
      const m=h?metricByHistory.get(h.id)||{}:{};

      return {
        queue_id:q.id,
        campaign_id:q.campaign_id||asset.campaign_id||null,
        campaign_name:campaign.name||null,
        asset_id:q.asset_id,
        clip_variant_id:asset.clip_variant_id||null,
        platform:q.platform,
        status:q.status,
        title:q.planned_title||q.title||asset.file_name||'Published clip',
        caption:q.planned_caption||q.caption||null,
        account_username:account.username||account.display_name||account.platform_account_id||null,
        source_url:asset.source_url||null,
        external_post_id:q.external_post_id||null,
        external_post_url:q.external_post_url||null,
        scheduled_at:q.scheduled_at||null,
        started_at:q.started_at||null,
        finished_at:q.finished_at||null,
        created_at:q.created_at||null,
        publish_count:asset.publish_count||0,
        media_approval_hold:q.media_approval_hold===true,
        views:Number(m.views||0),
        likes:Number(m.likes||0),
        comments:Number(m.comments||0),
        shares:Number(m.shares||0),
        saves:Number(m.saves||0),
        error:q.error_message||q.last_error||q.error||null
      };
    });

    const published=rows.filter(x=>x.status==='done'||x.external_post_id||x.external_post_url);

    return jsonResponse({
      rows,
      published,
      campaigns:(campaigns||[]).map(c=>({id:c.id,name:c.name,status:c.status})),
      summary:{
        total_queue:rows.length,
        published:published.length,
        ready:rows.filter(x=>x.status==='ready').length,
        running:rows.filter(x=>x.status==='running').length,
        failed:rows.filter(x=>x.status==='failed').length,
        held:rows.filter(x=>x.media_approval_hold).length,
        views:published.reduce((n,x)=>n+x.views,0)
      }
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};