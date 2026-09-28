import { authPassword, ensureAppUser, jsonResponse, publicError, refreshCookie } from './_shared.mjs';

export default async (request) => {
  try {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const input = await request.json();
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    if (!email || !password) return jsonResponse({ error: 'Email and password are required' }, 400);

    const session = await authPassword(email, password);
    if (!session?.access_token || !session?.refresh_token || !session?.user) {
      return jsonResponse({ error: 'Supabase did not return a session' }, 401);
    }

    const profile = await ensureAppUser(session.user, {
      fullName: session.user.user_metadata?.full_name || session.user.user_metadata?.name || null,
      touchLogin: true,
    });

    return jsonResponse({
      ok: true,
      access_token: session.access_token,
      expires_in: session.expires_in || 3600,
      user: { id: session.user.id, email: session.user.email },
      profile,
    }, 200, {
      'set-cookie': refreshCookie(session.refresh_token),
    });
  } catch (error) {
    return publicError(error, error.status || 401);
  }
};
