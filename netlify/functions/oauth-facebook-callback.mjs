import { assignmentFromState, callbacks, htmlResponse, reconnectAccount, successPage, upsertConnectedAccount, verifyOAuthState } from './_shared.mjs';

const failPage = (message) => htmlResponse(successPage({ title:'Facebook connection failed', message }), 400);
const graphVersion = () => process.env.FACEBOOK_API_VERSION?.trim() || 'v26.0';
const appSecret = () => process.env.FACEBOOK_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim();

async function exchangeCode(request, code) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
  url.search = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID.trim(),
    client_secret: appSecret(),
    redirect_uri: callbacks(request).facebook,
    code,
  });
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error?.message || 'Facebook token exchange failed');
  return data.access_token;
}

async function exchangeLongLived(shortToken) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
  url.search = new URLSearchParams({
    grant_type:'fb_exchange_token',
    client_id:process.env.FACEBOOK_APP_ID.trim(),
    client_secret:appSecret(),
    fb_exchange_token:shortToken,
  });
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) return { access_token: shortToken, expires_in: null };
  return data;
}

async function managedPages(userToken) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/me/accounts`);
  url.search = new URLSearchParams({
    fields:'id,name,access_token,tasks,category,picture{url}',
    limit:'100',
    access_token:userToken,
  });
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Could not list Facebook Pages');
  return data.data || [];
}

async function subscribePage(pageId, pageToken) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(pageId)}/subscribed_apps`);
  url.search = new URLSearchParams({
    subscribed_fields:'messages,messaging_postbacks,message_reads',
    access_token:pageToken,
  });
  const response = await fetch(url, { method:'POST' });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.success !== false, data };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('error')) {
      return failPage(`Facebook authorization was not completed: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
    }

    const state = verifyOAuthState(url.searchParams.get('state'), 'facebook');
    const code = url.searchParams.get('code');
    if (!code) return failPage('Facebook did not return an authorization code.');

    const shortToken = await exchangeCode(request, code);
    const longToken = await exchangeLongLived(shortToken);
    const pages = await managedPages(longToken.access_token);
    const existing = await reconnectAccount(state, 'facebook_page');
    if (existing && !pages.some((page) => String(page.id) === String(existing.platform_account_id))) {
      return failPage(`Meta did not grant access to ${existing.username || 'the selected Page'}. Select that Page in the authorization flow and try again.`);
    }

    const eligible = pages.filter((page) => {
      if (existing && String(page.id) !== String(existing.platform_account_id)) return false;
      const tasks = Array.isArray(page.tasks) ? page.tasks : [];
      return page.access_token && (!tasks.length || tasks.includes('MESSAGING') || tasks.includes('MESSAGE') || tasks.includes('MODERATE'));
    });

    if (!eligible.length) {
      return failPage('Facebook login succeeded, but no Page with messaging access was returned. Make sure your Facebook profile has Messenger access to the Page.');
    }

    const connected = [];
    const failed = [];

    for (const page of eligible) {
      try {
        const subscription = await subscribePage(String(page.id), page.access_token).catch((e) => ({ ok:false, data:{ message:e.message } }));
        const tasks = Array.isArray(page.tasks) ? page.tasks : [];

        const result = await upsertConnectedAccount({
          platform:'facebook_page',
          platform_account_id:String(page.id),
          username:page.name || String(page.id),
          display_name:page.name || String(page.id),
          status:existing?.status || 'active',
          is_active:existing?.is_active ?? true,
          health_status:'healthy',
          access_token:page.access_token,
          refresh_token:null,
          token_type:'Bearer',
          token_expires_at:null,
          scope:'pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging',
          daily_limit:state.dailyLimit,
          weekly_limit:state.weeklyLimit,
          min_gap_minutes:state.minGapMinutes,
          error_message:null,
          webhook_status:subscription.ok ? 'subscribed' : 'needs_attention',
          capabilities_json:{
            publish:false,
            messages_read:true,
            messages_send:true,
            webhooks:subscription.ok,
            read_receipts_subscribed:subscription.ok
          },
          settings_json:{},
          metadata:{
            oauth_provider:'facebook',
            connected_at:new Date().toISOString(),
            facebook_page_id:String(page.id),
            facebook_category:page.category || null,
            facebook_tasks:tasks,
            picture_url:page.picture?.data?.url || null,
            webhook_subscription:subscription.data,
            connected_by_user_id:state.connectedByUserId || null
          }
        }, assignmentFromState(state));

        connected.push({ ...result.saved, pool: result.pool });
      } catch (error) {
        failed.push({ id:page.id, name:page.name, error:error.message });
      }
    }

    if (!connected.length) {
      return failPage(failed[0]?.error || 'No Facebook Pages could be connected.');
    }

    const message = failed.length
      ? `${connected.length} Facebook Page(s) connected. ${failed.length} Page(s) need attention.`
      : `${connected.length} Facebook Page(s) connected with Messenger access.`;

    return htmlResponse(successPage({
      title:'Facebook Pages connected',
      message,
      accounts:connected.map((x) => ({ ...x, platform:'facebook_page' }))
    }));
  } catch (error) {
    console.error(error);
    return failPage(error.message || 'Facebook Pages could not be connected.');
  }
};
