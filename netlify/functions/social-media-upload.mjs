import crypto from 'node:crypto';
import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const BUCKET = 'social-message-media';
const MAX_BYTES = 4 * 1024 * 1024;
const types = {
  'image/jpeg': ['image', 'jpg'], 'image/png': ['image', 'png'],
  'video/mp4': ['video', 'mp4'],
  'audio/mp4': ['audio', 'm4a'], 'audio/wav': ['audio', 'wav'], 'audio/x-wav': ['audio', 'wav'],
  'application/pdf': ['file', 'pdf'],
};
let bucketReady = false;

async function storage(path, options = {}) {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Object.assign(new Error('Media storage is not configured.'), { status: 409 });
  const response = await fetch(base + '/storage/v1/' + path, {
    ...options,
    headers: { apikey: key, authorization: `Bearer ${key}`, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data, base };
}

async function ensureBucket() {
  if (bucketReady) return;
  const existing = await storage('bucket/' + BUCKET);
  if (existing.response.ok) { bucketReady = true; return; }
  if (existing.response.status !== 404) throw Object.assign(new Error('Media storage is unavailable.'), { status: 409 });
  const created = await storage('bucket', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_BYTES, allowed_mime_types: Object.keys(types) }),
  });
  if (!created.response.ok && created.response.status !== 409) {
    throw Object.assign(new Error(created.data.message || created.data.error || 'Could not prepare media storage.'), { status: 409 });
  }
  bucketReady = true;
}

export default async (request) => {
  try {
    const { workspaceId } = await requireWorkspace(request);
    if (request.method !== 'POST') throw Object.assign(new Error('POST required'), { status: 405 });
    const form = await request.formData();
    const conversationId = String(form.get('conversationId') || '');
    const file = form.get('file');
    if (!conversationId || !file || typeof file.arrayBuffer !== 'function') throw Object.assign(new Error('Choose a file for a conversation.'), { status: 400 });
    const rows = await supabaseRequest(scopedPath(`social_conversations?id=eq.${encodeURIComponent(conversationId)}&select=id&limit=1`, workspaceId));
    if (!rows?.length) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    const type = types[file.type];
    if (!type) throw Object.assign(new Error('Use a JPEG or PNG photo, MP4 video, M4A or WAV audio, or PDF file.'), { status: 400 });
    if (!file.size || file.size > MAX_BYTES) throw Object.assign(new Error('The file must be smaller than 4 MB.'), { status: 413 });
    await ensureBucket();
    const path = `${workspaceId || 'default'}/${conversationId}/${crypto.randomUUID()}.${type[1]}`;
    const uploaded = await storage('object/' + BUCKET + '/' + path, {
      method: 'POST', headers: { 'content-type': file.type, 'x-upsert': 'false' }, body: Buffer.from(await file.arrayBuffer()),
    });
    if (!uploaded.response.ok) throw Object.assign(new Error(uploaded.data.message || uploaded.data.error || 'Media upload failed.'), { status: 409 });
    return jsonResponse({
      storagePath: path, type: type[0], name: String(file.name || type[0]).slice(0, 120),
      url: `${uploaded.base}/storage/v1/object/public/${BUCKET}/${path}`,
    }, 201);
  } catch (error) {
    return publicError(error, error.status || 500);
  }
};
