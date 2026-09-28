import { connectorOrigin, jsonResponse, publicError, requireWorkspace, supabaseRequest } from './_shared.mjs';

export default async(request)=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});

    const x=await request.json();
    if(!x.slug||!x.destinationUrl) throw Object.assign(new Error('slug and destinationUrl required'),{status:400});

    const slug=String(x.slug).toLowerCase().replace(/[^a-z0-9_-]/g,'-');
    const existing=await supabaseRequest(
      'tracked_links?slug=eq.'+encodeURIComponent(slug)+'&select=id,workspace_id&limit=1'
    ).catch(()=>[]);

    if(existing?.[0]?.workspace_id && workspaceId && existing[0].workspace_id!==workspaceId){
      return jsonResponse({error:'This tracked-link slug is already used by another workspace'},409);
    }

    const rows=await supabaseRequest('tracked_links?on_conflict=slug',{
      method:'POST',
      headers:{Prefer:'resolution=merge-duplicates,return=representation'},
      body:{
        slug,
        destination_url:x.destinationUrl,
        label:x.label||null,
        campaign_id:x.campaignId||null,
        asset_id:x.assetId||null,
        history_id:x.historyId||null,
        account_id:x.accountId||null,
        utm:x.utm||{},
        is_active:true,
        updated_at:new Date().toISOString(),
        ...(workspaceId?{workspace_id:workspaceId}:{})
      }
    });

    const link=rows?.[0];
    return jsonResponse({link,url:connectorOrigin(request)+'/go/'+link.slug},201);
  }catch(error){
    return publicError(error,error.status||500);
  }
};
