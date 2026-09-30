import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchSocialOutboxItem } from '../netlify/functions/_social-delivery.mjs';

const job={
  id:'outbox-1',conversation_id:'conversation-1',account_id:'account-1',
  contact_id:'contact-1',reply_mode:'dm',target_platform_id:null,
  body:'Hello from the inbox',status:'pending',attempts:0,max_attempts:5
};

function fakeDatabase({claim=true}={}){
  const calls=[];
  const db=async (path,options)=>{
    calls.push({path,options});
    if(path.startsWith('social_outbox?') && !options) return [job];
    if(path.startsWith('social_outbox?') && path.includes('status=eq.pending')) return claim?[{...job,status:'sending',attempts:1}]:[];
    if(path.startsWith('content_accounts?')) return [{id:'account-1',platform:'instagram_reels',platform_account_id:'ig-1',access_token:'test-token'}];
    if(path.startsWith('social_contacts?')) return [{id:'contact-1',platform_user_id:'sender-1'}];
    if(path.startsWith('social_messages?')) return [];
    return null;
  };
  return {db,calls};
}

test('a manual reply claims only its own row and sends immediately',async()=>{
  const {db,calls}=fakeDatabase();
  let sentBody;
  const fetcher=async (url,options)=>{
    assert.match(url,/graph.instagram.com\/v26.0\/ig-1\/messages/);
    sentBody=JSON.parse(options.body);
    return new Response(JSON.stringify({message_id:'meta-message-1'}),{status:200});
  };
  const result=await dispatchSocialOutboxItem('outbox-1','workspace-1',{db,fetcher});
  assert.equal(result.status,'sent');
  assert.deepEqual(sentBody,{recipient:{id:'sender-1'},message:{text:job.body}});
  assert.ok(calls.find(c=>c.path.includes('status=eq.pending')&&c.path.includes('workspace_id=eq.workspace-1')&&c.options?.method==='PATCH'));
  assert.ok(calls.find(c=>c.path.startsWith('social_outbox?')&&c.options?.body.status==='sent'));
  assert.ok(calls.find(c=>c.path==='social_messages'&&c.options?.body.platform_message_id==='meta-message-1'));
  const conversationUpdate=calls.find(c=>c.path.startsWith('social_conversations?')&&c.options?.method==='PATCH');
  assert.equal(conversationUpdate.options.body.unread_count,undefined);
  const stageUpdate=calls.find(c=>c.path.startsWith('social_contacts?')&&c.options?.method==='PATCH');
  assert.match(stageUpdate.path,/lead_status=eq\.new/);
  assert.equal(stageUpdate.options.body.lead_status,'engaged');
});

test('Meta rejection is visible as failed and is not silently left pending',async()=>{
  const {db,calls}=fakeDatabase();
  const fetcher=async()=>new Response(JSON.stringify({error:{message:'Messaging permission denied'}}),{status:403});
  const result=await dispatchSocialOutboxItem('outbox-1','workspace-1',{db,fetcher});
  assert.equal(result.status,'failed');
  assert.match(result.error,/Messaging permission denied/);
  assert.ok(calls.find(c=>c.path.startsWith('social_outbox?')&&c.options?.body.status==='failed'&&c.options.body.last_error==='Messaging permission denied'));
  assert.equal(calls.some(c=>c.path==='social_messages'&&c.options?.method==='POST'),false);
});

test('a concurrent dispatcher cannot send the same row twice',async()=>{
  const {db}=fakeDatabase({claim:false});
  let sendCount=0;
  const result=await dispatchSocialOutboxItem('outbox-1','workspace-1',{db,fetcher:async()=>{sendCount++;}});
  assert.equal(result.status,'sending');
  assert.equal(sendCount,0);
});

test('an audio reply sends a Meta attachment and records playback media',async()=>{
  const {db,calls}=fakeDatabase();
  const audioJob={...job,id:'outbox-audio',body:'[Voice message]',metadata:{attachment:{type:'audio',url:'https://example.supabase.co/storage/v1/object/public/social-message-media/voice.wav',name:'Voice message.wav'}}};
  const mediaDb=async(path,options)=>{
    if(path.startsWith('social_outbox?')&&!options) return [audioJob];
    if(path.startsWith('social_outbox?')&&path.includes('status=eq.pending')) return [{...audioJob,status:'sending',attempts:1}];
    return db(path,options);
  };
  let payload;
  const result=await dispatchSocialOutboxItem('outbox-audio','workspace-1',{
    db:mediaDb,
    fetcher:async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({message_id:'audio-1'}),{status:200});}
  });
  assert.equal(result.sent,true);
  assert.deepEqual(payload.message,{attachment:{type:'audio',payload:{url:audioJob.metadata.attachment.url}}});
  const stored=calls.find(c=>c.path==='social_messages'&&c.options?.method==='POST')?.options.body;
  assert.equal(stored.message_type,'audio');
  assert.equal(stored.media_url,audioJob.metadata.attachment.url);
});


test('private comment reply uses the comment ID as the Instagram recipient',async()=>{
  const privateJob={...job,id:'outbox-private',reply_mode:'private_reply',target_platform_id:'comment-123',body:'Here is the training.'};
  const base=fakeDatabase();
  const db=async(path,options)=>{
    if(path.startsWith('social_outbox?')&&!options) return [privateJob];
    if(path.startsWith('social_outbox?')&&path.includes('status=eq.pending')) return [{...privateJob,status:'sending',attempts:1}];
    return base.db(path,options);
  };
  let payload;
  const result=await dispatchSocialOutboxItem('outbox-private','workspace-1',{
    db,
    fetcher:async(url,options)=>{
      payload=JSON.parse(options.body);
      return new Response(JSON.stringify({message_id:'private-1'}),{status:200});
    }
  });
  assert.equal(result.sent,true);
  assert.deepEqual(payload.recipient,{comment_id:'comment-123'});
  assert.equal(payload.message.text,'Here is the training.');
});
