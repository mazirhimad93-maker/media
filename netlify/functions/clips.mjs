import { jsonResponse, publicError, supabaseRequest } from './_shared.mjs';

const safe = async (path) => supabaseRequest(path).catch(() => []);

export default async () => {
  try {
    const [variants,assets,queue,campaigns,accounts] = await Promise.all([
      safe('clip_variants?select=*&order=created_at.desc&limit=1000'),
      safe('content_assets?select=*&order=created_at.desc&limit=1000'),
      safe('content_publish_queue?select=id,campaign_id,asset_id,platform,status,planned_title,planned_caption,external_post_id,external_post_url,selected_account_id,account_id,scheduled_at,finished_at,created_at&order=created_at.desc&limit=5000'),
      safe('content_campaigns?select=id,name,status&limit=500'),
      safe('content_accounts?select=id,platform,username,display_name,platform_account_id&limit=1000')
    ]);

    const campaignById=new Map((campaigns||[]).map(x=>[x.id,x]));
    const accountById=new Map((accounts||[]).map(x=>[x.id,x]));
    const assetByVariant=new Map();
    for(const a of assets||[]) if(a.clip_variant_id) assetByVariant.set(a.clip_variant_id,a);

    const queuesByAsset=new Map();
    for(const q of queue||[]){
      const list=queuesByAsset.get(q.asset_id)||[];
      const account=accountById.get(q.selected_account_id||q.account_id)||{};
      list.push({
        ...q,
        account_username:account.username||account.display_name||account.platform_account_id||null
      });
      queuesByAsset.set(q.asset_id,list);
    }

    const shape=(v,asset,id)=>{
      const queues=asset?queuesByAsset.get(asset.id)||[]:[];
      const published=queues.filter(q=>q.status==='done'||q.external_post_id||q.external_post_url);
      const pending=queues.filter(q=>!['done','failed'].includes(q.status));
      const campaignId=v?.campaign_id||asset?.campaign_id||null;
      return {
        id,
        campaign_id:campaignId,
        campaign_name:campaignById.get(campaignId)?.name||null,
        title:v?.title||v?.headline||asset?.file_name||'Clip',
        hook:v?.hook||asset?.metadata?.hook||null,
        status:v?.status||asset?.status||'unknown',
        publishing_approved:asset ? (asset.media_publish_approved ?? true) : false,
        render_url:v?.render_url||v?.rendered_url||asset?.source_url||null,
        duration_seconds:v?.duration_seconds||asset?.duration_seconds||asset?.duration_sec||null,
        created_at:v?.created_at||asset?.created_at||null,
        updated_at:v?.updated_at||asset?.updated_at||null,
        asset:asset?{
          id:asset.id,
          file_name:asset.file_name,
          source_url:asset.source_url,
          status:asset.status,
          publish_count:asset.publish_count||0,
          media_publish_approved:asset.media_publish_approved ?? true,
          media_approved_at:asset.media_approved_at||null
        }:null,
        queue_count:queues.length,
        pending_count:pending.length,
        published_count:published.length,
        distributions:queues.map(q=>({
          id:q.id,
          platform:q.platform,
          status:q.status,
          account_username:q.account_username,
          scheduled_at:q.scheduled_at,
          finished_at:q.finished_at,
          url:q.external_post_url,
          external_post_id:q.external_post_id
        })),
        published_urls:published.map(q=>({
          platform:q.platform,
          account_username:q.account_username,
          url:q.external_post_url,
          id:q.external_post_id,
          status:q.status
        })).filter(x=>x.url||x.id)
      };
    };

    const clips=(variants||[]).map(v=>{
      const asset=assetByVariant.get(v.id)||null;
      return shape(v,asset,v.id);
    });

    const knownVariantIds=new Set((variants||[]).map(v=>v.id));
    for(const a of assets||[]){
      if(a.clip_variant_id && knownVariantIds.has(a.clip_variant_id)) continue;
      clips.push(shape(null,a,`asset:${a.id}`));
    }

    clips.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));

    return jsonResponse({
      clips,
      campaigns:(campaigns||[]).map(c=>({id:c.id,name:c.name,status:c.status})),
      summary:{
        total:clips.length,
        needs_approval:clips.filter(x=>x.publishing_approved===false).length,
        approved:clips.filter(x=>x.publishing_approved===true).length,
        queued:clips.filter(x=>x.pending_count>0).length,
        published:clips.filter(x=>x.published_count>0).length
      }
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};