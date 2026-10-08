import { callbacks, clampInt, jsonResponse, providerConfig, publicError, reconnectAccount, requireWorkspace, signOAuthState } from './_shared.mjs';

export default async (request) => {
  try {
    const { user, workspaceId } = await requireWorkspace(request);
    const url = new URL(request.url);
    const provider = url.searchParams.get('provider');
    if (!['youtube','instagram','facebook'].includes(provider)) throw Object.assign(new Error('Unsupported OAuth provider'), { status: 400 });
    if (!providerConfig()[provider].ready) throw Object.assign(new Error(`${provider} app credentials are not configured`), { status: 409 });
    const reconnectAccountId = url.searchParams.get('reconnectAccountId') || null;
    const existing = reconnectAccountId ? await reconnectAccount(
      { reconnectAccountId, workspaceId }, provider === 'youtube' ? 'youtube_shorts' : provider === 'instagram' ? 'instagram_reels' : 'facebook_page'
    ) : null;
    const state = signOAuthState({
      provider,
      reconnectAccountId,
      campaignId: existing ? null : url.searchParams.get('campaignId') || null,
      poolId: existing ? null : url.searchParams.get('poolId') || null,
      dailyLimit: existing ? existing.daily_limit : clampInt(url.searchParams.get('dailyLimit'), 0, 1000, 4),
      weeklyLimit: existing ? existing.weekly_limit : clampInt(url.searchParams.get('weeklyLimit'), 0, 7000, 28),
      minGapMinutes: existing ? existing.min_gap_minutes : clampInt(url.searchParams.get('minGapMinutes'), 0, 10080, 60),
      connectedByUserId: user.id,
      workspaceId,
    });
    const cb = callbacks(request);
    let authorizationUrl;
    if (provider === 'youtube') {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID.trim(),
        redirect_uri: cb.youtube,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/yt-analytics.readonly',
        access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state,
      });
      authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else if (provider === 'instagram') {
      const params = new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID.trim(),
        redirect_uri: cb.instagram,
        response_type: 'code',
        scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_manage_insights',
        state,
      });
      authorizationUrl = `https://www.instagram.com/oauth/authorize?${params}`;
    } else {
      const params = new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID.trim(),
        redirect_uri: cb.facebook,
        response_type: 'code',
        scope: 'pages_show_list,pages_manage_metadata,pages_read_engagement,pages_messaging',
        state,
      });
      authorizationUrl = `https://www.facebook.com/v26.0/dialog/oauth?${params}`;
    }
    return jsonResponse({ authorizationUrl });
  } catch (error) { return publicError(error, error.status || 500); }
};
