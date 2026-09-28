import { scopedPath, supabaseRequest } from './_shared.mjs';

const nowIso=()=>new Date().toISOString();
const num=v=>Math.max(0,Number(v||0));
const ymd=value=>new Date(value).toISOString().slice(0,10);

async function refreshYouTube(account){
  if(account?.token_expires_at && new Date(account.token_expires_at).getTime()>Date.now()+60_000 && account.access_token) return account.access_token;
  if(!account?.refresh_token) throw new Error('YouTube refresh token missing');

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
  }).catch(()=>{});

  account.access_token=data.access_token;
  account.token_expires_at=expiresAt;
  return data.access_token;
}

async function youtubePublicCredential(accounts){
  const apiKey=process.env.YOUTUBE_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || '';
  if(apiKey) return {type:'key',value:apiKey};

  const candidates=(accounts||[]).filter(a=>a.platform==='youtube_shorts'&&(a.refresh_token||a.access_token));
  let lastError=null;

  for(const account of candidates){
    try{
      const token=await refreshYouTube(account);
      if(token) return {type:'oauth',value:token,account_id:account.id};
    }catch(error){
      lastError=error;
    }
  }

  throw new Error(
    'No usable YouTube read credential. Reconnect one YouTube channel or add YOUTUBE_API_KEY in Netlify'+
    (lastError?.message?': '+lastError.message:'')
  );
}

async function youtubeBatchStatistics(videoIds,credential){
  const url=new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part','statistics');
  url.searchParams.set('id',videoIds.join(','));

  const headers={};
  if(credential.type==='key') url.searchParams.set('key',credential.value);
  else headers.authorization='Bearer '+credential.value;

  const response=await fetch(url,{headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error?.message||'YouTube statistics failed');

  return new Map((data.items||[]).map(v=>[
    String(v.id),
    {
      views:num(v.statistics?.viewCount),
      likes:num(v.statistics?.likeCount),
      comments:num(v.statistics?.commentCount),
      shares:0,
      saves:0,
      raw_json:{item_id:v.id,statistics:v.statistics||{}}
    }
  ]));
}

async function youtubeDailyAnalytics(items,workspaceId){
  if(!items?.length) return {rows:[],status:'empty'};

  const account=items[0].account;
  const scope=String(account.scope||'');
  if(!scope.includes('yt-analytics.readonly')){
    return {rows:[],status:'needs_reconnect',account_id:account.id};
  }

  const token=await refreshYouTube(account);
  const dates=items.map(x=>new Date(x.post.finished_at||x.post.created_at||Date.now()).getTime()).filter(Number.isFinite);
  const startDate=ymd(new Date(Math.min(...dates,Date.now())));
  const endDate=ymd(new Date());

  const rows=[];
  for(let i=0;i<items.length;i+=100){
    const batch=items.slice(i,i+100);
    const byVideo=new Map(batch.map(x=>[String(x.post.external_post_id),x]));

    const url=new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    url.search=new URLSearchParams({
      ids:'channel==MINE',
      startDate,
      endDate,
      metrics:'views,estimatedMinutesWatched,averageViewDuration',
      dimensions:'day,video',
      filters:'video=='+batch.map(x=>x.post.external_post_id).join(','),
      sort:'day'
    });

    const response=await fetch(url,{headers:{authorization:'Bearer '+token}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const msg=data.error?.message||'YouTube Analytics daily metrics failed';
      if(/insufficient|scope|permission/i.test(msg)) return {rows:[],status:'needs_reconnect',account_id:account.id,error:msg};
      throw new Error(msg);
    }

    const names=(data.columnHeaders||[]).map(x=>x.name);
    const index=Object.fromEntries(names.map((name,idx)=>[name,idx]));

    for(const raw of data.rows||[]){
      const videoId=String(raw[index.video]||'');
      const item=byVideo.get(videoId);
      if(!item) continue;
      rows.push({
        workspace_id:workspaceId||null,
        history_id:item.h.id,
        metric_date:String(raw[index.day]),
        source:'youtube_analytics',
        platform:'youtube_shorts',
        views:num(raw[index.views]),
        likes:0,
        comments:0,
        shares:0,
        saves:0,
        watch_time_minutes:num(raw[index.estimatedMinutesWatched]),
        average_view_duration_seconds:num(raw[index.averageViewDuration]),
        raw_json:{headers:data.columnHeaders||[],row:raw},
        updated_at:nowIso()
      });
    }
  }

  return {rows,status:'ok',account_id:account.id};
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
      'content_accounts?select=id,platform,platform_account_id,access_token,refresh_token,token_expires_at,scope,settings_json&limit=3000',
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
  const due=[];

  for(const post of posts||[]){
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

    if(due.length>=maxUpdates){
      results.push({queue_id:post.id,history_id:h.id,platform:account.platform,status:'deferred',reason:'update budget reached'});
      continue;
    }

    due.push({post,h,account});
  }

  const snapshotRows=[];
  const success=(item,m)=>{
    const capturedAt=nowIso();
    snapshotRows.push({
      history_id:item.h.id,
      captured_at:capturedAt,
      views:num(m.views),
      likes:num(m.likes),
      comments:num(m.comments),
      shares:num(m.shares),
      saves:num(m.saves),
      raw_json:m.raw_json||{},
      ...(workspaceId?{workspace_id:workspaceId}:{})
    });
    results.push({
      history_id:item.h.id,
      queue_id:item.post.id,
      platform:item.account.platform,
      status:'ok',
      views:num(m.views),
      likes:num(m.likes),
      comments:num(m.comments),
      shares:num(m.shares),
      saves:num(m.saves),
      captured_at:capturedAt
    });
  };

  const youtube=due.filter(x=>x.account.platform==='youtube_shorts');
  const other=due.filter(x=>x.account.platform!=='youtube_shorts');

  if(youtube.length){
    try{
      const credential=await youtubePublicCredential(accounts);
      for(let i=0;i<youtube.length;i+=50){
        const batch=youtube.slice(i,i+50);
        const stats=await youtubeBatchStatistics(batch.map(x=>x.post.external_post_id),credential);
        for(const item of batch){
          const m=stats.get(String(item.post.external_post_id));
          if(!m){
            results.push({
              history_id:item.h.id,
              queue_id:item.post.id,
              platform:item.account.platform,
              status:'failed',
              error:'YouTube did not return statistics for this video'
            });
            continue;
          }
          success(item,m);
        }
      }
    }catch(error){
      for(const item of youtube){
        results.push({
          history_id:item.h.id,
          queue_id:item.post.id,
          platform:item.account.platform,
          status:'failed',
          error:error.message
        });
      }
    }
  }

  let cursor=0;
  const workers=Array.from({length:Math.min(5,other.length)},async()=>{
    while(cursor<other.length){
      const item=other[cursor++];
      try{
        const m=await metricsFor(item.post,item.account);
        success(item,m);
      }catch(error){
        results.push({
          history_id:item.h.id,
          queue_id:item.post.id,
          platform:item.account.platform,
          status:error.unsupported?'unsupported':'failed',
          error:error.message
        });
      }
    }
  });
  await Promise.all(workers);

  if(snapshotRows.length){
    await supabaseRequest('post_metrics_snapshots',{method:'POST',body:snapshotRows});
  }

  const analyticsAccounts=[];
  const ytByAccount=new Map();
  for(const item of youtube){
    const list=ytByAccount.get(item.account.id)||[];
    list.push(item);
    ytByAccount.set(item.account.id,list);
  }

  let dailyRows=0;
  for(const group of ytByAccount.values()){
    try{
      const daily=await youtubeDailyAnalytics(group,workspaceId);
      if(daily.status==='needs_reconnect'){
        analyticsAccounts.push({account_id:daily.account_id,status:'needs_reconnect',error:daily.error||null});
        continue;
      }
      if(daily.rows.length){
        await supabaseRequest('post_daily_metrics?on_conflict=history_id,metric_date,source',{
          method:'POST',
          headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
          body:daily.rows
        }).catch(error=>{
          if(!/post_daily_metrics/i.test(String(error?.message||''))) throw error;
        });
        dailyRows+=daily.rows.length;
      }
    }catch(error){
      analyticsAccounts.push({account_id:group[0]?.account?.id,status:'failed',error:error.message});
    }
  }

  const errorCounts={};
  for(const x of results){
    if(x.status!=='failed') continue;
    const key=x.error||'Unknown metrics error';
    errorCounts[key]=(errorCounts[key]||0)+1;
  }

  return {
    checked:(posts||[]).length,
    due:due.length,
    updated:snapshotRows.length,
    daily_rows:dailyRows,
    skipped:results.filter(x=>['fresh','skipped','deferred'].includes(x.status)).length,
    failed:results.filter(x=>x.status==='failed').length,
    unsupported:results.filter(x=>x.status==='unsupported').length,
    analytics_accounts:analyticsAccounts,
    errors:Object.entries(errorCounts).map(([error,count])=>({error,count})).sort((a,b)=>b.count-a.count),
    results,
    refreshed_at:nowIso()
  };
}
