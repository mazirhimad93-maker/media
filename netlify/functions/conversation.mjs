import { jsonResponse, publicError, requireAdmin, supabaseRequest } from './_shared.mjs';
export default async (request) => {
  try {
    requireAdmin(request);
    const url=new URL(request.url); const id=url.searchParams.get('id'); if(!id) throw Object.assign(new Error('conversation id required'),{status:400});
    const [conversation,messages,outbox]=await Promise.all([
      supabaseRequest(`v_social_inbox?conversation_id=eq.${encodeURIComponent(id)}&select=*&limit=1`),
      supabaseRequest(`social_messages?conversation_id=eq.${encodeURIComponent(id)}&select=*&order=sent_at.asc&limit=500`),
      supabaseRequest(`social_outbox?conversation_id=eq.${encodeURIComponent(id)}&select=id,body,status,reply_mode,target_platform_id,last_error,queued_at,sent_at&order=queued_at.asc&limit=100`),
    ]);
    if(!conversation?.[0]) throw Object.assign(new Error('Conversation not found'),{status:404});
    await supabaseRequest(`social_conversations?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{unread_count:0,updated_at:new Date().toISOString()}}).catch(()=>{});
    return jsonResponse({conversation:conversation[0],messages:messages||[],outbox:outbox||[]});
  } catch(error){ return publicError(error,error.status||500); }
};
