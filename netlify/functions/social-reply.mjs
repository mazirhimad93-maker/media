import { connectorOrigin, jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';
import { dispatchSocialOutboxItem } from './_social-delivery.mjs';
import { loadMessagingContext, assertMessagingAllowed } from './_messaging-eligibility.mjs';

export default async (request) => {
  try {
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});

    const input=await request.json();
    const conversationId=String(input.conversationId||'');
    const body=String(input.body||'').trim();
    const attachment=input.attachment||null;
    if(!conversationId||(!body&&!attachment)) throw Object.assign(new Error('Choose a message or attachment.'),{status:400});
    if(attachment&&body) throw Object.assign(new Error('Send the attachment and text as separate messages.'),{status:400});

    const rows=await supabaseRequest(
      scopedPath('social_conversations?id=eq.'+encodeURIComponent(conversationId)+'&select=id,account_id,contact_id,platform,metadata&limit=1',workspaceId)
    );
    const c=rows?.[0];
    if(!c) throw Object.assign(new Error('Conversation not found'),{status:404});

    let replyMode=String(input.replyMode||'').trim();
    if(replyMode && !['dm','private_reply'].includes(replyMode)) throw Object.assign(new Error('Unsupported reply mode'),{status:400});
    let targetPlatformId=input.targetPlatformId||null;
    const accounts=await supabaseRequest(scopedPath(
      'content_accounts?id=eq.'+encodeURIComponent(c.account_id)+'&select=id,platform,access_token,metadata,capabilities_json&limit=1',workspaceId
    ));
    if(!accounts?.[0]?.access_token||accounts[0].metadata?.disconnected_at){
      throw Object.assign(new Error('This channel is disconnected. Reconnect it before replying.'),{status:409});
    }
    const eligibility=await loadMessagingContext({...c,workspace_id:workspaceId},accounts[0]);
    // Pick an available private reply even if an old DM once existed.
    if(!input.replyMode && eligibility.reply_mode==='private_reply'){
      replyMode='private_reply'; targetPlatformId=eligibility.target_platform_id;
    }
    if(!replyMode) replyMode='dm';
    if(replyMode==='dm') targetPlatformId=null;
    assertMessagingAllowed(eligibility,{replyMode,targetPlatformId,manual:true,purpose:input.purpose});
    if(attachment && replyMode==='private_reply') throw Object.assign(new Error('The first private reply must be text.'),{status:409});
    let media=null;
    if(attachment){
      const type=String(attachment.type||'');
      const path=String(attachment.storagePath||'');
      const prefix=`${workspaceId||'default'}/${conversationId}/`;
      const extension=path.slice(prefix.length).match(/^[0-9a-f-]{36}\.([a-z0-9]+)$/)?.[1];
      const allowed={image:['jpg','png'],video:['mp4'],audio:['m4a','wav'],file:['pdf']};
      if(!allowed[type]?.includes(extension)||!path.startsWith(prefix)){
        throw Object.assign(new Error('Invalid attachment. Choose the file again.'),{status:400});
      }
      media={type,url:`${connectorOrigin(request)}/api/social/media/file?path=${encodeURIComponent(path)}`,name:String(attachment.name||type).slice(0,120)};
    }

    const created=await supabaseRequest('social_outbox',{
      method:'POST',
      headers:{Prefer:'return=representation'},
      body:{
        conversation_id:c.id,
        account_id:c.account_id,
        contact_id:c.contact_id,
        reply_mode:replyMode,
        target_platform_id:targetPlatformId,
        body:body||`[${media.type==='audio'?'Voice message':media.name}]`,
        status:'pending',
        metadata:{
          manual:true,
          created_from:'alchemic_media',
          purpose:input.purpose==='human_support'?'human_support':'conversation',
          ...(replyMode==='private_reply'?{comment_private_reply:true}:{}),
          ...(media?{attachment:media}:{})
        },
        ...(workspaceId?{workspace_id:workspaceId}:{})
      }
    });

    const outbox=created?.[0];
    if(!outbox?.id) throw new Error('Reply was not added to the outbox.');
    let delivery;
    try {
      delivery=await dispatchSocialOutboxItem(outbox.id,workspaceId);
    } catch(error) {
      console.error('Immediate social delivery could not start',error);
      delivery={id:outbox.id,status:'pending',sent:false,error:'Delivery could not start. Use Send now on the pending reply to retry.'};
    }
    return jsonResponse({queued:delivery.status==='pending',sent:delivery.sent===true,delivery,outbox},201);
  } catch(error){
    return publicError(error,error.status||500);
  }
};
