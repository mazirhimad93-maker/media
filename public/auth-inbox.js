const $ = (id) => document.getElementById(id);

let media = null;
let inboxBusy = false;

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
  await loadInboxHealth();
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
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
  media.state.inbox = { social: [], selected: null, conversation: null };
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
  if (!search) return rows;

  return rows.filter((x) => [x.name, x.meta, x.preview].filter(Boolean).join(' ').toLowerCase().includes(search));
}

function renderInboxThreads() {
  const rows = inboxThreadRows();
  const selected = media.state.inbox.selected;

  $('inbox-thread-list').innerHTML = rows.length ? rows.map((row) => {
    const active = selected && selected.source === row.source && String(selected.id) === String(row.id);
    return '<button class="inbox-thread ' + (active ? 'active' : '') + '" data-source="' + media.esc(row.source) + '" data-id="' + media.esc(row.id) + '">' +
      '<div class="inbox-thread-top"><strong>' + media.esc(row.name) + '</strong><span>' + dateLabel(row.at) + '</span></div>' +
      '<div class="inbox-thread-meta">' + media.esc(row.meta) + '</div>' +
      '<div class="inbox-thread-preview">' + media.esc(String(row.preview || '').slice(0, 130)) + '</div>' +
      (row.unread ? '<b class="thread-unread">' + row.unread + '</b>' : '') +
      '</button>';
  }).join('') : '<div class="empty-list">No conversations yet.</div>';

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

async function syncInboxAccounts({ activate = false, silent = false } = {}) {
  if (inboxBusy || !media?.state?.auth?.accessToken) return;
  inboxBusy = true;

  const activateButton = $('configure-inboxes');
  const syncButton = $('refresh-inbox');
  const message = $('inbox-sync-message');

  if (activateButton) activateButton.disabled = true;
  if (syncButton) syncButton.disabled = true;
  if (message) {
    message.textContent = activate ? 'Activating connected inboxes…' : 'Pulling messages from connected inboxes…';
    message.className = 'connector-message';
  }

  try {
    let accounts = await loadInboxHealth();

    if (activate) {
      for (const account of accounts) {
        if (!['instagram_reels','facebook_page','facebook'].includes(account.platform)) continue;
        if (account.inbox_state !== 'activate') continue;

        try {
          await media.api('/api/channels/inbox/activate', {
            method:'POST',
            body:{ accountId: account.id }
          });
        } catch (error) {
          account.activation_error = error.message;
        }
      }
      accounts = await loadInboxHealth();
    }

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

    if (message) {
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
    if (activateButton) activateButton.disabled = false;
    if (syncButton) syncButton.disabled = false;
  }
}

window.loadAlchemicInboxHealth = loadInboxHealth;
window.syncAlchemicInboxes = syncInboxAccounts;

async function openInboxThread(row) {
  media.state.inbox.selected = row;
  renderInboxThreads();

  $('conversation-lead-status').hidden = false;
  $('conversation-reply-form').hidden = false;
  $('inbox-empty').hidden = true;
  $('inbox-conversation-wrap').hidden = false;
  $('conversation-contact-name').textContent = row.name;
  $('conversation-contact-meta').textContent = row.meta;
  $('conversation-messages').innerHTML = '<div class="empty-list">Loading conversation…</div>';

  try {
    const result = await media.api('/api/conversation?id=' + encodeURIComponent(row.id));
    media.state.inbox.conversation = result;
    const conversation = result.conversation || {};
    $('conversation-lead-status').value = conversation.lead_status || 'new';

    const messages = []
      .concat((result.messages || []).map((m) => Object.assign({}, m, { _time: m.sent_at || m.created_at, _kind: 'message' })))
      .concat((result.outbox || []).map((m) => Object.assign({}, m, { direction: 'outbound', _time: m.sent_at || m.queued_at, _kind: 'outbox' })))
      .sort((a, b) => new Date(a._time || 0) - new Date(b._time || 0));

    $('conversation-messages').innerHTML = messages.length ? messages.map((m) => {
      const stateText = m.delivery_status || m.status || '';
      const queued = m._kind === 'outbox' && m.status !== 'sent';
      return '<div class="message-bubble ' + (m.direction === 'outbound' ? 'outbound' : 'inbound') + ' ' + (queued ? 'queued' : '') + '">' +
        '<div>' + media.esc(m.body || '') + '</div>' +
        '<small>' + (m._time ? new Date(m._time).toLocaleString() : '') + (stateText ? ' · ' + media.esc(stateText) : '') + '</small>' +
        '</div>';
    }).join('') : '<div class="empty-list">No messages in this conversation yet.</div>';

    requestAnimationFrame(() => {
      const box = $('conversation-messages');
      box.scrollTop = box.scrollHeight;
    });

    await loadInbox();
  } catch (error) {
    $('conversation-messages').innerHTML = '<div class="empty-list">' + media.esc(error.message) + '</div>';
  }
}

async function sendReply(event) {
  event.preventDefault();
  const selected = media.state.inbox.selected;
  if (!selected || selected.source !== 'social') return;

  const body = $('conversation-reply-body').value.trim();
  if (!body) return;

  const button = $('conversation-reply-submit');
  button.disabled = true;
  button.textContent = 'Queuing…';

  try {
    await media.api('/api/social/reply', {
      method: 'POST',
      body: { conversationId: selected.id, body: body }
    });
    $('conversation-reply-body').value = '';
    await openInboxThread(selected);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Send reply';
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
  } catch (error) {
    alert(error.message);
  }
}

function bindUi() {
  $('auth-tab-login').addEventListener('click', () => setAuthMode('login'));
  $('auth-tab-register').addEventListener('click', () => setAuthMode('register'));
  $('login-form').addEventListener('submit', login);
  $('register-form').addEventListener('submit', register);

  $('logout-button').addEventListener('click', logout);
  $('user-menu-button').addEventListener('click', () => {
    $('user-menu-popover').hidden = !$('user-menu-popover').hidden;
  });

  $('refresh-inbox').addEventListener('click', () => syncInboxAccounts({ activate:false, silent:false }));
  $('configure-inboxes').addEventListener('click', () => syncInboxAccounts({ activate:true, silent:false }));
  $('inbox-search').addEventListener('input', renderInboxThreads);
  $('conversation-reply-form').addEventListener('submit', sendReply);
  $('conversation-lead-status').addEventListener('change', changeLeadStatus);

  document.querySelectorAll('.nav-item[data-view="inbox"]').forEach((button) => {
    button.addEventListener('click', () => {
      loadInbox();
      loadInboxHealth();
      setTimeout(() => syncInboxAccounts({ activate:false, silent:true }), 250);
    });
  });
}

document.addEventListener('click', (event) => {
  const menu = $('user-menu-popover');
  const button = $('user-menu-button');
  if (!menu || menu.hidden) return;
  if (!menu.contains(event.target) && !button.contains(event.target)) menu.hidden = true;
});

bindUi();
waitForMedia();
