import test from 'node:test';
import assert from 'node:assert/strict';
import { messagingEligibility, latestInboundDm, eligibilityLabel } from '../public/messaging-policy.js';
import { assertMessagingAllowed } from '../netlify/functions/_messaging-eligibility.mjs';

const now=Date.parse('2026-10-03T20:00:00Z');
const hour=3600000;
const context={platform:'instagram_reels',now};
test('a Sep 30 DM is closed on Oct 3; CRM stage never affects eligibility',()=>{
  const e=messagingEligibility({...context,latestInbound:Date.parse('2026-09-30T18:10:00Z')});
  assert.equal(e.state,'WAITING_FOR_INBOUND'); assert.equal(e.lead_retained,true); assert.equal(e.can_send,false);
});
test('the 24-hour boundary closes and a new inbound DM reopens it',()=>{
  assert.equal(messagingEligibility({...context,latestInbound:now-24*hour}).can_send,false);
  const open=messagingEligibility({...context,latestInbound:now-hour});
  assert.equal(open.state,'NORMAL_DM'); assert.equal(open.can_send,true);
  assert.match(eligibilityLabel(open,now),/23h 0m/);
  assert.equal(messagingEligibility({...context,latestInbound:now+hour}).can_send,false);
});
test('comments, read receipts and outbound messages never open ordinary DMs',()=>{
  const messages=[{direction:'outbound',message_type:'text',sent_at:new Date(now).toISOString()},
    {direction:'inbound',message_type:'comment',sent_at:new Date(now).toISOString()},
    {direction:'inbound',message_type:'read',sent_at:new Date(now).toISOString()}];
  assert.equal(latestInboundDm(messages),null);
  assert.equal(messagingEligibility({...context,messages}).can_send,false);
});
test('private replies are tied to an unused comment younger than seven days',()=>{
  const comment={direction:'inbound',message_type:'comment',platform_message_id:'comment-1',sent_at:new Date(now-hour).toISOString()};
  const e=messagingEligibility({...context,messages:[comment]});
  assert.equal(e.state,'PRIVATE_REPLY');
  assert.throws(()=>assertMessagingAllowed(e,{replyMode:'dm'}));
  assert.throws(()=>assertMessagingAllowed(e,{replyMode:'private_reply',targetPlatformId:'other-comment'}));
  assertMessagingAllowed(e,{replyMode:'private_reply',targetPlatformId:'comment-1'});
  assert.equal(messagingEligibility({...context,messages:[comment],outbox:[{reply_mode:'private_reply',status:'sent',target_platform_id:'comment-1'}]}).can_send,false);
  assert.equal(messagingEligibility({...context,messages:[{...comment,sent_at:new Date(now-7*24*hour).toISOString()}]}).can_send,false);
});
test('human agent needs verified access and explicit manual support intent',()=>{
  const old={...context,latestInbound:now-48*hour};
  assert.equal(messagingEligibility(old).state,'WAITING_FOR_INBOUND');
  const e=messagingEligibility({...old,account:{capabilities_json:{human_agent_verified:true}}});
  assert.equal(e.state,'HUMAN_AGENT'); assert.equal(e.can_send,false);
  assert.throws(()=>assertMessagingAllowed(e,{manual:false,purpose:'human_support'}));
  assert.throws(()=>assertMessagingAllowed(e,{manual:true,purpose:'sales'}));
  assert.equal(assertMessagingAllowed(e,{manual:true,purpose:'human_support'}),'HUMAN_AGENT');
});
test('provider rejection blocks until a newer inbound DM; unsupported lanes fail closed',()=>{
  const metadata={messaging_block:{at:new Date(now).toISOString(),last_inbound_dm_at:new Date(now-hour).toISOString()}};
  assert.equal(messagingEligibility({...context,latestInbound:now-hour,metadata}).can_send,false);
  assert.equal(messagingEligibility({...context,latestInbound:now-1000,metadata}).can_send,true);
  assert.equal(messagingEligibility({...context,platform:'tiktok',latestInbound:now-1000}).state,'UNSUPPORTED');
  assert.equal(messagingEligibility({...context,latestInbound:now-1000,account:{metadata:{disconnected_at:'date'}}}).state,'DISCONNECTED');
});
