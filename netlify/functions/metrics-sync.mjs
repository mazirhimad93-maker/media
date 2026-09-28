import { jsonResponse, publicError, requireUser, supabaseRequest } from './_shared.mjs';

async function refreshYouTube(account){
  if(account.token_expires_at && new Date(account.token_expires_at).getTime()>Date.now()+60_000 && account.access_token) return account.access_token;
  if(!account.refresh_token) throw new Error('YouTube refresh token missing');

  const clientId=process.env.GOOGLE_CLIENT_ID?.trim() || account.settings_json?.google_client_id;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET?.trim() || account.settings_json?.google_client_secret;
  if(!clientId||!clientSecret) throw new Error('YouTube OAuth client credentials missing');

  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:clientId,
      client_secret:clientSecret,
      refresh_token:account.refresh_token,
      grant_type:'refresh_token'
    })
  });
  const data=await response.json();
  if(!response.ok||!data.access_token) throw new Error(data.error_description||data.error||'YouTube refresh failed');

  const expiresAt=new Date(Date.now()+Number(data.expires_in||3600)*1000).toISOString();
  await supabaseRequest(`content_accounts?id=eq.${encodeURIComponent(account.id)}`,{
    method:'PATCH',
    body:{access_token:data.access_token,token_expires_at:expiresAt,health_status:'healthy',updated_at:new Date().toISOString()}
  });
  return data.access_token;
}

async function youtubeMetrics(post,account){
  const token=await refreshYouTube(account);
  const url=new URL('https://www.googleapis.com/youtube/v3/videos');
  url.search=new URLSearchParams({part:'statistics',id:post.external_post_id});
  const response=await fetch(url,{headers:{authorization:`Bearer ${token}`}});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error?.message||'YouTube metrics failed');
  const s=data.items?.[0]?.statistics||{};
  return {views:Number(s.viewCount||0),likes:Number(s.likeCount||0),comments:Number(s.commentCount||0),shares:0,saves:0,raw_json:data};
}

async function instagramMetrics(post,account){
  if(!account.access_token) throw new Error('Instagram access token missing');
  const version=process.env.INSTAGRAM_API_VERSION?.trim()||'v26.0';
  const base=`https://graph.instagram.com/${version}/${encodeURIComponent(post.external_post_id)}`;
  const basicUrl=new URL(base);
  basicUrl.search=new URLSearchParams({fields:'like_count,comments_count,media_type,media_product_type',access_token:account.access_token});
  const br=await fetch(basicUrl);
  const basic=await br.json();
  if(!br.ok) throw new Error(basic.error?.message||'Instagram media lookup failed');

  const out={views:0,likes:Number(basic.like_count||0),comments:Number(basic.comments_count||0),shares:0,saves:0,raw_json:{basic,insights:{}}};
  for(const metric of ['views','saved','shares']){
    try{
      const u=new URL(`${base}/insights`);
      u.search=new URLSearchParams({metric,access_token:account.access_token});
      const r=await fetch(u);
      const d=await r.json();
      if(r.ok){
        const value=d.data?.[0]?.values?.[0]?.value ?? d.data?.[0]?.total_value?.value ?? 0;
        out.raw_json.insights[metric]=d;
        if(metric==='views') out.views=Number(value||0);
        if(metric==='saved') out.saves=Number(value||0);
        if(metric==='shares') out.shares=Number(value||0);
      }
    }catch{}
  }
  return out;
}

export default async request=>{
  try{
    await requireUser(request);
    if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json().catch(()=>({}));
    const limit=Math.min(100,Math.max(1,Number(input.limit||50)));

    const posts=await supabaseRequest(
      `content_publish_queue?external_post_id=not.is.null&select=id,asset_id,platform,external_post_id,external_post_url,selected_account_id,account_id,status,finished_at&order=finished_at.desc.nullslast&limit=${limit}`
    );

    const results=[];
    for(const post of posts||[]){
      const historyRows=await supabaseRequest(
        `content_history?queue_id=eq.${encodeURIComponent(post.id)}&event_type=eq.published&select=id,queue_id,account_id,platform,created_at&order=created_at.desc&limit=1`
      ).catch(()=>[]);
      const history=historyRows?.[0];
      if(!history){
        results.push({queue_id:post.id,status:'skipped',error:'published history row missing'});
        continue;
      }

      const accountId=history.account_id||post.selected_account_id||post.account_id;
      if(!accountId){
        results.push({queue_id:post.id,status:'skipped',error:'publishing account missing'});
        continue;
      }

      const accountRows=await supabaseRequest(
        `content_accounts?id=eq.${encodeURIComponent(accountId)}&select=id,platform,platform_account_id,access_token,refresh_token,token_expires_at,settings_json&limit=1`
      );
      const account=accountRows?.[0];
      if(!account) continue;

      try{
        let m;
        if(account.platform==='youtube_shorts') m=await youtubeMetrics(post,account);
        else if(account.platform==='instagram_reels') m=await instagramMetrics(post,account);
        else {
          results.push({history_id:history.id,platform:account.platform,status:'unsupported'});
          continue;
        }

        await supabaseRequest('post_metrics_snapshots',{
          method:'POST',
          body:{
            history_id:history.id,
            captured_at:new Date().toISOString(),
            views:m.views,
            likes:m.likes,
            comments:m.comments,
            shares:m.shares,
            saves:m.saves,
            raw_json:m.raw_json
          }
        });
        results.push({history_id:history.id,queue_id:post.id,platform:account.platform,status:'ok',views:m.views});
      }catch(error){
        results.push({history_id:history.id,queue_id:post.id,platform:account.platform,status:'failed',error:error.message});
      }
    }

    return jsonResponse({checked:posts?.length||0,results});
  }catch(error){
    return publicError(error,error.status||500);
  }
};
