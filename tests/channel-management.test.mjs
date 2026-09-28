import assert from 'node:assert/strict';
import test from 'node:test';
import { reconnectAccount } from '../netlify/functions/_shared.mjs';
import { removeConnectedChannel } from '../netlify/functions/channel-remove.mjs';

test('reconnect only accepts the same channel in the workspace', async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{
      id:'channel-1',platform:'instagram_reels',platform_account_id:'ig-123',
      username:'testbrand',daily_limit:8,metadata:{}
    }]),{status:200,headers:{'content-type':'application/json'}});
  };
  try {
    const state = { reconnectAccountId:'channel-1',workspaceId:'workspace-1' };
    assert.equal((await reconnectAccount(state,'instagram_reels','ig-123')).daily_limit,8);
    assert.match(requestedUrl,/workspace_id=eq.workspace-1/);
    await assert.rejects(reconnectAccount(state,'instagram_reels','different-id'),/different account/);
    await assert.rejects(reconnectAccount(state,'facebook_page'),/no longer available/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('remove refuses queued posts without touching credentials or history', async () => {
  const calls = [];
  const db = async (path, options) => {
    calls.push({path,options});
    if (path.startsWith('content_accounts?')) return [{id:'channel-1',metadata:{}}];
    if (path.startsWith('content_publish_queue?')) return [{id:'pending-post'}];
    throw new Error(`Unexpected request: ${path}`);
  };
  await assert.rejects(removeConnectedChannel('channel-1','workspace-1',db),/queued posts/);
  assert.equal(calls.length,2);
  assert.ok(calls.every(call=>!call.options?.method));
});

test('remove disconnects an idle channel while preserving its record', async () => {
  const calls = [];
  const db = async (path, options) => {
    calls.push({path,options});
    if (path.startsWith('content_accounts?') && !options) return [{id:'channel-1',metadata:{source:'oauth'}}];
    if (path.startsWith('content_publish_queue?') || path.startsWith('social_outbox?')) return [];
    if (path.startsWith('content_accounts?') && options?.method === 'PATCH') return [{id:'channel-1'}];
    if (path.startsWith('content_distribution_pool_accounts?')) return [];
    throw new Error(`Unexpected request: ${path}`);
  };
  assert.deepEqual(await removeConnectedChannel('channel-1','workspace-1',db),{ok:true,account_id:'channel-1'});
  const patch = calls.find(call=>call.path.startsWith('content_accounts?') && call.options?.method === 'PATCH');
  assert.equal(patch.options.body.is_active,false);
  assert.equal(patch.options.body.access_token,'');
  assert.equal(patch.options.body.metadata.source,'oauth');
  assert.ok(patch.options.body.metadata.disconnected_at);
  assert.ok(calls.every(call=>call.path.includes('workspace_id=eq.workspace-1')));
  assert.ok(calls.every(call=>!call.path.startsWith('social_messages?')));
});
