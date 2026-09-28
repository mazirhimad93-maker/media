import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const safe=async path=>supabaseRequest(path).catch(()=>[]);

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    const [queue,assets,accounts,history,metrics,campaigns] = await Promise.all([
      safe(scopedPath('content_publish_queue?select=*&order=created_at.desc&limit=5000',workspaceId)),
      safe(scopedPath('content_assets?select=*&order=created_at.desc&limit=3000',workspaceId)),
      safe(scopedPath('content_accounts?select=id,platform,username,display_name,platform_account_id&limit=2000',workspaceId)),
      safe(scopedPath('content_history?select=*&order=created_at.desc&limit=10000',workspaceId)),
      safe(scopedPath('post_metrics_snapshots?select=*&order=captured_at.asc&limit=20000',workspaceId)),
      safe(scopedPath('content_campaigns?select=id,name,status&limit=1000',workspaceId))
    ]);

    const assetById=new Map((assets||[]).map(x=>[x.id,x]));
    const accountById=new Map((accounts||[]).map(x=>[x.id,x]));
    const campaignById=new Map((campaigns||[]).map(x=>[x.id,x]));
    const queueById=new Map((queue||[]).map(x=>[x.id,x]));

    const historyByQueue=new Map();
    const historyById=new Map();
    for(const h of history||[]){
      historyById.set(h.id,h);
      if(h.queue_id && !historyByQueue.has(h.queue_id)) historyByQueue.set(h.queue_id,h);
    }

    const latestMetricByHistory=new Map();
    const metricSeriesByHistory=new Map();
    for(const m of metrics||[]){
      if(!m.history_id) continue;
      const list=metricSeriesByHistory.get(m.history_id)||[];
      list.push(m);
      metricSeriesByHistory.set(m.history_id,list);
      const current=latestMetricByHistory.get(m.history_id);
      if(!current||new Date(m.captured_at||0)>new Date(current.captured_at||0)) latestMetricByHistory.set(m.history_id,m);
    }

    const rows=(queue||[]).map(q=>{
      const asset=assetById.get(q.asset_id)||{};
      const account=accountById.get(q.selected_account_id||q.account_id)||{};
      const campaignId=q.campaign_id||asset.campaign_id||null;
      const campaign=campaignById.get(campaignId)||{};
      const h=historyByQueue.get(q.id)||null;
      const m=h?latestMetricByHistory.get(h.id)||{}:{};
      const likes=Number(m.likes||0);
      const comments=Number(m.comments||0);
      const shares=Number(m.shares||0);
      const saves=Number(m.saves||0);
      const views=Number(m.views||0);
      const engagements=likes+comments+shares+saves;

      return {
        queue_id:q.id,
        history_id:h?.id||null,
        campaign_id:campaignId,
        campaign_name:campaign.name||null,
        asset_id:q.asset_id,
        clip_variant_id:asset.clip_variant_id||null,
        platform:q.platform||account.platform||null,
        status:q.status,
        title:q.planned_title||q.title||asset.file_name||'Published clip',
        caption:q.planned_caption||q.caption||null,
        account_username:account.username||account.display_name||account.platform_account_id||null,
        source_url:asset.source_url||asset.url||null,
        external_post_id:q.external_post_id||null,
        external_post_url:q.external_post_url||null,
        scheduled_at:q.scheduled_at||null,
        started_at:q.started_at||null,
        finished_at:q.finished_at||null,
        created_at:q.created_at||null,
        publish_count:asset.publish_count||0,
        media_approval_hold:q.media_approval_hold===true,
        views,
        likes,
        comments,
        shares,
        saves,
        engagements,
        engagement_rate:views>0?engagements/views*100:0,
        metrics_captured_at:m.captured_at||null,
        error:q.error_message||q.last_error||q.error||null
      };
    });

    // Return per-snapshot deltas for the chart. This avoids double-counting repeated
    // absolute snapshots while still letting the client filter by campaign/platform.
    const metric_points=[];
    for(const [historyId,series] of metricSeriesByHistory.entries()){
      const h=historyById.get(historyId);
      const q=h?.queue_id?queueById.get(h.queue_id):null;
      if(!q) continue;
      const asset=assetById.get(q.asset_id)||{};
      const campaignId=q.campaign_id||asset.campaign_id||null;
      const account=accountById.get(q.selected_account_id||q.account_id)||{};
      let prev={views:0,likes:0,comments:0,shares:0,saves:0};

      for(const m of series.slice().sort((a,b)=>new Date(a.captured_at||0)-new Date(b.captured_at||0))){
        const current={
          views:Number(m.views||0),
          likes:Number(m.likes||0),
          comments:Number(m.comments||0),
          shares:Number(m.shares||0),
          saves:Number(m.saves||0)
        };
        const delta={
          views:Math.max(0,current.views-prev.views),
          likes:Math.max(0,current.likes-prev.likes),
          comments:Math.max(0,current.comments-prev.comments),
          shares:Math.max(0,current.shares-prev.shares),
          saves:Math.max(0,current.saves-prev.saves)
        };
        metric_points.push({
          history_id:historyId,
          queue_id:q.id,
          campaign_id:campaignId,
          platform:q.platform||account.platform||null,
          captured_at:m.captured_at,
          ...delta,
          engagements:delta.likes+delta.comments+delta.shares+delta.saves
        });
        prev=current;
      }
    }

    const published=rows.filter(x=>x.status==='done'||x.external_post_id||x.external_post_url);

    return jsonResponse({
      rows,
      published,
      metric_points,
      campaigns:(campaigns||[]).map(c=>({id:c.id,name:c.name,status:c.status})),
      summary:{
        total_queue:rows.length,
        published:published.length,
        ready:rows.filter(x=>x.status==='ready').length,
        running:rows.filter(x=>x.status==='running').length,
        failed:rows.filter(x=>x.status==='failed').length,
        held:rows.filter(x=>x.media_approval_hold).length,
        views:published.reduce((n,x)=>n+x.views,0),
        likes:published.reduce((n,x)=>n+x.likes,0),
        comments:published.reduce((n,x)=>n+x.comments,0),
        shares:published.reduce((n,x)=>n+x.shares,0),
        saves:published.reduce((n,x)=>n+x.saves,0),
        engagements:published.reduce((n,x)=>n+x.engagements,0),
        latest_metrics_at:published.map(x=>x.metrics_captured_at).filter(Boolean).sort().at(-1)||null
      }
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};
