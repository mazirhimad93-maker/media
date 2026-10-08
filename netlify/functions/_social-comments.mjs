import crypto from 'node:crypto';
import { channelActivity, instagramUrl, providerJson } from './_channel-live.mjs';
import { refreshYouTube } from './metrics-core.mjs';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = value => {
  try {const data=JSON.parse(Buffer.from(value,'base64url').toString()); if(typeof data==='object' && data) return data;} catch {}
  throw Object.assign(new Error('Invalid comments cursor.'),{status:400});
};
export const commentKey = (workspaceId,accountId,commentId) => workspaceId+'/'+accountId+'/'+crypto.createHash('sha256').update(String(commentId)).digest('hex');
export async function fetchComments(account,{cursor='',fetcher=fetch,tokenFor=refreshYouTube}={}) {
  const comments=[];
  if(account.platform==='youtube_shorts') {
    const token=await tokenFor(account);
    const data=await providerJson('https://www.googleapis.com/youtube/v3/commentThreads?'+new URLSearchParams({
      part:'snippet,replies',allThreadsRelatedToChannelId:account.platform_account_id,maxResults:'100',order:'time',textFormat:'plainText',...(cursor?{pageToken:cursor}:{})
    }),{headers:{authorization:'Bearer '+token}},fetcher);
    for(const thread of data.items || []) {
      const c=thread.snippet?.topLevelComment, s=c?.snippet;
      if(!s || s.authorChannelId?.value===account.platform_account_id) continue;
      comments.push({id:c.id,root_id:c.id,media_id:s.videoId,author:s.authorDisplayName || 'YouTube viewer',
        text:s.textOriginal || s.textDisplay || '',at:s.publishedAt,url:'https://www.youtube.com/watch?v='+s.videoId+'&lc='+c.id,
        own_reply:(thread.replies?.comments || []).some(r=>r.snippet?.authorChannelId?.value===account.platform_account_id),
        can_reply:thread.snippet?.canReply!==false,platform:account.platform,account_id:account.id});
    }
    return {comments,next_cursor:data.nextPageToken || null,coverage:'Up to 100 recent YouTube comment threads per page. Load older comments for more.'};
  }
  const position=cursor?decode(cursor):{};
  const activity=await channelActivity(account,{cursor:position.mediaCursor || '',fetcher});
  let mediaIndex=position.mediaId?activity.posts.findIndex(p=>String(p.id)===String(position.mediaId)):Number(position.mediaIndex || 0), after=String(position.after || '');
  if(!Number.isSafeInteger(mediaIndex) || mediaIndex<0 || mediaIndex>30) throw Object.assign(new Error('Invalid comments cursor.'),{status:400});
  let next=null;
  for(;mediaIndex<activity.posts.length;mediaIndex++) {
    const post=activity.posts[mediaIndex];
    if(!post.comments && !after) continue;
    const data=await providerJson(instagramUrl(account,post.id+'/comments',{
      fields:'id,text,username,timestamp,from,replies{id,text,username,from}',limit:String(Math.min(100,200-comments.length)),...(after?{after}:{})
    }),{},fetcher);
    for(const c of data.data || []) {
      if(c.from?.id===account.platform_account_id || String(c.username || '').replace(/^@/,'').toLowerCase()===String(account.username || '').replace(/^@/,'').toLowerCase()) continue;
      comments.push({id:c.id,root_id:c.id,media_id:post.id,author:c.username || c.from?.username || 'Instagram viewer',text:c.text || '',at:c.timestamp,
        url:post.url,own_reply:(c.replies?.data || []).some(r=>r.from?.id===account.platform_account_id || r.username===account.username),
        can_reply:true,platform:account.platform,account_id:account.id});
    }
    const more=data.paging?.next && data.paging?.cursors?.after;
    after='';
    if(more) {next=encode({mediaCursor:position.mediaCursor || '',mediaIndex,mediaId:post.id,after:more});break;}
    if(comments.length>=200) {next=encode({mediaCursor:position.mediaCursor || '',mediaIndex:mediaIndex+1,...(activity.posts[mediaIndex+1]?{mediaId:activity.posts[mediaIndex+1].id}:{})});break;}
  }
  if(!next && activity.next_cursor) next=encode({mediaCursor:activity.next_cursor,mediaIndex:0});
  return {comments,next_cursor:next,coverage:'Comments on this page of up to 30 Instagram posts. Load older comments to continue.'};
}

export async function sendCommentReply(account,comment,text,{fetcher=fetch,tokenFor=refreshYouTube}={}) {
  if(account.platform==='youtube_shorts') {
    if(!/youtube\.force-ssl/.test(account.scope || '')) throw Object.assign(new Error('Reconnect YouTube to allow comment replies.'),{status:409,rejected:true});
    const token=await tokenFor(account);
    // Validate the target's channel on the server before publishing.
    const owned=await providerJson('https://www.googleapis.com/youtube/v3/comments?'+new URLSearchParams({part:'snippet',id:comment.root_id || comment.id}),{headers:{authorization:'Bearer '+token}},fetcher);
    if(owned.items?.[0]?.snippet?.channelId!==account.platform_account_id) throw Object.assign(new Error('This comment does not belong to the connected channel.'),{status:404,rejected:true});
    const reply=await providerJson('https://www.googleapis.com/youtube/v3/comments?part=snippet',{
      method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
      body:JSON.stringify({snippet:{parentId:comment.root_id || comment.id,textOriginal:text}})
    },fetcher);
    if(!reply.id) throw new Error('YouTube did not confirm the reply. Check the video before retrying.');
    return reply.id;
  }
  const reply=await providerJson(instagramUrl(account,comment.id+'/replies'),{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({message:text})
  },fetcher);
  if(!reply.id) throw new Error('Instagram did not confirm the reply. Check the post before retrying.');
  return reply.id;
}

// A conditional durable claim stops concurrent sends and retries from publishing
// duplicates. Ambiguous provider outcomes require checking the native thread.
export async function replyOnce({store,key,account,comment,text,send=sendCommentReply}) {
  const previous=await store.getWithMetadata(key,{type:'json'});
  if(previous && previous.data.status!=='failed') return {...previous.data,duplicate:true};
  const claim={status:'sending',text,started_at:new Date().toISOString()};
  const lock=await store.setJSON(key,claim,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if(!lock.modified) return {status:'sending',duplicate:true};
  let result;
  try {result={...claim,status:'sent',reply_id:await send(account,comment,text),sent_at:new Date().toISOString()};}
  catch(error) {result={...claim,status:error.rejected?'failed':'unknown',error:error.message};}
  // If this persistence fails after a successful send, the durable claim remains
  // blocking. Never re-publish merely because the audit write did not complete.
  await store.setJSON(key,result,{onlyIfMatch:lock.etag});
  return result;
}
