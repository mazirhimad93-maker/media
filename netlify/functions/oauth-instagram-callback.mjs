import { assignmentFromState, callbacks, htmlResponse, reconnectAccount, successPage, upsertConnectedAccount, verifyOAuthState } from './_shared.mjs';
const failPage = (message) => htmlResponse(successPage({ title:'Instagram connection failed', message }), 400);

async function subscribeAccount(accountId, accessToken) {
  const version = process.env.INSTAGRAM_API_VERSION?.trim() || 'v26.0';
  const endpoint = new URL(`https://graph.instagram.com/${version}/${accountId}/subscribed_apps`);
  endpoint.search = new URLSearchParams({ subscribed_fields:'messages,messaging_postbacks,comments', access_token:accessToken });
  const response = await fetch(endpoint, { method:'POST' });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok && data?.success !== false, data };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('error')) return failPage(`Instagram authorization was not completed: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
    const state = verifyOAuthState(url.searchParams.get('state'), 'instagram');
    const code = url.searchParams.get('code')?.replace(/#_$/, '');
    if (!code) return failPage('Instagram did not return an authorization code.');

    const shortResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({
        client_id:process.env.INSTAGRAM_APP_ID.trim(), client_secret:process.env.INSTAGRAM_APP_SECRET.trim(), grant_type:'authorization_code', redirect_uri:callbacks(request).instagram, code
      })
    });
    const shortToken = await shortResponse.json();
    if (!shortResponse.ok || !shortToken.access_token) throw new Error(shortToken.error_message || shortToken.error?.message || 'Instagram token exchange failed');

    const longTokenUrl = new URL('https://graph.instagram.com/access_token');
    longTokenUrl.search = new URLSearchParams({grant_type:'ig_exchange_token',client_secret:process.env.INSTAGRAM_APP_SECRET.trim(),access_token:shortToken.access_token});
    const longResponse = await fetch(longTokenUrl);
    const longToken = await longResponse.json();
    if (!longResponse.ok || !longToken.access_token) throw new Error(longToken.error?.message || 'Instagram long-lived token exchange failed');

    const version = process.env.INSTAGRAM_API_VERSION?.trim() || 'v26.0';
    const profileUrl = new URL(`https://graph.instagram.com/${version}/me`);
    profileUrl.search = new URLSearchParams({fields:'user_id,username',access_token:longToken.access_token});
    const profileResponse = await fetch(profileUrl);
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error(profile.error?.message || 'Instagram profile lookup failed');
    const accountId = profile.user_id || profile.id || shortToken.user_id;
    if (!accountId) throw new Error('Instagram did not return a professional account ID');
    const existing = await reconnectAccount(state, 'instagram_reels', accountId);

    const expiresAt = new Date(Date.now()+Number(longToken.expires_in || 5184000)*1000).toISOString();
    const subscription = await subscribeAccount(String(accountId), longToken.access_token).catch((e)=>({ok:false,data:{message:e.message}}));
    const scope = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights';
    const result = await upsertConnectedAccount({
      platform:'instagram_reels', platform_account_id:String(accountId), username:profile.username || String(accountId), display_name:profile.username || String(accountId),
      status:existing?.status || 'active', is_active:existing?.is_active ?? true, health_status:'healthy', access_token:longToken.access_token, refresh_token:null, token_type:'Bearer', token_expires_at:expiresAt,
      scope, daily_limit:state.dailyLimit, weekly_limit:state.weeklyLimit, min_gap_minutes:state.minGapMinutes, error_message:null,
      webhook_status:subscription.ok ? 'subscribed' : 'needs_attention',
      capabilities_json:{publish:true,messages_read:true,messages_send:true,analytics:true,webhooks:subscription.ok},
      settings_json:{share_to_feed:true},
      metadata:{oauth_provider:'instagram',connected_at:new Date().toISOString(),instagram_scoped_id:profile.id || null,webhook_subscription:subscription.data}
    }, assignmentFromState(state));

    return htmlResponse(successPage({title:'Instagram connected',message:subscription.ok?'Publishing, DMs, and webhook permissions are connected.':'Account connected, but webhook subscription needs attention. Check Meta setup.',accounts:[{...result.saved,pool:result.pool}]}));
  } catch (error) { console.error(error); return failPage(error.message || 'Instagram connection could not be completed.'); }
};
