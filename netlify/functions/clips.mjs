import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const safe = async (path) => supabaseRequest(path).catch(() => []);
const obj=v=>{
  if(v && typeof v==='object' && !Array.isArray(v)) return v;
  if(typeof v==='string'){ try{return JSON.parse(v)}catch{} }
  return {};
};
const firstUrl=(...values)=>{
  for(const value of values.flat(Infinity)){
    const s=String(value||'').trim();
    if(/^https?:\/\//i.test(s)) return s;
  }
  return null;
};

const publicMediaUrl=value=>{
  const s=String(value||'').trim();
  if(!s) return null;
  const match=s.match(/^https?:\/\/(?:54\.172\.230\.194|172\.31\.45\.144|127\.0\.0\.1):8091\/outputs\/([^?#]+)(?:[?#].*)?$/i);
  if(!match) return s;
  return '/media/'+encodeURIComponent(decodeURIComponent(match[1]));
};

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    const [variants,assets,queue,campaigns,distributionCampaigns,accounts] = await Promise.all([
      safe(scopedPath('clip_variants?select=*&order=created_at.desc&limit=1000',workspaceId)),
      safe(scopedPath('content_assets?select=*&order=created_at.desc&limit=1000',workspaceId)),
      safe(scopedPath('content_publish_queue?select=id,campaign_id,asset_id,platform,status,planned_title,planned_caption,external_post_id,external_post_url,selected_account_id,account_id,scheduled_at,finished_at,created_at&order=created_at.desc&limit=5000',workspaceId)),
      safe(scopedPath('content_campaigns?select=id,name,status&limit=500',workspaceId)),
      safe(scopedPath('distribution_campaigns?select=id,name,slug,status&limit=500',workspaceId)),
      safe(scopedPath('content_accounts?select=id,platform,username,display_name,platform_account_id&limit=1000',workspaceId))
    ]);

    const campaignById=new Map([...(campaigns||[]),...(distributionCampaigns||[])].map(x=>[x.id,x]));
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
      const creative=obj(v?.creative_spec);
      const compliance=obj(v?.compliance_report);
      const editReport=obj(compliance.edit_report);
      const metadata=obj(asset?.metadata);
      const renderUrl=firstUrl(
        v?.render_url,
        v?.rendered_url,
        v?.output_url,
        v?.final_url,
        editReport.render_url,
        editReport.output_url,
        compliance.render_url,
        compliance.output_url,
        asset?.source_url,
        asset?.url
      );
      const sourcePreviewUrl=firstUrl(
        creative.source_url,
        creative.canonical_media_url,
        metadata.canonical_media_url,
        metadata.resolved_source_url
      );
      const thumbnailUrl=firstUrl(
        v?.thumbnail_url,
        editReport.thumbnail_url,
        compliance.thumbnail_url,
        metadata.thumbnail_url
      );

      return {
        id,
        source_id:v?.source_id||null,
        campaign_id:campaignId,
        campaign_name:campaignById.get(campaignId)?.name||null,
        title:v?.title||v?.headline||asset?.file_name||'Clip',
        hook:v?.hook||asset?.metadata?.hook||null,
        status:v?.status||asset?.status||'unknown',
        publishing_approved:asset ? (asset.media_publish_approved ?? true) : false,
        render_url:publicMediaUrl(renderUrl),
        render_status_url:v?.render_status_url||null,
        render_job_id:v?.render_job_id||null,
        thumbnail_url:thumbnailUrl,
        source_preview_url:sourcePreviewUrl,
        source_start_seconds:Number(creative.start_seconds||0)||0,
        source_end_seconds:Number(creative.end_seconds||0)||null,
        creative_spec:creative,
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
      campaigns:[...(campaigns||[]),...(distributionCampaigns||[])]
        .filter((c,i,a)=>a.findIndex(x=>x.id===c.id)===i)
        .map(c=>({id:c.id,name:c.name,status:c.status})),
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