import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    const url=new URL(request.url);
    const id=url.searchParams.get('id');
    if(!id) throw Object.assign(new Error('conversation id required'),{status:400});

    const owned=await supabaseRequest(
      scopedPath('social_conversations?id=eq.'+encodeURIComponent(id)+'&select=id,account_id,contact_id,platform&limit=1',workspaceId)
    );
    if(!owned?.[0]) throw Object.assign(new Error('Conversation not found'),{status:404});

    const [conversation,messages,outbox]=await Promise.all([
      supabaseRequest('v_social_inbox?conversation_id=eq.'+encodeURIComponent(id)+'&select=*&limit=1'),
      supabaseRequest(scopedPath('social_messages?conversation_id=eq.'+encodeURIComponent(id)+'&select=*&order=sent_at.asc&limit=500',workspaceId)),
      supabaseRequest(scopedPath('social_outbox?conversation_id=eq.'+encodeURIComponent(id)+'&select=id,body,status,reply_mode,target_platform_id,platform_message_id,last_error,queued_at,sent_at&order=queued_at.asc&limit=100',workspaceId)),
    ]);

    if(!conversation?.[0]) throw Object.assign(new Error('Conversation not found'),{status:404});

    await supabaseRequest(
      scopedPath('social_conversations?id=eq.'+encodeURIComponent(id),workspaceId),
      {method:'PATCH',body:{unread_count:0,updated_at:new Date().toISOString()}}
    ).catch(()=>{});

    return jsonResponse({conversation:conversation[0],messages:messages||[],outbox:outbox||[]});
  } catch(error){
    return publicError(error,error.status||500);
  }
};
