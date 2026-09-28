import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const int=(value,min,max,fallback)=>{
  const n=Math.round(Number(value));
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
};

export default async (request)=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') return jsonResponse({error:'Method not allowed'},405);

    const input=await request.json();
    const patch={updated_at:new Date().toISOString()};

    if(input.dailyLimit!==undefined) patch.daily_limit=int(input.dailyLimit,0,10000,0);
    if(input.weeklyLimit!==undefined) patch.weekly_limit=int(input.weeklyLimit,0,70000,0);
    if(input.minGapMinutes!==undefined) patch.min_gap_minutes=int(input.minGapMinutes,0,10080,0);

    if(Object.keys(patch).length===1) return jsonResponse({error:'No channel settings were supplied'},400);

    if(input.applyAll===true){
      if(!workspaceId) return jsonResponse({error:'Workspace migration must be installed before bulk channel updates'},409);
      const updated=await supabaseRequest(
        scopedPath('content_accounts',workspaceId),
        {method:'PATCH',headers:{Prefer:'return=representation'},body:patch}
      );
      return jsonResponse({ok:true,updated:(updated||[]).length,accounts:updated||[]});
    }

    const accountId=String(input.accountId||'').trim();
    if(!accountId) return jsonResponse({error:'accountId is required'},400);

    const rows=await supabaseRequest(
      scopedPath('content_accounts?id=eq.'+encodeURIComponent(accountId)+'&select=id,daily_limit,weekly_limit,min_gap_minutes&limit=1',workspaceId)
    );
    const account=rows?.[0];
    if(!account) return jsonResponse({error:'Channel not found in this workspace'},404);

    const updated=await supabaseRequest(
      scopedPath('content_accounts?id=eq.'+encodeURIComponent(accountId),workspaceId),
      {method:'PATCH',headers:{Prefer:'return=representation'},body:patch}
    );

    return jsonResponse({ok:true,account:updated?.[0]||{...account,...patch}});
  }catch(error){
    return publicError(error,error.status||500);
  }
};
