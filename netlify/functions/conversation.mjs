import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';
import { loadMessagingContext } from './_messaging-eligibility.mjs';

export async function markVisibleMessagesRead(id,workspaceId,{unreadCount,lastInboundAt},db=supabaseRequest){
  if(!Number.isSafeInteger(unreadCount)||unreadCount<1||!lastInboundAt||Number.isNaN(Date.parse(lastInboundAt)))
    throw Object.assign(new Error('A visible unread snapshot is required'),{status:400});
  const cleared=await db(scopedPath(
    'social_conversations?id=eq.'+encodeURIComponent(id)+
    '&unread_count=eq.'+unreadCount+
    '&last_inbound_at=eq.'+encodeURIComponent(lastInboundAt)+'&select=id',workspaceId
  ),{method:'PATCH',headers:{Prefer:'return=representation'},body:{unread_count:0,updated_at:new Date().toISOString()}});
  return Boolean(cleared?.length);
}

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    const url=new URL(request.url);
    const id=url.searchParams.get('id');
    if(!id) throw Object.assign(new Error('conversation id required'),{status:400});

    const owned=await supabaseRequest(
      scopedPath('social_conversations?id=eq.'+encodeURIComponent(id)+'&select=id,account_id,contact_id,platform,metadata&limit=1',workspaceId)
    );
    if(!owned?.[0]) throw Object.assign(new Error('Conversation not found'),{status:404});

    if(request.method==='POST'){
      const snapshot=await request.json().catch(()=>({}));
      return jsonResponse({marked_read:await markVisibleMessagesRead(id,workspaceId,snapshot)});
    }
    if(request.method!=='GET') throw Object.assign(new Error('GET or POST required'),{status:405});

    const [conversation,messages,outbox,commentAutomationEvents]=await Promise.all([
      supabaseRequest('v_social_inbox?conversation_id=eq.'+encodeURIComponent(id)+'&select=*&limit=1'),
      supabaseRequest(scopedPath('social_messages?conversation_id=eq.'+encodeURIComponent(id)+'&select=*&order=sent_at.asc&limit=500',workspaceId)),
      supabaseRequest(scopedPath('social_outbox?conversation_id=eq.'+encodeURIComponent(id)+'&select=id,body,status,reply_mode,target_platform_id,platform_message_id,last_error,queued_at,sent_at,metadata&order=queued_at.asc&limit=100',workspaceId)),
      supabaseRequest(scopedPath(
        'social_comment_automation_events?conversation_id=eq.'+encodeURIComponent(id)+
        '&select=id,automation_id,comment_id,comment_text,matched_keyword,status,error_message,outbox_id,platform_message_id,created_at,sent_at,updated_at'+
        '&order=created_at.desc&limit=25',
        workspaceId
      )).catch(()=>[]),
    ]);

    if(!conversation?.[0]) throw Object.assign(new Error('Conversation not found'),{status:404});
    const account=(await supabaseRequest(scopedPath('content_accounts?id=eq.'+encodeURIComponent(owned[0].account_id)+'&select=id,platform,capabilities_json,metadata&limit=1',workspaceId)))?.[0];
    const eligibility=await loadMessagingContext({...owned[0],workspace_id:workspaceId},account||{connected:false});

    return jsonResponse({
      conversation:conversation[0],
      messages:messages||[],
      outbox:outbox||[],
      messaging_eligibility:eligibility,
      comment_automation_events:commentAutomationEvents||[]
    });
  } catch(error){
    return publicError(error,error.status||500);
  }
};
