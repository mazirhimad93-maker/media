import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const clean=value=>String(value||'').trim();

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    const url=new URL(request.url);

    if(request.method==='GET'){
      const [rules,accounts]=await Promise.all([
        supabaseRequest(scopedPath('comment_automations?select=*&order=priority.desc,created_at.asc',workspaceId)).catch(()=>[]),
        supabaseRequest(scopedPath('content_accounts?platform=eq.instagram_reels&select=id,username,display_name,status,is_active&order=created_at.asc',workspaceId)).catch(()=>[])
      ]);
      return jsonResponse({automations:rules||[],accounts:accounts||[]});
    }

    if(request.method==='POST'){
      const input=await request.json().catch(()=>({}));
      const keyword=clean(input.keyword);
      const replyBody=clean(input.replyBody);
      if(!keyword||!replyBody) throw Object.assign(new Error('Keyword and private reply are required.'),{status:400});
      const rows=await supabaseRequest('comment_automations',{
        method:'POST',
        headers:{Prefer:'return=representation'},
        body:{
          workspace_id:workspaceId,
          account_id:input.accountId||null,
          name:clean(input.name)||keyword.toUpperCase()+' → DM',
          platform:'instagram_reels',
          keyword,
          match_type:['exact','contains','starts_with'].includes(input.matchType)?input.matchType:'exact',
          reply_body:replyBody,
          priority:Number.isFinite(Number(input.priority))?Number(input.priority):100,
          is_active:input.isActive!==false
        }
      });
      return jsonResponse({automation:rows?.[0]},201);
    }

    if(request.method==='PATCH'){
      const input=await request.json().catch(()=>({}));
      const id=clean(input.id);
      if(!id) throw Object.assign(new Error('Automation ID is required.'),{status:400});
      const patch={updated_at:new Date().toISOString()};
      if(input.name!==undefined) patch.name=clean(input.name);
      if(input.keyword!==undefined) patch.keyword=clean(input.keyword);
      if(input.replyBody!==undefined) patch.reply_body=clean(input.replyBody);
      if(input.matchType!==undefined&&['exact','contains','starts_with'].includes(input.matchType)) patch.match_type=input.matchType;
      if(input.accountId!==undefined) patch.account_id=input.accountId||null;
      if(input.isActive!==undefined) patch.is_active=Boolean(input.isActive);
      if(input.priority!==undefined&&Number.isFinite(Number(input.priority))) patch.priority=Number(input.priority);
      const rows=await supabaseRequest(scopedPath('comment_automations?id=eq.'+encodeURIComponent(id)+'&select=*',workspaceId),{
        method:'PATCH',headers:{Prefer:'return=representation'},body:patch
      });
      if(!rows?.[0]) throw Object.assign(new Error('Automation not found.'),{status:404});
      return jsonResponse({automation:rows[0]});
    }

    if(request.method==='DELETE'){
      const id=clean(url.searchParams.get('id'));
      if(!id) throw Object.assign(new Error('Automation ID is required.'),{status:400});
      await supabaseRequest(scopedPath('comment_automations?id=eq.'+encodeURIComponent(id),workspaceId),{method:'DELETE'});
      return jsonResponse({deleted:true,id});
    }

    throw Object.assign(new Error('Method not allowed'),{status:405});
  }catch(error){
    return publicError(error,error.status||500);
  }
};
