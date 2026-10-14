// Existing enticket-drive behavior, now serving the tools and their API together.
// Credentials and the protected company stamp stay in Worker secrets.
const ROUTES = new Set(['/verify', '/stamp', '/upload']);
const MAX_FILE = 10 * 1024 * 1024;
const MAX_BODY = MAX_FILE + 1024 * 1024;
class ApiError extends Error {
  constructor(code, status = 502) { super(code); this.status = status; }
}
function json(data, status = 200, cors = {}) {
  return Response.json(data, { status, headers: {
    ...cors, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
function originHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set([new URL(request.url).origin,
    'https://enticket.github.io',
    ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
  if (origin && !allowed.has(origin)) throw new ApiError('origin_not_allowed', 403);
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', Vary: 'Origin',
  };
}
async function parseForm(request) {
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data'))
    throw new ApiError('invalid_content_type', 415);
  if (Number(request.headers.get('Content-Length')) > MAX_BODY)
    throw new ApiError('file_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('missing_fields', 400);
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) { await reader.cancel(); throw new ApiError('file_too_large', 413); }
    chunks.push(value);
  }
  try {
    return await new Response(new Blob(chunks), { headers: {
      'Content-Type': request.headers.get('Content-Type'),
    } }).formData();
  } catch { throw new ApiError('invalid_form', 400); }
}
async function google(url, options = {}) {
  // Never log upstream URLs, tokens, bodies, or provider diagnostics.
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
}
async function verifyGoogleAccessToken(token, clientId) {
  const res = await google('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token));
  if (!res.ok) throw new ApiError(res.status >= 500 ? 'google_unavailable' : 'invalid_token', res.status >= 500 ? 502 : 401);
  const data = await res.json();
  if ((data.aud || data.azp) !== clientId) throw new ApiError('invalid_token', 401);
  if ((data.exp !== undefined && !(Number(data.exp) * 1000 > Date.now())) ||
      (data.expires_in !== undefined && !(Number(data.expires_in) > 0)))
    throw new ApiError('invalid_token', 401);
  let email = data.email;
  let verified = data.email_verified === true || data.email_verified === 'true';
  if (!email) {
    const u = await google('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!u.ok) throw new ApiError('invalid_token', 401);
    const user = await u.json(); email = user.email;
    verified = user.email_verified === true || user.email_verified === 'true';
  }
  if (!email || !verified) throw new ApiError('email_not_verified', 403);
  return String(email).toLowerCase();
}
async function companyToken(env) {
  if (!env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN)
    throw new ApiError('server_not_configured', 503);
  const res = await google('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new ApiError('company_token_failed');
  const data = await res.json();
  if (!data.access_token) throw new ApiError('company_token_failed');
  return data.access_token;
}
function driveEscape(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
async function ensurePath(token, segments) {
  let parent = 'root';
  for (const name of segments) {
    const query = `name='${driveEscape(name)}' and mimeType='application/vnd.google-apps.folder' and '${driveEscape(parent)}' in parents and trashed=false`;
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.search = new URLSearchParams({ q: query, fields: 'files(id,name)', spaces: 'drive' });
    const found = await google(url, { headers: { Authorization: 'Bearer ' + token } });
    // Failed lookup must not create duplicate folders or upload into Drive root.
    if (!found.ok) throw new ApiError('folder_lookup_failed');
    const data = await found.json();
    if (data.files?.[0]?.id) { parent = data.files[0].id; continue; }
    const created = await google('https://www.googleapis.com/drive/v3/files', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
    });
    if (!created.ok) throw new ApiError('folder_create_failed');
    const folder = await created.json();
    if (!folder.id) throw new ApiError('folder_create_failed');
    parent = folder.id;
  }
  return parent;
}
async function uploadFile(token, parent, filename, mime, file) {
  const boundary = 'enticket_' + crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify({ name: filename, parents: [parent] }),
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, file,
    `\r\n--${boundary}--\r\n`,
  ]);
  const res = await google('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  if (!res.ok) throw new ApiError('upload_failed');
  const saved = await res.json();
  if (!saved.id) throw new ApiError('upload_failed');
  return saved;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return json({ ok: true, service: 'enticket-drive' });
    const route = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;
    if (!ROUTES.has(route)) {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      return env.ASSETS.fetch(request);
    }
    let cors = {};
    try {
      cors = originHeaders(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
      if (!env.GOOGLE_CLIENT_ID || !env.ALLOWED_EMAILS) throw new ApiError('server_not_configured', 503);
      const form = await parseForm(request);
      const token = form.get('access_token');
      if (typeof token !== 'string' || !token || token.length > 8192) throw new ApiError('missing_fields', 400);
      const email = await verifyGoogleAccessToken(token, env.GOOGLE_CLIENT_ID);
      const allowed = env.ALLOWED_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!allowed.includes(email)) throw new ApiError('not_allowed', 403);
      if (route === '/verify') return json({ ok: true, allowed: true, email }, 200, cors);
      if (route === '/stamp') {
        // Worker secrets have a 5 KB per-value limit; preserve the original
        // image by reassembling three private chunks only after authorization.
        const stamp = [env.STAMP_JPEG_B64_1, env.STAMP_JPEG_B64_2, env.STAMP_JPEG_B64_3];
        if (!stamp.every(part => typeof part === 'string' && part.length > 0))
          throw new ApiError('stamp_not_configured', 503);
        return json({ ok: true, by: email, mime: 'image/jpeg', b64: stamp.join('') }, 200, cors);
      }
      const file = form.get('file');
      const filename = form.get('filename') || 'upload.bin';
      const mime = form.get('mime') || 'application/octet-stream';
      const folder = form.get('folder') || '';
      if (!(file instanceof Blob) || !file.size) throw new ApiError('missing_fields', 400);
      if (file.size > MAX_FILE) throw new ApiError('file_too_large', 413);
      if (typeof filename !== 'string' || filename.length > 255 || /[\r\n\0]/.test(filename) ||
          typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mime) ||
          typeof folder !== 'string' || folder.length > 1500) throw new ApiError('invalid_fields', 400);
      const segments = folder.split('/').map(s => s.trim()).filter(Boolean);
      if (!segments.length || segments.length > 8 || segments.some(s => s.length > 200 || /[\r\n\0]/.test(s)))
        throw new ApiError('invalid_folder', 400);
      const company = await companyToken(env);
      const parent = await ensurePath(company, segments);
      const saved = await uploadFile(company, parent, filename, mime, file);
      return json({ ok: true, by: email, fileId: saved.id, name: saved.name, webViewLink: saved.webViewLink || null }, 200, cors);
    } catch (error) {
      return json({ error: error instanceof ApiError ? error.message : 'upstream_error' },
        error instanceof ApiError ? error.status : 502, cors);
    }
  },
};
