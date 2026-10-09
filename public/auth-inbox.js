import { eligibilityLabel } from './messaging-policy.js';
import { initMobileInbox, openMobileThread, closeMobileThread, isMobileInbox } from './mobile-inbox.js';
const $ = (id) => document.getElementById(id);

let media = null;
let inboxBusy = false;
let conversationFetch = null;
let conversationSignature = '';
let localReplies = [];
let pendingAttachment = null;
let recordingSession = null;
let recordingTimer = null;
let replyBusy = false;
let inboxUnreadOnly = false;
const receiptUpgradeAttempted = new Set();

function waitForMedia() {
  if (window.__alchemic) {
    media = window.__alchemic;
    bootAuth();
    return;
  }
  window.addEventListener('alchemic-ready', () => {
    media = window.__alchemic;
    bootAuth();
  }, { once: true });
}

function setAuthMode(mode) {
  const registering = mode === 'register';
  $('login-form').hidden = registering;
  $('register-form').hidden = !registering;
  $('auth-tab-login').classList.toggle('active', !registering);
  $('auth-tab-register').classList.toggle('active', registering);
  $('auth-title').textContent = registering ? 'Create your account' : 'Welcome back';
  $('auth-subtitle').textContent = registering ? 'Join the Alchemic Media workspace.' : 'Sign in to your media workspace.';
  $('auth-message').textContent = '';
  $('auth-message').className = 'auth-message';
}

function updateUserUi() {
  const profile = media.state.auth.profile || {};
  const user = media.state.auth.user || {};
  const email = user.email || profile.email || '';
  const name = profile.full_name || (email ? email.split('@')[0] : 'User');
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => (x[0] || '').toUpperCase()).join('') || 'U';

  $('user-name').textContent = name;
  $('user-role').textContent = profile.role || 'member';
  $('user-email').textContent = email;
  $('user-avatar').textContent = initials;
  const workspaceName = media.state.auth.workspace?.name || 'Media workspace';
  document.querySelectorAll('.workspace-card span').forEach(el=>{ el.textContent=workspaceName; });
}

function showAuth(message) {
  cancelRecording();
  media.state.auth = { accessToken: null, user: null, profile: null, workspace: null };
  $('app-shell').hidden = true;
  $('auth-shell').hidden = false;
  $('auth-message').textContent = message || '';
  $('auth-message').className = 'auth-message' + (message ? ' error' : '');
}

window.showAlchemicAuth = showAuth;

async function showApp() {
  $('auth-shell').hidden = true;
  $('app-shell').hidden = false;
  updateUserUi();
  await media.load();
  await loadInbox();
  const accounts = await loadInboxHealth();
  enableReadReceipts(accounts);
  if (media.state.view === 'leads') window.loadAlchemicLeads?.();
}

async function restoreSession() {
  try {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.authenticated || !payload.access_token) return false;

    media.state.auth.accessToken = payload.access_token;
    media.state.auth.user = payload.user || null;
    media.state.auth.profile = payload.profile || null;
    media.state.auth.workspace = payload.workspace || null;
    return true;
  } catch {
    return false;
  }
}

async function bootAuth() {
  const restored = await restoreSession();
  if (restored) await showApp();
  else showAuth('');
}

async function login(event) {
  event.preventDefault();
  const button = $('login-submit');
  button.disabled = true;
  button.textContent = 'Signing in…';
  $('auth-message').textContent = '';

  try {
    const result = await media.api('/api/auth/login', {
      method: 'POST',
      body: {
        email: $('login-email').value,
        password: $('login-password').value
      }
    });

    media.state.auth.accessToken = result.access_token;
    media.state.auth.user = result.user;
    media.state.auth.profile = result.profile;
    media.state.auth.workspace = result.workspace || null;
    $('login-password').value = '';
    await showApp();
  } catch (error) {
    $('auth-message').textContent = error.message;
    $('auth-message').className = 'auth-message error';
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
}

async function register(event) {
  event.preventDefault();
  const button = $('register-submit');
  button.disabled = true;
  button.textContent = 'Creating…';
  $('auth-message').textContent = '';

  try {
    const result = await media.api('/api/auth/register', {
      method: 'POST',
      body: {
        full_name: $('register-name').value,
        email: $('register-email').value,
        password: $('register-password').value,
        registration_code: $('register-code').value
      }
    });

    if (result.requires_verification) {
      const registeredEmail = (result.user && result.user.email) || $('register-email').value;
      setAuthMode('login');
      $('login-email').value = registeredEmail;
      $('auth-message').textContent = result.message || 'Account created. Confirm your email, then sign in.';
      $('auth-message').className = 'auth-message success';
      return;
    }

    media.state.auth.accessToken = result.access_token;
    media.state.auth.user = result.user;
    media.state.auth.profile = result.profile;
    media.state.auth.workspace = result.workspace || null;
    await showApp();
  } catch (error) {
    const message = String(error.message || '');
    if (message.toLowerCase().includes('already registered')) {
      const email = $('register-email').value;
      setAuthMode('login');
      $('login-email').value = email;
      $('auth-message').textContent = 'This account already exists. Sign in with the password you registered.';
      $('auth-message').className = 'auth-message success';
    } else {
      $('auth-message').textContent = message;
      $('auth-message').className = 'auth-message error';
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Create account';
  }
}

async function logout() {
  cancelRecording();
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
  media.state.inbox = { social: [], selected: null, conversation: null };
  localReplies = [];
  clearAttachment();
  showAuth('');
}

function dateLabel(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function inboxThreadRows() {
  const state = media.state;
  const search = (($('inbox-search') && $('inbox-search').value) || '').trim().toLowerCase();
  const rows = [];

    for (const x of state.inbox.social || []) {
      rows.push({
        source: 'social',
        id: x.conversation_id,
        name: x.contact_display_name || x.contact_username || 'Social lead',
        meta: media.platformLabel(x.platform) + ' · @' + (x.account_username || 'account'),
        preview: x.last_message || 'No message preview',
        at: x.last_message_at,
        unread: Number(x.unread_count || 0),
        raw: x
      });
    }

  rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const visible = inboxUnreadOnly && isMobileInbox() ? rows.filter(row => row.unread > 0) : rows;
  if (!search) return visible;

  return visible.filter((x) => [x.name, x.meta, x.preview].filter(Boolean).join(' ').toLowerCase().includes(search));
}

function contactInitials(name) {
  return String(name || '?').replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
}

function renderInboxThreads() {
  const rows = inboxThreadRows();
  const selected = media.state.inbox.selected;

  $('inbox-thread-list').innerHTML = rows.length ? rows.map((row) => {
    const active = selected && selected.source === row.source && String(selected.id) === String(row.id);
    return '<button class="inbox-thread ' + (active ? 'active ' : '') + (row.unread ? 'unread' : '') + '" data-source="' + media.esc(row.source) + '" data-id="' + media.esc(row.id) + '" aria-label="' + media.esc(row.name + (row.unread ? `, ${row.unread} unread message${row.unread === 1 ? '' : 's'}` : '')) + '">' +
      '<span class="inbox-thread-avatar" aria-hidden="true">' + media.esc(contactInitials(row.name)) + '</span><div class="inbox-thread-copy">' +
      '<div class="inbox-thread-top"><strong>' + media.esc(row.name) + '</strong><span>' + dateLabel(row.at) + '</span></div>' +
      '<div class="inbox-thread-meta">' + media.esc(row.meta) + '</div>' +
      '<div class="thread-messaging-state">'+media.esc(eligibilityLabel(row.raw?.messaging_eligibility))+'</div>'+
      '<div class="inbox-thread-preview">' + media.esc(String(row.preview || '').slice(0, 130)) + '</div>' +
      '</div>' +
      (row.unread ? '<b class="thread-unread" aria-hidden="true">' + (row.unread > 1 ? row.unread : '') + '</b>' : '') +
      '</button>';
  }).join('') : '<div class="empty-list">' + ($('inbox-search').value.trim() ? 'No matching conversations.' : inboxUnreadOnly && isMobileInbox() ? 'You’re all caught up. No unread chats.' : 'No conversations yet.') + '</div>';
  $('inbox-unread-threads').textContent = String((media.state.inbox.social || []).filter(row => Number(row.unread_count) > 0).length);

  document.querySelectorAll('.inbox-thread').forEach((button) => {
    button.onclick = () => {
      const row = rows.find((x) => x.source === button.dataset.source && String(x.id) === String(button.dataset.id));
      if (row) openInboxThread(row);
    };
  });
}

async function loadInbox() {
  if (!media || !media.state.auth.accessToken) return;

  try {
    const result = await media.api('/api/inbox?limit=150');

    media.state.inbox.social = result.social || [];
    renderInboxThreads();

    const unread = (media.state.inbox.social || []).reduce((n, x) => n + Number(x.unread_count || 0), 0);
    $('unread-pill').textContent = media.fmt(unread);
    $('unread-pill').hidden = unread === 0;
  } catch (error) {
    $('inbox-thread-list').innerHTML = '<div class="empty-list">' + media.esc(error.message) + '</div>';
  }
}

window.loadAlchemicInbox = loadInbox;

function inboxStateLabel(account) {
  if (account.inbox_state === 'ready') return ['Ready', 'ready'];
  if (account.inbox_state === 'activate') return ['Needs activation', 'activate'];
  if (account.inbox_state === 'reconnect_required') return ['Reconnect required', 'reconnect'];
  return ['Not applicable', 'muted'];
}

function renderInboxChannelHealth(accounts) {
  const host = $('inbox-channel-status');
  const summary = $('inbox-health-summary');
  if (!host || !summary) return;

  const metaAccounts = (accounts || []).filter((a) => ['instagram_reels','facebook_page','facebook'].includes(a.platform));
  const ready = metaAccounts.filter((a) => a.inbox_state === 'ready').length;
  const activate = metaAccounts.filter((a) => a.inbox_state === 'activate').length;
  const reconnect = metaAccounts.filter((a) => a.inbox_state === 'reconnect_required').length;

  summary.textContent = metaAccounts.length
    ? `${ready} ready · ${activate} activate · ${reconnect} reconnect`
    : 'No Meta channels';

  host.innerHTML = metaAccounts.length ? metaAccounts.map((account) => {
    const [label, tone] = inboxStateLabel(account);
    const platform = media.platformLabel(account.platform);
    const lastSync = account.last_inbox_sync_at ? new Date(account.last_inbox_sync_at).toLocaleString() : 'Never synced';
    return `
      <div class="inbox-channel-health-row">
        <div class="inbox-channel-health-main">
          <span class="platform-chip">${media.esc(platform)}</span>
          <strong>@${media.esc(account.username || 'account')}</strong>
          <span class="inbox-health-state ${tone}">${label}</span>
        </div>
        <div class="inbox-channel-health-meta">
          <span>Messaging: ${account.messaging_permission ? 'granted' : 'missing'}</span>
          <span>Webhook: ${media.esc(account.webhook_status || 'not configured')}</span>
          <span>Last sync: ${media.esc(lastSync)}</span>
        </div>
        ${account.inbox_state === 'reconnect_required'
          ? '<button class="text-btn inbox-reconnect" data-id="' + media.esc(account.id) + '" type="button">Reconnect DMs</button>'
          : account.inbox_state === 'activate'
            ? '<button class="text-btn inbox-activate-one" data-id="' + media.esc(account.id) + '" type="button">Activate inbox</button>'
          : account.inbox_state === 'ready' && !account.read_receipts_subscribed
            ? '<button class="text-btn inbox-activate-one" data-id="' + media.esc(account.id) + '" type="button">Enable seen</button>'
          : ''}
      </div>
    `;
  }).join('') : '<div class="empty-list">Connect an Instagram professional account or Facebook Page from Channels first.</div>';

  host.querySelectorAll('.inbox-reconnect').forEach((button) => {
    button.onclick = () => {
      media.setView('accounts');
      window.connectAlchemicChannel?.(button.dataset.id);
    };
  });
  host.querySelectorAll('.inbox-activate-one').forEach((button) => {
    button.onclick = () => activateInboxAccount(button.dataset.id, button);
  });
}

async function activateInboxAccount(id, button = null) {
  if (button) button.disabled = true;
  try {
    await media.api('/api/channels/inbox/activate', { method:'POST', body:{ accountId:id } });
    await loadInboxHealth();
  } catch (error) {
    const message = $('inbox-sync-message');
    message.textContent = error.message;
    message.className = 'connector-message error';
    if (button) button.disabled = false;
  }
}

async function enableReadReceipts(accounts) {
  for (const account of accounts || []) {
    if (account.inbox_state !== 'ready' || account.read_receipts_subscribed || receiptUpgradeAttempted.has(account.id)) continue;
    receiptUpgradeAttempted.add(account.id);
    await activateInboxAccount(account.id);
  }
}

async function loadInboxHealth() {
  if (!media || !media.state.auth.accessToken) return [];
  try {
    const result = await media.api('/api/channels/inbox/activate');
    const accounts = result.accounts || [];
    media.state.inbox.accounts = accounts;
    media.state.inbox.webhook = result.webhook || null;
    renderInboxChannelHealth(accounts);

    const webhookUrl = $('inbox-webhook-url');
    if (webhookUrl) {
      webhookUrl.textContent = result.webhook?.callback_url || 'Webhook URL unavailable';
      webhookUrl.title = [
        result.webhook?.verify_token_configured ? 'Verify token configured' : 'Verify token missing in Netlify',
        result.webhook?.app_secret_configured ? 'App secret configured' : 'App secret missing in Netlify'
      ].join(' · ');
    }
    return accounts;
  } catch (error) {
    const host = $('inbox-channel-status');
    if (host) host.innerHTML = '<div class="empty-list">' + media.esc(error.message) + '</div>';
    return [];
  }
}

async function syncInboxAccounts({ silent = false } = {}) {
  if (inboxBusy || !media?.state?.auth?.accessToken) return;
  inboxBusy = true;

  const syncButton = $('refresh-inbox');
  const message = $('inbox-sync-message');

  if (syncButton) syncButton.disabled = true;
  if (message && !silent) {
    message.textContent = 'Pulling messages from connected inboxes…';
    message.className = 'connector-message';
  }

  try {
    const accounts = await loadInboxHealth();

    const syncable = accounts.filter((account) =>
      ['instagram_reels','facebook_page','facebook'].includes(account.platform) &&
      account.messaging_permission
    );

    let totalInserted = 0;
    let totalConversations = 0;
    const failures = [];

    for (const account of syncable) {
      try {
        const result = await media.api('/api/channels/inbox/sync', {
          method:'POST',
          body:{ accountId: account.id }
        });
        totalInserted += Number(result.messages_inserted || 0);
        totalConversations += Number(result.conversations || 0);
      } catch (error) {
        failures.push('@' + (account.username || 'account') + ': ' + error.message);
      }
    }

    await loadInbox();
    await loadInboxHealth();

    const reconnect = (media.state.inbox.accounts || []).filter((a) => a.inbox_state === 'reconnect_required');

    if (message && !silent) {
      if (failures.length) {
        message.textContent = `Imported ${totalInserted} messages from ${totalConversations} conversations. ${failures.length} account(s) need attention.`;
        message.className = 'connector-message error';
        message.title = failures.join('\n');
      } else if (reconnect.length) {
        message.textContent = `Imported ${totalInserted} messages. ${reconnect.length} account(s) must be reconnected once to grant DM permission.`;
        message.className = 'connector-message error';
      } else {
        message.textContent = `Inbox synced. ${totalInserted} new message${totalInserted === 1 ? '' : 's'} imported.`;
        message.className = 'connector-message success';
      }
    }

    if (!silent && failures.length) console.warn('Inbox sync failures', failures);
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.className = 'connector-message error';
    }
  } finally {
    inboxBusy = false;
    if (syncButton) syncButton.disabled = false;
  }
}

window.loadAlchemicInboxHealth = loadInboxHealth;
window.syncAlchemicInboxes = syncInboxAccounts;

function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'blob:'].includes(url.protocol) ? media.esc(url.href) : '';
  } catch { return ''; }
}

function messageMedia(m) {
  const attachment = m.metadata?.attachment || {};
  const url = safeMediaUrl(m.media_url || attachment.url);
  if (!url) return '';
  const type = m.message_type || attachment.type;
  if (type === 'image') return `<a href="${url}" target="_blank" rel="noopener"><img class="chat-image" src="${url}" alt="Attached photo" loading="lazy"></a>`;
  if (type === 'video') return `<video class="chat-video" controls preload="metadata" src="${url}"></video>`;
  if (type === 'audio') return `<audio class="chat-audio" controls preload="metadata" src="${url}"></audio>`;
  return `<a class="chat-file" href="${url}" target="_blank" rel="noopener">↗ ${media.esc(attachment.name || 'Open attachment')}</a>`;
}

function shortTime(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function messageFallback(m) {
  const labels = { image: 'Photo', video: 'Video', audio: 'Voice message', file: 'File', sticker: 'Sticker', share: 'Shared post' };
  return labels[m.message_type || m.metadata?.attachment?.type] || 'Attachment';
}

function conversationSendState(result = media.state.inbox.conversation || {}) {
  const eligibility=result.messaging_eligibility;
  if(!eligibility) return {mode:'checking',label:'Checking messaging availability…',locked:true,privateReply:false};
  const expired=eligibility.expires_at && Date.parse(eligibility.expires_at)<=Date.now();
  const human=eligibility.state==='HUMAN_AGENT' && !expired && $('human-support-reply')?.checked;
  return {mode:eligibility.reply_mode || 'waiting',label:eligibilityLabel(eligibility),
    locked:(!eligibility.can_send && !human) || expired,privateReply:eligibility.reply_mode==='private_reply'};
}

function updateComposerState(result = media.state.inbox.conversation || {}) {
  const state=conversationSendState(result);
  const note=$('conversation-mode-note');
  const input=$('conversation-reply-body');
  const submit=$('conversation-reply-submit');
  const file=$('composer-file-button');
  const record=$('composer-record-button');

  if(note){note.textContent=state.label;note.dataset.state=result.messaging_eligibility?.state||'CHECKING';}
  if($('human-support-option')) $('human-support-option').hidden=result.messaging_eligibility?.state!=='HUMAN_AGENT';
  const link=$('conversation-native-link');
  const username=result.conversation?.contact_username;
  if(link){
    const platform=result.conversation?.platform;
    const tiktok=['tiktok','tiktok_video'].includes(platform);
    const validName=username && /^[a-z0-9._]+$/i.test(username);
    link.hidden=platform!=='instagram_reels'&&!tiktok;
    link.href=tiktok?(validName?'https://www.tiktok.com/@'+encodeURIComponent(username):'https://www.tiktok.com/messages')
      :(validName?'https://www.instagram.com/'+encodeURIComponent(username)+'/':'https://www.instagram.com/direct/inbox/');
    link.textContent=(validName?'Open @'+username:'Open inbox')+' in '+(tiktok?'TikTok':'Instagram');
  }
  if(input){
    input.disabled=false;
    input.placeholder=state.locked?'Waiting for their next message…':state.privateReply?'Private reply to comment…':'Message…';
  }
  if(submit) submit.disabled=state.locked||replyBusy;
  if(file) file.disabled=state.locked||state.privateReply;
  if(record) record.disabled=state.locked||state.privateReply;

  return state;
}

function renderConversation(forceScroll = false) {
  const result = media.state.inbox.conversation || {};
  updateComposerState(result);
  const deliveredIds = new Set((result.messages || []).filter((m) => m.direction === 'outbound' && m.platform_message_id).map((m) => m.platform_message_id));
  const sendState=conversationSendState(result);
  const outbox = (result.outbox || []).filter((m) => m.status !== 'sent' || !m.platform_message_id || !deliveredIds.has(m.platform_message_id));
  const remoteIds = new Set((result.outbox || []).map((m) => m.id));
  localReplies = localReplies.filter((m) => !m.outboxId || !remoteIds.has(m.outboxId));
  const messages = [
    ...(result.messages || []).map((m) => ({ ...m, _time: m.sent_at || m.created_at, _kind: 'message' })),
    ...outbox.map((m) => ({ ...m, direction: 'outbound', _time: m.sent_at || m.queued_at, _kind: 'outbox' })),
    ...localReplies,
  ].sort((a, b) => new Date(a._time || 0) - new Date(b._time || 0));
  const signature = sendState.locked + ':' + JSON.stringify(messages.map((m) => [m.id, m.platform_message_id, m.status, m.delivery_status, m.last_error, m.media_url, m.body]));
  if (signature === conversationSignature && !forceScroll) return;
  conversationSignature = signature;
  const box = $('conversation-messages');
  const atBottom = forceScroll || box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  const oldTop = box.scrollTop;
  let lastDay = '';
  box.innerHTML = messages.length ? messages.map((m) => {
    const day = m._time ? new Date(m._time).toDateString() : '';
    const divider = day && day !== lastDay ? `<div class="chat-day">${media.esc(new Date(m._time).toLocaleDateString(undefined, { month:'short', day:'numeric' }))}</div>` : '';
    lastDay = day;
    const stateText = m.delivery_status || m.status || '';
    const queued = m._kind !== 'message' && m.status !== 'sent';
    const mediaMarkup = messageMedia(m);
    const body = m.body === 'Attachment' ? messageFallback(m) : m.body;
    const text = body && (!mediaMarkup || !String(body).startsWith('[')) ? `<div class="message-text">${media.esc(body)}</div>` : '';
    const outbound = m.direction === 'outbound';
    const status = outbound ? (stateText === 'read' || stateText === 'seen' ? 'Seen' : ['sent','delivered'].includes(stateText) ? 'Sent' : stateText === 'uploading' ? 'Uploading' : stateText === 'sending' ? 'Sending' : stateText === 'failed' ? 'Failed' : 'Pending') : '';
    const mark = status === 'Seen' ? '✓✓' : status === 'Sent' ? '✓' : status === 'Failed' ? '!' : '…';
    return `${divider}<div class="message-bubble ${outbound ? 'outbound' : 'inbound'} ${queued ? 'queued' : ''}">
      ${mediaMarkup}${text || (!mediaMarkup ? `<div class="message-text">${messageFallback(m)}</div>` : '')}
      <small class="message-meta"><time title="${media.esc(m._time ? new Date(m._time).toLocaleString() : '')}">${media.esc(shortTime(m._time))}</time>${outbound ? `<span class="message-check" title="${status}" aria-label="${status}">${status === 'Failed' ? 'Failed · Not delivered' : mark}</span>` : ''}</small>
      ${m.last_error ? `<small class="delivery-error">Delivery error: ${media.esc(m.last_error)}</small>` : ''}
      ${m._kind === 'outbox' && !sendState.locked && ['pending', 'failed'].includes(m.status) ? `<button class="text-btn outbox-send-now" data-id="${media.esc(m.id)}" type="button">${m.status === 'failed' ? 'Retry' : 'Send now'}</button>` : ''}
    </div>`;
  }).join('') : '<div class="empty-list">No messages in this conversation yet.</div>';
  requestAnimationFrame(() => { box.scrollTop = atBottom ? box.scrollHeight : oldTop; });
}

async function refreshConversation() {
  const selected = media.state.inbox.selected;
  if (!selected || media.state.view !== 'inbox' || !document.querySelector('.inbox-layout')?.classList.contains('show-thread')) return;
  if (conversationFetch) return conversationFetch;
  const id = selected.id;
  conversationFetch = (async () => {
    try {
      const result = await media.api('/api/conversation?id=' + encodeURIComponent(id));
      if (media.state.inbox.selected?.id !== id || media.state.view !== 'inbox' || !document.querySelector('.inbox-layout')?.classList.contains('show-thread')) return;
      media.state.inbox.conversation = result;
      $('conversation-lead-status').value = result.conversation?.lead_status || 'new';
      updateComposerState(result);
      renderConversation();
      const unreadCount = Number(result.conversation?.unread_count || 0);
      if (unreadCount > 0 && result.conversation?.last_inbound_at) {
        const read = await media.api('/api/conversation?id=' + encodeURIComponent(id), {
          method: 'POST', body: { unreadCount, lastInboundAt: result.conversation.last_inbound_at }
        });
        if (read.marked_read) loadInbox();
      }
    } catch (error) {
      if (!media.state.inbox.conversation && media.state.inbox.selected?.id === id) $('conversation-messages').innerHTML = `<div class="empty-list">${media.esc(error.message)}</div>`;
      // Keep the loaded conversation visible through a transient poll failure.
    }
  })();
  try { await conversationFetch; } finally { conversationFetch = null; }
}

async function openInboxThread(row) {
  if ($('inbox-messages-panel').hidden) $('inbox-messages-tab').click();
  const switching = String(media.state.inbox.selected?.id) !== String(row.id);
  media.state.inbox.selected = row;
  if (switching) {
    cancelRecording();
    media.state.inbox.conversation = null;
    conversationSignature = '';
    localReplies = [];
    clearAttachment();
    $('conversation-reply-body').value = '';
    $('human-support-reply').checked=false;
    resizeComposer();
    $('conversation-messages').innerHTML = '<div class="empty-list">Loading conversation…</div>';
  }
  renderInboxThreads();
  document.querySelector('.inbox-layout').classList.add('show-thread');
  $('inbox-empty').hidden = true;
  $('inbox-conversation-wrap').hidden = false;
  $('conversation-contact-name').textContent = row.name;
  $('conversation-contact-meta').textContent = row.meta;
  $('conversation-avatar').textContent = contactInitials(row.name);
  openMobileThread(row.id);
  if (conversationFetch) await conversationFetch;
  await refreshConversation();
  loadInbox();
}

window.openAlchemicConversation = async (id, lead = null) => {
  media.setView('inbox');
  await loadInbox();
  const row = inboxThreadRows().find((item) => String(item.id) === String(id)) || (lead ? {
    source: 'social', id, name: lead.contact_display_name || lead.contact_username || 'Social lead',
    meta: media.platformLabel(lead.platform) + ' · @' + (lead.account_username || 'account'),
    preview: lead.last_message, at: lead.last_message_at,
  } : null);
  if (row) await openInboxThread(row);
  else $('inbox-sync-message').textContent = 'This conversation is not in the current inbox list.';
};

function clearAttachment() {
  if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
  pendingAttachment = null;
  if ($('composer-file-input')) $('composer-file-input').value = '';
  if ($('composer-attachment')) { $('composer-attachment').hidden = true; $('composer-attachment').innerHTML = ''; }
}

function stageAttachment(file) {
  $('composer-error').textContent = '';
  if (!file) return;
  if (!['image/jpeg','image/png','video/mp4','audio/mp4','audio/wav','audio/x-wav','application/pdf'].includes(file.type)) {
    $('composer-error').textContent = 'Use a JPEG or PNG photo, MP4 video, M4A or WAV audio, or PDF file.';
    return;
  }
  if (file.size > 4 * 1024 * 1024) { $('composer-error').textContent = 'Choose a file smaller than 4 MB.'; return; }
  clearAttachment();
  pendingAttachment = { file, previewUrl: URL.createObjectURL(file) };
  const preview = file.type.startsWith('audio/') ? `<audio controls src="${safeMediaUrl(pendingAttachment.previewUrl)}"></audio>` : '';
  $('composer-attachment').innerHTML = `<span>📎 ${media.esc(file.name)} · sends separately from text</span>${preview}<button class="text-btn" type="button" id="composer-remove-file">Remove</button>`;
  $('composer-attachment').hidden = false;
  $('composer-remove-file').onclick = clearAttachment;
}

async function uploadAttachment(file, conversationId) {
  const form = new FormData();
  form.append('conversationId', conversationId);
  form.append('file', file);
  const response = await fetch('/api/social/media/upload', {
    method: 'POST', credentials: 'same-origin',
    headers: { authorization: `Bearer ${media.state.auth.accessToken}` }, body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not upload the attachment.');
  return result;
}

function setReplyButtonLabel(text) {
  const button = $('conversation-reply-submit');
  button.querySelector('.composer-send-label').textContent = text;
  button.setAttribute('aria-label', text === 'Send' ? 'Send message' : text);
  button.setAttribute('aria-busy', String(text !== 'Send'));
}

async function sendReply(event) {
  event.preventDefault();
  const selected = media.state.inbox.selected;
  if (!selected || selected.source !== 'social') return;
  const body = $('conversation-reply-body').value.trim();
  const attachment = pendingAttachment;
  const sendState=conversationSendState();
  if(sendState.locked){
    $('composer-error').textContent=sendState.label;
    return;
  }
  if(sendState.privateReply&&attachment){
    $('composer-error').textContent='The first comment-to-DM reply must be text. Send text first; attachments unlock after they reply.';
    return;
  }
  if (!body && !attachment) return;
  const button = $('conversation-reply-submit');
  if (button.disabled) return;
  replyBusy=true;
  button.disabled = true;
  $('composer-error').textContent = '';
  const local = {
    id: `local-${Date.now()}`, direction: 'outbound', body: attachment ? `[${attachment.file.name}]` : body,
    message_type: attachment?.file.type.split('/')[0] || 'text',
    media_url: attachment?.previewUrl || null,
    status: attachment ? 'uploading' : 'sending', _kind: 'local', _time: new Date().toISOString(),
  };
  localReplies.push(local);
  renderConversation(true);
  if (!attachment) { $('conversation-reply-body').value = ''; resizeComposer(); }
  try {
    let uploaded;
    if (attachment) {
      setReplyButtonLabel('Uploading…');
      uploaded = await uploadAttachment(attachment.file, selected.id);
      local.media_url = uploaded.url;
      local.message_type = uploaded.type;
      local.status = 'sending';
      if (media.state.inbox.selected?.id === selected.id) renderConversation(true);
    }
    setReplyButtonLabel('Sending…');
    const result = await media.api('/api/social/reply', {
      method: 'POST', body: { conversationId: selected.id, body: attachment ? '' : body,
        purpose:$('human-support-reply').checked?'human_support':'conversation',
        ...(uploaded ? { attachment: { storagePath: uploaded.storagePath, type: uploaded.type, name: uploaded.name } } : {}) },
    });
    local.outboxId = result.outbox?.id;
    local.status = result.delivery?.status || (result.sent ? 'sent' : 'pending');
    local.last_error = result.delivery?.error || '';
    if (media.state.inbox.selected?.id === selected.id) renderConversation(true);
    if (attachment && media.state.inbox.selected?.id === selected.id && pendingAttachment === attachment) clearAttachment();
    if (local.last_error && media.state.inbox.selected?.id === selected.id) $('composer-error').textContent = local.last_error;
    await refreshConversation();
    loadInbox();
  } catch (error) {
    localReplies = localReplies.filter((item) => item !== local);
    if (media.state.inbox.selected?.id === selected.id) renderConversation();
    if (!attachment && media.state.inbox.selected?.id === selected.id) { $('conversation-reply-body').value = body; resizeComposer(); }
    if (media.state.inbox.selected?.id === selected.id) $('composer-error').textContent = error.message;
  } finally {
    replyBusy=false;
    setReplyButtonLabel('Send');
    updateComposerState();
    $('conversation-reply-body').focus();
  }
}

async function changeLeadStatus() {
  const selected = media.state.inbox.selected;
  if (!selected || selected.source !== 'social') return;

  try {
    await media.api('/api/social/lead-status', {
      method: 'POST',
      body: {
        conversationId: selected.id,
        status: $('conversation-lead-status').value
      }
    });
    await loadInbox();
    window.loadAlchemicLeads?.();
  } catch (error) {
    alert(error.message);
  }
}

async function toggleRecording() {
  const button = $('composer-record-button');
  if (recordingSession) {
    const session = recordingSession;
    recordingSession = null;
    await session.stop();
    button.textContent = '🎙';
    button.classList.remove('recording');
    clearTimeout(recordingTimer);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    $('composer-error').textContent = 'Voice recording is not available in this browser.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (window.MediaRecorder?.isTypeSupported('audio/mp4')) {
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/mp4' });
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.start();
      recordingSession = { cancel: () => {
        recorder.onstop = null;
        if (recorder.state === 'recording') recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
      }, stop: () => new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          stageAttachment(new File(chunks, 'Voice message.m4a', { type: 'audio/mp4' }));
          resolve();
        };
        recorder.stop();
      }) };
    } else {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Voice recording is unavailable in this browser.'); }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const samples = [];
      let frames = 0;
      processor.onaudioprocess = (event) => {
        const sample = new Float32Array(event.inputBuffer.getChannelData(0));
        samples.push(sample);
        frames += sample.length;
      };
      source.connect(processor);
      processor.connect(context.destination);
      recordingSession = { cancel: () => {
        processor.disconnect(); source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        context.close();
      }, stop: async () => {
        processor.disconnect(); source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        const bytes = new ArrayBuffer(44 + frames * 2);
        const view = new DataView(bytes);
        const write = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
        write(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, context.sampleRate, true); view.setUint32(28, context.sampleRate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, frames * 2, true);
        let offset = 44;
        for (const chunk of samples) for (const sample of chunk) {
          const clipped = Math.max(-1, Math.min(1, sample));
          view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
          offset += 2;
        }
        stageAttachment(new File([bytes], 'Voice message.wav', { type: 'audio/wav' }));
      } };
    }
    button.textContent = '■ Stop';
    button.classList.add('recording');
    $('composer-error').textContent = 'Recording… press Stop when finished.';
    recordingTimer = setTimeout(() => { if (recordingSession) toggleRecording(); }, 30000);
  } catch (error) {
    $('composer-error').textContent = error.message || 'Microphone permission was denied.';
  }
}

function cancelRecording() {
  if (!recordingSession) return;
  recordingSession.cancel();
  recordingSession = null;
  clearTimeout(recordingTimer);
  const button = $('composer-record-button');
  if (button) { button.textContent = '🎙'; button.classList.remove('recording'); }
}

const emojis = ['😀', '😊', '😂', '❤️', '👍', '🙌', '🔥', '✨', '🎉', '🙏', '👋', '😍', '💯', '🤝', '💬', '✅'];
function insertEmoji(value) {
  const input = $('conversation-reply-body');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.slice(0, start) + value + input.value.slice(end);
  input.focus();
  input.setSelectionRange(start + value.length, start + value.length);
  resizeComposer();
  $('composer-emoji-picker').hidden = true;
}

function resizeComposer() {
  const input = $('conversation-reply-body');
  input.style.height = 'auto';
  input.style.height = `${Math.min(96, Math.max(42, input.scrollHeight))}px`;
}

function bindUi() {
  initMobileInbox(() => { if (media) renderInboxThreads(); });
  $('auth-tab-login').addEventListener('click', () => setAuthMode('login'));
  $('auth-tab-register').addEventListener('click', () => setAuthMode('register'));
  $('login-form').addEventListener('submit', login);
  $('register-form').addEventListener('submit', register);

  $('logout-button').addEventListener('click', logout);
  $('user-menu-button').addEventListener('click', () => {
    $('user-menu-popover').hidden = !$('user-menu-popover').hidden;
  });

  $('human-support-reply').addEventListener('change',()=>updateComposerState());
  $('refresh-inbox').addEventListener('click', () => syncInboxAccounts({ silent:false }));
  $('inbox-search').addEventListener('input', renderInboxThreads);
  $('conversation-reply-form').addEventListener('submit', sendReply);
  $('conversation-lead-status').addEventListener('change', changeLeadStatus);
  $('conversation-back').addEventListener('click', closeMobileThread);
  for (const [id, unreadOnly] of [['inbox-filter-all', false], ['inbox-filter-unread', true]]) {
    $(id).addEventListener('click', () => {
      inboxUnreadOnly = unreadOnly;
      for (const [buttonId, selected] of [['inbox-filter-all', !unreadOnly], ['inbox-filter-unread', unreadOnly]]) {
        $(buttonId).classList.toggle('active', selected);
        $(buttonId).setAttribute('aria-pressed', String(selected));
      }
      renderInboxThreads();
    });
  }
  $('conversation-messages').addEventListener('click', async (event) => {
    const button = event.target.closest('.outbox-send-now');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const delivery = await media.api('/api/social/outbox/send', { method: 'POST', body: { outboxId: button.dataset.id } });
      if (delivery.error) $('composer-error').textContent = delivery.error;
      await refreshConversation();
      loadInbox();
    } catch (error) {
      $('composer-error').textContent = error.message;
      button.disabled = false;
      button.textContent = 'Retry';
    }
  });
  $('conversation-reply-body').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !isMobileInbox()) {
      event.preventDefault();
      $('conversation-reply-form').requestSubmit();
    }
  });
  $('conversation-reply-body').addEventListener('input', resizeComposer);
  $('composer-file-button').addEventListener('click', () => $('composer-file-input').click());
  $('composer-file-input').addEventListener('change', (event) => stageAttachment(event.target.files[0]));
  $('composer-record-button').addEventListener('click', toggleRecording);
  $('composer-emoji-picker').innerHTML = emojis.map((emoji) => `<button type="button" aria-label="Insert ${emoji}">${emoji}</button>`).join('');
  $('composer-emoji-button').addEventListener('click', () => { $('composer-emoji-picker').hidden = !$('composer-emoji-picker').hidden; });
  $('composer-emoji-picker').addEventListener('click', (event) => { if (event.target.closest('button')) insertEmoji(event.target.textContent); });

  document.querySelectorAll('.nav-item[data-view="inbox"]').forEach((button) => {
    button.addEventListener('click', () => {
      loadInbox();
      loadInboxHealth();
      setTimeout(() => syncInboxAccounts({ silent:true }), 250);
    });
  });
}

setInterval(() => {
  if (!media?.state.auth.accessToken || document.hidden || media.state.view !== 'inbox') return;
  if (media.state.inbox.selected && document.querySelector('.inbox-layout')?.classList.contains('show-thread')) {updateComposerState();refreshConversation();}
}, 3500);
setInterval(() => {
  if (!media?.state.auth.accessToken || document.hidden) return;
  loadInbox();
  if (media.state.view === 'leads') window.loadAlchemicLeads?.();
}, 10000);

document.addEventListener('click', (event) => {
  const menu = $('user-menu-popover');
  const button = $('user-menu-button');
  if (!menu || menu.hidden) return;
  if (!menu.contains(event.target) && !button.contains(event.target)) menu.hidden = true;
});

bindUi();
waitForMedia();
