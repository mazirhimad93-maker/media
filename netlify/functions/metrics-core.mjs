import { scopedPath, supabaseRequest } from './_shared.mjs';

const nowIso=()=>new Date().toISOString();
const num=v=>Math.max(0,Number(v||0));

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
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token) throw new Error(data.error_description||data.error||'YouTube refresh failed');

  const expiresAt=new Date(Date.now()+Number(data.expires_in||3600)*1000).toISOString();
  await supabaseRequest('content_accounts?id=eq.'+encodeURIComponent(account.id),{
    method:'PATCH',
    body:{access_token:data.access_token,token_expires_at:expiresAt,health_status:'healthy',updated_at:nowIso()}
  });
  return data.access_token;
}

async function youtubeMetrics(post,account){
  const token=await refreshYouTube(account);
  const url=new URL('https://www.googleapis.com/youtube/v3/videos');
  url.search=new URLSearchParams({part:'statistics',id:post.external_post_id});
  const response=await fetch(url,{headers:{authorization:'Bearer '+token}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error?.message||'YouTube metrics failed');
  const s=data.items?.[0]?.statistics||{};
  return {
    views:num(s.viewCount),
    likes:num(s.likeCount),
    comments:num(s.commentCount),
    shares:0,
    saves:0,
    raw_json:data
  };
}

async function instagramMetrics(post,account){
  if(!account.access_token) throw new Error('Instagram access token missing');
  const version=process.env.INSTAGRAM_API_VERSION?.trim()||'v26.0';
  const base='https://graph.instagram.com/'+version+'/'+encodeURIComponent(post.external_post_id);

  const basicUrl=new URL(base);
  basicUrl.search=new URLSearchParams({
    fields:'like_count,comments_count,media_type,media_product_type',
    access_token:account.access_token
  });

  const basicResponse=await fetch(basicUrl);
  const basic=await basicResponse.json().catch(()=>({}));
  if(!basicResponse.ok) throw new Error(basic.error?.message||'Instagram media lookup failed');

  const out={
    views:0,
    likes:num(basic.like_count),
    comments:num(basic.comments_count),
    shares:0,
    saves:0,
    raw_json:{basic,insights:{}}
  };

  // Meta can expose different Reel metrics depending on account type/API version.
  // Try the common metrics independently so one unavailable metric never blocks the rest.
  for(const metric of ['views','plays','saved','shares']){
    try{
      const u=new URL(base+'/insights');
      u.search=new URLSearchParams({metric,access_token:account.access_token});
      const response=await fetch(u);
      const data=await response.json().catch(()=>({}));
      if(!response.ok) continue;
      const value=data.data?.[0]?.values?.[0]?.value ?? data.data?.[0]?.total_value?.value ?? 0;
      out.raw_json.insights[metric]=data;
      if((metric==='views'||metric==='plays') && !out.views) out.views=num(value);
      if(metric==='saved') out.saves=num(value);
      if(metric==='shares') out.shares=num(value);
    }catch{}
  }

  return out;
}

async function facebookMetrics(post,account){
  if(!account.access_token) throw new Error('Facebook Page access token missing');
  const version=process.env.FACEBOOK_API_VERSION?.trim()||'v26.0';
  const base='https://graph.facebook.com/'+version+'/'+encodeURIComponent(post.external_post_id);

  const u=new URL(base);
  u.search=new URLSearchParams({
    fields:'shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)',
    access_token:account.access_token
  });
  const response=await fetch(u);
  const basic=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(basic.error?.message||'Facebook post metrics failed');

  const out={
    views:0,
    likes:num(basic.reactions?.summary?.total_count),
    comments:num(basic.comments?.summary?.total_count),
    shares:num(basic.shares?.count),
    saves:0,
    raw_json:{basic,insights:{}}
  };

  for(const metric of ['post_video_views','post_impressions']){
    try{
      const insights=new URL(base+'/insights');
      insights.search=new URLSearchParams({metric,access_token:account.access_token});
      const ir=await fetch(insights);
      const data=await ir.json().catch(()=>({}));
      if(!ir.ok) continue;
      const value=data.data?.[0]?.values?.[0]?.value ?? data.data?.[0]?.total_value?.value ?? 0;
      out.raw_json.insights[metric]=data;
      if(metric==='post_video_views' && !out.views) out.views=num(value);
    }catch{}
  }
  return out;
}

function refreshAfterMinutes(post){
  const publishedAt=new Date(post.finished_at||post.created_at||Date.now()).getTime();
  const ageHours=Math.max(0,(Date.now()-publishedAt)/3600000);
  if(ageHours<48) return 15;
  if(ageHours<24*7) return 60;
  if(ageHours<24*30) return 360;
  return 1440;
}

async function metricsFor(post,account){
  if(account.platform==='youtube_shorts') return youtubeMetrics(post,account);
  if(account.platform==='instagram_reels') return instagramMetrics(post,account);
  if(account.platform==='facebook_page'||account.platform==='facebook') return facebookMetrics(post,account);
  throw Object.assign(new Error('Metrics not supported for '+account.platform),{unsupported:true});
}

export async function syncWorkspaceMetrics(workspaceId,{limit=300,force=false,maxUpdates=300}={}){
  limit=Math.min(500,Math.max(1,Number(limit||300)));
  maxUpdates=Math.min(500,Math.max(1,Number(maxUpdates||limit)));

  const [posts,history,accounts,snapshots]=await Promise.all([
    supabaseRequest(scopedPath(
      'content_publish_queue?external_post_id=not.is.null&select=id,asset_id,platform,external_post_id,external_post_url,selected_account_id,account_id,status,finished_at,created_at&order=finished_at.desc.nullslast&limit='+limit,
      workspaceId
    )).catch(()=>[]),
    supabaseRequest(scopedPath(
      'content_history?event_type=eq.published&select=id,queue_id,account_id,platform,created_at&order=created_at.desc&limit=10000',
      workspaceId
    )).catch(()=>[]),
    supabaseRequest(scopedPath(
      'content_accounts?select=id,platform,platform_account_id,access_token,refresh_token,token_expires_at,settings_json&limit=3000',
      workspaceId
    )).catch(()=>[]),
    supabaseRequest(scopedPath(
      'post_metrics_snapshots?select=id,history_id,captured_at,views,likes,comments,shares,saves&order=captured_at.desc&limit=20000',
      workspaceId
    )).catch(()=>[])
  ]);

  const historyByQueue=new Map();
  for(const h of history||[]) if(h.queue_id&&!historyByQueue.has(h.queue_id)) historyByQueue.set(h.queue_id,h);
  const accountById=new Map((accounts||[]).map(a=>[a.id,a]));
  const latestByHistory=new Map();
  for(const s of snapshots||[]) if(s.history_id&&!latestByHistory.has(s.history_id)) latestByHistory.set(s.history_id,s);

  const results=[];
  let updated=0;

  for(const post of posts||[]){
    if(updated>=maxUpdates){
      results.push({queue_id:post.id,status:'deferred',reason:'update budget reached'});
      continue;
    }

    const h=historyByQueue.get(post.id);
    if(!h){
      results.push({queue_id:post.id,status:'skipped',error:'published history row missing'});
      continue;
    }

    const accountId=h.account_id||post.selected_account_id||post.account_id;
    const account=accountById.get(accountId);
    if(!account){
      results.push({queue_id:post.id,history_id:h.id,status:'skipped',error:'publishing account missing'});
      continue;
    }

    const latest=latestByHistory.get(h.id);
    if(!force&&latest?.captured_at){
      const minutesOld=(Date.now()-new Date(latest.captured_at).getTime())/60000;
      if(minutesOld<refreshAfterMinutes(post)){
        results.push({queue_id:post.id,history_id:h.id,platform:account.platform,status:'fresh',captured_at:latest.captured_at});
        continue;
      }
    }

    try{
      const m=await metricsFor(post,account);
      const capturedAt=nowIso();
      await supabaseRequest('post_metrics_snapshots',{
        method:'POST',
        body:{
          history_id:h.id,
          captured_at:capturedAt,
          views:m.views,
          likes:m.likes,
          comments:m.comments,
          shares:m.shares,
          saves:m.saves,
          raw_json:m.raw_json,
          ...(workspaceId?{workspace_id:workspaceId}:{})
        }
      });
      latestByHistory.set(h.id,{history_id:h.id,captured_at:capturedAt,...m});
      updated++;
      results.push({
        history_id:h.id,
        queue_id:post.id,
        platform:account.platform,
        status:'ok',
        views:m.views,
        likes:m.likes,
        comments:m.comments,
        shares:m.shares,
        saves:m.saves,
        captured_at:capturedAt
      });
    }catch(error){
      results.push({
        history_id:h.id,
        queue_id:post.id,
        platform:account.platform,
        status:error.unsupported?'unsupported':'failed',
        error:error.message
      });
    }
  }

  return {
    checked:(posts||[]).length,
    updated,
    skipped:results.filter(x=>['fresh','skipped','deferred'].includes(x.status)).length,
    failed:results.filter(x=>x.status==='failed').length,
    unsupported:results.filter(x=>x.status==='unsupported').length,
    results,
    refreshed_at:nowIso()
  };
}
