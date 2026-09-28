import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

async function approveOne(rawId,workspaceId){
  let variantId=rawId.startsWith('asset:')?null:rawId;
  let assetId=rawId.startsWith('asset:')?rawId.slice(6):null;

  if(variantId){
    await supabaseRequest(scopedPath(`clip_variants?id=eq.${encodeURIComponent(variantId)}`,workspaceId),{
      method:'PATCH',
      headers:{Prefer:'return=representation'},
      body:{status:'approved',approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}
    }).catch(async()=>{
      await supabaseRequest(scopedPath(`clip_variants?id=eq.${encodeURIComponent(variantId)}`,workspaceId),{
        method:'PATCH',
        body:{status:'approved',updated_at:new Date().toISOString()}
      });
    });

    const assets=await supabaseRequest(
      scopedPath(`content_assets?clip_variant_id=eq.${encodeURIComponent(variantId)}&select=*&order=created_at.desc&limit=1`,workspaceId)
    ).catch(()=>[]);
    assetId=assets?.[0]?.id||assetId;
  }

  if(!assetId){
    return {ok:true,variant_id:variantId,asset_pending:true,released_queue_rows:0};
  }

  const approvedAt=new Date().toISOString();
  await supabaseRequest(scopedPath(`content_assets?id=eq.${encodeURIComponent(assetId)}`,workspaceId),{
    method:'PATCH',
    body:{media_publish_approved:true,media_approved_at:approvedAt,updated_at:approvedAt}
  });

  const heldRows=await supabaseRequest(
    scopedPath(`content_publish_queue?asset_id=eq.${encodeURIComponent(assetId)}&media_approval_hold=eq.true&select=id,scheduled_at,next_attempt_at,media_original_scheduled_at,media_original_next_attempt_at`,workspaceId)
  ).catch(()=>[]);

  for(const q of heldRows||[]){
    const original=q.media_original_scheduled_at ? new Date(q.media_original_scheduled_at) : null;
    const originalNext=q.media_original_next_attempt_at ? new Date(q.media_original_next_attempt_at) : null;
    const releaseAt=original && original.getTime()>Date.now() ? original.toISOString() : approvedAt;
    const releaseNext=originalNext && originalNext.getTime()>Date.now() ? originalNext.toISOString() : null;
    await supabaseRequest(scopedPath(`content_publish_queue?id=eq.${encodeURIComponent(q.id)}`,workspaceId),{
      method:'PATCH',
      body:{media_approval_hold:false,scheduled_at:releaseAt,next_attempt_at:releaseNext,updated_at:approvedAt}
    });
  }

  return {
    ok:true,
    variant_id:variantId,
    asset_id:assetId,
    publishing_approved:true,
    released_queue_rows:(heldRows||[]).length
  };
}

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);

    const body=await request.json().catch(()=>({}));
    const action=String(body.action||'').trim();
    if(action!=='approve') return jsonResponse({error:'Unsupported action'},400);

    const ids=Array.isArray(body.ids)
      ? body.ids.map(x=>String(x||'').trim()).filter(Boolean)
      : [String(body.id||'').trim()].filter(Boolean);

    if(!ids.length) return jsonResponse({error:'At least one clip id is required'},400);
    if(ids.length>1000) return jsonResponse({error:'Bulk approval is limited to 1000 clips at a time'},400);

    const results=[];
    for(const id of ids){
      try{
        results.push({id,...await approveOne(id,workspaceId)});
      }catch(error){
        results.push({id,ok:false,error:error.message});
      }
    }

    return jsonResponse({
      ok:results.every(x=>x.ok!==false),
      approved:results.filter(x=>x.ok!==false).length,
      failed:results.filter(x=>x.ok===false).length,
      results
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};