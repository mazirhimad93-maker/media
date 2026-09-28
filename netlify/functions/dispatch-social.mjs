import { jsonResponse, publicError, requireAdmin, rpc, supabaseRequest } from './_shared.mjs';

async function sendInstagram(account, contact, job){
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
  const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${account.access_token}`,'content-type':'application/json'},body:JSON.stringify({recipient,message:{text:job.body}})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error) throw new Error(data?.error?.message||`Instagram send failed (${response.status})`);
  return {messageId:data.message_id||null,raw:data};
}

async function sendFacebook(account, contact, job){
  const version=process.env.FACEBOOK_API_VERSION?.trim()||'v26.0';
  const endpoint=`https://graph.facebook.com/${version}/${encodeURIComponent(account.platform_account_id)}/messages`;
  const recipientId=job.target_platform_id||contact.platform_user_id;
  if(!recipientId) throw new Error('Facebook recipient PSID is missing');

  const response=await fetch(endpoint,{
    method:'POST',
    headers:{
      authorization:`Bearer ${account.access_token}`,
      'content-type':'application/json'
    },
    body:JSON.stringify({
      recipient:{id:recipientId},
      messaging_type:'RESPONSE',
      message:{text:job.body}
    })
  });

  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.error) throw new Error(data?.error?.message||`Facebook Messenger send failed (${response.status})`);
  return {messageId:data.message_id||null,raw:data};
}

export default async (request)=>{
  try{
    requireAdmin(request); if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json().catch(()=>({})); const limit=Math.min(25,Math.max(1,Number(input.limit||10))); const worker=`social-hub-${Date.now()}`;
    const jobs=(await rpc('claim_social_outbox',{p_worker:worker,p_limit:limit}))||[]; const results=[];
    for(const job of jobs){
      try{
        const [accounts,contacts]=await Promise.all([
          supabaseRequest(`content_accounts?id=eq.${encodeURIComponent(job.account_id)}&select=id,platform,platform_account_id,username,access_token,capabilities_json&limit=1`),
          supabaseRequest(`social_contacts?id=eq.${encodeURIComponent(job.contact_id)}&select=id,platform,platform_user_id,username,display_name&limit=1`)
        ]);
        const account=accounts?.[0],contact=contacts?.[0]; if(!account||!contact) throw new Error('Account or contact not found');
        let sent;
        if(account.platform==='instagram_reels') sent=await sendInstagram(account,contact,job);
        else if(account.platform==='facebook_page') sent=await sendFacebook(account,contact,job);
        else throw new Error(`Outbound messaging not enabled yet for ${account.platform}`);
        const now=new Date().toISOString();
        await supabaseRequest(`social_outbox?id=eq.${encodeURIComponent(job.id)}`,{method:'PATCH',body:{status:'sent',platform_message_id:sent.messageId,last_error:null,sent_at:now,updated_at:now}});
        await supabaseRequest('social_messages',{method:'POST',headers:{Prefer:'return=minimal'},body:{conversation_id:job.conversation_id,account_id:job.account_id,contact_id:job.contact_id,platform_message_id:sent.messageId,direction:'outbound',sender_role:'account',message_type:job.reply_mode==='private_reply'?'private_reply':'text',body:job.body,delivery_status:'sent',sent_at:now,raw_json:sent.raw}});
        await supabaseRequest(`social_conversations?id=eq.${encodeURIComponent(job.conversation_id)}`,{method:'PATCH',body:{last_message_at:now,last_outbound_at:now,unread_count:0,updated_at:now}});
        await supabaseRequest('growth_events',{method:'POST',body:{event_type:'social_reply_sent',occurred_at:now,platform:account.platform,source:'manual_social_inbox',account_id:account.id,social_contact_id:contact.id,social_conversation_id:job.conversation_id,metadata:{outbox_id:job.id,reply_mode:job.reply_mode}}}).catch(()=>{});
        results.push({id:job.id,status:'sent',platform_message_id:sent.messageId});
      }catch(error){
        const status=job.attempts>=job.max_attempts?'failed':'pending';
        await supabaseRequest(`social_outbox?id=eq.${encodeURIComponent(job.id)}`,{method:'PATCH',body:{status,last_error:String(error.message||error).slice(0,1000),locked_at:null,locked_by:null,updated_at:new Date().toISOString()}}).catch(()=>{});
        results.push({id:job.id,status:'failed',error:error.message});
      }
    }
    return jsonResponse({claimed:jobs.length,results});
  }catch(error){ return publicError(error,error.status||500); }
};
