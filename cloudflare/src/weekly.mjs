import { InstagramError, instagramConfig, instagramRequest, instagramMedia } from './instagram.mjs';
import { MAX_SCHEDULE_LENGTH, normalizeDesign } from './weekly-design.mjs';

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
// Read ticket prices, excluding incidental fees and promotional discounts.
export function parsePerformancePrice(caption='') {
  const lines=String(caption).slice(0,10000).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const label=/(?:티켓\s*가격|티켓가|관람\s*료|입장\s*료|관람\s*가격|관람비|요금|가격|티켓)\s*[:|｜：]?\s*/;
  const amount=/(?:\d[\d,]*(?:\.\d+)?\s*(?:만\s*)?원|₩\s*\d[\d,]*)/;
  const values=[];let inPrices=false;
  for(const line of lines){
    if(/주차|배송|수수료|환불|취소/.test(line)||(/할인|적립|쿠폰/.test(line)&&!/(?:가격|관람료|입장료|전석|[RSAB]석)/i.test(line))){inPrices=false;continue;}
    const match=label.exec(line);
    const value=match?line.slice(match.index+match[0].length):line;
    const seat=/(?:전석|[RSAB]석|VIP석|일반석|일반|학생|청소년|어린이|성인)/i.test(line);
    const free=/(?:무료\s*(?:공연|관람|입장)|(?:관람|입장)\s*무료)/.test(line);
    if(match||free||seat||/💰|🎟/u.test(line)||/^(?:₩\s*)?\d[\d,.]*\s*(?:만\s*)?원?$/.test(line)||inPrices){
      if(amount.test(value)||/무료/.test(value))values.push(value);
      inPrices=!!match||seat||inPrices&&(amount.test(value)||/무료/.test(value));
    }else inPrices=false;
  }
  if(!values.length)return {priceKind:'unknown',price:''};
  const price=[...new Set(values)].join(' · ').slice(0,220);
  const amounts=[...price.matchAll(/(?:₩\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:만\s*)?원|₩\s*(\d[\d,]*)/g)];
  const paid=amounts.some(m=>Number((m[1]||m[2]).replaceAll(',',''))>0);
  return {priceKind:paid?'paid':'free',price:paid?price:''};
}
export function withCaptionPrice(performance) {
  return performance.priceKind==='unknown'&&!performance.price
    ? {...performance,...parsePerformancePrice(performance.description)} : performance;
}

// Extract only explicitly described performance sessions. Never use publication time.
export function parsePerformanceCaption(caption='') {
  const lines=String(caption).slice(0,10000).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const labelled=lines.find(s=>/공연명\s*[:|｜]/.test(s));
  const title=(labelled?labelled.replace(/^.*?공연명\s*[:|｜]\s*/,''):lines[0]||'공연명 확인 필요').replace(/^[🎭🎵🎶\s]+/u,'').slice(0,220);
  const venue=(lines.find(s=>/(?:장소|공연장)\s*[:|｜]/.test(s))||'').replace(/^.*?(?:장소|공연장)\s*[:|｜]\s*/,'').slice(0,220);
  const pricing=parsePerformancePrice(caption);
  const sessionLines=[];let inDates=false;
  for(const line of lines){
    if(/예매|티켓\s*오픈|예약|판매|접수|마감|모집/.test(line)){inDates=false;continue;}
    if(/(?:공연\s*(?:일시|일정|날짜|일)|일시|일정|📅)/u.test(line)){inDates=true;sessionLines.push(line);continue;}
    if(inDates&&/^(?:[-•·]\s*)?(?:20\d{2}[.\-/년]|\d{1,2}[.\/월])/.test(line)){sessionLines.push(line);continue;}
    inDates=false;
  }
  // An unlabelled full date is usable only on a line explicitly about a performance.
  if(!sessionLines.length)sessionLines.push(...lines.filter(s=>/공연|콘서트|음악회/.test(s)&&/20\d{2}[.\-/년]/.test(s)&&!/예매|오픈|접수|마감/.test(s)));
  const sessions=[];let year=null,uncertain=false,reason='공연 날짜를 찾지 못했습니다.';
  for(const line of sessionLines){
    if(/[~～〜–]/.test(line)||/부터|까지/.test(line)||/\d\s*[일.)]?\s*-\s*\d/.test(line.replace(/20\d{2}-\d{1,2}-\d{1,2}/g,''))){return {title,venue,...pricing,sessions:[],reason:'기간 표기입니다. 실제 공연 회차를 확인해 주세요.'};}
    if(/[,、]\s*\d{1,2}\s*(?:일|\.\s*\()/.test(line))return {title,venue,...pricing,sessions:[],reason:'축약된 여러 날짜입니다. 공연 회차를 확인해 주세요.'};
    const matches=[...line.matchAll(/(?:(20\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\/월-]\s*(\d{1,2})(?:일)?(?!\d)/g)];
    for(let i=0;i<matches.length;i++){
      const m=matches[i];if(m[1])year=m[1];if(!year){uncertain=true;reason='연도가 없는 일정입니다. 공연 연도를 확인해 주세요.';continue;}
      const date=`${year}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      if(!dateOnly(date))return {title,venue,...pricing,sessions:[],reason:'존재하지 않는 날짜가 포함되어 있습니다.'};
      const tail=line.slice(m.index+m[0].length,matches[i+1]?.index),weekday=/\(([일월화수목금토])(?:요일)?\)/.exec(tail);
      if(weekday&&'일월화수목금토'[new Date(date+'T00:00:00Z').getUTCDay()]!==weekday[1])return {title,venue,...pricing,sessions:[],reason:'날짜와 요일이 일치하지 않습니다.'};
      const times=[...tail.matchAll(/(오전|오후|AM|PM)?\s*(\d{1,2})(?::(\d{2})|시(?:\s*(\d{1,2})분)?)/gi)];
      if(!times.length)sessions.push({date,time:''});
      else for(const t of times){let hour=Number(t[2]),minute=Number(t[3]||t[4]||0);const meridiem=t[1]?.toUpperCase();
        if(hour>23||minute>59||(meridiem&&(hour<1||hour>12)))return {title,venue,...pricing,sessions:[],reason:'공연 시간을 확인해 주세요.'};
        if(meridiem)hour=hour%12+(['오후','PM'].includes(meridiem)?12:0);
        // Bare 1~12시 has no AM/PM certainty. Keep its date but leave time unset.
        const time=meridiem||t[3]||hour>12?`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`:'';
        sessions.push({date,time});}
    }
  }
  const unique=[...new Map(sessions.map(s=>[s.date+s.time,s])).values()];
  return {title,venue,...pricing,eligible:sessionLines.length>0||/공연|콘서트|음악회|뮤지컬|연극|독주회|연주회/.test(caption),sessions:uncertain?[]:unique,reason:!uncertain&&unique.length?'':reason};
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
  if(action==='sources'){const result=await instagramMedia(env,form.get('after')||'');return reply({...result,items:result.items.map(p=>({...p,suggestion:parsePerformanceCaption(p.caption)}))});}
  if(action==='list'){
    const [p,d]=await Promise.all([store.list({prefix:'performance:'}),store.list({prefix:'draft:'})]);
    return reply({performances:[...p.values()].map(withCaptionPrice),drafts:[...d.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
  }
  if(action==='source'){
    const post=form.get('post');if(!/^\d{1,40}$/.test(post||''))fail('invalid_fields');
    // Verify ownership via the connected account's media edge, never fetch arbitrary URLs.
    const after=form.get('after')||'';if(after.length>2048||!/^[-a-zA-Z0-9_+=/]*$/.test(after))fail('invalid_fields');
    const fields='id,media_type,media_url,children{id,media_type,media_url}';
    let page=await instagramRequest(env,instagramConfig(env)+'/media',{fields,limit:12,after:after||undefined});
    let item=page.data?.find(x=>x.id===post);
    const performanceId=form.get('performance_id');
    if(!item&&validDraftId(performanceId)){
      const saved=await store.get('performance:'+performanceId);
      if(saved?.sourcePostId===post){
        for(let i=0;i<19&&!item&&page.paging?.cursors?.after&&page.paging?.next;i++){
          page=await instagramRequest(env,instagramConfig(env)+'/media',{fields,limit:50,after:page.paging.cursors.after});
          item=page.data?.find(x=>x.id===post);
        }
      }
    }
    const index=Number(form.get('index')||0);
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
    const keys=Array.from({length:meta.chunks},(_,i)=>`bytes:${id}:${i}`),values=await store.get(keys);
    const chunks=keys.map(k=>values.get(k));if(chunks.some(x=>!x))fail('asset_not_found',404);
    return new Response(new Blob(chunks),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(action==='calendar-save'){
    const changes=getJson();
    if(!Array.isArray(changes)||!changes.length||changes.length>1000||new Set(changes.map(x=>x?.id)).size!==changes.length)fail('invalid_fields');
    return reply({performances:await store.transaction(async tx=>{
      const updated=[];
      for(const change of changes){
        if(!change||!validDraftId(change.id))fail('invalid_id');
        const old=await tx.get('performance:'+change.id);
        if(!old||old.version!==change.version)fail('conflict',409);
        const {sessions}=performanceInput({...old,sessions:change.sessions});
        updated.push({...old,sessions,version:old.version+1,updatedAt:new Date().toISOString()});
      }
      await tx.put(Object.fromEntries(updated.map(p=>['performance:'+p.id,p])));
      return updated.map(withCaptionPrice);
    })});
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
    const cards=x.cards.map(c=>({performanceId:str(c.performanceId,40),title:str(c.title),...(c.description===undefined?{}:{description:str(c.description)}),schedule:str(c.schedule,MAX_SCHEDULE_LENGTH),venue:str(c.venue),price:str(c.price)}));
    const template=x.template??'classic';if(!['classic','editorial','midnight','ticket','gallery','poster-news','paper-editorial'].includes(template))fail('invalid_fields');
    const value={id,template,week:week.start,weekEnd:week.end,title:str(x.title),subtitle:str(x.subtitle),closing:str(x.closing,300),caption:str(x.caption,2200),cards};
    if(x.design!==undefined||template==='paper-editorial') {
      try {value.design=normalizeDesign(x.design);} catch {fail('invalid_design');}
    }
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
