import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const safe=async path=>supabaseRequest(path).catch(()=>[]);

export default async (request) => {
  try{
    const {workspaceId}=await requireWorkspace(request);

    const [contentCampaigns,distributionCampaigns,pools,memberships,accounts,variants,assets,queue,history,metrics,links,clicks,conversations,messages]=await Promise.all([
      safe(scopedPath('content_campaigns?select=*&limit=500',workspaceId)),
      safe(scopedPath('distribution_campaigns?select=*&limit=500',workspaceId)),
      safe(scopedPath('content_distribution_pools?select=*&limit=500',workspaceId)),
      safe(scopedPath('content_distribution_pool_accounts?select=pool_id,account_id,is_active,priority,weight&limit=5000',workspaceId)),
      safe(scopedPath('content_accounts?select=id,platform,username,display_name,status,is_active&limit=3000',workspaceId)),
      safe(scopedPath('clip_variants?select=id,campaign_id,status,created_at&limit=10000',workspaceId)),
      safe(scopedPath('content_assets?select=id,campaign_id,clip_variant_id,media_publish_approved,publish_count,status,created_at&limit=10000',workspaceId)),
      safe(scopedPath('content_publish_queue?select=id,campaign_id,asset_id,platform,status,external_post_id,external_post_url,selected_account_id,account_id,created_at,finished_at&limit=20000',workspaceId)),
      safe(scopedPath('content_history?select=id,queue_id,campaign_id,account_id,event_type,created_at&order=created_at.desc&limit=25000',workspaceId)),
      safe(scopedPath('post_metrics_snapshots?select=history_id,captured_at,views,likes,comments,shares,saves&order=captured_at.desc&limit=30000',workspaceId)),
      safe(scopedPath('tracked_links?select=id,campaign_id,asset_id,history_id&limit=10000',workspaceId)),
      safe(scopedPath('tracked_link_clicks?select=tracked_link_id,occurred_at&limit=30000',workspaceId)),
      safe(scopedPath('social_conversations?select=id,account_id,source_history_id,source_external_post_id,created_at&limit=10000',workspaceId)),
      safe(scopedPath('social_messages?select=id,conversation_id,direction,sent_at,created_at&limit=30000',workspaceId))
    ]);

    const poolById=new Map((pools||[]).map(x=>[x.id,x]));
    const accountById=new Map((accounts||[]).map(x=>[x.id,x]));
    const variantCampaign=new Map((variants||[]).map(v=>[v.id,v.campaign_id]));
    const assetById=new Map((assets||[]).map(a=>[a.id,a]));
    const queueById=new Map((queue||[]).map(q=>[q.id,q]));

    const historyByQueue=new Map();
    const historyCampaign=new Map();
    for(const h of history||[]){
      if(h.queue_id && !historyByQueue.has(h.queue_id)) historyByQueue.set(h.queue_id,h);
      const q=h.queue_id?queueById.get(h.queue_id):null;
      const a=q?.asset_id?assetById.get(q.asset_id):null;
      const campaignId=h.campaign_id||q?.campaign_id||a?.campaign_id||(a?.clip_variant_id?variantCampaign.get(a.clip_variant_id):null)||null;
      if(campaignId) historyCampaign.set(h.id,campaignId);
    }

    const metricByHistory=new Map();
    for(const m of metrics||[]){
      if(m.history_id && !metricByHistory.has(m.history_id)) metricByHistory.set(m.history_id,m);
    }

    const externalCampaign=new Map();
    for(const q of queue||[]){
      const a=q.asset_id?assetById.get(q.asset_id):null;
      const campaignId=q.campaign_id||a?.campaign_id||(a?.clip_variant_id?variantCampaign.get(a.clip_variant_id):null)||null;
      if(campaignId && q.external_post_id) externalCampaign.set(String(q.external_post_id),campaignId);
    }

    const linkCampaign=new Map();
    for(const l of links||[]){
      const a=l.asset_id?assetById.get(l.asset_id):null;
      const campaignId=l.campaign_id||(l.history_id?historyCampaign.get(l.history_id):null)||a?.campaign_id||(a?.clip_variant_id?variantCampaign.get(a.clip_variant_id):null)||null;
      if(campaignId) linkCampaign.set(l.id,campaignId);
    }

    const clickCountByCampaign=new Map();
    for(const click of clicks||[]){
      const campaignId=linkCampaign.get(click.tracked_link_id);
      if(campaignId) clickCountByCampaign.set(campaignId,(clickCountByCampaign.get(campaignId)||0)+1);
    }

    const conversationCampaign=new Map();
    for(const conv of conversations||[]){
      const campaignId=(conv.source_history_id?historyCampaign.get(conv.source_history_id):null)
        ||(conv.source_external_post_id?externalCampaign.get(String(conv.source_external_post_id)):null)
        ||null;
      if(campaignId) conversationCampaign.set(conv.id,campaignId);
    }

    const conversationCountByCampaign=new Map();
    for(const campaignId of conversationCampaign.values()){
      conversationCountByCampaign.set(campaignId,(conversationCountByCampaign.get(campaignId)||0)+1);
    }

    const messageCountByCampaign=new Map();
    for(const message of messages||[]){
      const campaignId=conversationCampaign.get(message.conversation_id);
      if(campaignId) messageCountByCampaign.set(campaignId,(messageCountByCampaign.get(campaignId)||0)+1);
    }

    const classifyCampaign=(campaign)=>{
      const hay=[campaign?.slug,campaign?.name,campaign?.metadata?.campaign_group,campaign?.metadata?.client]
        .filter(Boolean).join(' ').toLowerCase();
      if(/(^|\\b)(alchemic|alchemix)(\\b|$)/.test(hay)) return 'alchemic';
      if(/(^|\\b)(zach|zack)(\\b|$)/.test(hay)) return 'zach';
      return 'whoop';
    };

    const groupDefs={
      alchemic:{id:'group:alchemic',name:'Alchemic',description:'Alchemic brand growth, case studies and acquisition media.'},
      zach:{id:'group:zach',name:'Zach',description:'Zach / Nanaki / Pet Influencer content and distribution.'},
      whoop:{id:'group:whoop',name:'Whoop',description:'General clipping, testing and distribution campaigns.'}
    };

    const campaignGroups=new Map(Object.keys(groupDefs).map(key=>[key,{
      ...groupDefs[key],members:[],contentMembers:[],distributionMembers:[]
    }]));

    for(const campaign of contentCampaigns||[]){
      const key=classifyCampaign(campaign);
      campaignGroups.get(key).members.push(campaign);
      campaignGroups.get(key).contentMembers.push(campaign);
    }
    for(const campaign of distributionCampaigns||[]){
      const key=classifyCampaign(campaign);
      campaignGroups.get(key).members.push(campaign);
      campaignGroups.get(key).distributionMembers.push(campaign);
    }

    const rows=[...campaignGroups.entries()].map(([groupKey,group])=>{
      const memberIds=new Set(group.members.map(x=>x.id).filter(Boolean));
      const campaignVariants=(variants||[]).filter(v=>memberIds.has(v.campaign_id));
      const variantIds=new Set(campaignVariants.map(v=>v.id));
      const campaignAssets=(assets||[]).filter(a=>memberIds.has(a.campaign_id) || (a.clip_variant_id && variantIds.has(a.clip_variant_id)));
      const assetIds=new Set(campaignAssets.map(a=>a.id));
      const campaignQueue=(queue||[]).filter(q=>memberIds.has(q.campaign_id) || assetIds.has(q.asset_id));
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
      for(const member of group.contentMembers){
        if(!member.distribution_pool_id) continue;
        for(const membership of memberships||[]){
          if(membership.pool_id===member.distribution_pool_id && membership.is_active!==false) channelIds.add(membership.account_id);
        }
      }
      const channels=[...channelIds].map(id=>accountById.get(id)).filter(Boolean);
      const timestamps=group.members.flatMap(x=>[x.updated_at,x.created_at]).filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite);
      const active=group.members.some(x=>x.status==='active');

      return {
        id:group.id,group_key:groupKey,name:group.name,
        status:active?'active':(group.members[0]?.status||'active'),
        description:group.description,distribution_pool_id:null,
        pool_name:group.contentMembers.map(x=>poolById.get(x.distribution_pool_id)?.name).filter(Boolean)[0]||null,
        created_at:timestamps.length?new Date(Math.min(...timestamps)).toISOString():null,
        updated_at:timestamps.length?new Date(Math.max(...timestamps)).toISOString():null,
        member_campaign_ids:[...memberIds],
        member_campaigns:group.members.map(x=>({id:x.id,name:x.name,slug:x.slug,status:x.status})),
        clips:campaignVariants.length || campaignAssets.length,
        assets:campaignAssets.length,
        needs_approval:campaignAssets.filter(a=>a.media_publish_approved===false).length,
        approved:campaignAssets.filter(a=>a.media_publish_approved!==false).length,
        queue_jobs:campaignQueue.length,ready:ready.length,running:running.length,failed:failed.length,
        published:published.length,views,likes,comments,shares,saves,
        link_clicks:[...memberIds].reduce((n,id)=>n+(clickCountByCampaign.get(id)||0),0),
        conversations:[...memberIds].reduce((n,id)=>n+(conversationCountByCampaign.get(id)||0),0),
        messages:[...memberIds].reduce((n,id)=>n+(messageCountByCampaign.get(id)||0),0),
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
        views:rows.reduce((n,x)=>n+x.views,0),
        link_clicks:rows.reduce((n,x)=>n+x.link_clicks,0),
        conversations:rows.reduce((n,x)=>n+x.conversations,0),
        messages:rows.reduce((n,x)=>n+x.messages,0)
      }
    });
  }catch(error){
    return publicError(error,error.status||500);
  }
};
