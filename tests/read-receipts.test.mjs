import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReadReceipt } from '../netlify/functions/meta-webhook.mjs';

const account = { id:'account-1', platform:'instagram_reels', platform_account_id:'ig-1', workspace_id:'workspace-1' };

test('Instagram seen updates only a matching outbound message in this workspace', async () => {
  const calls = [];
  const db = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('social_contacts?')) return [{ id:'contact-1' }];
    if (path.startsWith('social_messages?') && !options) return [{ id:'sent-1' }];
    return [];
  };
  const result = await applyReadReceipt(account, { sender:{id:'user-1'}, recipient:{id:'ig-1'}, read:{mid:'mid-1'} }, db);
  assert.equal(result.count, 1);
  assert.match(calls[1].path, /direction=eq.outbound.*platform_message_id=eq.mid-1/);
  assert.ok(calls.every((call) => call.path.includes('workspace_id=eq.workspace-1')));
  assert.equal(calls[2].options.body.delivery_status, 'read');
});

test('an unknown or inbound message receipt never marks the thread seen', async () => {
  const calls = [];
  const db = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('social_contacts?')) return [{ id:'contact-1' }];
    return [];
  };
  const result = await applyReadReceipt(account, { sender:{id:'user-1'}, recipient:{id:'ig-1'}, read:{mid:'inbound-mid'} }, db);
  assert.equal(result.ignored, 'no_outbound_match');
  assert.equal(calls.some((call) => call.options?.method === 'PATCH'), false);
});
