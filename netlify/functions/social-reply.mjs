import { jsonResponse, publicError, requireUser, supabaseRequest } from './_shared.mjs';
export default async (request) => {
  try {
    await requireUser(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json(); const conversationId=String(input.conversationId||''); const body=String(input.body||'').trim();
    if(!conversationId||!body) throw Object.assign(new Error('conversationId and body are required'),{status:400});
    const rows=await supabaseRequest(`social_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id,account_id,contact_id,platform,metadata&limit=1`); const c=rows?.[0];
    if(!c) throw Object.assign(new Error('Conversation not found'),{status:404});
    const replyMode=input.replyMode||'dm';
    const created=await supabaseRequest('social_outbox',{method:'POST',headers:{Prefer:'return=representation'},body:{conversation_id:c.id,account_id:c.account_id,contact_id:c.contact_id,reply_mode:replyMode,target_platform_id:input.targetPlatformId||null,body,status:'pending',metadata:{manual:true,created_from:'social_hub'}}});
    return jsonResponse({queued:true,outbox:created?.[0]||null},201);
  } catch(error){ return publicError(error,error.status||500); }
};
