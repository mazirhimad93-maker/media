import { jsonResponse, refreshCookie } from './_shared.mjs';

export default async () => jsonResponse({ ok: true }, 200, {
  'set-cookie': refreshCookie('', 0),
});
