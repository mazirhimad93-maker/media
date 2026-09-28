import { authRefresh, ensureAppUser, ensureWorkspaceForProfile, jsonResponse, publicError, readCookie, refreshCookie } from './_shared.mjs';

export default async (request) => {
  try {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const token = readCookie(request, 'alchemic_refresh');
    if (!token) return jsonResponse({ authenticated: false }, 401);

    const session = await authRefresh(token);
    if (!session?.access_token || !session?.refresh_token || !session?.user) {
      return jsonResponse({ authenticated: false }, 401, {
        'set-cookie': refreshCookie('', 0),
      });
    }

    const profile = await ensureAppUser(session.user, { touchLogin: true });
    const workspaceContext = await ensureWorkspaceForProfile(session.user, profile);
    return jsonResponse({
      authenticated: true,
      access_token: session.access_token,
      expires_in: session.expires_in || 3600,
      user: { id: session.user.id, email: session.user.email },
      profile: workspaceContext.membership?.role ? {...profile,role:workspaceContext.membership.role,default_workspace_id:workspaceContext.workspace?.id||profile.default_workspace_id||null} : profile,
      workspace: workspaceContext.workspace || null,
    }, 200, {
      'set-cookie': refreshCookie(session.refresh_token),
    });
  } catch (error) {
    return jsonResponse({ authenticated: false, error: error.message }, 401, {
      'set-cookie': refreshCookie('', 0),
    });
  }
};
