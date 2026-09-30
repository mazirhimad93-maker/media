import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

function cleanRule(input={}){
  const keyword=String(input.keyword||'').trim();
  const dmMessage=String(input.dmMessage??input.dm_message??'').trim();
  const matchType=String(input.matchType??input.match_type??'contains').toLowerCase();
  if(!keyword) throw Object.assign(new Error('Keyword is required.'),{status:400});
  if(!dmMessage) throw Object.assign(new Error('DM message is required.'),{status:400});
  if(!['contains','exact'].includes(matchType)) throw Object.assign(new Error('matchType must be contains or exact.'),{status:400});
  return {
    name:String(input.name||keyword+' -> DM').trim().slice(0,120),
    keyword:keyword.slice(0,120),
    match_type:matchType,
    dm_message:dmMessage.slice(0,2000),
    is_active:input.isActive??input.is_active??true,
    account_id:input.accountId??input.account_id??null,
    metadata:input.metadata&&typeof input.metadata==='object'?input.metadata:{}
  };
}

async function verifyAccount(accountId,workspaceId){
  if(!accountId) return;
  const rows=await supabaseRequest(scopedPath(
    'content_accounts?id=eq.'+encodeURIComponent(accountId)+'&platform=eq.instagram_reels&select=id&limit=1',
    workspaceId
  ));
  if(!rows?.[0]) throw Object.assign(new Error('Instagram account not found in this workspace.'),{status:404});
}

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);

    if(request.method==='GET'){
      const rules=await supabaseRequest(scopedPath(
        'social_comment_automations?select=*&order=created_at.asc',
        workspaceId
      )).catch(error=>{
        if(/social_comment_automations/i.test(String(error?.message||''))){
          throw Object.assign(new Error('Comment automation migration has not been applied yet.'),{status:409});
        }
        throw error;
      });
      return jsonResponse({rules:rules||[]});
    }

    if(request.method==='POST'){
      const input=await request.json().catch(()=>({}));
      const rule=cleanRule(input);
      await verifyAccount(rule.account_id,workspaceId);
      const rows=await supabaseRequest('social_comment_automations',{
        method:'POST',
        headers:{Prefer:'return=representation'},
        body:{...rule,workspace_id:workspaceId||null}
      });
      return jsonResponse({rule:rows?.[0]||null},201);
    }

    if(request.method==='PATCH'){
      const input=await request.json().catch(()=>({}));
      const id=String(input.id||'');
      if(!id) throw Object.assign(new Error('Rule id is required.'),{status:400});
      const existing=(await supabaseRequest(scopedPath(
        'social_comment_automations?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1',
        workspaceId
      )))?.[0];
      if(!existing) throw Object.assign(new Error('Comment automation not found.'),{status:404});

      const merged=cleanRule({
        ...existing,
        ...input,
        dmMessage:input.dmMessage??input.dm_message??existing.dm_message,
        matchType:input.matchType??input.match_type??existing.match_type,
        accountId:input.accountId??input.account_id??existing.account_id,
        isActive:input.isActive??input.is_active??existing.is_active
      });
      await verifyAccount(merged.account_id,workspaceId);
      const rows=await supabaseRequest(scopedPath(
        'social_comment_automations?id=eq.'+encodeURIComponent(id),
        workspaceId
      ),{
        method:'PATCH',
        headers:{Prefer:'return=representation'},
        body:{...merged,updated_at:new Date().toISOString()}
      });
      return jsonResponse({rule:rows?.[0]||null});
    }

    if(request.method==='DELETE'){
      const url=new URL(request.url);
      const id=String(url.searchParams.get('id')||'');
      if(!id) throw Object.assign(new Error('Rule id is required.'),{status:400});
      await supabaseRequest(scopedPath(
        'social_comment_automations?id=eq.'+encodeURIComponent(id),
        workspaceId
      ),{method:'DELETE'});
      return jsonResponse({deleted:true,id});
    }

    throw Object.assign(new Error('Method not allowed.'),{status:405});
  }catch(error){
    return publicError(error,error.status||500);
  }
};
