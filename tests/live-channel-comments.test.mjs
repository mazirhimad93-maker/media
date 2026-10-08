import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedChannel, channelActivity, instagramPostViews} from '../netlify/functions/_channel-live.mjs';
import {fetchComments, sendCommentReply, replyOnce} from '../netlify/functions/_social-comments.mjs';
import {metricsAreDue, syncWorkspaceMetrics} from '../netlify/functions/metrics-core.mjs';
import {removeSavedFollowUps} from '../netlify/functions/social-follow-up.mjs';
const response=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const youtube={id:'a',platform:'youtube_shorts',platform_account_id:'owner-channel',scope:'https://www.googleapis.com/auth/youtube.force-ssl',username:'Channel'};
const instagram={id:'ig',platform:'instagram_reels',platform_account_id:'123',access_token:'test-token',scope:'instagram_business_manage_comments',username:'our-account'};
const tokenFor=async()=> 'test-only-token';

test('channel lookup fails closed and carries workspace scope',async()=>{
  let path;
  const db=async p=>{path=p;return [youtube];};
  assert.equal((await ownedChannel('a','workspace',db)).id,'a');
  assert.match(path,/workspace_id=eq.workspace/);
  await assert.rejects(ownedChannel('a',null,db),/Choose/);
  await assert.rejects(ownedChannel('other','workspace',async()=>[]),/not found/);
});
test('manual sync and a brand-new post are due immediately; automatic refresh respects one hour',()=>{
  const now=Date.now(),post=new Date(now).toISOString(),recent={captured_at:new Date(now-60000).toISOString()};
  assert.equal(metricsAreDue(post,null,false,now),true);
  assert.equal(metricsAreDue(post,recent,true,now),true);
  assert.equal(metricsAreDue(post,recent,false,now),false);
  assert.equal(metricsAreDue(post,{captured_at:new Date(now-3600000).toISOString()},false,now),true);
});
test('YouTube activity comes from the uploads playlist and preserves unavailable stats',async()=>{
  const calls=[];
  const fetcher=async url=>{
    calls.push(String(url));
    if(String(url).includes('/channels?'))return response({items:[{contentDetails:{relatedPlaylists:{uploads:'uploads-owner'}}}]});
    if(String(url).includes('/playlistItems?'))return response({items:[{contentDetails:{videoId:'video1'}}],nextPageToken:'older'});
    return response({items:[{id:'video1',snippet:{title:'Real post'},statistics:{viewCount:'1024',commentCount:'7'}}]});
  };
  const result=await channelActivity(youtube,{fetcher,tokenFor});
  assert.equal(result.posts[0].views,1024);assert.equal(result.posts[0].likes,null);assert.equal(result.next_cursor,'older');
  assert.match(calls[1],/playlistId=uploads-owner/);
});
test('Instagram Insights permission failure shows unavailable instead of zero',async()=>{
  const posts=[{id:'real',views:null}];
  await instagramPostViews(instagram,posts,async()=>new Response(JSON.stringify({error:{message:'Missing permission'}}),{status:403}));
  assert.equal(posts[0].views,null);assert.match(posts[0].metrics_error,/Reconnect/);
});
test('YouTube comments keep native pagination, flag replies and exclude the channel author',async()=>{
  const result=await fetchComments(youtube,{tokenFor,fetcher:async()=>response({nextPageToken:'page2',items:[
    {snippet:{topLevelComment:{id:'c1',snippet:{videoId:'v1',authorDisplayName:'Viewer',authorChannelId:{value:'viewer'},textOriginal:'TRAINING'}}},replies:{comments:[{snippet:{authorChannelId:{value:'owner-channel'}}}]}},
    {snippet:{topLevelComment:{id:'ours',snippet:{authorChannelId:{value:'owner-channel'}}}}}
  ]})});
  assert.equal(result.comments.length,1);assert.equal(result.comments[0].own_reply,true);assert.equal(result.next_cursor,'page2');
});
test('Instagram pagination continues the current media comment page before older media',async()=>{
  const calls=[];
  const fetcher=async url=>{
    calls.push(String(url));
    if(String(url).includes('/media?'))return response({data:[{id:'m1',comments_count:200,permalink:'https://www.instagram.com/reel/test/'}]});
    return response({data:[{id:'comment1',username:'viewer',text:'training'}],paging:{next:'unused-provider-url',cursors:{after:'more-comments'}}});
  };
  const first=await fetchComments(instagram,{fetcher});
  assert.ok(first.next_cursor);assert.equal(first.comments[0].media_id,'m1');
  await fetchComments(instagram,{cursor:first.next_cursor,fetcher});
  assert.match(calls[3],/after=more-comments/);
});
test('reply targets a thread on the connected YouTube channel and uses the correct reply API',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push({url:String(url),options});return response(options.method==='POST'?{id:'reply1'}:{items:[{snippet:{channelId:'owner-channel'}}]});};
  assert.equal(await sendCommentReply(youtube,{id:'c1'},'Here you go',{fetcher,tokenFor}),'reply1');
  assert.deepEqual(JSON.parse(calls[1].options.body),{snippet:{parentId:'c1',textOriginal:'Here you go'}});
  await assert.rejects(sendCommentReply(youtube,{id:'other'},'text',{tokenFor,fetcher:async()=>response({items:[{snippet:{channelId:'other-channel'}}]})}),/does not belong/);
  await assert.rejects(sendCommentReply({...youtube,scope:'youtube.readonly'},{id:'c1'},'text',{fetcher,tokenFor}),/Reconnect/);
});
function memoryStore(){
  const entries=new Map();let version=0;
  return {async getWithMetadata(k){return entries.get(k)||null;},async setJSON(k,data,options={}){
    const previous=entries.get(k);
    if(options.onlyIfNew&&previous || options.onlyIfMatch&&previous?.etag!==options.onlyIfMatch)return {modified:false};
    const etag=String(++version);entries.set(k,{data,etag});return {modified:true,etag};
  }};
}
test('concurrent reply requests and retries publish once',async()=>{
  const store=memoryStore();let sends=0;
  const options={store,key:'w/a/c',account:youtube,comment:{id:'c'},text:'text',send:async()=>{sends++;return 'reply';}};
  const outcomes=await Promise.all([replyOnce(options),replyOnce(options)]);
  assert.equal(sends,1);assert.ok(outcomes.some(o=>o.status==='sent'));
  assert.equal((await replyOnce(options)).duplicate,true);assert.equal(sends,1);
});
test('an ambiguous provider outcome blocks retry; a definite rejection can retry',async()=>{
  const store=memoryStore();let sends=0;
  const options={store,key:'w/a/c',account:youtube,comment:{id:'c'},text:'text',send:async()=>{sends++;throw new Error('Connection reset');}};
  assert.equal((await replyOnce(options)).status,'unknown');
  await replyOnce(options);assert.equal(sends,1);
  const rejected={...options,key:'w/a/d',send:async()=>{throw Object.assign(new Error('Permission denied'),{rejected:true});}};
  assert.equal((await replyOnce(rejected)).status,'failed');
  assert.equal((await replyOnce({...rejected,send:async()=> 'reply2'})).status,'sent');
});
test('retiring follow-ups removes only saved drafts and keeps CRM and policy metadata',async()=>{
  const calls=[];
  const db=async(path,options)=>{calls.push({path,options});return options?[{id:'c1'}]:[{id:'c1',metadata:{follow_up:{draft:'old'},source:'training',messaging_block:{at:'old'}}}];};
  assert.equal((await removeSavedFollowUps('workspace',db)).removed,1);
  assert.ok(calls.every(c=>c.path.includes('workspace_id=eq.workspace')));
  assert.deepEqual(calls[1].options.body.metadata,{source:'training',messaging_block:{at:'old'}});
  assert.ok(calls.every(c=>!c.path.startsWith('social_outbox')));
});

test('missing Instagram Insights does not overwrite an existing real views snapshot',async()=>{
  process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='sb_secret_test';
  const original=globalThis.fetch;let snapshotWrites=0;
  globalThis.fetch=async(url,options={})=>{
    const value=String(url);
    if(value.includes('/content_publish_queue?'))return response([{id:'q',external_post_id:'m',finished_at:new Date().toISOString(),selected_account_id:'ig'}]);
    if(value.includes('/content_history?'))return response([{id:'h',queue_id:'q',account_id:'ig'}]);
    if(value.includes('/content_accounts?'))return response([instagram]);
    if(value.includes('/post_metrics_snapshots?'))return response([{history_id:'h',views:1024,captured_at:'2026-10-01T00:00:00Z'}]);
    if(value.includes('/insights?'))return new Response(JSON.stringify({error:{message:'Missing Insights permission'}}),{status:403});
    if(value.includes('graph.instagram.com'))return response({id:'m',like_count:5,comments_count:2});
    if(value.endsWith('/post_metrics_snapshots')){snapshotWrites++;return response([]);}
    throw new Error('Unexpected request '+value);
  };
  try {const result=await syncWorkspaceMetrics('workspace',{force:true});assert.equal(result.partial,1);assert.equal(result.updated,0);assert.equal(snapshotWrites,0);}
  finally {globalThis.fetch=original;}
});
