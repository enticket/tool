// Existing enticket-drive behavior, now serving the tools and their API together.
// Credentials and the protected company stamp stay in Worker secrets.
import { instagramConnection, instagramMedia, InstagramError } from './instagram.mjs';
import { generateCaption } from './instagram-caption.mjs';
import { validDraftId } from './instagram-job.mjs';
export { InstagramJob } from './instagram-job.mjs';
const ROUTES = new Set(['/session/login', '/session', '/session/logout', '/verify', '/stamp', '/upload', '/instagram/connection',
  '/instagram/schedule', '/instagram/cancel', '/instagram/schedules', '/instagram/media', '/instagram/caption', '/instagram/prepare', '/instagram/publish', '/instagram/status']);
const SESSION_TTL = 86400000;
const SESSION_COOKIE = '__Host-enticket_session';
function sessionCookie(id = '') {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${id ? 86400 : 0}`;
}
export class LoginSession {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const input = await request.json();
    return this.ctx.storage.transaction(async storage => {
      if (input.action === 'delete') { await storage.delete('session'); return Response.json({ok:true}); }
      let session = await storage.get('session');
      if (input.action === 'create' && !session) session = {email:input.email, expiresAt:Date.now()+SESSION_TTL};
      if (!session || session.expiresAt <= Date.now()) {
        await storage.delete('session'); return Response.json({error:'invalid_token'}, {status:401});
      }
      session.expiresAt = Date.now()+SESSION_TTL;
      await storage.put('session', session);
      await storage.setAlarm(session.expiresAt);
      return Response.json(session);
    });
  }
  async alarm() {
    const session = await this.ctx.storage.get('session');
    if (!session || session.expiresAt <= Date.now()) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(session.expiresAt);
  }
}
function sessionId(request) {
  const value = request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);
  return /^[0-9a-f]{64}$/.test(value || '') ? value : null;
}
async function sessionCall(env, id, action, email) {
  if (!env.LOGIN_SESSIONS) throw new ApiError('server_not_configured',503);
  return env.LOGIN_SESSIONS.get(env.LOGIN_SESSIONS.idFromName(id)).fetch('https://session/', {
    method:'POST', body:JSON.stringify({action,email})
  });
}
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
  // Workers supports only follow/manual. Reject redirects without forwarding credentials.
  const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20000) });
  if (response.status >= 300 && response.status < 400) throw new ApiError('google_unavailable');
  return response;
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
    if (url.pathname.startsWith('/instagram-media/')) {
      const match = /^\/instagram-media\/([^/]+)\/([0-9a-f-]{72})$/.exec(url.pathname);
      if (!match || !validDraftId(match[1]) || !env.INSTAGRAM_JOBS || !['GET', 'HEAD'].includes(request.method))
        return new Response(null, { status: 404 });
      const stub = env.INSTAGRAM_JOBS.get(env.INSTAGRAM_JOBS.idFromName(match[1]));
      const response = await stub.fetch('https://job/media?key=' + match[2]);
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
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
      const id = sessionId(request);
      const sessionRoute = route.startsWith('/session');
      // Cookie credentials may only be used by our own origin, including logout/login.
      if (sessionRoute || id) {
        if (request.headers.get('Origin') !== url.origin)
          throw new ApiError('origin_not_allowed',403);
      }
      if (route === '/session/logout') {
        if (id) await sessionCall(env,id,'delete');
        cors['Set-Cookie'] = sessionCookie();
        return json({ok:true},200,cors);
      }
      let email;
      if (route === '/session/login' || (!id && !sessionRoute)) {
        if (typeof token !== 'string' || !token || token.length > 8192) throw new ApiError('missing_fields',400);
        email = await verifyGoogleAccessToken(token,env.GOOGLE_CLIENT_ID);
      } else {
        if (!id) throw new ApiError('invalid_token',401);
        const response = await sessionCall(env,id,'touch');
        if (!response.ok) { cors['Set-Cookie']=sessionCookie(); throw new ApiError('invalid_token',401); }
        email = (await response.json()).email;
        cors['Set-Cookie']=sessionCookie(id);
      }
      const allowed = env.ALLOWED_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!allowed.includes(email)) {
        if(id) await sessionCall(env,id,'delete');
        cors['Set-Cookie']=sessionCookie();
        throw new ApiError('not_allowed',403);
      }
      if (route === '/session/login') {
        if(id) await sessionCall(env,id,'delete');
        const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
        await sessionCall(env,fresh,'create',email);
        cors['Set-Cookie']=sessionCookie(fresh);
      }
      if (sessionRoute) return json({ok:true,allowed:true,email},200,cors);
      if (route === '/verify') return json({ ok: true, allowed: true, email }, 200, cors);
      if (route === '/instagram/connection')
        return json({ ok: true, connected: true, account: await instagramConnection(env) }, 200, cors);
      if (route === '/instagram/media')
        return json({ok:true,...await instagramMedia(env,form.get('after')||'')},200,cors);
      if (route === '/instagram/caption')
        return json({ ok: true, ...await generateCaption(env, form.get('file')) }, 200, cors);
      if (route.startsWith('/instagram/')) {
        if (!env.INSTAGRAM_JOBS) throw new InstagramError('instagram_storage_not_configured', 503);
        if(route==='/instagram/schedules'){
          const registry=env.INSTAGRAM_JOBS.get(env.INSTAGRAM_JOBS.idFromName('schedule-index'));
          const r=await registry.fetch('https://job/schedules',{method:'POST',body:JSON.stringify({after:form.get('after')||'0'})});return json(await r.json(),r.status,cors);
        }
        const id = form.get('draft_id');
        if (!validDraftId(id)) throw new InstagramError('instagram_invalid_draft', 400);
        const stub = env.INSTAGRAM_JOBS.get(env.INSTAGRAM_JOBS.idFromName(id));
        const prepare = route === '/instagram/prepare';
        // Google access tokens never enter durable storage or the Meta API.
        form.delete('access_token');
        const result = await stub.fetch('https://job/' + route.split('/').pop(), {
          method: 'POST', ...(prepare ? { body: form } : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fingerprint: form.get('fingerprint'), confirm: form.get('confirm'), scheduled_at:form.get('scheduled_at') }),
          }),
        });
        return json(await result.json(), result.status, cors);
      }
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
      const known = error instanceof ApiError || error instanceof InstagramError;
      return json({ error: known ? error.message : 'upstream_error' },
        known ? error.status : 502, cors);
    }
  },
};
