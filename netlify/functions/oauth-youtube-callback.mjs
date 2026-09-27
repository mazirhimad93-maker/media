import { assignmentFromState, callbacks, htmlResponse, successPage, supabaseRequest, upsertConnectedAccount, verifyOAuthState } from './_shared.mjs';
const failPage = (message) => htmlResponse(successPage({ title: 'YouTube connection failed', message }), 400);

export default async (request) => {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('error')) return failPage(`Google authorization was not completed: ${url.searchParams.get('error')}`);
    const state = verifyOAuthState(url.searchParams.get('state'), 'youtube');
    const code = url.searchParams.get('code');
    if (!code) return failPage('Google did not return an authorization code.');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({
        code, client_id:process.env.GOOGLE_CLIENT_ID.trim(), client_secret:process.env.GOOGLE_CLIENT_SECRET.trim(), redirect_uri:callbacks(request).youtube, grant_type:'authorization_code'
      })
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || token.error || 'Google token exchange failed');
    const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet,status&mine=true&maxResults=50', { headers:{ authorization:`Bearer ${token.access_token}` } });
    const channelData = await channelResponse.json();
    if (!channelResponse.ok) throw new Error(channelData.error?.message || 'YouTube channel lookup failed');
    if (!channelData.items?.length) throw new Error('This Google identity does not have an accessible YouTube channel');
    const expiresAt = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
    const connected=[];
    for (const channel of channelData.items) {
      const existing = await supabaseRequest(`content_accounts?platform=eq.youtube_shorts&platform_account_id=eq.${encodeURIComponent(channel.id)}&select=refresh_token&limit=1`);
      const refreshToken = token.refresh_token || existing?.[0]?.refresh_token;
      if (!refreshToken) throw new Error('Google did not return a refresh token. Remove the app from Google Account connections, then connect again.');
      const result = await upsertConnectedAccount({
        platform:'youtube_shorts', platform_account_id:channel.id, username:channel.snippet?.customUrl || channel.snippet?.title || channel.id,
        display_name:channel.snippet?.title || channel.id, status:'active', is_active:true, health_status:'healthy', access_token:token.access_token,
        refresh_token:refreshToken, token_type:token.token_type || 'Bearer', token_expires_at:expiresAt,
        scope:token.scope || 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        daily_limit:state.dailyLimit, weekly_limit:state.weeklyLimit, min_gap_minutes:state.minGapMinutes,
        error_message:null, capabilities_json:{publish:true,analytics:true,comments_read:true},
        settings_json:{google_client_id:process.env.GOOGLE_CLIENT_ID.trim(), youtube_privacy_status:'public', youtube_category_id:'22', youtube_notify_subscribers:true},
        metadata:{oauth_provider:'google', connected_at:new Date().toISOString(), channel_status:channel.status || {}}
      }, assignmentFromState(state));
      connected.push({ ...result.saved, pool: result.pool });
    }
    return htmlResponse(successPage({title:'YouTube connected',message:`${connected.length} channel${connected.length===1?'':'s'} synced to the Social Hub.`,accounts:connected}));
  } catch (error) { console.error(error); return failPage(error.message || 'YouTube connection could not be completed.'); }
};
