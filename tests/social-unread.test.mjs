import assert from 'node:assert/strict';
import test from 'node:test';
import { addUnreadMessages } from '../netlify/functions/_social-unread.mjs';
import { markVisibleMessagesRead } from '../netlify/functions/conversation.mjs';
import { insertMessage, upsertContact as webhookContact } from '../netlify/functions/meta-webhook.mjs';
import { recordImportedMessages, upsertContact as syncContact, upsertConversation as syncConversation } from '../netlify/functions/inbox-sync.mjs';

test('simultaneous inbound events retain both unread counts',async()=>{
  let unread=0;
  const db=async(path,options)=>{
    if(!options) return [{id:'thread-1',unread_count:unread}];
    const expected=Number(new URLSearchParams(path.split('?')[1]).get('unread_count').slice(3));
    if(unread!==expected) return [];
    unread=options.body.unread_count;
    return [{id:'thread-1'}];
  };
  await Promise.all([
    addUnreadMessages('thread-1',1,'workspace-1',db),
    addUnreadMessages('thread-1',1,'workspace-1',db)
  ]);
  assert.equal(unread,2);
});

test('reading one snapshot cannot clear a newer inbound message',async()=>{
  const first='2026-09-28T17:00:00.000Z';
  const second='2026-09-28T17:01:00.000Z';
  let state={unread:1,lastInbound:first};
  const db=async(path,options)=>{
    const query=new URLSearchParams(path.split('?')[1]);
    if(query.get('unread_count')!==`eq.${state.unread}` || query.get('last_inbound_at')!==`eq.${state.lastInbound}`) return [];
    state.unread=options.body.unread_count;
    return [{id:'thread-1'}];
  };
  state={unread:2,lastInbound:second};
  assert.equal(await markVisibleMessagesRead('thread-1','workspace-1',{unreadCount:1,lastInboundAt:first},db),false);
  assert.equal(state.unread,2);
  assert.equal(await markVisibleMessagesRead('thread-1','workspace-1',{unreadCount:2,lastInboundAt:second},db),true);
  assert.equal(state.unread,0);
});

test('an inbound webhook marks the DM unread without changing its lead stage',async()=>{
  let unread=0;
  const calls=[];
  const db=async(path,options)=>{
    calls.push({path,options});
    if(path.startsWith('social_messages?')) return [];
    if(path==='social_messages') return [{id:'message-1'}];
    if(path.startsWith('social_conversations?')&&!options) return [{id:'thread-1',unread_count:unread}];
    if(path.startsWith('social_conversations?')&&path.includes('unread_count=eq.')){
      unread=options.body.unread_count;
      return [{id:'thread-1'}];
    }
    if(path.startsWith('growth_events?')) return [{id:'captured'}];
    return null;
  };
  await insertMessage({
    conversation:{id:'thread-1'},account:{id:'account-1',platform:'instagram_reels',workspace_id:'workspace-1'},
    contact:{id:'contact-1'},platformMessageId:'ig-mid-1',body:'New DM'
  },db);
  assert.equal(unread,1);
  assert.equal(calls.some(({options})=>options?.body?.lead_status!==undefined),false);
});

test('webhook and sync preserve CRM stage, and sync preserves an existing unread count',async()=>{
  const account={id:'account-1',platform:'instagram_reels',platform_account_id:'ig-1',workspace_id:'workspace-1'};
  const contact={id:'contact-1',platform_user_id:'lead-1',lead_status:'qualified',metadata:{note:'kept'}};
  const conversation={id:'thread-1',unread_count:4,status:'pending',metadata:{note:'kept'}};
  const calls=[];
  const db=async(path,options)=>{
    calls.push({path,options});
    if(path.startsWith('social_contacts?')&&!options) return [contact];
    if(path.startsWith('social_contacts?')&&options?.method==='PATCH') return [contact];
    if(path.startsWith('social_conversations?')&&!options) return [conversation];
    if(path.startsWith('social_conversations?')&&options?.method==='PATCH') return [conversation];
    return null;
  };
  await webhookContact({account,platformUserId:'lead-1',metadata:{last_webhook:'messaging'}},db);
  await syncContact(account,{id:'lead-1',name:'Lead'},'workspace-1',db);
  await syncConversation(account,contact,{id:'remote-1'},[],'workspace-1',db);
  assert.equal(calls.filter(({options})=>options?.method==='PATCH').length,3);
  assert.equal(calls.some(({options})=>options?.body?.lead_status!==undefined),false);
  assert.equal(calls.some(({options})=>options?.body?.unread_count!==undefined),false);
  assert.equal(calls.some(({options})=>options?.body?.status!==undefined),false);
});

test('sync creates a New contact and counts only newly imported inbound DMs',async()=>{
  const account={id:'account-1',platform:'instagram_reels',platform_account_id:'ig-1',workspace_id:'workspace-1'};
  let unread=0;
  const calls=[];
  const db=async(path,options)=>{
    calls.push({path,options});
    if(path.startsWith('social_contacts?')&&!options) return [];
    if(path.startsWith('social_contacts?')&&options?.method==='POST') return [{id:'contact-1',lead_status:'new'}];
    if(path.includes('select=last_message_at')) return [{last_message_at:null,last_inbound_at:null,last_outbound_at:null}];
    if(path.startsWith('social_conversations?')&&!options) return [{id:'thread-1',unread_count:unread}];
    if(path.includes('unread_count=eq.')){
      unread=options.body.unread_count;
      return [{id:'thread-1'}];
    }
    return null;
  };
  const contact=await syncContact(account,{id:'lead-1',name:'Lead'},'workspace-1',db);
  assert.equal(contact.lead_status,'new');
  assert.equal(calls.find(({options})=>options?.method==='POST').options.body.lead_status,undefined);
  await recordImportedMessages([
    {conversation_id:'thread-1',direction:'inbound',sent_at:'2026-09-28T17:00:00Z'},
    {conversation_id:'thread-1',direction:'outbound',sent_at:'2026-09-28T17:01:00Z'},
    {conversation_id:'thread-1',direction:'inbound',sent_at:'2026-09-28T17:02:00Z'}
  ],'workspace-1',db);
  assert.equal(unread,2);
  const activity=calls.find(({path,options})=>path.startsWith('social_conversations?')&&options?.body?.last_inbound_at);
  assert.equal(activity.options.body.last_inbound_at,'2026-09-28T17:02:00Z');
});
