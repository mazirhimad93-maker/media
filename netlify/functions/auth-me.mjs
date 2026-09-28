import { jsonResponse, publicError, requireUser } from './_shared.mjs';

export default async (request) => {
  try {
    const { user, profile } = await requireUser(request);
    return jsonResponse({
      authenticated: true,
      user: { id: user.id, email: user.email },
      profile,
    });
  } catch (error) {
    return publicError(error, error.status || 401);
  }
};
