import { scopedPath, supabaseRequest } from './_shared.mjs';

// PostgREST has no arithmetic PATCH. Compare the count we read with the count
// we update so simultaneous webhook and sync requests cannot lose an unread DM.
export async function addUnreadMessages(conversationId, count, workspaceId, db = supabaseRequest) {
  if (!count) return;
  const base = scopedPath(`social_conversations?id=eq.${encodeURIComponent(conversationId)}`, workspaceId);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = await db(`${base}&select=id,unread_count&limit=1`);
    if (!rows?.[0]) throw new Error('Conversation not found while marking messages unread');
    const current = Number(rows[0].unread_count || 0);
    const updated = await db(`${base}&unread_count=eq.${current}&select=id`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: { unread_count: current + count, updated_at: new Date().toISOString() }
    });
    if (updated?.length) return;
  }
  throw new Error('Could not update the unread message count');
}
