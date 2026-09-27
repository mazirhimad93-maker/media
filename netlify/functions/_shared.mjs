import crypto from 'node:crypto';

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

export const clampInt = (value, min, max, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

export const htmlResponse = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
});

export const publicError = (error, status = 500) => {
  console.error(error);
  return jsonResponse({ error: status >= 500 ? 'The Social Hub could not complete this request.' : error.message }, status);
};

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export function requireAdmin(request) {
  const supplied = request.headers.get('x-connector-admin-token') || request.headers.get('x-social-hub-token') || '';
  if (!safeEqual(supplied, required('CONNECTOR_ADMIN_TOKEN'))) {
    const error = new Error('Invalid Social Hub admin token');
    error.status = 401;
    throw error;
  }
}

export function verifyMetaSignature(rawBody, signatureHeader) {
  const secret = process.env.INSTAGRAM_APP_SECRET?.trim();
  if (!secret) return true;
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(signatureHeader, expected);
}

const b64url = (value) => Buffer.from(value).toString('base64url');
const unb64url = (value) => Buffer.from(value, 'base64url').toString('utf8');

export function signOAuthState(payload) {
  const body = b64url(JSON.stringify({ ...payload, issuedAt: Date.now() }));
  const signature = crypto.createHmac('sha256', required('OAUTH_STATE_SECRET')).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyOAuthState(state, expectedProvider) {
  const [body, signature, extra] = String(state || '').split('.');
  if (!body || !signature || extra) throw new Error('Invalid OAuth state');
  const expected = crypto.createHmac('sha256', required('OAUTH_STATE_SECRET')).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) throw new Error('Invalid OAuth state signature');
  const payload = JSON.parse(unb64url(body));
  if (payload.provider !== expectedProvider) throw new Error('OAuth provider mismatch');
  if (!payload.issuedAt || Date.now() - payload.issuedAt > 10 * 60 * 1000) throw new Error('OAuth state expired. Start the connection again.');
  return payload;
}

export function connectorOrigin(request) {
  // Use the deployment that initiated OAuth. This prevents stale Netlify
  // CONNECTOR_PUBLIC_URL values from sending callbacks to an older site.
  return new URL(request.url).origin.replace(/\/$/, '');
}

export function callbacks(request) {
  const origin = connectorOrigin(request);
  return {
    youtube: `${origin}/oauth/youtube/callback`,
    instagram: `${origin}/oauth/instagram/callback`,
    metaWebhook: `${origin}/api/meta/webhook`,
  };
}

export const providerConfig = () => ({
  youtube: { ready: Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()) },
  instagram: { ready: Boolean(process.env.INSTAGRAM_APP_ID?.trim() && process.env.INSTAGRAM_APP_SECRET?.trim()) },
  outreachBridge: { ready: Boolean(process.env.OUTREACH_SUPABASE_URL?.trim() && process.env.OUTREACH_SUPABASE_SERVICE_ROLE_KEY?.trim()) },
});

async function restRequest(base, key, path, { method = 'GET', body, headers = {} } = {}) {
  const normalizedKey = String(key || '').trim();
  if (normalizedKey.startsWith('sb_publishable_')) {
    const error = new Error('This backend needs a Supabase secret key or legacy service_role key, not a publishable key.');
    error.status = 401;
    throw error;
  }

  // Supabase's new sb_secret_* keys are opaque API keys, not JWTs.
  // They must be sent in the apikey header and must NOT be sent as Bearer tokens.
  // Legacy service_role keys are JWTs and can still be sent as both apikey + Bearer.
  const authHeaders = {
    apikey: normalizedKey,
    'content-type': 'application/json',
  };
  if (!normalizedKey.startsWith('sb_secret_')) {
    authHeaders.authorization = `Bearer ${normalizedKey}`;
  }

  const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: {
      ...authHeaders,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Supabase request failed (${response.status})`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function supabaseRequest(path, options = {}) {
  return restRequest(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), path, options);
}

export async function outreachRequest(path, options = {}) {
  const base = process.env.OUTREACH_SUPABASE_URL?.trim();
  const key = process.env.OUTREACH_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !key) return null;
  if ((options.method || 'GET').toUpperCase() !== 'GET') throw new Error('Outreach bridge is read-only by design');
  return restRequest(base, key, path, options);
}

export async function rpc(name, body = {}) {
  return supabaseRequest(`rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    body,
    headers: { Prefer: 'return=representation' },
  });
}

export async function resolveCampaignPool({ campaignId, requestedPoolId }) {
  if (!campaignId) return { campaign: null, pool: null };
  const campaigns = await supabaseRequest(`content_campaigns?id=eq.${encodeURIComponent(campaignId)}&select=id,name,status,distribution_pool_id&limit=1`);
  const campaign = campaigns?.[0];
  if (!campaign) throw new Error('The selected content campaign does not exist');

  let poolId = requestedPoolId || campaign.distribution_pool_id;
  if (poolId) {
    const pools = await supabaseRequest(`content_distribution_pools?id=eq.${encodeURIComponent(poolId)}&status=eq.active&select=id,name&limit=1`);
    if (!pools?.[0]) throw new Error('The selected distribution pool is not active');
    if (campaign.distribution_pool_id !== poolId) {
      await supabaseRequest(`content_campaigns?id=eq.${encodeURIComponent(campaign.id)}`, {
        method: 'PATCH', body: { distribution_pool_id: poolId, updated_at: new Date().toISOString() },
      });
    }
    return { campaign, pool: pools[0] };
  }

  const baseSlug = `${campaign.name || 'campaign'}-channels`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const created = await supabaseRequest('content_distribution_pools', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { name: `${campaign.name} Channels`, slug: `${baseSlug}-${campaign.id.slice(0, 8)}`, strict_isolation: true, distribution_mode: 'rotation', status: 'active' },
  });
  const pool = created?.[0];
  await supabaseRequest(`content_campaigns?id=eq.${encodeURIComponent(campaign.id)}`, {
    method: 'PATCH', body: { distribution_pool_id: pool.id, updated_at: new Date().toISOString() },
  });
  return { campaign: { ...campaign, distribution_pool_id: pool.id }, pool };
}

export async function upsertConnectedAccount(account, assignment = {}) {
  const existingRows = await supabaseRequest(`content_accounts?platform=eq.${encodeURIComponent(account.platform)}&platform_account_id=eq.${encodeURIComponent(account.platform_account_id)}&select=*&limit=1`);
  const existing = existingRows?.[0] || {};
  const payload = {
    ...account,
    settings_json: { ...(existing.settings_json || {}), ...(account.settings_json || {}) },
    metadata: { ...(existing.metadata || {}), ...(account.metadata || {}), connector_managed: true },
    capabilities_json: { ...(existing.capabilities_json || {}), ...(account.capabilities_json || {}) },
    updated_at: new Date().toISOString(),
  };
  if (!payload.refresh_token && existing.refresh_token) payload.refresh_token = existing.refresh_token;

  const rows = await supabaseRequest('content_accounts?on_conflict=platform,platform_account_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: payload,
  });
  const saved = rows?.[0];
  if (!saved) throw new Error('Supabase did not return the connected account');

  const { campaign, pool } = await resolveCampaignPool(assignment);
  if (pool) {
    await supabaseRequest(`content_distribution_pool_accounts?account_id=eq.${encodeURIComponent(saved.id)}&is_active=eq.true`, {
      method: 'PATCH', body: { is_active: false, updated_at: new Date().toISOString() },
    }).catch(() => {});
    await supabaseRequest('content_distribution_pool_accounts?on_conflict=pool_id,account_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { pool_id: pool.id, account_id: saved.id, priority: 100, weight: 1, is_active: true, updated_at: new Date().toISOString() },
    });
  }

  await supabaseRequest('content_history', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      campaign_id: campaign?.id || null,
      account_id: saved.id,
      platform: saved.platform,
      event_type: 'account_connected',
      message: `${saved.username || saved.platform_account_id} connected through OAuth`,
      response_json: { pool_id: pool?.id || null, provider: assignment.provider || account.metadata?.oauth_provider || null },
    },
  }).catch(() => {});
  return { saved, campaign, pool };
}

export const assignmentFromState = (state) => ({
  campaignId: state.campaignId || null,
  requestedPoolId: state.poolId || null,
  provider: state.provider,
});

export function successPage({ title, message, accounts = [] }) {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const list = accounts.map((x) => `<li><strong>${esc(x.username || x.display_name || x.platform_account_id)}</strong><span>${esc(x.platform || '')}</span></li>`).join('');
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)}</title>
      <style>
        *{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#111827;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;padding:18px}
        .card{width:min(520px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;box-shadow:0 16px 50px rgba(15,23,42,.08)}
        .logo{width:42px;height:42px;border-radius:11px;background:#2563eb;color:#fff;display:grid;place-items:center;font-weight:800;margin-bottom:18px}
        .eyebrow{font-size:10px;font-weight:800;letter-spacing:.08em;color:#2563eb}.card h1{font-size:22px;margin:7px 0 8px}.card p{font-size:12px;line-height:1.55;color:#64748b}
        ul{list-style:none;padding:0;margin:16px 0;display:grid;gap:7px}li{border:1px solid #e5e7eb;border-radius:9px;padding:10px 11px;display:flex;justify-content:space-between;gap:10px;font-size:11px}li span{color:#64748b}
        a{display:block;background:#2563eb;color:#fff;text-decoration:none;text-align:center;border-radius:9px;padding:11px 14px;font-size:12px;font-weight:700;margin-top:18px}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">A</div>
        <div class="eyebrow">ALCHEMIC MEDIA</div>
        <h1>${esc(title)}</h1>
        <p>${esc(message)}</p>
        ${list ? `<ul>${list}</ul>` : ''}
        <a href="/?view=accounts">Return to Channels</a>
      </div>
    </body>
  </html>`;
}

export const hashIp = (ip) => crypto.createHash('sha256').update(`${process.env.CLICK_HASH_SALT || 'alchemic'}:${ip || ''}`).digest('hex');
