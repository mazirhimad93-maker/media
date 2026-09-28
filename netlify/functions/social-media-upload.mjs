import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { connectorOrigin, jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const types = {
  'image/jpeg': ['image', 'jpg'], 'image/png': ['image', 'png'],
  'video/mp4': ['video', 'mp4'],
  'audio/mp4': ['audio', 'm4a'], 'audio/wav': ['audio', 'wav'], 'audio/x-wav': ['audio', 'wav'],
  'application/pdf': ['file', 'pdf'],
};
export async function saveSocialMedia({ file, conversationId, workspaceId, origin }, store = getStore('social-message-media')) {
  const type = types[file?.type];
  if (!type) throw Object.assign(new Error('Use a JPEG or PNG photo, MP4 video, M4A or WAV audio, or PDF file.'), { status: 400 });
  if (!file.size || file.size > MAX_BYTES) throw Object.assign(new Error('The file must be smaller than 4 MB.'), { status: 413 });
  const path = `${workspaceId || 'default'}/${conversationId}/${crypto.randomUUID()}.${type[1]}`;
  await store.set(path, file, { metadata: { contentType: file.type } });
  return {
    storagePath: path, type: type[0], name: String(file.name || type[0]).slice(0, 120),
    url: `${origin}/api/social/media/file?path=${encodeURIComponent(path)}`,
  };
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
    return jsonResponse(await saveSocialMedia({ file, conversationId, workspaceId, origin: connectorOrigin(request) }), 201);
  } catch (error) {
    return publicError(error, error.status || 500);
  }
};
