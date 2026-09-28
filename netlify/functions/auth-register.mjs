import { authSignup, ensureAppUser, ensureWorkspaceForProfile, jsonResponse, publicError, refreshCookie, registrationCodeMatches, supabaseRequest } from './_shared.mjs';

export default async (request) => {
  try {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const input = await request.json();

    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    const fullName = String(input.full_name || '').trim();
    const registrationCode = String(input.registration_code || '');

    if (!registrationCodeMatches(registrationCode)) {
      return jsonResponse({ error: 'Invalid registration code' }, 403);
    }
    if (!email || !password) return jsonResponse({ error: 'Email and password are required' }, 400);
    if (password.length < 8) return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);

    const existingProfile = await supabaseRequest(
      `app_users?email=eq.${encodeURIComponent(email)}&select=user_id,email,full_name,role,status&limit=1`
    ).catch(() => []);

    if (existingProfile?.[0]) {
      return jsonResponse({
        error: 'This email is already registered. Sign in instead.',
        code: 'EMAIL_ALREADY_REGISTERED',
        email,
      }, 409);
    }

    const result = await authSignup(email, password, { full_name: fullName || null });
    const user = result?.user || (result?.id ? result : null);
    if (!user?.id) return jsonResponse({ error: 'Supabase did not return a user' }, 400);

    const profile = await ensureAppUser(user, { fullName, touchLogin: Boolean(result?.access_token) });
    const workspaceContext = await ensureWorkspaceForProfile(user, profile);

    if (result?.access_token && result?.refresh_token) {
      return jsonResponse({
        ok: true,
        requires_verification: false,
        access_token: result.access_token,
        expires_in: result.expires_in || 3600,
        user: { id: user.id, email: user.email || email },
        profile,
        workspace: workspaceContext.workspace || null,
      }, 201, {
        'set-cookie': refreshCookie(result.refresh_token),
      });
    }

    return jsonResponse({
      ok: true,
      requires_verification: true,
      message: 'Account created. Check your email to confirm the account, then sign in.',
      user: { id: user.id, email: user.email || email },
      profile,
      workspace: workspaceContext.workspace || null,
    }, 201);
  } catch (error) {
    return publicError(error, error.status || 400);
  }
};
