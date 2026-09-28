import { jsonResponse, supabaseRequest, verifyMetaSignature } from './_shared.mjs';

const textResponse=(body,status=200)=>new Response(String(body),{status,headers:{'content-type':'text/plain; charset=utf-8'}});

async function accountFor(platformId){
  const rows=await supabaseRequest(
    'content_accounts?platform_account_id=eq.'+encodeURIComponent(platformId)+
    '&platform=in.(instagram_reels,facebook_page)&select=id,platform,platform_account_id,username,workspace_id,metadata&limit=1'
  );
  return rows?.[0]?.metadata?.disconnected_at ? null : rows?.[0]||null;
}

async function upsertContact({account,platformUserId,username=null,displayName=null,metadata={}}){
  if(!platformUserId||!account) return null;
  const workspaceId=account.workspace_id||null;
  const query=workspaceId
    ? 'social_contacts?on_conflict=workspace_id,platform,platform_user_id'
    : 'social_contacts?on_conflict=platform,platform_user_id';

  const rows=await supabaseRequest(query,{
    method:'POST',
    headers:{Prefer:'resolution=merge-duplicates,return=representation'},
    body:{
      platform:account.platform,
      platform_user_id:String(platformUserId),
      username,
      display_name:displayName,
      last_seen_at:new Date().toISOString(),
      metadata,
      ...(workspaceId?{workspace_id:workspaceId}:{})
    }
  });
  return rows?.[0]||null;
}

async function sourceHistoryFor(account,sourceExternalPostId){
  if(!sourceExternalPostId) return null;
  const queues=await supabaseRequest(
    'content_publish_queue?external_post_id=eq.'+encodeURIComponent(sourceExternalPostId)+
    '&or=(selected_account_id.eq.'+encodeURIComponent(account.id)+',account_id.eq.'+encodeURIComponent(account.id)+')'+
    '&select=id&order=created_at.desc&limit=1'
  ).catch(()=>[]);
  const queueId=queues?.[0]?.id;
  if(!queueId) return null;

  const history=await supabaseRequest(
    'content_history?queue_id=eq.'+encodeURIComponent(queueId)+
    '&event_type=eq.published&select=id&order=created_at.desc&limit=1'
  ).catch(()=>[]);
  return history?.[0]?.id||null;
}

async function upsertConversation({account,contact,threadId,sourceExternalPostId=null,metadata={}}){
  const existing=await supabaseRequest(
    'social_conversations?account_id=eq.'+encodeURIComponent(account.id)+
    '&platform_thread_id=eq.'+encodeURIComponent(threadId)+
    '&select=id,source_history_id,source_external_post_id,metadata&limit=1'
  ).catch(()=>[]);

  const sourceHistoryId=sourceExternalPostId
    ? await sourceHistoryFor(account,sourceExternalPostId)
    : existing?.[0]?.source_history_id||null;

  const preservedExternal=sourceExternalPostId||existing?.[0]?.source_external_post_id||null;

  const rows=await supabaseRequest('social_conversations?on_conflict=account_id,platform_thread_id',{
    method:'POST',
    headers:{Prefer:'resolution=merge-duplicates,return=representation'},
    body:{
      account_id:account.id,
      contact_id:contact.id,
      platform:account.platform,
      platform_thread_id:threadId,
      source_history_id:sourceHistoryId,
      source_external_post_id:preservedExternal,
      status:'open',
      last_message_at:new Date().toISOString(),
      metadata:{...(existing?.[0]?.metadata||{}),...metadata},
      ...(account.workspace_id?{workspace_id:account.workspace_id}:{})
    }
  });
  return rows?.[0]||null;
}

async function insertMessage({conversation,account,contact,platformMessageId,direction='inbound',type='text',body=null,mediaUrl=null,raw={}}){
  const existing=platformMessageId
    ? await supabaseRequest(
        'social_messages?account_id=eq.'+encodeURIComponent(account.id)+
        '&platform_message_id=eq.'+encodeURIComponent(platformMessageId)+
        '&select=id&limit=1'
      ).catch(()=>[])
    : [];

  if(existing?.[0]) return existing[0];

  const now=new Date().toISOString();
  const rows=await supabaseRequest('social_messages',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:{
      conversation_id:conversation.id,
      account_id:account.id,
      contact_id:contact.id,
      platform_message_id:platformMessageId||null,
      direction,
      sender_role:direction==='inbound'?'lead':'account',
      message_type:type,
      body,
      media_url:mediaUrl,
      delivery_status:direction==='inbound'?'received':'sent',
      sent_at:now,
      raw_json:raw,
      ...(account.workspace_id?{workspace_id:account.workspace_id}:{})
    }
  });

  const unread=direction==='inbound'
    ? Number(conversation.unread_count||0)+1
    : Number(conversation.unread_count||0);

  await supabaseRequest(
    'social_conversations?id=eq.'+encodeURIComponent(conversation.id),
    {
      method:'PATCH',
      body:{
        last_message_at:now,
        last_inbound_at:direction==='inbound'?now:conversation.last_inbound_at||null,
        last_outbound_at:direction==='outbound'?now:conversation.last_outbound_at||null,
        unread_count:unread,
        updated_at:now
      }
    }
  ).catch(()=>{});

  if(direction==='inbound'){
    await supabaseRequest(
      'social_contacts?id=eq.'+encodeURIComponent(contact.id),
      {method:'PATCH',body:{lead_status:'engaged',last_seen_at:now,updated_at:now}}
    ).catch(()=>{});

    const captured=await supabaseRequest(
      'growth_events?social_contact_id=eq.'+encodeURIComponent(contact.id)+
      '&event_type=eq.lead_captured&select=id&limit=1'
    ).catch(()=>[]);

    if(!captured?.[0]){
      await supabaseRequest('growth_events',{
        method:'POST',
        body:{
          event_type:'lead_captured',
          platform:account.platform,
          source:type,
          history_id:conversation.source_history_id||null,
          account_id:account.id,
          social_contact_id:contact.id,
          social_conversation_id:conversation.id,
          metadata:{platform_message_id:platformMessageId},
          ...(account.workspace_id?{workspace_id:account.workspace_id}:{})
        }
      }).catch(()=>{});
    }

    await supabaseRequest('growth_events',{
      method:'POST',
      body:{
        event_type:type==='comment'?'social_comment_received':'social_message_received',
        platform:account.platform,
        source:type,
        history_id:conversation.source_history_id||null,
        account_id:account.id,
        social_contact_id:contact.id,
        social_conversation_id:conversation.id,
        metadata:{platform_message_id:platformMessageId},
        ...(account.workspace_id?{workspace_id:account.workspace_id}:{})
      }
    }).catch(()=>{});
  }

  return rows?.[0]||null;
}

async function processMessaging(entry,event){
  const account=await accountFor(String(entry.id||event.recipient?.id||''));
  if(!account) return {ignored:'unknown_account'};

  const outbound=Boolean(event.message?.is_echo);
  const contactId=outbound?event.recipient?.id:event.sender?.id;
  if(!contactId) return {ignored:'no_contact'};

  const contact=await upsertContact({
    account,
    platformUserId:contactId,
    metadata:{last_webhook:'messaging'}
  });
  if(!contact) return {ignored:'contact_failed'};

  const conversation=await upsertConversation({
    account,
    contact,
    threadId:account.platform_account_id+':'+contact.platform_user_id,
    metadata:{webhook_source:'messages'}
  });

  const attachment=event.message?.attachments?.[0];
  const body=event.message?.text||event.postback?.title||null;
  const type=event.postback?'postback':attachment?.type||'text';
  const mediaUrl=attachment?.payload?.url||null;
  const mid=event.message?.mid||event.postback?.mid||null;

  await insertMessage({
    conversation,
    account,
    contact,
    platformMessageId:mid,
    direction:outbound?'outbound':'inbound',
    type,
    body,
    mediaUrl,
    raw:event
  });

  return {processed:true,type:'message'};
}

async function processComment(entry,change){
  const value=change.value||{};
  const account=await accountFor(String(entry.id||''));
  if(!account) return {ignored:'unknown_account'};

  const from=value.from||{};
  const contactId=from.id||value.user_id;
  if(!contactId) return {ignored:'no_commenter_id'};

  const contact=await upsertContact({
    account,
    platformUserId:contactId,
    username:from.username||null,
    displayName:from.username||null,
    metadata:{last_webhook:'comment'}
  });

  const mediaId=value.media?.id||value.media_id||null;
  const commentId=value.id||value.comment_id||null;
  const conversation=await upsertConversation({
    account,
    contact,
    threadId:account.platform_account_id+':'+contact.platform_user_id,
    sourceExternalPostId:mediaId,
    metadata:{webhook_source:'comments'}
  });

  await insertMessage({
    conversation,
    account,
    contact,
    platformMessageId:commentId,
    direction:'inbound',
    type:'comment',
    body:value.text||value.message||null,
    raw:value
  });

  return {processed:true,type:'comment',commentId};
}

export default async (request)=>{
  const url=new URL(request.url);

  if(request.method==='GET'){
    const mode=url.searchParams.get('hub.mode');
    const token=url.searchParams.get('hub.verify_token');
    const challenge=url.searchParams.get('hub.challenge');

    if(mode==='subscribe'&&token&&token===process.env.META_WEBHOOK_VERIFY_TOKEN){
      return textResponse(challenge||'');
    }
    return textResponse('Forbidden',403);
  }

  if(request.method!=='POST') return textResponse('Method Not Allowed',405);

  const raw=await request.text();
  if(!verifyMetaSignature(raw,request.headers.get('x-hub-signature-256'))){
    return textResponse('Invalid signature',401);
  }

  let payload;
  try{payload=JSON.parse(raw);}catch{return textResponse('Bad JSON',400);}

  const results=[];
  try{
    for(const entry of payload.entry||[]){
      for(const event of entry.messaging||[]){
        const key=event.message?.mid||event.postback?.mid||(entry.id+':'+(event.timestamp||Date.now()));
        const account=await accountFor(String(entry.id||event.recipient?.id||'')).catch(()=>null);
        const provider=account?.platform==='facebook_page'?'facebook':'instagram';

        await supabaseRequest('social_webhook_events',{
          method:'POST',
          body:{
            provider,
            event_key:key,
            account_platform_id:String(entry.id||''),
            event_type:'messaging',
            payload:event,
            status:'received',
            ...(account?.workspace_id?{workspace_id:account.workspace_id}:{})
          }
        }).catch(()=>{});

        results.push(await processMessaging(entry,event));
      }

      for(const change of entry.changes||[]){
        const value=change.value||{};
        const key=value.id||value.comment_id||(entry.id+':'+change.field+':'+(value.created_time||Date.now()));
        const account=await accountFor(String(entry.id||'')).catch(()=>null);
        const provider=account?.platform==='facebook_page'?'facebook':'instagram';

        await supabaseRequest('social_webhook_events',{
          method:'POST',
          body:{
            provider,
            event_key:key,
            account_platform_id:String(entry.id||''),
            event_type:change.field||'change',
            payload:change,
            status:'received',
            ...(account?.workspace_id?{workspace_id:account.workspace_id}:{})
          }
        }).catch(()=>{});

        if(change.field==='comments'||change.field==='comment'){
          results.push(await processComment(entry,change));
        }else{
          results.push({ignored:change.field||'change'});
        }
      }
    }

    return jsonResponse({received:true,results});
  }catch(error){
    console.error(error);
    return jsonResponse({received:true,error:'processing_failed'},200);
  }
};
