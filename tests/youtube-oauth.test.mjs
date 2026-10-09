import assert from 'node:assert/strict';
import test from 'node:test';
import callback from '../netlify/functions/oauth-youtube-callback.mjs';
import { signOAuthState } from '../netlify/functions/_shared.mjs';
import { safeSettings } from '../netlify/functions/channel-settings.mjs';

test('YouTube reconnect keeps the distributor credentials paired with the refresh token', async () => {
  const names = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OAUTH_STATE_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'];
  const previous = Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const oldFetch = globalThis.fetch;
  const oldConsoleError = console.error;
  Object.assign(process.env,{SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-key',OAUTH_STATE_SECRET:'test-state-secret',GOOGLE_CLIENT_ID:' new-client ',GOOGLE_CLIENT_SECRET:' new-secret '});
  let returnedRefresh = 'new-refresh', storedClient = 'old-client', saved;
  const existing = () => ({id:'account-1',workspace_id:'workspace-1',refresh_token:'stored-refresh',settings_json:{google_client_id:storedClient,google_client_secret:'old-secret',custom:'preserved'}});
  globalThis.fetch = async (input,options={}) => {
    const url = String(input);
    const response = body => new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
    if(url==='https://oauth2.googleapis.com/token') {
      assert.equal(options.body.get('client_id'),'new-client');
      assert.equal(options.body.get('client_secret'),'new-secret');
      return response({access_token:'new-access',refresh_token:returnedRefresh,scope:'https://www.googleapis.com/auth/youtube.upload'});
    }
    if(url.startsWith('https://www.googleapis.com/youtube/v3/channels')) return response({items:[{id:'yt-1',snippet:{title:'Test channel'}}]});
    if(url.includes('content_accounts?') && options.method==='POST') {
      saved=JSON.parse(options.body);
      return response([{id:'account-1',...saved}]);
    }
    if(url.includes('content_accounts?')) return response([existing()]);
    if(url.endsWith('/content_history')) return response(null);
    throw new Error('Unexpected request');
  };
  const run = () => callback(new Request('https://app.test/oauth/youtube/callback?code=test&state='+signOAuthState({provider:'youtube',workspaceId:'workspace-1'})));
  try {
    let response=await run();
    assert.equal(response.status,200);
    assert.equal(saved.refresh_token,'new-refresh');
    assert.equal(saved.settings_json.google_client_id,'new-client');
    assert.equal(saved.settings_json.google_client_secret,'new-secret');
    assert.equal(saved.settings_json.custom,'preserved');
    assert.doesNotMatch(await response.text(),/new-secret|new-refresh|new-access/);

    returnedRefresh=undefined; saved=undefined;
    console.error=()=>{};
    response=await run();
    assert.equal(response.status,400);
    assert.equal(saved,undefined,'a token belonging to another client must not be saved');

    storedClient='new-client';
    response=await run();
    assert.equal(response.status,200);
    assert.equal(saved.refresh_token,'stored-refresh');
    assert.equal(saved.settings_json.google_client_secret,'new-secret');
  } finally {
    globalThis.fetch=oldFetch; console.error=oldConsoleError;
    for(const name of names) { if(previous[name]===undefined) delete process.env[name]; else process.env[name]=previous[name]; }
  }
});

test('channel limit responses omit credentials and private settings', () => {
  assert.deepEqual(safeSettings({id:'account-1',daily_limit:6,weekly_limit:42,min_gap_minutes:240,access_token:'private-access',refresh_token:'private-refresh',settings_json:{google_client_secret:'private-secret'}}),{id:'account-1',daily_limit:6,weekly_limit:42,min_gap_minutes:240});
});
