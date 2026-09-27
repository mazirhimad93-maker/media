import assert from 'node:assert/strict';
import test from 'node:test';
import { clampInt, signOAuthState, verifyOAuthState } from '../netlify/functions/_shared.mjs';
process.env.OAUTH_STATE_SECRET='test-only-oauth-state-secret-that-is-long';
test('signed state survives a valid round trip',()=>{const signed=signOAuthState({provider:'instagram',campaignId:'campaign-1'});const value=verifyOAuthState(signed,'instagram');assert.equal(value.campaignId,'campaign-1')});
test('signed state rejects tampering',()=>{const signed=signOAuthState({provider:'youtube'});assert.throws(()=>verifyOAuthState(`${signed}x`,'youtube'),/Invalid OAuth state/)});
test('limits are clamped',()=>{assert.equal(clampInt('5',0,10,4),5);assert.equal(clampInt('999',0,10,4),10);assert.equal(clampInt('bad',0,10,4),4)});
