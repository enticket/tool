// Unified Login uses graph.facebook.com, not graph.instagram.com.
// See docs/instagram.md for the official references and verification boundary.
export const INSTAGRAM_API_VERSION = 'v27.0';
export class InstagramError extends Error {
  constructor(code, status = 502) { super(code); this.status = status; }
}
export function instagramConfig(env) {
  if (!env.INSTAGRAM_ACCESS_TOKEN || !/^\d+$/.test(env.INSTAGRAM_ACCOUNT_ID || ''))
    throw new InstagramError('instagram_not_configured', 503);
  return env.INSTAGRAM_ACCOUNT_ID;
}
export async function instagramRequest(env, path, { fields, body } = {}) {
  instagramConfig(env);
  const url = new URL(`https://graph.facebook.com/${INSTAGRAM_API_VERSION}/${path}`);
  if (fields) url.searchParams.set('fields', fields);
  let response, data;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + env.INSTAGRAM_ACCESS_TOKEN,
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual', signal: AbortSignal.timeout(20000),
    });
    if (response.status >= 300 && response.status < 400)
      throw new InstagramError('instagram_unavailable');
    data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new InstagramError('instagram_unavailable');
  } catch { throw new InstagramError('instagram_unavailable'); }
  // Never return provider messages, request URLs, raw data, or tokens.
  if (!response.ok || data.error) {
    if (data.error?.code === 190) throw new InstagramError('instagram_token_invalid', 503);
    if ([10, 200].includes(data.error?.code)) throw new InstagramError('instagram_permission_denied', 503);
    if (response.status === 429 || [4, 17, 32, 613].includes(data.error?.code))
      throw new InstagramError('instagram_rate_limited', 429);
    throw new InstagramError('instagram_unavailable');
  }
  return data;
}
export async function instagramConnection(env) {
  const id = instagramConfig(env);
  const account = await instagramRequest(env, id, { fields: 'id,username' });
  if (account.id !== id || typeof account.username !== 'string' || !/^[\w.]{1,30}$/.test(account.username))
    throw new InstagramError('instagram_account_mismatch', 409);
  return { id, username: account.username,
    apiVersion: INSTAGRAM_API_VERSION, checkedAt: new Date().toISOString() };
}
