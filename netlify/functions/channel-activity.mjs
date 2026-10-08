import { getStore } from '@netlify/blobs';
import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';
import { channelActivity, channelFields, instagramPostViews, ownedChannel, safeChannel } from './_channel-live.mjs';

export default async request=>{
  try {
    const {workspaceId}=await requireWorkspace(request);
    if(request.method!=='GET') throw Object.assign(new Error('GET required'),{status:405});
    const url=new URL(request.url), id=url.searchParams.get('accountId');
    if(!id) {
      const accounts=await supabaseRequest(scopedPath('content_accounts?platform=in.(instagram_reels,youtube_shorts)&select='+channelFields+'&limit=2000',workspaceId));
      return jsonResponse({accounts:(accounts || []).filter(a=>!a.metadata?.disconnected_at).map(safeChannel)});
    }
    const account=await ownedChannel(id,workspaceId);
    const store=getStore({name:'channel-live-activity',consistency:'strong'});
    const cursor=url.searchParams.get('cursor') || '';
    const key=workspaceId+'/'+id+'/'+encodeURIComponent(cursor || 'latest');
    const cached=await store.get(key,{type:'json'});
    if(url.searchParams.get('force')!=='true' && cached && Date.now()-Date.parse(cached.synced_at)<5*60000) return jsonResponse({...cached,cached:true});
    const activity=await channelActivity(account,{cursor});
    if(account.platform==='instagram_reels') await instagramPostViews(account,activity.posts);
    const result={...activity,account:safeChannel(account),synced_at:new Date().toISOString(),coverage:'This page contains up to 30 recent channel posts. Counts are lifetime totals per post.'};
    await store.setJSON(key,result);
    return jsonResponse(result);
  } catch(error) {return publicError(error,error.status || 500);}
};
