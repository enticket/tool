// Existing enticket-drive behavior, now serving the tools and their API together.
// Credentials and the protected company stamp stay in Worker secrets.
import { instagramConnection, instagramMedia, InstagramError } from './instagram.mjs';
import { generateCaption } from './instagram-caption.mjs';
import { validDraftId } from './instagram-job.mjs';
export { InstagramJob } from './instagram-job.mjs';
const ROUTES = new Set(['/weekly', '/session/login', '/session', '/session/logout', '/verify', '/stamp', '/instagram/connection',
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
const MAX_BODY = 11 * 1024 * 1024;
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
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return json({ ok: true, service: 'enticket-drive' });
    if (url.pathname.startsWith('/instagram-media/')) {
      const match = /^\/instagram-media\/([^/]+)\/([0-9a-f-]{72})(?:\/(\d))?$/.exec(url.pathname);
      if (!match || !validDraftId(match[1]) || !env.INSTAGRAM_JOBS || !['GET', 'HEAD'].includes(request.method))
        return new Response(null, { status: 404 });
      const stub = env.INSTAGRAM_JOBS.get(env.INSTAGRAM_JOBS.idFromName(match[1]));
      const response = await stub.fetch('https://job/media?key=' + match[2] + '&index=' + (match[3] || '0'));
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    const route = url.pathname.startsWith('/api/') ? url.pathname.slice(4) : url.pathname;
    if (!ROUTES.has(route)) {
      if (url.pathname === '/upload' || url.pathname === '/api' || url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      return env.ASSETS.fetch(request);
    }
    let cors = {};
    try {
      cors = originHeaders(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
      if (!env.GOOGLE_CLIENT_ID || !env.ALLOWED_EMAILS) throw new ApiError('server_not_configured', 503);
      const id = sessionId(request);
      const sessionRoute = route.startsWith('/session');
      // Cookie credentials may only be used by our own origin, including logout/login.
      if (sessionRoute || id) {
        if (request.headers.get('Origin') !== url.origin)
          throw new ApiError('origin_not_allowed',403);
      }
      const verifiesToken = route === '/session/login' || (!id && !sessionRoute);
      if (verifiesToken) {
        if (!env.LOGIN_RATE_LIMITER) throw new ApiError('server_not_configured', 503);
        const key = request.headers.get('CF-Connecting-IP') || 'unknown';
        const { success } = await env.LOGIN_RATE_LIMITER.limit({ key });
        if (!success) {
          return json({ error: 'login_rate_limited' }, 429, { ...cors, 'Retry-After': '60' });
        }
      }
      const form = await parseForm(request);
      if (route === '/session/logout') {
        if (id) await sessionCall(env,id,'delete');
        cors['Set-Cookie'] = sessionCookie();
        return json({ok:true},200,cors);
      }
      let email;
      if (verifiesToken) {
        const token = form.get('access_token');
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
      if (route === '/weekly') {
        if (!env.INSTAGRAM_JOBS) throw new InstagramError('instagram_storage_not_configured',503);
        form.delete('access_token');
        const stub=env.INSTAGRAM_JOBS.get(env.INSTAGRAM_JOBS.idFromName('weekly-library'));
        const r=await stub.fetch('https://job/weekly',{method:'POST',body:form});
        const headers=new Headers(r.headers);for(const [k,v] of Object.entries(cors))headers.set(k,v);
        return new Response(r.body,{status:r.status,headers});
      }
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
      throw new ApiError('not_found', 404);
    } catch (error) {
      const known = error instanceof ApiError || error instanceof InstagramError;
      return json({ error: known ? error.message : 'upstream_error' },
        known ? error.status : 502, cors);
    }
  },
};
