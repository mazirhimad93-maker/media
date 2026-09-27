import { jsonResponse, publicError, supabaseRequest } from './_shared.mjs';

const safe = async (path) => supabaseRequest(path).catch(() => []);

export default async () => {
  try {
    const [variants,assets,queue,campaigns] = await Promise.all([
      safe('clip_variants?select=*&order=created_at.desc&limit=500'),
      safe('content_assets?select=*&order=created_at.desc&limit=500'),
      safe('content_publish_queue?select=id,campaign_id,asset_id,platform,status,planned_title,planned_caption,external_post_id,external_post_url,selected_account_id,account_id,scheduled_at,finished_at,created_at&order=created_at.desc&limit=1000'),
      safe('content_campaigns?select=id,name,status&order=created_at.desc&limit=200')
    ]);

    const campaignById=new Map((campaigns||[]).map(x=>[x.id,x]));
    const assetByVariant=new Map();
    for(const a of assets||[]) if(a.clip_variant_id) assetByVariant.set(a.clip_variant_id,a);

    const queuesByAsset=new Map();
    for(const q of queue||[]){
      const list=queuesByAsset.get(q.asset_id)||[];
      list.push(q); queuesByAsset.set(q.asset_id,list);
    }

    const clips=(variants||[]).map(v=>{
      const asset=assetByVariant.get(v.id)||null;
      const queues=asset?queuesByAsset.get(asset.id)||[]:[];
      const published=queues.filter(q=>q.status==='done'||q.external_post_id);
      const pending=queues.filter(q=>!['done','failed'].includes(q.status));
      return {
        id:v.id,
        campaign_id:v.campaign_id,
        campaign_name:campaignById.get(v.campaign_id)?.name||null,
        title:v.title||v.headline||asset?.file_name||'Clip',
        hook:v.hook||asset?.metadata?.hook||null,
        status:v.status||asset?.status||'unknown',
        publishing_approved:asset ? (asset.media_publish_approved ?? true) : false,
        render_url:v.render_url||v.rendered_url||asset?.source_url||null,
        duration_seconds:v.duration_seconds||asset?.duration_seconds||asset?.duration_sec||null,
        created_at:v.created_at||asset?.created_at||null,
        updated_at:v.updated_at||asset?.updated_at||null,
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
        published_urls:published.map(q=>({platform:q.platform,url:q.external_post_url,id:q.external_post_id,status:q.status})).filter(x=>x.url||x.id)
      };
    });

    const knownVariantIds=new Set((variants||[]).map(v=>v.id));
    for(const a of assets||[]){
      if(a.clip_variant_id && knownVariantIds.has(a.clip_variant_id)) continue;
      const queues=queuesByAsset.get(a.id)||[];
      const published=queues.filter(q=>q.status==='done'||q.external_post_id);
      clips.push({
        id:`asset:${a.id}`,
        campaign_id:a.campaign_id,
        campaign_name:campaignById.get(a.campaign_id)?.name||null,
        title:a.file_name||'Video asset',
        hook:a.metadata?.hook||null,
        status:a.status||'unknown',
        publishing_approved:a.media_publish_approved ?? true,
        render_url:a.source_url||null,
        duration_seconds:a.duration_seconds||a.duration_sec||null,
        created_at:a.created_at||null,
        updated_at:a.updated_at||null,
        asset:{id:a.id,file_name:a.file_name,source_url:a.source_url,status:a.status,publish_count:a.publish_count||0,media_publish_approved:a.media_publish_approved ?? true,media_approved_at:a.media_approved_at||null},
        queue_count:queues.length,
        pending_count:queues.filter(q=>!['done','failed'].includes(q.status)).length,
        published_count:published.length,
        published_urls:published.map(q=>({platform:q.platform,url:q.external_post_url,id:q.external_post_id,status:q.status})).filter(x=>x.url||x.id)
      });
    }

    clips.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));

    return jsonResponse({
      clips,
      summary:{
        total:clips.length,
        needs_approval:clips.filter(x=>x.publishing_approved===false).length,
        approved:clips.filter(x=>x.publishing_approved===true).length,
        queued:clips.filter(x=>x.pending_count>0).length,
        published:clips.filter(x=>x.published_count>0).length
      }
    });
  } catch(error){ return publicError(error,error.status||500); }
};
