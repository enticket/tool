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
export async function instagramRequest(env, path, { fields, body, after, limit } = {}) {
  instagramConfig(env);
  const url = new URL(`https://graph.facebook.com/${INSTAGRAM_API_VERSION}/${path}`);
  if (fields) url.searchParams.set('fields', fields);
  if (after) url.searchParams.set('after',after);
  if (limit) url.searchParams.set('limit',String(limit));
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
    if (data.error?.code===200 && data.error?.message==='API access blocked.') throw new InstagramError('instagram_access_blocked',503);
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

function safeMediaUrl(value, permalink=false){
  try {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || url.searchParams.has('access_token')) return null;
    const hosts=permalink?['instagram.com']:['fbcdn.net','cdninstagram.com','instagram.com'];
    return hosts.some(host=>url.hostname===host || url.hostname.endsWith('.'+host))?url.href:null;
  } catch { return null; }
}
export async function instagramMedia(env, after=''){
  if(typeof after!=='string' || after.length>2048 || (after && !/^[a-zA-Z0-9_+=\/-]+$/.test(after))) throw new InstagramError('instagram_invalid_cursor',400);
  const account=await instagramConnection(env);
  const result=await instagramRequest(env,account.id+'/media',{fields:'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp',limit:12,after});
  if(!Array.isArray(result.data)) throw new InstagramError('instagram_unavailable');
  const items=result.data.filter(x=>/^\d+$/.test(x.id)).map(x=>({
    id:x.id,caption:typeof x.caption==='string'?x.caption.slice(0,10000):'',
    type:x.media_type==='CAROUSEL_ALBUM'?'여러 장':x.media_product_type==='REELS'?'릴스':x.media_type==='VIDEO'?'동영상':'사진',
    thumbnail:safeMediaUrl(x.media_type==='VIDEO'?x.thumbnail_url:x.media_url),
    permalink:safeMediaUrl(x.permalink,true),timestamp:Number.isFinite(Date.parse(x.timestamp))?new Date(x.timestamp).toISOString():null,
  })).sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  const cursor=result.paging?.cursors?.after;
  return {account,items,nextCursor:result.paging?.next && typeof cursor==='string' && cursor.length<=2048 && /^[a-zA-Z0-9_+=\/-]+$/.test(cursor)?cursor:null};
}
