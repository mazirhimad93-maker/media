import { scopedPath, supabaseRequest } from './_shared.mjs';

function outgoingMessage(job){
  const attachment=job.metadata?.attachment;
  return attachment
    ? {attachment:{type:attachment.type,payload:{url:attachment.url}}}
    : {text:job.body};
}

async function sendInstagram(account, contact, job, fetcher){
  const version=process.env.INSTAGRAM_API_VERSION?.trim()||'v26.0';
  const endpoint=`https://graph.instagram.com/${version}/${encodeURIComponent(account.platform_account_id)}/messages`;
  let recipient;
  if(job.reply_mode==='private_reply'){
    if(!job.target_platform_id) throw new Error('Private reply requires target_platform_id = comment ID');
    recipient={comment_id:job.target_platform_id};
  } else {
    const id=job.target_platform_id||contact.platform_user_id;
    if(!id) throw new Error('Recipient platform user ID is missing');
    recipient={id};
  }
  const response=await fetcher(endpoint,{method:'POST',headers:{authorization:`Bearer ${account.access_token}`,'content-type':'application/json'},body:JSON.stringify({recipient,message:outgoingMessage(job)})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error) throw new Error(data?.error?.message||`Instagram send failed (${response.status})`);
  return {messageId:data.message_id||null,raw:data};
}

async function sendFacebook(account, contact, job, fetcher){
  const version=process.env.FACEBOOK_API_VERSION?.trim()||'v26.0';
  const endpoint=`https://graph.facebook.com/${version}/${encodeURIComponent(account.platform_account_id)}/messages`;
  const recipientId=job.target_platform_id||contact.platform_user_id;
  if(!recipientId) throw new Error('Facebook recipient PSID is missing');

  const response=await fetcher(endpoint,{
    method:'POST',
    headers:{
      authorization:`Bearer ${account.access_token}`,
      'content-type':'application/json'
    },
    body:JSON.stringify({
      recipient:{id:recipientId},
      messaging_type:'RESPONSE',
      message:outgoingMessage(job)
    })
  });

  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error) throw new Error(data?.error?.message||`Facebook Messenger send failed (${response.status})`);
  return {messageId:data.message_id||null,raw:data};
}

export async function deliverClaimedSocialJob(job,{db=supabaseRequest,fetcher=fetch,retryOnFailure=true}={}){
  let account,contact,sent;
  try{
    const [accounts,contacts]=await Promise.all([
      db(`content_accounts?id=eq.${encodeURIComponent(job.account_id)}&select=id,platform,platform_account_id,username,access_token,capabilities_json&limit=1`),
      db(`social_contacts?id=eq.${encodeURIComponent(job.contact_id)}&select=id,platform,platform_user_id,username,display_name&limit=1`)
    ]);
    account=accounts?.[0]; contact=contacts?.[0];
    if(!account||!contact) throw new Error('Account or contact not found');
    if(account.platform==='instagram_reels') sent=await sendInstagram(account,contact,job,fetcher);
    else if(account.platform==='facebook_page') sent=await sendFacebook(account,contact,job,fetcher);
    else throw new Error(`Outbound messaging not enabled yet for ${account.platform}`);
  }catch(error){
    const status=retryOnFailure && job.attempts<job.max_attempts?'pending':'failed';
    await db(`social_outbox?id=eq.${encodeURIComponent(job.id)}`,{method:'PATCH',body:{status,last_error:String(error.message||error).slice(0,1000),locked_at:null,locked_by:null,updated_at:new Date().toISOString()}}).catch(()=>{});
    return {id:job.id,status,error:error.message};
  }

  // Meta accepted the message. A later database error must never put it back
  // into the queue, since a retry could send the DM twice.
  const now=new Date().toISOString();
  try{
    await db(`social_outbox?id=eq.${encodeURIComponent(job.id)}`,{method:'PATCH',body:{status:'sent',platform_message_id:sent.messageId,last_error:null,sent_at:now,locked_at:null,locked_by:null,updated_at:now}});
  }catch(error){
    console.error('Meta accepted social reply but outbox confirmation failed',error);
    return {id:job.id,status:'sending',sent:true,error:'Meta accepted the reply, but its delivery record could not be updated. Do not resend it yet.'};
  }
  try{
    const existing=sent.messageId
      ? await db(`social_messages?account_id=eq.${encodeURIComponent(account.id)}&platform_message_id=eq.${encodeURIComponent(sent.messageId)}&select=id&limit=1`)
      : [];
    if(!existing?.length) await db('social_messages',{method:'POST',headers:{Prefer:'return=minimal'},body:{conversation_id:job.conversation_id,account_id:job.account_id,contact_id:job.contact_id,platform_message_id:sent.messageId,direction:'outbound',sender_role:'account',message_type:job.metadata?.attachment?.type||(job.reply_mode==='private_reply'?'private_reply':'text'),body:job.body,media_url:job.metadata?.attachment?.url||null,delivery_status:'sent',sent_at:now,raw_json:sent.raw}});
  }catch(error){ console.error('Could not record delivered social message',error); }
  await db(scopedPath(`social_conversations?id=eq.${encodeURIComponent(job.conversation_id)}`,job.workspace_id),{method:'PATCH',body:{last_message_at:now,last_outbound_at:now,updated_at:now}}).catch(console.error);
  // Reaching out moves a new contact to Engaged, but never overwrites a stage
  // the team already selected (Qualified, Booked, and so on).
  await db(scopedPath(`social_contacts?id=eq.${encodeURIComponent(contact.id)}&lead_status=eq.new`,job.workspace_id),{
    method:'PATCH',body:{lead_status:'engaged',updated_at:now}
  }).catch(console.error);
  const replySource=job.metadata?.automated===true?'comment_automation':'manual_social_inbox';
  await db('growth_events',{method:'POST',body:{
    event_type:'social_reply_sent',
    occurred_at:now,
    platform:account.platform,
    source:replySource,
    account_id:account.id,
    social_contact_id:contact.id,
    social_conversation_id:job.conversation_id,
    metadata:{
      outbox_id:job.id,
      reply_mode:job.reply_mode,
      automation_id:job.metadata?.automation_id||null,
      keyword:job.metadata?.keyword||null
    },
    ...(job.workspace_id?{workspace_id:job.workspace_id}:{})
  }}).catch(()=>{});
  return {id:job.id,status:'sent',sent:true,platform_message_id:sent.messageId};
}

// The conditional PATCH claims only this reply. It races safely with the
// scheduled dispatcher because a second claimant sees no pending row.
export async function dispatchSocialOutboxItem(id,workspaceId,{db=supabaseRequest,fetcher=fetch}={}){
  const job=(await db(scopedPath(`social_outbox?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,workspaceId)))?.[0];
  if(!job){const error=new Error('Reply not found');error.status=404;throw error;}
  if(!['pending','failed'].includes(job.status)) return {id,status:job.status,sent:job.status==='sent'};
  const now=new Date().toISOString();
  const claimed=await db(scopedPath(`social_outbox?id=eq.${encodeURIComponent(id)}&status=eq.${job.status}&select=*`,workspaceId),{
    method:'PATCH',headers:{Prefer:'return=representation'},
    body:{status:'sending',attempts:Number(job.attempts||0)+1,locked_at:now,locked_by:`social-hub-direct-${Date.now()}`,updated_at:now}
  });
  if(!claimed?.[0]) return {id,status:'sending',sent:false};
  return deliverClaimedSocialJob(claimed[0],{db,fetcher,retryOnFailure:false});
}
