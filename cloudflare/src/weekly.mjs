import { InstagramError, instagramConfig, instagramRequest } from './instagram.mjs';

const fail = (code, status = 400) => { throw new InstagramError('weekly_' + code, status); };
const reply = data => Response.json({ok:true, ...data}, {headers:{'Cache-Control':'no-store'}});
const CHUNK = 65536;
export function dateOnly(value) {
  return typeof value === 'string' && /^20\d\d-\d\d-\d\d$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function weekOf(value) {
  if (!dateOnly(value)) fail('invalid_date');
  const start = new Date(value + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay()+6)%7);
  const end = new Date(+start + 6*86400000);
  return {start:start.toISOString().slice(0,10), end:end.toISOString().slice(0,10),
    title:`${start.getUTCFullYear()}년 ${start.getUTCMonth()+1}월 ${['첫째','둘째','셋째','넷째','다섯째'][Math.floor((start.getUTCDate()-1)/7)]} 주 공연`};
}
const str = (x, max=220) => { if(typeof x !== 'string' || x.length>max) fail('invalid_fields'); return x.trim(); };
export function performanceInput(x) {
  if(!x || !Array.isArray(x.sessions) || x.sessions.length>100) fail('invalid_sessions');
  const sessions = x.sessions.map(s=>{
    if(!dateOnly(s.date) || (s.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))) fail('invalid_sessions');
    return {date:s.date,time:s.time||''};
  }).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  if(new Set(sessions.map(s=>s.date+s.time)).size!==sessions.length) fail('invalid_sessions');
  if(!['needs_review','verified','hidden'].includes(x.status) || !['unknown','free','paid'].includes(x.priceKind)) fail('invalid_fields');
  const p={title:str(x.title),venue:str(x.venue),priceKind:x.priceKind,price:str(x.price),
    bookingUrl:str(x.bookingUrl,1500),description:str(x.description,10000),sessions,status:x.status,
    sourcePostId:str(x.sourcePostId||'',100),sourceAsset:str(x.sourceAsset||'',100)};
  if(!p.title || (p.priceKind==='paid'&&!p.price)) fail('invalid_fields');
  if(p.bookingUrl){try{const u=new URL(p.bookingUrl);if(u.protocol!=='https:'||u.username||u.password)fail('invalid_link');}catch{fail('invalid_link');}}
  if(p.sourcePostId && !/^\d+$/.test(p.sourcePostId)) fail('invalid_fields');
  if(p.status==='verified' && (!sessions.length || !p.venue)) fail('verification_required');
  return p;
}

// Collect replaced posters only when neither a performance nor a saved card uses them.
async function pruneAsset(tx,id){
  if(!id)return;
  const records=[...(await tx.list({prefix:'performance:'})).values()];
  const drafts=[...(await tx.list({prefix:'draft:'})).values()];
  if(records.some(p=>p.assetId===id)||drafts.some(d=>d.cards.some(c=>c.assetId===id)))return;
  const meta=await tx.get('asset:'+id);if(!meta)return;
  await tx.delete(['asset:'+id,...Array.from({length:meta.chunks},(_,i)=>`bytes:${id}:${i}`)]);
}

// The named library object has no expiry alarm. It shares the existing binding,
// but never the temporary publication job's cleanup policy.
export async function weeklyLibrary(owner, request, {jpegSize, validDraftId}) {
  const {ctx,env}=owner, store=ctx.storage, form=await request.formData();
  const action=form.get('action'), id=form.get('id');
  const getJson=()=>{try{return JSON.parse(form.get('data'));}catch{fail('invalid_fields');}};
  const key=(prefix)=>{if(!validDraftId(id))fail('invalid_id');return prefix+id;};
  if(action==='list'){
    const [p,d]=await Promise.all([store.list({prefix:'performance:'}),store.list({prefix:'draft:'})]);
    return reply({performances:[...p.values()],drafts:[...d.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
  }
  if(action==='source'){
    const post=form.get('post');if(!/^\d{1,40}$/.test(post||''))fail('invalid_fields');
    // Verify ownership via the connected account's media edge, never fetch arbitrary URLs.
    const after=form.get('after')||'';if(after.length>2048||!/^[-a-zA-Z0-9_+=/]*$/.test(after))fail('invalid_fields');
    const page=await instagramRequest(env,instagramConfig(env)+'/media',{fields:'id,media_type,media_url,children{id,media_type,media_url}',limit:12,after:after||undefined});
    const item=page.data?.find(x=>x.id===post), index=Number(form.get('index')||0);
    const asset=item?.media_type==='CAROUSEL_ALBUM'?item.children?.data?.[index]:item;
    if(!asset || asset.media_type!=='IMAGE')fail('source_unavailable');
    let url;try{url=new URL(asset.media_url);}catch{fail('source_unavailable');}
    if(url.protocol!=='https:'||url.username||url.password||!['cdninstagram.com','fbcdn.net'].some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))fail('source_unavailable');
    const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(!r.ok||r.status>=300)fail('source_unavailable');
    const reader=r.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15*1024*1024){await reader.cancel();fail('image_too_large');}chunks.push(value);}
    return new Response(new Blob(chunks),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(action==='asset'){
    const meta=await store.get(key('asset:'));if(!meta)fail('asset_not_found',404);
    const chunks=[];for(let i=0;i<meta.chunks;i++)chunks.push(await store.get(`bytes:${id}:${i}`));
    return new Response(new Blob(chunks),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(action==='performance'){
    const k=key('performance:'),x=getJson(),p=performanceInput(x),file=form.get('file');
    let bytes,assetId;
    if(file instanceof Blob && file.size){
      if(file.type!=='image/jpeg'||file.size>2*1024*1024)fail('invalid_image');
      bytes=new Uint8Array(await file.arrayBuffer());const dims=jpegSize(bytes);
      if(!dims||!dims.width||!dims.height||dims.width*dims.height>16000000)fail('invalid_image');
      assetId=crypto.randomUUID();
    }
    return reply({performance:await store.transaction(async tx=>{
      const old=await tx.get(k);if((old?.version||0)!==x.version)fail('conflict',409);
      const all=await tx.list({prefix:'performance:'});
      if(!old&&all.size>=1000)fail('library_full',409);
      if(p.sourcePostId && [...all.values()].some(v=>v.id!==id&&v.sourcePostId===p.sourcePostId&&v.sourceAsset===p.sourceAsset))fail('source_duplicate',409);
      if(!assetId&&!old?.assetId)fail('poster_required');
      if(assetId){const chunks=Math.ceil(bytes.length/CHUNK), entries={['asset:'+assetId]:{chunks}};
        for(let i=0;i<chunks;i++)entries[`bytes:${assetId}:${i}`]=bytes.slice(i*CHUNK,(i+1)*CHUNK);await tx.put(entries);}
      const value={...p,id,assetId:assetId||old.assetId,version:(old?.version||0)+1,updatedAt:new Date().toISOString()};
      await tx.put(k,value);if(old?.assetId!==value.assetId)await pruneAsset(tx,old?.assetId);return value;
    })});
  }
  if(action==='delete'){
    const k=key('performance:');const x=getJson();
    await store.transaction(async tx=>{const old=await tx.get(k);if(!old||old.version!==x.version)fail('conflict',409);
      const drafts=await tx.list({prefix:'draft:'});if([...drafts.values()].some(d=>d.cards.some(c=>c.performanceId===id)))fail('in_use',409);
      await tx.delete(k);await pruneAsset(tx,old.assetId);
    });return reply({});
  }
  if(action==='draft'){
    const k=key('draft:'),x=getJson(),week=weekOf(x.week);
    if(!Array.isArray(x.cards)||x.cards.length>8||new Set(x.cards.map(c=>c.performanceId)).size!==x.cards.length)fail('invalid_cards');
    const cards=x.cards.map(c=>({performanceId:str(c.performanceId,40),title:str(c.title),schedule:str(c.schedule,600),venue:str(c.venue),price:str(c.price)}));
    const value={id,week:week.start,weekEnd:week.end,title:str(x.title),subtitle:str(x.subtitle),closing:str(x.closing,300),caption:str(x.caption,2200),cards};
    return reply({draft:await store.transaction(async tx=>{
      const old=await tx.get(k);if((old?.version||0)!==x.version)fail('conflict',409);
      if(old?.jobId)fail('locked',409);
      if(!old&&(await tx.list({prefix:'draft:'})).size>=1000)fail('library_full',409);
      for(const c of cards){const p=await tx.get('performance:'+c.performanceId);if(!p)fail('performance_not_found');c.assetId=p.assetId;}
      Object.assign(value,{version:(old?.version||0)+1,status:'draft',updatedAt:new Date().toISOString()});await tx.put(k,value);for(const c of old?.cards||[])if(!cards.some(n=>n.assetId===c.assetId))await pruneAsset(tx,c.assetId);return value;
    })});
  }
  if(['prepare','publish','status','unlock','rendered'].includes(action)){
    const k=key('draft:');let draft=await store.get(k);if(!draft)fail('draft_not_found',404);
    if(action==='rendered'){
      if(!draft.jobId)fail('draft_not_found',404);
      const index=Number(form.get('index'));if(!Number.isInteger(index)||index<0||index>=draft.cards.length+2)fail('invalid_fields');
      const prefix=`render:${draft.jobId}:${index}:`,count=await store.get(prefix+'count');
      if(count){const chunks=[];for(let i=0;i<count;i++)chunks.push(await store.get(prefix+i));return new Response(new Blob(chunks),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store'}});}
      const stub=env.INSTAGRAM_JOBS.get(env.INSTAGRAM_JOBS.idFromName(draft.jobId));
      return stub.fetch('https://job/review?index='+index,{method:'POST'});
    }
    if(action==='prepare'){
      const files=form.getAll('file');
      if(files.some(f=>!(f instanceof Blob)||f.type!=='image/jpeg'||!f.size||f.size>4*1024*1024)||files.reduce((n,f)=>n+f.size,0)>10*1024*1024)fail('invalid_image');
      for(const f of files){const dims=jpegSize(new Uint8Array(await f.arrayBuffer()));if(dims?.width!==1080||dims?.height!==1350)fail('invalid_image');}
      if(Number(form.get('version'))!==draft.version)fail('conflict',409);
      if(!draft.title || !draft.cards.length || form.getAll('file').length!==draft.cards.length+2)fail('invalid_cards');
      for(const c of draft.cards){const p=await store.get('performance:'+c.performanceId);
        if(!p||p.status!=='verified'||p.assetId!==c.assetId||!p.sessions.some(s=>s.date>=draft.week&&s.date<=draft.weekEnd)||!c.title||!c.venue||!c.schedule)fail('verification_required');}
      draft=await store.transaction(async tx=>{const d=await tx.get(k);if(d.version!==draft.version)fail('conflict',409);
        d.jobId ||= crypto.randomUUID();d.status='preparing';await tx.put(k,d);return d;});
    }
    if(!draft.jobId) return reply({draft});
    const stub=env.INSTAGRAM_JOBS.get(env.INSTAGRAM_JOBS.idFromName(draft.jobId));
    if(action==='unlock'){
      const r=await stub.fetch('https://job/abandon',{method:'POST'});
      if(!r.ok)fail('locked',409);
      draft=await store.transaction(async tx=>{const d=await tx.get(k);if(d.jobId!==draft.jobId)fail('conflict',409);delete d.jobId;delete d.job;d.status='draft';d.version++;await tx.put(k,d);return d;});
      return reply({draft});
    }
    let response;
    if(action==='prepare'){
      const body=new FormData();body.set('draft_id',draft.jobId);body.set('channel','carousel');body.set('caption',draft.caption);
      for(const file of form.getAll('file'))body.append('file',file);
      response=await stub.fetch('https://job/prepare',{method:'POST',body});
    }else{
      response=await stub.fetch('https://job/'+action,{method:'POST',body:JSON.stringify({confirm:form.get('confirm'),fingerprint:form.get('fingerprint')})});
    }
    const job=await response.json();
    if(!response.ok){
      // Preparation never publishes. If no job was created, safely release this
      // reservation so a token/network failure cannot permanently lock the editor.
      if(action==='prepare'||(action==='status'&&draft.status==='preparing')){
        const snapshot=await stub.fetch('https://job/snapshot',{method:'POST'});
        if(snapshot.status===404){
          const reset=await store.transaction(async tx=>{const d=await tx.get(k);if(d.jobId!==draft.jobId)fail('conflict',409);delete d.jobId;delete d.job;d.status='draft';d.version++;await tx.put(k,d);return d;});
          if(action==='status')return reply({draft:reset});
        }
      }
      return Response.json(job,{status:response.status});
    }
    if(action==='prepare'){
      let index=0;for(const file of form.getAll('file')){const bytes=new Uint8Array(await file.arrayBuffer()),prefix=`render:${draft.jobId}:${index++}:`;
        await store.transaction(async tx=>{if(await tx.get(prefix+'count'))return;const chunks=Math.ceil(bytes.length/CHUNK);for(let i=0;i<chunks;i++)await tx.put(prefix+i,bytes.slice(i*CHUNK,(i+1)*CHUNK));await tx.put(prefix+'count',chunks);});}
    }
    draft=await store.transaction(async tx=>{const d=await tx.get(k);if(d.jobId!==draft.jobId)fail('conflict',409);
      const rank={preparing:0,prepared:1,creating:2,processing:3,checking:3,posting:4,unknown:5,failed:5,published:6};
      if((rank[d.status]||0)>(rank[job.status]||0))return d;
      d.job=job;d.status=job.status;d.updatedAt=new Date().toISOString();await tx.put(k,d);return d;});
    return reply({draft});
  }
  fail('invalid_action');
}
