import { instagramConfig, instagramConnection, instagramRequest, InstagramError } from './instagram.mjs';

const DAY = 24 * 60 * 60 * 1000;
const CHUNK = 64 * 1024;
export const validDraftId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const reply = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const publicJob = job => ({ ok: true, draftId: job.id, fingerprint: job.fingerprint,
  account: { id: job.accountId, username: job.username }, channel: job.channel,
  caption: job.caption, scheduledAt:job.scheduledAt?new Date(job.scheduledAt).toISOString():null, previewUrl:job.scheduledAt && job.expiresAt>Date.now()?`/instagram-media/${job.id}/${job.capability}`:null, status: job.status, mediaId: job.mediaId || null,
  error: job.error || null, expiresAt: new Date(job.expiresAt).toISOString() });
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), b => b.toString(16).padStart(2, '0')).join('');

// Validate the browser-rendered JPEG, including dimensions, without native image libraries.
export function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
      return { height: bytes[offset + 3] * 256 + bytes[offset + 4], width: bytes[offset + 5] * 256 + bytes[offset + 6] };
    }
    offset += length;
  }
  return null;
}

// One SQLite-backed Durable Object per immutable draft: durable state prevents
// duplicate publication after retries, concurrent clicks, or an isolate restart.
export class InstagramJob {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/register' || path === '/schedules') return await this.registry(request,path);
      if (path === '/media') return await this.media(request);
      if (path === '/prepare') return await this.prepare(request);
      const job = await this.ctx.storage.get('job');
      if (!job) throw new InstagramError('instagram_draft_not_found', 404);
      if (job.accountId !== instagramConfig(this.env)) throw new InstagramError('instagram_account_mismatch', 409);
      if(path==='/snapshot')return reply(publicJob(job));
      const input = await request.json();
      if (path === '/schedule' || path === '/cancel') return await this.schedule(job,input,path);
      if (path === '/publish') return await this.publish(job, input);
      if (path === '/status') {
        // A worker can stop after a remote request but before saving its response.
        if (['creating', 'checking', 'posting'].includes(job.status) && Date.now() - job.attemptedAt > 65000) {
          job.status = 'unknown'; await this.ctx.storage.put('job', job);
        }
        if (job.status === 'unknown' && job.containerId) {
          const state = await instagramRequest(this.env, job.containerId, { fields: 'status_code' });
          if (state.status_code === 'PUBLISHED') {
            job.status = 'published'; job.error = null; await this.ctx.storage.put('job', job);
          }
        }
        return reply(publicJob(job));
      }
      return reply({ error: 'not_found' }, 404);
    } catch (e) {
      return reply({ error: e instanceof InstagramError ? e.message : 'instagram_unavailable' }, e instanceof InstagramError ? e.status : 502);
    }
  }
  async registry(request,path){
    if(path==='/register'){
      const {id,until}=await request.json();
      if(!validDraftId(id)||!Number.isFinite(until)) throw new InstagramError('instagram_invalid_draft',400);
      await this.ctx.storage.transaction(async txn=>{const old=await txn.get('entry:'+id);await txn.put('entry:'+id,{id,when:until-31*DAY,until:Math.max(until,old?.until||0)});});return reply({ok:true});
    }
    const entries=await this.ctx.storage.list({prefix:'entry:',limit:500});const items=[];
    const {after='0'}=await request.json();
    if(!/^\d{1,4}$/.test(String(after)))throw new InstagramError('instagram_invalid_cursor',400);
    const active=[...entries].filter(([,e])=>e.until>=Date.now()).sort((a,b)=>a[1].when-b[1].when);
    for(const [key,entry] of entries)if(entry.until<Date.now())await this.ctx.storage.delete(key);
    const offset=Number(after);
    for(const [key,entry] of active.slice(offset,offset+20)){
      if(entry.until<Date.now()){await this.ctx.storage.delete(key);continue;}
      const stub=this.env.INSTAGRAM_JOBS.get(this.env.INSTAGRAM_JOBS.idFromName(entry.id));
      const r=await stub.fetch('https://job/snapshot',{method:'POST',body:'{}'});
      if(r.status===404){await this.ctx.storage.delete(key);continue;}
      if(!r.ok) throw new InstagramError('instagram_unavailable');
      const job=await r.json();if(job.scheduledAt)items.push(job);
    }
    return reply({ok:true,nextCursor:offset+20<active.length?String(offset+20):null,items:items.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt))});
  }
  async schedule(original,input,path){
    const cancel=path==='/cancel';
    if(input.fingerprint!==original.fingerprint || input.confirm!==(cancel?'cancel':'schedule')) throw new InstagramError('instagram_confirmation_required',409);
    const time=typeof input.scheduled_at==='string' && /Z$/.test(input.scheduled_at)?Date.parse(input.scheduled_at):NaN;
    if(!cancel && (!Number.isFinite(time)||time<Date.now()+120000||time>Date.now()+30*DAY)) throw new InstagramError('instagram_invalid_schedule',400);
    if(!cancel){
      const registry=this.env.INSTAGRAM_JOBS.get(this.env.INSTAGRAM_JOBS.idFromName('schedule-index'));
      await registry.fetch('https://job/register',{method:'POST',body:JSON.stringify({id:original.id,until:time+31*DAY})}).then(r=>{if(!r.ok)throw new InstagramError('instagram_unavailable');});
    }
    const job=await this.ctx.storage.transaction(async txn=>{
      const j=await txn.get('job');
      if(cancel && j.status==='cancelled')return j;
      if(!(cancel?j.status==='scheduled':['prepared','scheduled'].includes(j.status)) || j.expiresAt<=Date.now()) throw new InstagramError('instagram_schedule_locked',409);
      if(cancel){j.status='cancelled';j.expiresAt=Date.now();await txn.setAlarm(Date.now()+1000);}
      else {j.status='scheduled';j.scheduledAt=time;j.expiresAt=time+DAY;await txn.setAlarm(time);}
      await txn.put('job',j);return j;
    });
    return reply(publicJob(job));
  }
  async prepare(request) {
    const form = await request.formData();
    const id = form.get('draft_id'), channel = form.get('channel'), caption = form.get('caption');
    const file = form.get('file');
    if (!validDraftId(id) || !['feed', 'story'].includes(channel) || typeof caption !== 'string' ||
        [...caption].length > 2200 || (channel === 'story' && caption !== '') ||
        !(file instanceof Blob) || file.type !== 'image/jpeg' || !file.size || file.size > 4 * 1024 * 1024)
      throw new InstagramError('instagram_invalid_draft', 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = jpegSize(bytes);
    if (dimensions?.width !== 1080 || dimensions?.height !== (channel === 'feed' ? 1350 : 1920))
      throw new InstagramError('instagram_invalid_image', 400);
    const accountId = instagramConfig(this.env);
    const fingerprint = await hash(new TextEncoder().encode(JSON.stringify({ accountId, channel, caption, image: await hash(bytes) })));
    const existing = await this.ctx.storage.get('job');
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new InstagramError('instagram_draft_conflict', 409);
      return reply(publicJob(existing));
    }
    const account = await instagramConnection(this.env);
    const job = { id, fingerprint, accountId, username: account.username, channel, caption,
      status: 'prepared', capability: crypto.randomUUID() + crypto.randomUUID(),
      chunks: Math.ceil(bytes.length / CHUNK), size: bytes.length, expiresAt: Date.now() + DAY };
    // Serialize competing preparations and store all image chunks atomically.
    await this.ctx.storage.transaction(async txn => {
      const current = await txn.get('job');
      if (current) {
        if (current.fingerprint !== fingerprint) throw new InstagramError('instagram_draft_conflict', 409);
        Object.assign(job, current); return;
      }
      const entries = { job };
      for (let i = 0; i < job.chunks; i++) entries['image:' + i] = bytes.slice(i * CHUNK, (i + 1) * CHUNK);
      await txn.put(entries);
      await txn.setAlarm(job.expiresAt);
    });
    return reply(publicJob(job));
  }
  async media(request) {
    const job = await this.ctx.storage.get('job');
    const capability = new URL(request.url).searchParams.get('key');
    if (!job || job.expiresAt <= Date.now() || capability !== job.capability) return new Response(null, { status: 404 });
    const chunks = [];
    for (let i = 0; i < job.chunks; i++) {
      const chunk = await this.ctx.storage.get('image:' + i);
      if (!chunk) return new Response(null, { status: 404 });
      chunks.push(chunk);
    }
    return new Response(new Blob(chunks), { headers: { 'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  }
  async publish(original, input, automatic=false) {
    if (input.confirm !== 'publish' || input.fingerprint !== original.fingerprint)
      throw new InstagramError('instagram_confirmation_required', 409);
    // The transaction is the only place that grants permission for a remote write.
    const claim = await this.ctx.storage.transaction(async txn => {
      const job = await txn.get('job');
      if (job.expiresAt <= Date.now()) throw new InstagramError('instagram_draft_expired', 410);
      if (!(automatic?((job.status==='scheduled' && job.scheduledAt<=Date.now())||job.status==='processing'):(!job.scheduledAt && ['prepared','processing'].includes(job.status)))) return { claimed: false, job };
      const create = ['prepared','scheduled'].includes(job.status);
      job.status = create ? 'creating' : 'checking'; job.attemptedAt = Date.now();
      await txn.put('job', job); return { claimed: true, create, job };
    });
    const job = claim.job;
    if (!claim.claimed) return reply(publicJob(job));
    let posting = false;
    try {
      if (claim.create) {
        const account = await instagramConnection(this.env);
        if (account.username !== job.username) throw new InstagramError('instagram_account_mismatch', 409);
        const imageUrl = `https://tools.enticket.kr/instagram-media/${job.id}/${job.capability}`;
        const container = await instagramRequest(this.env, job.accountId + '/media', { body: {
          image_url: imageUrl, ...(job.channel === 'story' ? { media_type: 'STORIES' } : { caption: job.caption }),
        } });
        if (!/^\d+$/.test(container.id || '')) throw new InstagramError('instagram_unavailable');
        job.containerId = container.id;
        await this.ctx.storage.put('job', job);
      }
      const state = await instagramRequest(this.env, job.containerId, { fields: 'status_code' });
      if (state.status_code === 'PUBLISHED') { job.status = 'published'; }
      else if (['ERROR', 'EXPIRED'].includes(state.status_code)) {
        job.status = 'failed'; job.error = 'instagram_media_failed';
      } else if (state.status_code === 'FINISHED') {
        job.status = 'posting'; job.attemptedAt = Date.now();
        await this.ctx.storage.put('job', job);
        posting = true;
        const result = await instagramRequest(this.env, job.accountId + '/media_publish', { body: { creation_id: job.containerId } });
        if (!/^\d+$/.test(result.id || '')) throw new InstagramError('instagram_unavailable');
        job.mediaId = result.id; job.status = 'published';
      } else { job.status = 'processing'; }
      await this.ctx.storage.put('job', job);
    } catch (e) {
      // After media_publish, even a timeout must never trigger a second publish.
      job.status = posting ? 'unknown' : 'failed';
      job.error = e instanceof InstagramError ? e.message : 'instagram_unavailable';
      await this.ctx.storage.put('job', job);
    }
    return reply(publicJob(job));
  }
  async alarm() {
    let job=await this.ctx.storage.get('job');if(!job)return;
    if(job.scheduledAt && job.expiresAt>Date.now()){
      if(job.status==='scheduled' && job.scheduledAt>Date.now()){await this.ctx.storage.setAlarm(job.scheduledAt);return;}
      if(['scheduled','processing'].includes(job.status)){
        // Persist a watchdog before remote calls. After an interrupted write, never publish twice.
        await this.ctx.storage.setAlarm(Date.now()+90000);
        await this.publish(job,{confirm:'publish',fingerprint:job.fingerprint},true);
        job=await this.ctx.storage.get('job');
        if(job.status==='processing'){
          job.polls=(job.polls||0)+1;
          if(job.polls>=20){job.status='failed';job.error='instagram_media_failed';}
          await this.ctx.storage.put('job',job);
          if(job.status==='processing'){await this.ctx.storage.setAlarm(Date.now()+30000);return;}
        }
      }else if(['creating','checking','posting'].includes(job.status)){
        job.status='unknown';job.error='instagram_unavailable';await this.ctx.storage.put('job',job);
      }
    }
    job=await this.ctx.storage.get('job');if(!job)return;
    if(job.status==='scheduled' && job.scheduledAt>Date.now()){await this.ctx.storage.setAlarm(job.scheduledAt);return;}
    if(job.expiresAt<=Date.now()){
      if(job.scheduledAt && ['scheduled','processing'].includes(job.status)){job.status='failed';job.error='instagram_draft_expired';await this.ctx.storage.put('job',job);}
      await this.ctx.storage.delete(Array.from({length:job.chunks},(_,i)=>'image:'+i));
      if(Date.now()>=job.expiresAt+29*DAY)await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(job.expiresAt+29*DAY);
    }else await this.ctx.storage.setAlarm(job.expiresAt);
  }
}
