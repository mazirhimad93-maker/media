import {getStore} from '@netlify/blobs';
import {jsonResponse,publicError,requireWorkspace} from './_shared.mjs';
import {ownedChannel,safeChannel} from './_channel-live.mjs';
import {commentKey,fetchComments,replyOnce} from './_social-comments.mjs';

export default async request=>{
  try {
    const {workspaceId}=await requireWorkspace(request);
    const input=request.method==='GET'?Object.fromEntries(new URL(request.url).searchParams):await request.json();
    const account=await ownedChannel(String(input.accountId || ''),workspaceId);
    const store=getStore({name:'social-public-comments',consistency:'strong'});
    if(request.method==='GET') {
      const cursor=String(input.cursor || '');
      const cacheKey=workspaceId+'/'+account.id+'/pages/'+encodeURIComponent(cursor || 'latest');
      let page=await store.get(cacheKey,{type:'json'});
      if(!page || input.force==='true' || Date.now()-Date.parse(page.synced_at)>5*60000) {
        page={...await fetchComments(account,{cursor}),synced_at:new Date().toISOString()};
        // Store provider-verified targets. Browser-supplied comment IDs are never
        // sufficient authorization to publish from an account.
        await Promise.all(page.comments.map(c=>store.setJSON(commentKey(workspaceId,account.id,c.id)+'/target',c)));
        await store.setJSON(cacheKey,page);
      }
      const comments=await Promise.all(page.comments.map(async c=>{
        const key=commentKey(workspaceId,account.id,c.id);
        const [reply,seen]=await Promise.all([store.get(key+'/reply',{type:'json'}),store.get(key+'/seen',{type:'json'})]);
        return {...c,reply,unread:!seen,replied:c.own_reply || reply?.status==='sent'};
      }));
      return jsonResponse({...page,comments,account:safeChannel(account)});
    }
    if(!['POST','PATCH'].includes(request.method)) throw Object.assign(new Error('GET, POST or PATCH required'),{status:405});
    const ids=[...new Set(input.commentIds || [])];
    if(!ids.length || ids.length>20 || ids.some(id=>typeof id!=='string' || !id || id.length>256)) throw Object.assign(new Error('Select 1–20 comments from this channel.'),{status:400});
    if(request.method==='POST' && ids.length!==1) throw Object.assign(new Error('Send each selected reply as a separate request.'),{status:400});
    const text=String(input.text || '').trim();
    if(request.method==='POST' && (!text || text.length>2000)) throw Object.assign(new Error('Write a reply under 2,000 characters.'),{status:400});
    const targets=await Promise.all(ids.map(id=>store.get(commentKey(workspaceId,account.id,id)+'/target',{type:'json'})));
    if(targets.some((c,i)=>!c || c.id!==ids[i] || c.account_id!==account.id)) throw Object.assign(new Error('Refresh comments before replying.'),{status:404});
    const results=[];
    for(const comment of targets) {
      const key=commentKey(workspaceId,account.id,comment.id);
      if(request.method==='PATCH') {
        await store.setJSON(key+'/seen',{seen_at:new Date().toISOString()},{onlyIfNew:true});
        results.push({id:comment.id,status:'read'});
      } else if(!comment.can_reply || comment.own_reply) results.push({id:comment.id,status:'skipped',error:'Already replied or replies unavailable.'});
      else {
        const reply=await replyOnce({store,key:key+'/reply',account,comment,text});
        results.push({id:comment.id,...reply});
        if(reply.status==='sent') await store.setJSON(key+'/seen',{seen_at:new Date().toISOString()},{onlyIfNew:true});
      }
    }
    return jsonResponse({results,sent:results.filter(r=>r.status==='sent' && !r.duplicate).length});
  } catch(error) {return publicError(error,error.status || 500);}
};
