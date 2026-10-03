const HOUR = 60 * 60 * 1000;
export const messageTime = (message) => {
  const value = message?.sent_at || message?.created_at;
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
};

export function latestInboundDm(messages = []) {
  return messages.filter(m => m.direction === 'inbound' && !['comment', 'reaction', 'read', 'delivery'].includes(m.message_type))
    .reduce((latest, m) => Math.max(latest || 0, messageTime(m) || 0), 0) || null;
}

// Shared by the inbox and delivery worker. Public comments, outbound sends,
// CRM stages, and read receipts never extend the ordinary messaging window.
export function messagingEligibility({platform, latestInbound = null, messages = [], outbox = [], account = {}, metadata = {}, now = Date.now()} = {}) {
  const result = (state, label, extra = {}) => ({state, label, can_send: false, reply_mode: null,
    expires_at: null, last_inbound_dm_at: latestInbound ? new Date(latestInbound).toISOString() : null,
    lead_retained: true, marketing_available: false, limited_reengagement_available: false, ...extra});
  if (account.metadata?.disconnected_at || account.connected === false)
    return result('DISCONNECTED', 'Channel disconnected · lead and conversation retained');
  if (!['instagram_reels', 'facebook_page'].includes(platform))
    return result('UNSUPPORTED', ['tiktok','tiktok_video'].includes(platform) ? 'TikTok DM connection required · lead retained' : 'Messaging unavailable on this channel · lead retained');

  const inbound = latestInbound || latestInboundDm(messages);
  const expiry = inbound ? inbound + 24 * HOUR : null;
  const rejected = metadata.messaging_block;
  const providerBlocked = rejected && (!inbound || inbound <= Date.parse(rejected.last_inbound_dm_at || rejected.at));
  if (inbound && inbound <= now && now < expiry && !providerBlocked)
    return result('NORMAL_DM', 'DM window open', {can_send: true, reply_mode: 'dm', expires_at: new Date(expiry).toISOString(), last_inbound_dm_at: new Date(inbound).toISOString()});

  if (platform === 'instagram_reels') {
    const reserved = new Set(outbox.filter(item => item.reply_mode === 'private_reply' && ['pending', 'sending', 'sent'].includes(item.status))
      .map(item => String(item.target_platform_id || '')));
    const comment = messages.filter(m => m.direction === 'inbound' && m.message_type === 'comment' && m.platform_message_id)
      .sort((a, b) => (messageTime(b) || 0) - (messageTime(a) || 0))
      .find(m => {const time = messageTime(m); return time && time <= now && now < time + 7 * 24 * HOUR && !reserved.has(String(m.platform_message_id));});
    if (comment) return result('PRIVATE_REPLY', 'One private reply available · wait for their answer before more DMs',
      {can_send: true, reply_mode: 'private_reply', target_platform_id: comment.platform_message_id,
        expires_at: new Date(messageTime(comment) + 7 * 24 * HOUR).toISOString()});
  }
  // This flag is server-controlled and must represent approved app access.
  // Human Agent is selected explicitly for a manual support reply, never sales automation.
  if (inbound && inbound <= now && now < inbound + 7 * 24 * HOUR && !providerBlocked && account.capabilities_json?.human_agent_verified === true)
    return result('HUMAN_AGENT', 'Human support reply only · automated and promotional follow-ups unavailable',
      {human_reply_available: true, expires_at: new Date(inbound + 7 * 24 * HOUR).toISOString(), last_inbound_dm_at: new Date(inbound).toISOString()});
  return result('WAITING_FOR_INBOUND', providerBlocked ? 'Instagram rejected this messaging window · waiting for a new DM · lead retained'
    : 'DM window closed · waiting for their reply · lead retained', {last_inbound_dm_at: inbound ? new Date(inbound).toISOString() : null});
}

export function eligibilityLabel(eligibility, now = Date.now()) {
  if (!eligibility) return 'Checking messaging availability…';
  if (eligibility.state !== 'NORMAL_DM') return eligibility.label;
  const remaining = Math.max(0, Date.parse(eligibility.expires_at) - now);
  if (!remaining) return 'DM window closed · waiting for their reply · lead retained';
  const minutes = Math.ceil(remaining / 60000);
  return `DM open · ${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}
