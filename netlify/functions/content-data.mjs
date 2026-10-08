import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';
import { loadMetricData, readAllRows } from './_analytics-read.mjs';

const n=v=>Number(v||0);

export async function loadContentData(workspaceId, db=supabaseRequest) {
    const warnings=[];
    const read=path=>readAllRows(path,{db});
    const optional=async path=>{
      try{return await read(path);}
      catch(error){warnings.push({section:path.split('?')[0],error:'This analytics section could not be loaded.'});return [];}
    };

    const [queue,assets,accounts,history,metricData,dailyMetrics,campaigns,links,clicks,conversations,messages] = await Promise.all([
      read(scopedPath('content_publish_queue?select=*&order=created_at.desc,id.desc',workspaceId)),
      read(scopedPath('content_assets?select=*&order=created_at.desc,id.desc',workspaceId)),
      read(scopedPath('content_accounts?select=id,platform,username,display_name,platform_account_id&order=id.asc',workspaceId)),
      read(scopedPath('content_history?select=*&event_type=eq.published&order=created_at.desc,id.desc',workspaceId)),
      loadMetricData(workspaceId,db),
      optional(scopedPath('post_daily_metrics?select=*&order=metric_date.asc,id.asc',workspaceId)),
      read(scopedPath('content_campaigns?select=id,name,status&order=id.asc',workspaceId)),
      optional(scopedPath('tracked_links?select=id,campaign_id,asset_id,history_id,account_id,slug,destination_url&order=id.asc',workspaceId)),
      optional(scopedPath('tracked_link_clicks?select=id,tracked_link_id,occurred_at&order=occurred_at.asc,id.asc',workspaceId)),
      optional(scopedPath('social_conversations?select=id,account_id,source_history_id,source_external_post_id,created_at,last_inbound_at,last_message_at&order=id.asc',workspaceId)),
      optional(scopedPath('social_messages?select=id,conversation_id,direction,message_type,sent_at,created_at&order=sent_at.asc,id.asc',workspaceId))
    ]);
    const metrics=metricData.latest;

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
    for(const m of metricData.samples||[]){
      if(!m.history_id) continue;
      const list=metricSeriesByHistory.get(m.history_id)||[];
      list.push(m);
      metricSeriesByHistory.set(m.history_id,list);
    }
    for(const m of metrics) latestMetricByHistory.set(m.history_id,m);

    const dailyByHistory=new Map();
    for(const d of dailyMetrics||[]){
      if(!d.history_id) continue;
      const list=dailyByHistory.get(d.history_id)||[];
      list.push(d);
      dailyByHistory.set(d.history_id,list);
    }

    const linksByHistory=new Map();
    const linksByAsset=new Map();
    const linkById=new Map();
    for(const link of links||[]){
      linkById.set(link.id,link);
      if(link.history_id){
        const list=linksByHistory.get(link.history_id)||[];
        list.push(link); linksByHistory.set(link.history_id,list);
      }else if(link.asset_id){
        const list=linksByAsset.get(link.asset_id)||[];
        list.push(link); linksByAsset.set(link.asset_id,list);
      }
    }

    const clicksByLink=new Map();
    for(const click of clicks||[]){
      const list=clicksByLink.get(click.tracked_link_id)||[];
      list.push(click); clicksByLink.set(click.tracked_link_id,list);
    }

    const convByHistory=new Map();
    const convByExternal=new Map();
    const convById=new Map();
    for(const conv of conversations||[]){
      convById.set(conv.id,conv);
      if(conv.source_history_id){
        const list=convByHistory.get(conv.source_history_id)||[];
        list.push(conv); convByHistory.set(conv.source_history_id,list);
      }else if(conv.source_external_post_id){
        const key=String(conv.source_external_post_id);
        const list=convByExternal.get(key)||[];
        list.push(conv); convByExternal.set(key,list);
      }
    }

    const messagesByConversation=new Map();
    for(const message of messages||[]){
      const list=messagesByConversation.get(message.conversation_id)||[];
      list.push(message); messagesByConversation.set(message.conversation_id,list);
    }

    const rows=(queue||[]).map(q=>{
      const asset=assetById.get(q.asset_id)||{};
      const h=historyByQueue.get(q.id)||null;
      const account=accountById.get(h?.account_id||q.selected_account_id||q.account_id)||{};
      const campaignId=q.campaign_id||asset.campaign_id||null;
      const campaign=campaignById.get(campaignId)||{};
      const m=h?latestMetricByHistory.get(h.id)||{}:{};

      const platform=q.platform||account.platform||null;
      const rawMetrics=m.raw_json||{insights_ok:m.insights_ok};
      const hasSnapshot=Boolean(m.id||m.history_id);
      const instagramInsightsReady=platform!=='instagram_reels' || rawMetrics.insights_ok===true || Boolean(rawMetrics.insights?.data?.length);
      const viewsAvailable=hasSnapshot && instagramInsightsReady;
      const interactionsAvailable=hasSnapshot;
      const views=viewsAvailable?n(m.views):null;
      const likes=interactionsAvailable?n(m.likes):null;
      const comments=interactionsAvailable?n(m.comments):null;
      const shares=interactionsAvailable?n(m.shares):null;
      const saves=interactionsAvailable?n(m.saves):null;
      const engagements=[likes,comments,shares,saves].some(v=>v!==null)
        ? n(likes)+n(comments)+n(shares)+n(saves)
        : null;

      const rowLinks=[
        ...(h?.id?(linksByHistory.get(h.id)||[]):[]),
        ...((!h?.id||!(linksByHistory.get(h.id)||[]).length)&&asset.id?(linksByAsset.get(asset.id)||[]):[])
      ];
      const uniqueLinks=[...new Map(rowLinks.map(x=>[x.id,x])).values()];
      const linkClicks=uniqueLinks.reduce((sum,link)=>sum+(clicksByLink.get(link.id)||[]).length,0);

      const rowConversations=[
        ...(h?.id?(convByHistory.get(h.id)||[]):[]),
        ...(q.external_post_id?(convByExternal.get(String(q.external_post_id))||[]):[])
      ];
      const uniqueConversations=[...new Map(rowConversations.map(x=>[x.id,x])).values()];
      let inboundDms=0,outboundDms=0,dmThreads=0;
      for(const conv of uniqueConversations){
        const convMessages=messagesByConversation.get(conv.id)||[];
        const inboundMessages=convMessages.filter(message=>message.direction==='inbound'&&message.message_type!=='comment');
        if(inboundMessages.length) dmThreads++;
        inboundDms+=inboundMessages.length;
        outboundDms+=convMessages.filter(message=>message.direction==='outbound'&&message.message_type!=='comment').length;
      }

      const isYoutube=platform==='youtube_shorts';
      const primaryResult=isYoutube?linkClicks:inboundDms;
      const primaryResultLabel=isYoutube?'Link Clicks':'DMs';

      return {
        queue_id:q.id,
        history_id:h?.id||null,
        campaign_id:campaignId,
        campaign_name:campaign.name||null,
        asset_id:q.asset_id,
        clip_variant_id:asset.clip_variant_id||null,
        platform,
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
        views,likes,comments,shares,saves,engagements,
        views_available:viewsAvailable,
        metrics_available:hasSnapshot,
        metrics_status:!hasSnapshot
          ? 'not_synced'
          : (platform==='instagram_reels'&&!instagramInsightsReady)
            ? 'insights_permission_required'
            : 'ready',
        engagement_rate:views!==null&&views>0&&engagements!==null?engagements/views*100:null,
        link_clicks:linkClicks,
        inbound_dms:inboundDms,
        outbound_dms:outboundDms,
        dm_threads:dmThreads,
        primary_result:primaryResult,
        primary_result_label:primaryResultLabel,
        tracked_links:uniqueLinks.map(x=>({id:x.id,slug:x.slug,destination_url:x.destination_url})),
        metrics_captured_at:m.captured_at||null,
        has_daily_metrics:Boolean(h?.id&&(dailyByHistory.get(h.id)||[]).length),
        error:q.error_message||q.last_error||q.error||null
      };
    });

    const rowByQueue=new Map(rows.map(x=>[x.queue_id,x]));
    const rowByHistory=new Map(rows.filter(x=>x.history_id).map(x=>[x.history_id,x]));
    const latestRowByAsset=new Map();
    for(const row of rows.slice().sort((a,b)=>new Date(b.finished_at||b.created_at||0)-new Date(a.finished_at||a.created_at||0))){
      if(row.asset_id&&!latestRowByAsset.has(row.asset_id)) latestRowByAsset.set(row.asset_id,row);
    }
    const rowByExternal=new Map(rows.filter(x=>x.external_post_id).map(x=>[String(x.external_post_id),x]));

    const activity_points=[];

    // Platform-authored daily history (currently YouTube Analytics) takes priority.
    const historiesWithDaily=new Set();
    for(const d of dailyMetrics||[]){
      const row=rowByHistory.get(d.history_id);
      if(!row) continue;
      historiesWithDaily.add(d.history_id);
      activity_points.push({
        queue_id:row.queue_id,
        history_id:row.history_id,
        campaign_id:row.campaign_id,
        platform:row.platform,
        occurred_at:String(d.metric_date)+'T12:00:00Z',
        views:n(d.views),
        likes:n(d.likes),
        comments:n(d.comments),
        shares:n(d.shares),
        saves:n(d.saves),
        engagements:n(d.likes)+n(d.comments)+n(d.shares)+n(d.saves),
        link_clicks:0,
        inbound_dms:0,
        dm_threads:0,
        source:d.source||'platform_daily'
      });
    }

    // If true daily history is unavailable, use snapshot growth from the moment
    // Media started collecting metrics. This never double-counts daily Analytics rows.
    for(const growth of metricData.growth||[]){
      if(historiesWithDaily.has(growth.history_id)) continue;
      const row=rowByHistory.get(growth.history_id);
      if(!row) continue;
      if(!['views','likes','comments','shares','saves'].some(key=>n(growth[key])>0)) continue;
      activity_points.push({queue_id:row.queue_id,history_id:row.history_id,campaign_id:row.campaign_id,platform:row.platform,
        occurred_at:growth.metric_date+'T12:00:00Z',views:n(growth.views),likes:n(growth.likes),comments:n(growth.comments),
        shares:n(growth.shares),saves:n(growth.saves),engagements:n(growth.likes)+n(growth.comments)+n(growth.shares)+n(growth.saves),
        link_clicks:0,inbound_dms:0,dm_threads:0,source:'snapshot_delta'});
    }

    const sampledGrowth=new Map();
    for(const [historyId,series] of metricSeriesByHistory.entries()){
      if(historiesWithDaily.has(historyId)) continue;
      const row=rowByHistory.get(historyId);
      if(!row) continue;
      let prev={};

      for(const m of series.slice().sort((a,b)=>new Date(a.captured_at||0)-new Date(b.captured_at||0))){
        const insightsReady=row.platform!=='instagram_reels'||m.insights_ok===true;
        const current={views:insightsReady?n(m.views):null,likes:n(m.likes),comments:n(m.comments),shares:n(m.shares),saves:n(m.saves)};
        const delta={
          views:current.views===null||prev.views===undefined?0:Math.max(0,current.views-prev.views),
          likes:prev.likes===undefined?0:Math.max(0,current.likes-prev.likes),
          comments:prev.comments===undefined?0:Math.max(0,current.comments-prev.comments),
          shares:prev.shares===undefined?0:Math.max(0,current.shares-prev.shares),
          saves:prev.saves===undefined?0:Math.max(0,current.saves-prev.saves)
        };
        if(Object.values(delta).some(value=>value>0)) {
          const date=String(m.captured_at).slice(0,10),key=historyId+'/'+date;
          const point=sampledGrowth.get(key)||{
            queue_id:row.queue_id,history_id:historyId,campaign_id:row.campaign_id,platform:row.platform,
            occurred_at:date+'T12:00:00Z',views:0,likes:0,comments:0,shares:0,saves:0,engagements:0,
            link_clicks:0,inbound_dms:0,dm_threads:0,source:'snapshot_delta'
          };
          for(const key of Object.keys(delta)) point[key]+=delta[key];
          point.engagements=point.likes+point.comments+point.shares+point.saves;
          sampledGrowth.set(key,point);
        }
        for(const key of Object.keys(current)) if(current[key]!==null) prev[key]=Math.max(prev[key]??0,current[key]);
      }
    }
    activity_points.push(...sampledGrowth.values());

    // Link-click activity. History-level links are exact; asset-only links fall
    // back to the latest published instance of that asset.
    for(const click of clicks||[]){
      const link=linkById.get(click.tracked_link_id);
      if(!link) continue;
      const row=(link.history_id?rowByHistory.get(link.history_id):null)||(link.asset_id?latestRowByAsset.get(link.asset_id):null);
      if(!row) continue;
      activity_points.push({
        queue_id:row.queue_id,history_id:row.history_id,campaign_id:row.campaign_id,platform:row.platform,
        occurred_at:click.occurred_at,views:0,likes:0,comments:0,shares:0,saves:0,engagements:0,
        link_clicks:1,inbound_dms:0,dm_threads:0,source:'tracked_link'
      });
    }

    // DM thread creation + inbound message activity attributed to the source post.
    for(const conv of conversations||[]){
      const row=(conv.source_history_id?rowByHistory.get(conv.source_history_id):null)
        ||(conv.source_external_post_id?rowByExternal.get(String(conv.source_external_post_id)):null);
      if(!row) continue;

      const convMessages=messagesByConversation.get(conv.id)||[];
      const inboundDmMessages=convMessages.filter(message=>message.direction==='inbound'&&message.message_type!=='comment');

      if(inboundDmMessages.length){
        activity_points.push({
          queue_id:row.queue_id,history_id:row.history_id,campaign_id:row.campaign_id,platform:row.platform,
          occurred_at:inboundDmMessages[0].sent_at||inboundDmMessages[0].created_at||conv.created_at,
          views:0,likes:0,comments:0,shares:0,saves:0,engagements:0,
          link_clicks:0,inbound_dms:0,dm_threads:1,source:'dm_thread'
        });
      }

      for(const message of inboundDmMessages){
        activity_points.push({
          queue_id:row.queue_id,history_id:row.history_id,campaign_id:row.campaign_id,platform:row.platform,
          occurred_at:message.sent_at||message.created_at,
          views:0,likes:0,comments:0,shares:0,saves:0,engagements:0,
          link_clicks:0,inbound_dms:1,dm_threads:0,source:'inbound_dm'
        });
      }
    }

    const published=rows.filter(x=>x.status==='done'||x.external_post_id||x.external_post_url);

    return {
      rows,
      published,
      metric_points:activity_points,
      activity_points,
      campaigns:(campaigns||[]).map(c=>({id:c.id,name:c.name,status:c.status})),
      warnings,
      analytics_source:metricData.source,
      summary:{
        total_queue:rows.length,
        published:published.length,
        ready:rows.filter(x=>x.status==='ready').length,
        running:rows.filter(x=>x.status==='running').length,
        failed:rows.filter(x=>x.status==='failed').length,
        held:rows.filter(x=>x.media_approval_hold).length,
        views:published.reduce((sum,x)=>sum+n(x.views),0),
        likes:published.reduce((sum,x)=>sum+n(x.likes),0),
        comments:published.reduce((sum,x)=>sum+n(x.comments),0),
        shares:published.reduce((sum,x)=>sum+n(x.shares),0),
        saves:published.reduce((sum,x)=>sum+n(x.saves),0),
        engagements:published.reduce((sum,x)=>sum+n(x.engagements),0),
        link_clicks:published.reduce((sum,x)=>sum+x.link_clicks,0),
        inbound_dms:published.reduce((sum,x)=>sum+x.inbound_dms,0),
        dm_threads:published.reduce((sum,x)=>sum+x.dm_threads,0),
        primary_results:published.reduce((sum,x)=>sum+x.primary_result,0),
        latest_metrics_at:published.map(x=>x.metrics_captured_at).filter(Boolean).sort().at(-1)||null,
        daily_metric_rows:(dailyMetrics||[]).length
      }
    };
}

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    return jsonResponse(await loadContentData(workspaceId));
  } catch(error){
    return publicError(error,error.status||500);
  }
};
