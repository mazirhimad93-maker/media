import { callbacks, jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const versionInstagram=()=>process.env.INSTAGRAM_API_VERSION?.trim()||'v26.0';
const versionFacebook=()=>process.env.FACEBOOK_API_VERSION?.trim()||'v26.0';

async function validateInstagram(account){
  const url=new URL('https://graph.instagram.com/'+versionInstagram()+'/me');
  url.search=new URLSearchParams({
    fields:'user_id,username',
    access_token:account.access_token
  });
  const response=await fetch(url);
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error?.message||'Instagram access token is no longer valid');
  return data;
}

async function subscribeInstagram(account){
  const endpoint=new URL(
    'https://graph.instagram.com/'+versionInstagram()+'/'+encodeURIComponent(account.platform_account_id)+'/subscribed_apps'
  );
  endpoint.search=new URLSearchParams({
    subscribed_fields:'messages,messaging_postbacks,comments',
    access_token:account.access_token
  });
  const response=await fetch(endpoint,{method:'POST'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.success===false) throw new Error(data.error?.message||data.message||'Instagram webhook subscription failed');
  return data;
}

async function validateFacebook(account){
  const url=new URL('https://graph.facebook.com/'+versionFacebook()+'/me');
  url.search=new URLSearchParams({fields:'id,name',access_token:account.access_token});
  const response=await fetch(url);
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error?.message||'Facebook Page access token is no longer valid');
  return data;
}

async function subscribeFacebook(account){
  const endpoint=new URL(
    'https://graph.facebook.com/'+versionFacebook()+'/'+encodeURIComponent(account.platform_account_id)+'/subscribed_apps'
  );
  endpoint.search=new URLSearchParams({
    subscribed_fields:'messages,messaging_postbacks',
    access_token:account.access_token
  });
  const response=await fetch(endpoint,{method:'POST'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.success===false) throw new Error(data.error?.message||data.message||'Facebook Page webhook subscription failed');
  return data;
}

function permissionState(account){
  const scope=String(account.scope||'');
  const caps=account.capabilities_json||{};

  if(account.platform==='instagram_reels'){
    const messaging=scope.includes('instagram_business_manage_messages')||caps.messages_read===true||caps.messages_send===true;
    const insights=scope.includes('instagram_business_manage_insights')||caps.analytics===true;
    return {messaging,insights};
  }

  if(account.platform==='facebook_page'||account.platform==='facebook'){
    const messaging=scope.includes('pages_messaging')||caps.messages_read===true||caps.messages_send===true;
    return {messaging,insights:true};
  }

  return {messaging:false,insights:account.platform==='youtube_shorts'};
}

export default async request=>{
  try{
    const {workspaceId}=await requireWorkspace(request);

    if(request.method==='GET'){
      const accounts=await supabaseRequest(scopedPath(
        'content_accounts?select=id,platform,platform_account_id,username,display_name,scope,capabilities_json,webhook_status,token_expires_at,last_inbox_sync_at&order=created_at.desc',
        workspaceId
      )).catch(()=>[]);

      return jsonResponse({
        webhook:{
          callback_url:callbacks(request).metaWebhook,
          verify_token_configured:Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()),
          app_secret_configured:Boolean(
            process.env.INSTAGRAM_APP_SECRET?.trim() ||
            process.env.FACEBOOK_APP_SECRET?.trim() ||
            process.env.META_APP_SECRET?.trim()
          )
        },
        accounts:(accounts||[]).map(account=>{
          const p=permissionState(account);
          return {
            id:account.id,
            platform:account.platform,
            username:account.username||account.display_name||account.platform_account_id,
            messaging_permission:p.messaging,
            insights_permission:p.insights,
            webhook_status:account.webhook_status||'not_configured',
            token_expires_at:account.token_expires_at||null,
            last_inbox_sync_at:account.last_inbox_sync_at||null,
            inbox_state:!['instagram_reels','facebook_page','facebook'].includes(account.platform)
              ? 'not_applicable'
              : !p.messaging
                ? 'reconnect_required'
                : account.webhook_status==='subscribed'
                  ? 'ready'
                  : 'activate'
          };
        })
      });
    }

    if(request.method!=='POST') throw Object.assign(new Error('GET or POST required'),{status:405});

    const input=await request.json().catch(()=>({}));
    const accountId=input.accountId;
    if(!accountId) throw Object.assign(new Error('accountId required'),{status:400});

    const rows=await supabaseRequest(scopedPath(
      'content_accounts?id=eq.'+encodeURIComponent(accountId)+
      '&select=id,platform,platform_account_id,username,display_name,access_token,scope,capabilities_json,webhook_status&limit=1',
      workspaceId
    ));
    const account=rows?.[0];
    if(!account) throw Object.assign(new Error('Channel not found'),{status:404});
    if(!['instagram_reels','facebook_page','facebook'].includes(account.platform)){
      throw Object.assign(new Error('This channel does not use the Meta inbox connector'),{status:400});
    }

    const p=permissionState(account);
    if(!p.messaging){
      return jsonResponse({
        ok:false,
        state:'reconnect_required',
        error:account.platform==='instagram_reels'
          ? 'This Instagram token does not include instagram_business_manage_messages.'
          : 'This Facebook Page token does not include pages_messaging.'
      },409);
    }
    if(!account.access_token){
      return jsonResponse({ok:false,state:'reconnect_required',error:'The stored access token is missing.'},409);
    }

    let profile,subscription;
    if(account.platform==='instagram_reels'){
      profile=await validateInstagram(account);
      subscription=await subscribeInstagram(account);
    }else{
      profile=await validateFacebook(account);
      subscription=await subscribeFacebook(account);
    }

    const caps={
      ...(account.capabilities_json||{}),
      messages_read:true,
      messages_send:true,
      webhooks:true
    };
    await supabaseRequest(
      scopedPath('content_accounts?id=eq.'+encodeURIComponent(account.id),workspaceId),
      {
        method:'PATCH',
        body:{
          capabilities_json:caps,
          webhook_status:'subscribed',
          last_inbox_sync_at:new Date().toISOString(),
          error_message:null,
          updated_at:new Date().toISOString()
        }
      }
    );

    return jsonResponse({
      ok:true,
      state:'ready',
      account:{id:account.id,platform:account.platform,username:account.username||account.display_name},
      profile,
      subscription
    });
  }catch(error){
    return publicError(error,error.status||500);
  }
};
