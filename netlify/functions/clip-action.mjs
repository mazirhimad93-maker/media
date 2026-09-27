import { jsonResponse, publicError, supabaseRequest } from './_shared.mjs';

const TEMP_PASSWORD='alchemic2026';

export default async (request) => {
  try {
    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);
    const supplied=request.headers.get('x-media-password')||'';
    if(supplied!==TEMP_PASSWORD) return jsonResponse({error:'Invalid media password'},401);

    const body=await request.json();
    const rawId=String(body.id||'').trim();
    const action=String(body.action||'').trim();
    if(!rawId) return jsonResponse({error:'Clip id is required'},400);

    let variantId=rawId.startsWith('asset:')?null:rawId;
    let assetId=rawId.startsWith('asset:')?rawId.slice(6):null;

    if(action!=='approve') return jsonResponse({error:'Unsupported action'},400);

    if(variantId){
      await supabaseRequest(`clip_variants?id=eq.${encodeURIComponent(variantId)}`,{
        method:'PATCH',
        headers:{Prefer:'return=representation'},
        body:{status:'approved',approved_at:new Date().toISOString(),updated_at:new Date().toISOString()}
      }).catch(async()=>{
        await supabaseRequest(`clip_variants?id=eq.${encodeURIComponent(variantId)}`,{
          method:'PATCH',
          body:{status:'approved',updated_at:new Date().toISOString()}
        });
      });

      const assets=await supabaseRequest(
        `content_assets?clip_variant_id=eq.${encodeURIComponent(variantId)}&select=*&order=created_at.desc&limit=1`
      ).catch(()=>[]);
      assetId=assets?.[0]?.id||assetId;
    }

    if(!assetId) return jsonResponse({ok:true,variant_id:variantId,asset_pending:true});

    const approvedAt=new Date().toISOString();
    await supabaseRequest(`content_assets?id=eq.${encodeURIComponent(assetId)}`,{
      method:'PATCH',
      body:{media_publish_approved:true,media_approved_at:approvedAt,updated_at:approvedAt}
    });

    await supabaseRequest(`content_publish_queue?asset_id=eq.${encodeURIComponent(assetId)}&status=eq.paused`,{
      method:'PATCH',
      body:{status:'ready',updated_at:approvedAt}
    }).catch(()=>{});

    return jsonResponse({ok:true,variant_id:variantId,asset_id:assetId,publishing_approved:true});
  } catch(error){ return publicError(error,error.status||500); }
};
