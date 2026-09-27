import { jsonResponse, publicError, requireAdmin, supabaseRequest } from './_shared.mjs';

async function refreshYouTube(account){
  if(account.token_expires_at && new Date(account.token_expires_at).getTime()>Date.now()+60_000) return account.access_token;
  if(!account.refresh_token) throw new Error('YouTube refresh token missing');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID.trim(),client_secret:process.env.GOOGLE_CLIENT_SECRET.trim(),refresh_token:account.refresh_token,grant_type:'refresh_token'})});
  const data=await response.json(); if(!response.ok||!data.access_token) throw new Error(data.error_description||data.error||'YouTube refresh failed');
  const expiresAt=new Date(Date.now()+Number(data.expires_in||3600)*1000).toISOString();
  await supabaseRequest(`content_accounts?id=eq.${encodeURIComponent(account.id)}`,{method:'PATCH',body:{access_token:data.access_token,token_expires_at:expiresAt,health_status:'healthy',updated_at:new Date().toISOString()}});
  return data.access_token;
}

async function youtubeMetrics(history,account){
  const token=await refreshYouTube(account); const url=new URL('https://www.googleapis.com/youtube/v3/videos'); url.search=new URLSearchParams({part:'statistics',id:history.external_post_id});
  const response=await fetch(url,{headers:{authorization:`Bearer ${token}`}}); const data=await response.json(); if(!response.ok) throw new Error(data.error?.message||'YouTube metrics failed');
  const s=data.items?.[0]?.statistics||{}; return {views:Number(s.viewCount||0),likes:Number(s.likeCount||0),comments:Number(s.commentCount||0),shares:0,saves:0,raw_json:data};
}

async function instagramMetrics(history,account){
  const version=process.env.INSTAGRAM_API_VERSION?.trim()||'v26.0'; const base=`https://graph.instagram.com/${version}/${encodeURIComponent(history.external_post_id)}`;
  const basicUrl=new URL(base); basicUrl.search=new URLSearchParams({fields:'like_count,comments_count,media_type,media_product_type',access_token:account.access_token});
  const br=await fetch(basicUrl); const basic=await br.json(); if(!br.ok) throw new Error(basic.error?.message||'Instagram media lookup failed');
  const out={views:0,likes:Number(basic.like_count||0),comments:Number(basic.comments_count||0),shares:0,saves:0,raw_json:{basic,insights:{}}};
  for(const metric of ['views','saved','shares']){
    try{
      const u=new URL(`${base}/insights`); u.search=new URLSearchParams({metric,access_token:account.access_token}); const r=await fetch(u); const d=await r.json(); if(r.ok){ const value=d.data?.[0]?.values?.[0]?.value ?? d.data?.[0]?.total_value?.value ?? 0; out.raw_json.insights[metric]=d; if(metric==='views')out.views=Number(value||0); if(metric==='saved')out.saves=Number(value||0); if(metric==='shares')out.shares=Number(value||0); }
    }catch{}
  }
  return out;
}

export default async (request)=>{
  try{
    requireAdmin(request); if(request.method!=='POST') throw Object.assign(new Error('POST required'),{status:405});
    const input=await request.json().catch(()=>({})); const limit=Math.min(100,Math.max(1,Number(input.limit||50)));
    const history=await supabaseRequest(`content_history?external_post_id=not.is.null&select=id,account_id,platform,external_post_id,external_post_url&order=created_at.desc&limit=${limit}`);
    const accountIds=[...new Set((history||[]).map(h=>h.account_id).filter(Boolean))]; const accountMap=new Map();
    for(const id of accountIds){ const rows=await supabaseRequest(`content_accounts?id=eq.${encodeURIComponent(id)}&select=id,platform,platform_account_id,access_token,refresh_token,token_expires_at&limit=1`); if(rows?.[0])accountMap.set(id,rows[0]); }
    const results=[];
    for(const h of history||[]){
      const account=accountMap.get(h.account_id); if(!account)continue;
      try{
        let m; if(account.platform==='youtube_shorts')m=await youtubeMetrics(h,account); else if(account.platform==='instagram_reels')m=await instagramMetrics(h,account); else continue;
        await supabaseRequest('post_metrics_snapshots',{method:'POST',body:{history_id:h.id,captured_at:new Date().toISOString(),views:m.views,likes:m.likes,comments:m.comments,shares:m.shares,saves:m.saves,raw_json:m.raw_json}});
        results.push({history_id:h.id,platform:account.platform,status:'ok',views:m.views});
      }catch(error){ results.push({history_id:h.id,platform:account.platform,status:'failed',error:error.message}); }
    }
    return jsonResponse({checked:history?.length||0,results});
  }catch(error){ return publicError(error,error.status||500); }
};
