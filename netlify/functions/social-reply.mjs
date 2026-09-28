import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});

    const input=await request.json();
    const conversationId=String(input.conversationId||'');
    const body=String(input.body||'').trim();
    if(!conversationId||!body) throw Object.assign(new Error('conversationId and body are required'),{status:400});

    const rows=await supabaseRequest(
      scopedPath('social_conversations?id=eq.'+encodeURIComponent(conversationId)+'&select=id,account_id,contact_id,platform,metadata&limit=1',workspaceId)
    );
    const c=rows?.[0];
    if(!c) throw Object.assign(new Error('Conversation not found'),{status:404});
    const accounts=await supabaseRequest(scopedPath(
      'content_accounts?id=eq.'+encodeURIComponent(c.account_id)+'&select=id,access_token,metadata&limit=1',workspaceId
    ));
    if(!accounts?.[0]?.access_token||accounts[0].metadata?.disconnected_at){
      throw Object.assign(new Error('This channel is disconnected. Reconnect it before replying.'),{status:409});
    }

    const created=await supabaseRequest('social_outbox',{
      method:'POST',
      headers:{Prefer:'return=representation'},
      body:{
        conversation_id:c.id,
        account_id:c.account_id,
        contact_id:c.contact_id,
        reply_mode:input.replyMode||'dm',
        target_platform_id:input.targetPlatformId||null,
        body,
        status:'pending',
        metadata:{manual:true,created_from:'alchemic_media'},
        ...(workspaceId?{workspace_id:workspaceId}:{})
      }
    });

    return jsonResponse({queued:true,outbox:created?.[0]||null},201);
  } catch(error){
    return publicError(error,error.status||500);
  }
};
