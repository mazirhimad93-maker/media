import assert from 'node:assert/strict';
import test from 'node:test';
import { saveSocialMedia } from '../netlify/functions/social-media-upload.mjs';
import { readSocialMedia } from '../netlify/functions/social-media-file.mjs';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';

test('a voice note is stored and publicly fetchable at the URL given to Meta', async () => {
  const entries = new Map();
  const store = {
    set: async (key, file) => { entries.set(key, await file.arrayBuffer()); },
    get: async (key) => entries.get(key) || null,
  };
  const file = new File([new Uint8Array([82, 73, 70, 70])], 'voice.wav', { type: 'audio/wav' });
  const saved = await saveSocialMedia({ file, conversationId, workspaceId, origin: 'https://example.netlify.app' }, store);
  assert.equal(saved.type, 'audio');
  assert.match(saved.storagePath, /^11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222\/[0-9a-f-]{36}\.wav$/);
  const response = await readSocialMedia(new Request(saved.url), store);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([82, 73, 70, 70]));
  assert.equal((await readSocialMedia(new Request(saved.url.replace('/file?', '/file?path=../../&unused=')), store)).status, 404);
});

test('media validation rejects unsupported or oversized files before storage', async () => {
  let writes = 0;
  const store = { set: async () => { writes++; } };
  const options = { conversationId, workspaceId, origin: 'https://example.netlify.app' };
  await assert.rejects(saveSocialMedia({ ...options, file: new File(['bad'], 'bad.svg', { type: 'image/svg+xml' }) }, store), /Use a JPEG/);
  await assert.rejects(saveSocialMedia({ ...options, file: new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' }) }, store), /smaller than 4 MB/);
  assert.equal(writes, 0);
});
