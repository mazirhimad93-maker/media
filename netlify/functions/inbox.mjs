import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    const url=new URL(request.url);
    const limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||100)));
    const offset=Math.max(0,Number(url.searchParams.get('offset')||0));

    const accounts=await supabaseRequest(
      scopedPath('content_accounts?select=id,metadata&limit=5000',workspaceId)
    ).catch(()=>[]);
    const ids=(accounts||[]).filter(a=>!a.metadata?.disconnected_at).map(a=>a.id).filter(Boolean);

    if(workspaceId && !ids.length) return jsonResponse({social:[]});

    const accountFilter=workspaceId
      ? '&account_id=in.('+ids.map(id=>encodeURIComponent(id)).join(',')+')'
      : '';
    const social=await supabaseRequest(
      'v_social_inbox?select=*'+accountFilter+'&order=last_message_at.desc.nullslast&limit='+limit+'&offset='+offset
    ).catch(()=>[]);

    const allowed=new Set(ids);
    const filtered=workspaceId
      ? (social||[]).filter(x=>allowed.has(x.account_id))
      : (social||[]);

    return jsonResponse({social:filtered});
  } catch(error){
    return publicError(error,error.status||500);
  }
};
