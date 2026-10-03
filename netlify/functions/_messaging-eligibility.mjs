import { scopedPath, supabaseRequest } from './_shared.mjs';
import { latestInboundDm, messagingEligibility } from '../../public/messaging-policy.js';

export async function loadMessagingContext(conversation, account, {db = supabaseRequest, excludeOutboxId = null} = {}) {
  const scope = conversation.workspace_id;
  const base = 'social_messages?conversation_id=eq.' + encodeURIComponent(conversation.id);
  const [dm, comments, outbox] = await Promise.all([
    db(scopedPath(base + '&direction=eq.inbound&message_type=not.in.(comment,reaction,read,delivery)&select=direction,message_type,sent_at,created_at&order=sent_at.desc.nullslast&limit=1', scope)),
    db(scopedPath(base + '&direction=eq.inbound&message_type=eq.comment&select=direction,message_type,platform_message_id,sent_at,created_at&order=sent_at.desc.nullslast&limit=100', scope)),
    db(scopedPath('social_outbox?conversation_id=eq.' + encodeURIComponent(conversation.id) + '&reply_mode=eq.private_reply&select=id,status,reply_mode,target_platform_id&limit=1000', scope))
  ]);
  const messages = [...(dm || []), ...(comments || [])];
  return messagingEligibility({platform: conversation.platform || account.platform, latestInbound: latestInboundDm(dm || []), messages,
    outbox: (outbox || []).filter(item => item.id !== excludeOutboxId), account, metadata: conversation.metadata || {}});
}

export function assertMessagingAllowed(eligibility, {replyMode = 'dm', targetPlatformId, manual = false, purpose} = {}) {
  const human = eligibility.state === 'HUMAN_AGENT' && manual === true && purpose === 'human_support' && replyMode === 'dm';
  const normal = eligibility.can_send && eligibility.reply_mode === replyMode &&
    (replyMode !== 'private_reply' || String(targetPlatformId) === String(eligibility.target_platform_id));
  if (!human && !normal) throw Object.assign(new Error(eligibility.label), {status: 409, messagingBlocked: true});
  return human ? 'HUMAN_AGENT' : null;
}

// Lists use actual inbound DM timestamps rather than last_inbound_at, which also
// contains public comments in older data. Never hide a CRM lead when DM expires.
export async function enrichMessagingRows(rows, accounts, workspaceId, db = supabaseRequest) {
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const latest = new Map();
  for (let start = 0; start < rows.length; start += 100) {
    const ids = [...new Set(rows.slice(start, start + 100).map(r => r.conversation_id))];
    for (let offset = 0; ; offset += 1000) {
      const page = await db(scopedPath('social_messages?conversation_id=in.(' + ids.map(encodeURIComponent).join(',') + ')&direction=eq.inbound&message_type=not.in.(comment,reaction,read,delivery)&select=conversation_id,direction,message_type,sent_at,created_at&order=sent_at.desc.nullslast&limit=1000&offset=' + offset, workspaceId));
      for (const message of page || []) if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, latestInboundDm([message]));
      if (!page || page.length < 1000 || ids.every(id => latest.has(id))) break;
    }
  }
  // Read only the metadata needed for provider rejection and saved follow-ups.
  const details = new Map();
  for (let start = 0; start < rows.length; start += 100) {
    const ids = rows.slice(start, start + 100).map(r => r.conversation_id);
    const page = await db(scopedPath('social_conversations?id=in.(' + ids.map(encodeURIComponent).join(',') + ')&select=id,metadata&limit=100', workspaceId));
    for (const c of page || []) details.set(c.id, c.metadata || {});
  }
  return rows.map(row => ({...row, follow_up: details.get(row.conversation_id)?.follow_up || null,
    messaging_eligibility: messagingEligibility({platform: row.platform, latestInbound: latest.get(row.conversation_id),
      account: accountMap.get(row.account_id) || {}, metadata: details.get(row.conversation_id) || {}})}));
}
