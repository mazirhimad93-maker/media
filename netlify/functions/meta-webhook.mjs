import { jsonResponse, scopedPath, supabaseRequest, verifyMetaSignature } from './_shared.mjs';
import { addUnreadMessages } from './_social-unread.mjs';
import { dispatchSocialOutboxItem } from './_social-delivery.mjs';

const textResponse=(body,status=200)=>new Response(String(body),{status,headers:{'content-type':'text/plain; charset=utf-8'}});

async function accountFor(platformId){
  const rows=await supabaseRequest(
    'content_accounts?platform_account_id=eq.'+encodeURIComponent(platformId)+
    '&platform=in.(instagram_reels,facebook_page)&select=id,platform,platform_account_id,username,workspace_id,metadata&limit=1'
  );
  return rows?.[0]?.metadata?.disconnected_at ? null : rows?.[0]||null;
}

export async function upsertContact({account,platformUserId,username=null,displayName=null,metadata={}},db=supabaseRequest){
  if(!platformUserId||!account) return null;
  const workspaceId=account.workspace_id||null;
  const base=scopedPath(
    'social_contacts?platform=eq.'+encodeURIComponent(account.platform)+
    '&platform_user_id=eq.'+encodeURIComponent(String(platformUserId)),workspaceId
  );
  const existing=(await db(base+'&select=id,username,display_name,metadata&limit=1'))?.[0];
  const now=new Date().toISOString();
  if(existing){
    const rows=await db(scopedPath('social_contacts?id=eq.'+encodeURIComponent(existing.id),workspaceId)+'&select=*',{
      method:'PATCH',headers:{Prefer:'return=representation'},
      body:{
        ...(username?{username}:{}),...(displayName?{display_name:displayName}:{}),
        last_seen_at:now,updated_at:now,metadata:{...(existing.metadata||{}),...metadata}
      }
    });
    return rows?.[0]||existing;
  }
  const conflict=workspaceId?'workspace_id,platform,platform_user_id':'platform,platform_user_id';
  const rows=await db('social_contacts?on_conflict='+encodeURIComponent(conflict),{
    method:'POST',
    headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:{
      platform:account.platform,
      platform_user_id:String(platformUserId),
      username,
      display_name:displayName,
      last_seen_at:now,
      metadata,
      ...(workspaceId?{workspace_id:workspaceId}:{})
    }
  });
  return rows?.[0]||(await db(base+'&select=*&limit=1'))?.[0]||null;
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
  const base=scopedPath('social_conversations?account_id=eq.'+encodeURIComponent(account.id)+
    '&platform_thread_id=eq.'+encodeURIComponent(threadId)+
    '&select=*&limit=1',account.workspace_id);
  const existing=(await supabaseRequest(base))?.[0];

  const sourceHistoryId=sourceExternalPostId
    ? await sourceHistoryFor(account,sourceExternalPostId)
    : existing?.source_history_id||null;

  const preservedExternal=sourceExternalPostId||existing?.source_external_post_id||null;
  if(existing){
    const rows=await supabaseRequest(scopedPath('social_conversations?id=eq.'+encodeURIComponent(existing.id),account.workspace_id)+'&select=*',{
      method:'PATCH',headers:{Prefer:'return=representation'},
      body:{
        ...(sourceHistoryId?{source_history_id:sourceHistoryId}:{}),
        ...(preservedExternal?{source_external_post_id:preservedExternal}:{}),
        metadata:{...(existing.metadata||{}),...metadata}
      }
    });
    return rows?.[0]||existing;
  }

  const rows=await supabaseRequest('social_conversations?on_conflict=account_id,platform_thread_id',{
    method:'POST',
    headers:{Prefer:'resolution=ignore-duplicates,return=representation'},
    body:{
      account_id:account.id,
      contact_id:contact.id,
      platform:account.platform,
      platform_thread_id:threadId,
      source_history_id:sourceHistoryId,
      source_external_post_id:preservedExternal,
      metadata,
      ...(account.workspace_id?{workspace_id:account.workspace_id}:{})
    }
  });
  return rows?.[0]||(await supabaseRequest(base))?.[0]||null;
}

export async function insertMessage({conversation,account,contact,platformMessageId,direction='inbound',type='text',body=null,mediaUrl=null,raw={}},db=supabaseRequest){
  const existing=platformMessageId
    ? await db(
        'social_messages?account_id=eq.'+encodeURIComponent(account.id)+
        '&platform_message_id=eq.'+encodeURIComponent(platformMessageId)+
        '&select=id&limit=1'
      ).catch(()=>[])
    : [];

  if(existing?.[0]) return existing[0];

  const now=new Date().toISOString();
  const rows=await db('social_messages',{
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

  await db(
    scopedPath('social_conversations?id=eq.'+encodeURIComponent(conversation.id),account.workspace_id),
    {
      method:'PATCH',
      body:{
        last_message_at:now,
        ...(direction==='inbound'?{last_inbound_at:now}:{last_outbound_at:now}),
        updated_at:now
      }
    }
  );

  if(direction==='inbound'){
    await addUnreadMessages(conversation.id,1,account.workspace_id,db);
    await db(
      scopedPath('social_contacts?id=eq.'+encodeURIComponent(contact.id),account.workspace_id),
      {method:'PATCH',body:{last_seen_at:now,updated_at:now}}
    ).catch(()=>{});

    const captured=await db(
      'growth_events?social_contact_id=eq.'+encodeURIComponent(contact.id)+
      '&event_type=eq.lead_captured&select=id&limit=1'
    ).catch(()=>[]);

    if(!captured?.[0]){
      await db('growth_events',{
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

    await db('growth_events',{
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
  }else{
    await db(
      scopedPath('social_contacts?id=eq.'+encodeURIComponent(contact.id)+'&lead_status=eq.new',account.workspace_id),
      {method:'PATCH',body:{lead_status:'engaged',updated_at:now}}
    ).catch(()=>{});
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

// A receipt is evidence of a read only when it belongs to this contact and
// identifies an outbound message. An inbound mid must never turn our replies
// into "seen" messages.
export async function applyReadReceipt(account, event, db = supabaseRequest) {
  const senderId = String(event.sender?.id || '');
  if (!senderId || !event.read || String(event.recipient?.id || '') !== String(account.platform_account_id)) return { ignored: 'invalid_receipt' };
  const contacts = await db(scopedPath(
    `social_contacts?platform=eq.${encodeURIComponent(account.platform)}&platform_user_id=eq.${encodeURIComponent(senderId)}&select=id&limit=1`,
    account.workspace_id
  ));
  const contactId = contacts?.[0]?.id;
  if (!contactId) return { ignored: 'unknown_contact' };
  const base = `social_messages?account_id=eq.${encodeURIComponent(account.id)}&contact_id=eq.${encodeURIComponent(contactId)}&direction=eq.outbound`;
  let query;
  if (account.platform === 'instagram_reels' && event.read.mid) {
    query = `${base}&platform_message_id=eq.${encodeURIComponent(event.read.mid)}&select=id&limit=1`;
  } else if (account.platform === 'facebook_page' && Number.isFinite(Number(event.read.watermark))) {
    const watermark = new Date(Number(event.read.watermark)).toISOString();
    query = `${base}&sent_at=lte.${encodeURIComponent(watermark)}&select=id&limit=500`;
  } else return { ignored: 'unsupported_receipt' };
  const messages = await db(scopedPath(query, account.workspace_id));
  if (!messages?.length) return { ignored: 'no_outbound_match' };
  const ids = messages.map((message) => message.id);
  await db(scopedPath(`${base}&id=in.(${ids.map(encodeURIComponent).join(',')})`, account.workspace_id), {
    method: 'PATCH', body: { delivery_status: 'read' }
  });
  return { processed: true, type: 'read', count: ids.length };
}

async function matchingCommentAutomation(account,commentText){
  const text=String(commentText||'').trim().toLowerCase();
  if(!text) return null;

  const rows=await supabaseRequest(
    scopedPath(
      'social_comment_automations?is_active=eq.true'+
      '&or=(account_id.is.null,account_id.eq.'+encodeURIComponent(account.id)+')'+
      '&select=*&order=created_at.asc',
      account.workspace_id
    )
  ).catch(()=>[]);

  // Prefer an account-specific rule over a workspace-wide fallback.
  const ordered=[...(rows||[])].sort((a,b)=>Number(Boolean(b.account_id))-Number(Boolean(a.account_id)));
  return ordered.find(rule=>{
    const keyword=String(rule.keyword||'').trim().toLowerCase();
    if(!keyword) return false;
    return rule.match_type==='exact' ? text===keyword : text.includes(keyword);
  })||null;
}

async function runCommentAutomation({account,contact,conversation,commentId,mediaId,commentText}){
  if(!commentId||!contact||!conversation) return {automation:'skipped',reason:'missing_context'};
  if(String(contact.platform_user_id||'')===String(account.platform_account_id||'')){
    return {automation:'skipped',reason:'own_comment'};
  }

  const existing=await supabaseRequest(
    scopedPath(
      'social_comment_automation_events?account_id=eq.'+encodeURIComponent(account.id)+
      '&comment_id=eq.'+encodeURIComponent(String(commentId))+
      '&select=id,status,outbox_id&limit=1',
      account.workspace_id
    )
  ).catch(()=>[]);
  if(existing?.[0]) return {automation:'duplicate',event:existing[0]};

  const rule=await matchingCommentAutomation(account,commentText);
  if(!rule) return {automation:'no_match'};

  // Insert the idempotency record first. If Meta retries the webhook while the
  // reply is being sent, the unique(account_id, comment_id) index blocks a
  // second private message.
  let event;
  try{
    event=(await supabaseRequest('social_comment_automation_events',{
      method:'POST',
      headers:{Prefer:'return=representation'},
      body:{
        workspace_id:account.workspace_id||null,
        automation_id:rule.id,
        account_id:account.id,
        conversation_id:conversation.id,
        contact_id:contact.id,
        comment_id:String(commentId),
        media_id:mediaId?String(mediaId):null,
        comment_text:String(commentText||''),
        matched_keyword:rule.keyword,
        status:'matched',
        metadata:{match_type:rule.match_type}
      }
    }))?.[0];
  }catch(error){
    // A concurrent delivery may already have claimed this comment.
    const duplicate=await supabaseRequest(
      scopedPath(
        'social_comment_automation_events?account_id=eq.'+encodeURIComponent(account.id)+
        '&comment_id=eq.'+encodeURIComponent(String(commentId))+
        '&select=id,status,outbox_id&limit=1',
        account.workspace_id
      )
    ).catch(()=>[]);
    if(duplicate?.[0]) return {automation:'duplicate',event:duplicate[0]};
    throw error;
  }

  const outbox=(await supabaseRequest('social_outbox',{
    method:'POST',
    headers:{Prefer:'return=representation'},
    body:{
      conversation_id:conversation.id,
      account_id:account.id,
      contact_id:contact.id,
      reply_mode:'private_reply',
      target_platform_id:String(commentId),
      body:rule.dm_message,
      status:'pending',
      metadata:{
        automated:true,
        created_from:'comment_automation',
        automation_id:rule.id,
        automation_event_id:event?.id||null,
        keyword:rule.keyword,
        source_media_id:mediaId||null
      },
      ...(account.workspace_id?{workspace_id:account.workspace_id}:{})
    }
  }))?.[0];

  if(!outbox?.id){
    if(event?.id) await supabaseRequest(
      scopedPath('social_comment_automation_events?id=eq.'+encodeURIComponent(event.id),account.workspace_id),
      {method:'PATCH',body:{status:'failed',error_message:'Outbox insert failed',updated_at:new Date().toISOString()}}
    ).catch(()=>{});
    return {automation:'failed',reason:'outbox_insert_failed'};
  }

  if(event?.id) await supabaseRequest(
    scopedPath('social_comment_automation_events?id=eq.'+encodeURIComponent(event.id),account.workspace_id),
    {method:'PATCH',body:{status:'sending',outbox_id:outbox.id,updated_at:new Date().toISOString()}}
  ).catch(()=>{});

  const delivery=await dispatchSocialOutboxItem(outbox.id,account.workspace_id).catch(error=>({
    sent:false,status:'failed',error:error.message
  }));

  if(event?.id){
    await supabaseRequest(
      scopedPath('social_comment_automation_events?id=eq.'+encodeURIComponent(event.id),account.workspace_id),
      {
        method:'PATCH',
        body:delivery.sent===true
          ? {
              status:'sent',
              platform_message_id:delivery.platform_message_id||null,
              sent_at:new Date().toISOString(),
              error_message:null,
              updated_at:new Date().toISOString()
            }
          : {
              status:'failed',
              error_message:String(delivery.error||'Private reply failed').slice(0,1000),
              updated_at:new Date().toISOString()
            }
      }
    ).catch(()=>{});
  }

  return {
    automation:delivery.sent===true?'sent':'failed',
    automation_id:rule.id,
    keyword:rule.keyword,
    outbox_id:outbox.id,
    platform_message_id:delivery.platform_message_id||null,
    error:delivery.error||null
  };
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
  const commentText=value.text||value.message||null;
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
    body:commentText,
    raw:value
  });

  const automation=await runCommentAutomation({
    account,
    contact,
    conversation,
    commentId,
    mediaId,
    commentText
  });

  return {processed:true,type:'comment',commentId,...automation};
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
        const key=event.message?.mid||event.postback?.mid||event.read?.mid||event.read?.watermark||(entry.id+':'+(event.timestamp||Date.now()));
        const account=await accountFor(String(entry.id||event.recipient?.id||'')).catch(()=>null);
        const provider=account?.platform==='facebook_page'?'facebook':'instagram';

        await supabaseRequest('social_webhook_events',{
          method:'POST',
          body:{
            provider,
            event_key:key,
            account_platform_id:String(entry.id||''),
            event_type:event.read?'read':'messaging',
            payload:event,
            status:'received',
            ...(account?.workspace_id?{workspace_id:account.workspace_id}:{})
          }
        }).catch(()=>{});

        results.push(event.read ? (account ? await applyReadReceipt(account,event) : {ignored:'unknown_account'}) : await processMessaging(entry,event));
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
