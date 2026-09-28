import { getStore } from '@netlify/blobs';

const validPath = /^(?:default|[0-9a-f-]{36})\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|mp4|m4a|wav|pdf)$/i;
const contentTypes = { jpg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', m4a: 'audio/mp4', wav: 'audio/wav', pdf: 'application/pdf' };

export async function readSocialMedia(request, store = getStore('social-message-media')) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!validPath.test(path)) return new Response('Not found', { status: 404 });
  const file = await store.get(path, { type: 'arrayBuffer' });
  if (file === null) return new Response('Not found', { status: 404 });
  const extension = path.split('.').pop().toLowerCase();
  return new Response(request.method === 'HEAD' ? null : file, {
    headers: { 'content-type': contentTypes[extension], 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
  });
}

export default async (request) => {
  try { return await readSocialMedia(request); }
  catch (error) { console.error('Could not read social media', error); return new Response('Media unavailable', { status: 503 }); }
};
