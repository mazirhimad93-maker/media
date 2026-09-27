import { callbacks, jsonResponse, providerConfig, publicError, requireAdmin } from './_shared.mjs';

export default async (request) => {
  try {
    requireAdmin(request);
    return jsonResponse({ providers: providerConfig(), callbacks: callbacks(request), instagramApiVersion: process.env.INSTAGRAM_API_VERSION?.trim() || 'v26.0' });
  } catch (error) { return publicError(error, error.status || 500); }
};
