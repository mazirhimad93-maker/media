import { jsonResponse, publicError, requireWorkspace, scopedPath, supabaseRequest } from './_shared.mjs';

const conflict = (message, status = 409) => Object.assign(new Error(message), { status });

export async function removeConnectedChannel(accountId, workspaceId, db = supabaseRequest) {
  const path = scopedPath(
    `content_accounts?id=eq.${encodeURIComponent(accountId)}&select=id,username,metadata&limit=1`,workspaceId
  );
  const account = (await db(path))?.[0];
  if (!account) throw conflict('Channel not found in this workspace.',404);
  if (account.metadata?.disconnected_at) return { ok:true,already_removed:true };

  // Keep publishing and conversation history intact. A channel assigned to pending
  // work must be unassigned first, so removal cannot strand scheduled posts/replies.
  const queue = await db(scopedPath(
    `content_publish_queue?or=(selected_account_id.eq.${encodeURIComponent(accountId)},account_id.eq.${encodeURIComponent(accountId)})&status=not.in.(done,failed,cancelled,skipped)&select=id&limit=1`,workspaceId
  ));
  if (queue?.length) throw conflict('This channel has queued posts. Reassign or cancel them before removing it.');
  const outbox = await db(scopedPath(
    `social_outbox?account_id=eq.${encodeURIComponent(accountId)}&status=in.(pending,sending)&select=id&limit=1`,workspaceId
  ));
  if (outbox?.length) throw conflict('This channel has pending DM replies. Send or cancel them before removing it.');

  const now = new Date().toISOString();
  const updated = await db(scopedPath(
    `content_accounts?id=eq.${encodeURIComponent(accountId)}`,workspaceId
  ),{
    method:'PATCH',headers:{Prefer:'return=representation'},body:{
      is_active:false,
      access_token:'',refresh_token:'',token_expires_at:null,scope:'',
      capabilities_json:{},webhook_status:'not_configured',
      metadata:{...(account.metadata || {}),disconnected_at:now},
      updated_at:now
    }
  });
  if (!updated?.length) throw conflict('Channel could not be removed. Refresh and try again.');
  await db(scopedPath(
    `content_distribution_pool_accounts?account_id=eq.${encodeURIComponent(accountId)}&is_active=eq.true`,workspaceId
  ),{method:'PATCH',body:{is_active:false,updated_at:now}});
  return { ok:true,account_id:accountId };
}

export default async (request) => {
  try {
    if (request.method !== 'POST') return jsonResponse({ error:'POST required' }, 405);
    const { workspaceId, membership, profile } = await requireWorkspace(request);
    if (!workspaceId) return jsonResponse({ error:'Workspace setup is required before removing channels.' }, 409);
    if (!['owner','admin'].includes(membership?.role || profile?.role)) {
      return jsonResponse({ error:'Only workspace owners and admins can remove channels.' }, 403);
    }

    const { accountId } = await request.json().catch(() => ({}));
    if (!accountId) return jsonResponse({ error:'accountId is required' }, 400);
    return jsonResponse(await removeConnectedChannel(accountId,workspaceId));
  } catch (error) {
    return publicError(error,error.status || 500);
  }
};
