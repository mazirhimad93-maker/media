import { callbacks, clampInt, jsonResponse, providerConfig, publicError, requireUser, signOAuthState } from './_shared.mjs';

export default async (request) => {
  try {
    const { user } = await requireUser(request);
    const url = new URL(request.url);
    const provider = url.searchParams.get('provider');
    if (!['youtube','instagram'].includes(provider)) throw Object.assign(new Error('Unsupported OAuth provider'), { status: 400 });
    if (!providerConfig()[provider].ready) throw Object.assign(new Error(`${provider} app credentials are not configured`), { status: 409 });
    const state = signOAuthState({
      provider,
      campaignId: url.searchParams.get('campaignId') || null,
      poolId: url.searchParams.get('poolId') || null,
      dailyLimit: clampInt(url.searchParams.get('dailyLimit'), 0, 1000, 4),
      weeklyLimit: clampInt(url.searchParams.get('weeklyLimit'), 0, 7000, 28),
      minGapMinutes: clampInt(url.searchParams.get('minGapMinutes'), 0, 10080, 60),
      connectedByUserId: user.id,
    });
    const cb = callbacks(request);
    let authorizationUrl;
    if (provider === 'youtube') {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID.trim(),
        redirect_uri: cb.youtube,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state,
      });
      authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else {
      const params = new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID.trim(), redirect_uri: cb.instagram, response_type: 'code',
        scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments', state,
      });
      authorizationUrl = `https://www.instagram.com/oauth/authorize?${params}`;
    }
    return jsonResponse({ authorizationUrl });
  } catch (error) { return publicError(error, error.status || 500); }
};
