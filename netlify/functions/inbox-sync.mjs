import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const igVersion=()=>process.env.INSTAGRAM_API_VERSION?.trim()||'v26.0';
const fbVersion=()=>process.env.FACEBOOK_API_VERSION?.trim()||'v26.0';

const idOf=value=>{
  if(!value) return null;
  if(typeof value==='string'||typeof value==='number') return String(value);
  if(value.id) return String(value.id);
  return null;
};

function toIds(value){
  if(!value) return [];
  if(Array.isArray(value)) return value.flatMap(toIds);
  if(Array.isArray(value.data)) return value.data.flatMap(toIds);
  const id=idOf(value);
  return id?[id]:[];
}

function otherParty(messages,ownId){
  const own=String(ownId||'');
  const candidates=[];
  for(const m of messages||[]){
    const from=idOf(m.from);
    if(from&&from!==own) candidates.push({id:from,name:m.from?.username||m.from?.name||null});
    for(const id of toIds(m.to)) if(id&&id!==own) candidates.push({id,name:null});
  }
  return candidates[0]||null;
}

async function getJson(url){
  const response=await fetch(url);
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error?.message||data.message||'Meta conversation request failed');
  return data;
}

async function instagramConversations(account){
  const url=new URL('https://graph.instagram.com/'+igVersion()+'/'+encodeURIComponent(account.platform_account_id)+'/conversations');
  url.search=new URLSearchParams({limit:'50',access_token:account.access_token});
  const listing=await getJson(url);
  const out=[];

  for(const conversation of listing.data||[]){
    const detail=new URL('https://graph.instagram.com/'+igVersion()+'/'+encodeURIComponent(conversation.id));
    detail.search=new URLSearchParams({
      fields:'messages{id,created_time,from,to,message}',
      access_token:account.access_token
    });
    const data=await getJson(detail).catch(()=>({id:conversation.id,messages:{data:[]}}));
    out.push({
      id:String(conversation.id),
      updated_time:conversation.updated_time||null,
      messages:data.messages?.data||[]
    });
  }
  return out;
}

async function facebookConversations(account){
  const url=new URL('https://graph.facebook.com/'+fbVersion()+'/'+encodeURIComponent(account.platform_account_id)+'/conversations');
  url.search=new URLSearchParams({
    limit:'50',
    fields:'id,updated_time,messages.limit(20){id,message,from,to,created_time}',
    access_token:account.access_token
  });
  const listing=await getJson(url);
  return (listing.data||[]).map(x=>({
    id:String(x.id),
    updated_time:x.updated_time||null,
    messages:x.messages?.data||[]
  }));
}

async function upsertContact(account,party,workspaceId){
  const conflict=workspaceId?'workspace_id,platform,platform_user_id':'platform,platform_user_id';
  const rows=await supabaseRequest('social_contacts?on_conflict='+encodeURIComponent(conflict),{
    method:'POST',
    headers:{Prefer:'resolution=merge-duplicates,return=representation'},
    body:{
      platform:account.platform,
      platform_user_id:String(party.id),
      username:party.name||null,
      display_name:party.name||null,
      lead_status:'engaged',
      first_seen_at:new Date().toISOString(),
      last_seen_at:new Date().toISOString(),
      metadata:{synced_from:'conversations_api'},
      ...(workspaceId?{workspace_id:workspaceId}:{})
    }
  });
  return rows?.[0]||null;
}

async function upsertConversation(account,contact,remote,messages,workspaceId){
  const last=messages.slice().sort((a,b)=>new Date(a.created_time||0)-new Date(b.created_time||0)).at(-1);
  const inbound=messages.filter(m=>idOf(m.from)!==String(account.platform_account_id));
  const outbound=messages.filter(m=>idOf(m.from)===String(account.platform_account_id));
  const threadId=String(account.platform_account_id)+':'+String(contact.platform_user_id);

  const rows=await supabaseRequest('social_conversations?on_conflict=account_id,platform_thread_id',{
    method:'POST',
    headers:{Prefer:'resolution=merge-duplicates,return=representation'},
    body:{
      account_id:account.id,
      contact_id:contact.id,
      platform:account.platform,
      platform_thread_id:threadId,
      status:'open',
      unread_count:0,
      last_message_at:last?.created_time||remote.updated_time||new Date().toISOString(),
      last_inbound_at:inbound.at(-1)?.created_time||null,
      last_outbound_at:outbound.at(-1)?.created_time||null,
      metadata:{synced_from:'conversations_api',remote_conversation_id:remote.id},
      ...(workspaceId?{workspace_id:workspaceId}:{})
    }
  });
  return rows?.[0]||null;
}

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json().catch(()=>({}));
    if(!input.accountId) throw Object.assign(new Error('accountId required'),{status:400});

    const rows=await supabaseRequest(scopedPath(
      'content_accounts?id=eq.'+encodeURIComponent(input.accountId)+
      '&select=id,platform,platform_account_id,username,display_name,access_token,scope,capabilities_json,webhook_status&limit=1',
      workspaceId
    ));
    const account=rows?.[0];
    if(!account) throw Object.assign(new Error('Channel not found'),{status:404});
    if(!account.access_token) throw Object.assign(new Error('Channel access token is missing'),{status:409});

    let remote=[];
    if(account.platform==='instagram_reels') remote=await instagramConversations(account);
    else if(account.platform==='facebook_page'||account.platform==='facebook') remote=await facebookConversations(account);
    else throw Object.assign(new Error('Conversation sync is supported for Instagram and Facebook Pages'),{status:400});

    const existing=await supabaseRequest(scopedPath(
      'social_messages?account_id=eq.'+encodeURIComponent(account.id)+'&platform_message_id=not.is.null&select=platform_message_id&limit=10000',
      workspaceId
    )).catch(()=>[]);
    const known=new Set((existing||[]).map(x=>String(x.platform_message_id)));

    let conversations=0,inserted=0,skipped=0;
    const inserts=[];

    for(const remoteConv of remote){
      const messages=(remoteConv.messages||[]).slice().sort((a,b)=>new Date(a.created_time||0)-new Date(b.created_time||0));
      const party=otherParty(messages,account.platform_account_id);
      if(!party?.id){skipped++;continue}

      const contact=await upsertContact(account,party,workspaceId);
      if(!contact){skipped++;continue}

      const conversation=await upsertConversation(account,contact,remoteConv,messages,workspaceId);
      if(!conversation){skipped++;continue}
      conversations++;

      for(const m of messages){
        if(!m.id||known.has(String(m.id))) continue;
        const from=idOf(m.from);
        const direction=from===String(account.platform_account_id)?'outbound':'inbound';
        inserts.push({
          conversation_id:conversation.id,
          account_id:account.id,
          contact_id:contact.id,
          platform_message_id:String(m.id),
          direction,
          sender_role:direction==='inbound'?'lead':'account',
          message_type:'text',
          body:m.message||null,
          delivery_status:direction==='inbound'?'received':'sent',
          sent_at:m.created_time||new Date().toISOString(),
          raw_json:m,
          ...(workspaceId?{workspace_id:workspaceId}:{})
        });
        known.add(String(m.id));
      }
    }

    if(inserts.length){
      for(let i=0;i<inserts.length;i+=200){
        const batch=inserts.slice(i,i+200);
        await supabaseRequest('social_messages',{
          method:'POST',
          headers:{Prefer:'return=minimal'},
          body:batch
        });
        inserted+=batch.length;
      }
    }

    await supabaseRequest(scopedPath('content_accounts?id=eq.'+encodeURIComponent(account.id),workspaceId),{
      method:'PATCH',
      body:{last_inbox_sync_at:new Date().toISOString(),updated_at:new Date().toISOString()}
    }).catch(()=>{});

    return jsonResponse({
      ok:true,
      account_id:account.id,
      remote_conversations:remote.length,
      conversations,
      messages_inserted:inserted,
      skipped
    });
  }catch(error){
    return publicError(error,error.status||500);
  }
};
