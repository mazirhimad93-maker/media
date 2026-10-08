import { scopedPath, supabaseRequest } from './_shared.mjs';
import { refreshYouTube } from './metrics-core.mjs';

export const channelFields = 'id,platform,platform_account_id,username,display_name,scope,access_token,refresh_token,token_expires_at,settings_json,metadata,is_active';
export async function ownedChannel(id, workspaceId, db = supabaseRequest) {
  if (!workspaceId || !id) throw Object.assign(new Error('Choose a channel.'), {status:400});
  const account = (await db(scopedPath('content_accounts?id=eq.'+encodeURIComponent(id)+'&select='+channelFields+'&limit=1', workspaceId)))?.[0];
  if (!account || account.metadata?.disconnected_at || !['instagram_reels','youtube_shorts'].includes(account.platform))
    throw Object.assign(new Error('Connected channel not found in this workspace.'), {status:404});
  return account;
}
export const safeChannel = a => ({id:a.id, platform:a.platform, username:a.username || a.display_name,
  comments_write: a.platform === 'youtube_shorts' ? /youtube\.force-ssl/.test(a.scope || '') : /instagram_business_manage_comments|instagram_manage_comments/.test(a.scope || '')});
export async function providerJson(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, {...options, signal:AbortSignal.timeout(12000)});
  const data = await response.json().catch(()=>({}));
  if (!response.ok || data.error) {
    const message = data.error?.message || 'Channel request failed ('+response.status+').';
    const error = Object.assign(new Error(message), {status:response.status===401 || response.status===403 ? 409 : 502,
      providerStatus:response.status, rejected:response.status>=400 && response.status<500,
      reconnect:response.status===401 || response.status===403});
    throw error;
  }
  return data;
}
export function instagramUrl(account, path, params = {}) {
  const facebook = account.metadata?.oauth_provider === 'facebook' || /(^|\s|,)instagram_basic($|\s|,)/.test(account.scope || '');
  const host = facebook ? 'graph.facebook.com' : 'graph.instagram.com';
  const version = (facebook ? process.env.FACEBOOK_API_VERSION : process.env.INSTAGRAM_API_VERSION)?.trim() || 'v26.0';
  const url = new URL('https://'+host+'/'+version+'/'+encodeURIComponent(path));
  // A path may contain one explicit edge, but never a caller-supplied host.
  url.pathname = '/'+version+'/'+path.split('/').map(encodeURIComponent).join('/');
  url.search = new URLSearchParams({...params, access_token:account.access_token});
  return url;
}
const n = v => v == null ? null : Math.max(0, Number(v) || 0);
export async function channelActivity(account, {cursor='', limit=30, fetcher=fetch, tokenFor=refreshYouTube} = {}) {
  limit = Math.min(50, Math.max(1, parseInt(limit,10) || 30));
  if (account.platform === 'instagram_reels') {
    const data = await providerJson(instagramUrl(account, account.platform_account_id+'/media', {
      fields:'id,caption,permalink,thumbnail_url,media_url,media_type,media_product_type,timestamp,like_count,comments_count', limit:String(limit), ...(cursor?{after:cursor}:{})
    }), {}, fetcher);
    return {posts:(data.data || []).map(p=>({id:p.id, title:p.caption || 'Instagram post', url:p.permalink,
      thumbnail:p.thumbnail_url || (p.media_type==='IMAGE'?p.media_url:null), published_at:p.timestamp,
      views:null, likes:n(p.like_count), comments:n(p.comments_count), platform:account.platform, account_id:account.id})),
      next_cursor:data.paging?.next ? data.paging?.cursors?.after || null : null};
  }
  const token = await tokenFor(account);
  const headers = {authorization:'Bearer '+token};
  const channel = await providerJson('https://www.googleapis.com/youtube/v3/channels?'+new URLSearchParams({part:'contentDetails', id:account.platform_account_id}), {headers}, fetcher);
  const playlist = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) throw new Error('YouTube uploads playlist is unavailable.');
  const data = await providerJson('https://www.googleapis.com/youtube/v3/playlistItems?'+new URLSearchParams({part:'snippet,contentDetails', playlistId:playlist, maxResults:String(limit), ...(cursor?{pageToken:cursor}:{})}), {headers}, fetcher);
  const ids = (data.items || []).map(p=>p.contentDetails?.videoId).filter(Boolean);
  const stats = ids.length ? await providerJson('https://www.googleapis.com/youtube/v3/videos?'+new URLSearchParams({part:'statistics,snippet', id:ids.join(',')}), {headers}, fetcher) : {items:[]};
  return {posts:(stats.items || []).map(p=>({id:p.id, title:p.snippet?.title || 'YouTube video', url:'https://www.youtube.com/watch?v='+p.id,
    thumbnail:p.snippet?.thumbnails?.medium?.url, published_at:p.snippet?.publishedAt,
    views:n(p.statistics?.viewCount), likes:n(p.statistics?.likeCount), comments:n(p.statistics?.commentCount), platform:account.platform, account_id:account.id})), next_cursor:data.nextPageToken || null};
}
export async function instagramPostViews(account, posts, fetcher=fetch) {
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,posts.length)}, async()=>{
    while(cursor<posts.length) {
      const post=posts[cursor++];
      try {
        const data=await providerJson(instagramUrl(account,post.id+'/insights',{metric:'views'}),{},fetcher);
        const metric=data.data?.find(x=>x.name==='views');
        if(metric) post.views=n(metric.total_value?.value ?? metric.values?.[0]?.value);
      } catch(error) { post.metrics_error=error.reconnect?'Reconnect this channel for Insights.':error.message; }
    }
  }));
  return posts;
}
