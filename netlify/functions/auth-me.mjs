import { jsonResponse, publicError, requireWorkspace } from './_shared.mjs';

export default async (request) => {
  try {
    const { user, profile, workspace } = await requireWorkspace(request);
    return jsonResponse({
      authenticated: true,
      user: { id: user.id, email: user.email },
      profile,
      workspace: workspace || null,
    });
  } catch (error) {
    return publicError(error, error.status || 401);
  }
};
