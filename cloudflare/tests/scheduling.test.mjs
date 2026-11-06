import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('durable scheduling, rescheduling, cancellation, processing and uncertain publication',async()=>{
 let publishes=0,processing=false,lost=false;
 const env={GOOGLE_CLIENT_ID:'client',ALLOWED_EMAILS:'staff@test.example',INSTAGRAM_ACCOUNT_ID:'123',INSTAGRAM_ACCESS_TOKEN:'meta-secret'};
 const source=readFileSync(new URL('../src/instagram-job.mjs',import.meta.url),'utf8').replace('export class InstagramJob','class BaseJob')+`
 export class InstagramJob extends BaseJob {
 async fetch(r){const p=new URL(r.url).pathname;if(p==='/__test'){
 const x=await r.json();const j=await this.ctx.storage.get('job');
 if(x.due){j.scheduledAt=Date.now()-1000;await this.ctx.storage.put('job',j);}
 if(x.crash){j.status='posting';j.attemptedAt=Date.now()-100000;await this.ctx.storage.put('job',j);}
 await this.alarm();return Response.json(await this.ctx.storage.get('job'));}return super.fetch(r);}}
 `;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:['worker.mjs','instagram.mjs','instagram-caption.mjs','instagram-job.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+name,import.meta.url)),...(name==='instagram-job.mjs'?{contents:source}:{})})),compatibilityDate:'2026-10-13',bindings:env,durableObjects:{INSTAGRAM_JOBS:{className:'InstagramJob',useSQLite:true}},outboundService:async req=>{
 const u=new URL(req.url);if(u.hostname==='oauth2.googleapis.com')return Response.json({aud:'client',email:'staff@test.example',email_verified:true,expires_in:300});
 assert.equal(req.headers.get('Authorization'),'Bearer meta-secret');
 if(u.pathname.endsWith('/media_publish')){publishes++;return lost?new Response('lost',{status:502}):Response.json({id:'777'});}
 if(u.pathname.endsWith('/media'))return Response.json({id:'999'});
 if(u.pathname.endsWith('/999'))return Response.json({status_code:processing?'IN_PROGRESS':'FINISHED'});
 return Response.json({id:'123',username:'test'});
 }}));
 const invoke=async(path,fields={})=>{const form=new FormData();form.set('access_token','google');for(const[k,v]of Object.entries(fields))form.set(k,v);const req=new Request('https://tools.enticket.kr/api/instagram/'+path,{method:'POST',body:form});return mf.dispatchFetch(req.url,{method:'POST',headers:Object.fromEntries(req.headers),body:await req.arrayBuffer()});};
 const ns=await mf.getDurableObjectNamespace('INSTAGRAM_JOBS');
 const tick=async(id,fields={})=>{const r=await ns.get(ns.idFromName(id)).fetch('https://job/__test',{method:'POST',body:JSON.stringify(fields)});return r.json();};
 const jpeg=new Uint8Array([255,216,255,192,0,17,8,5,70,4,56,3,1,17,0,2,17,0,3,17,0,255,217]);
 const prepare=async()=>{const id=crypto.randomUUID();const r=await invoke('prepare',{draft_id:id,channel:'feed',caption:'reviewed',file:new File([jpeg],'x.jpg',{type:'image/jpeg'})});assert.equal(r.status,200);return r.json();};
 const fields=j=>({draft_id:j.draftId,fingerprint:j.fingerprint,confirm:'schedule',scheduled_at:new Date(Date.now()+3600000).toISOString()});
 try{
 let j=await prepare();assert.equal((await invoke('schedule',{...fields(j),confirm:''})).status,409);
 assert.equal((await invoke('schedule',{...fields(j),scheduled_at:new Date().toISOString()})).status,400);
 assert.equal((await invoke('schedule',{...fields(j),scheduled_at:new Date(Date.now()+31*86400000).toISOString()})).status,400);
 let r=await invoke('schedule',fields(j));assert.equal(r.status,200);assert.equal((await r.json()).status,'scheduled');
 assert.equal((await tick(j.draftId)).status,'scheduled');assert.equal(publishes,0);
 assert.equal((await (await invoke('publish',{...fields(j),confirm:'publish'})).json()).status,'scheduled');assert.equal(publishes,0);
 const changed=new Date(Date.now()+7200000).toISOString();assert.equal((await (await invoke('schedule',{...fields(j),scheduled_at:changed})).json()).scheduledAt,changed);
 assert.equal((await (await invoke('schedules')).json()).items.length,1);
 assert.equal((await (await invoke('cancel',{...fields(j),confirm:'cancel'})).json()).status,'cancelled');await tick(j.draftId);assert.equal(publishes,0);
 j=await prepare();await invoke('schedule',fields(j));processing=true;assert.equal((await tick(j.draftId,{due:true})).status,'processing');assert.equal(publishes,0);
 processing=false;assert.equal((await tick(j.draftId)).status,'published');assert.equal(publishes,1);await tick(j.draftId);assert.equal(publishes,1);
 assert.equal((await invoke('cancel',{...fields(j),confirm:'cancel'})).status,409);
 j=await prepare();await invoke('schedule',fields(j));lost=true;assert.equal((await tick(j.draftId,{due:true})).status,'unknown');assert.equal(publishes,2);await tick(j.draftId);assert.equal(publishes,2);
 j=await prepare();await invoke('schedule',fields(j));assert.equal((await tick(j.draftId,{due:true,crash:true})).status,'unknown');assert.equal(publishes,2);
 for(let i=0;i<17;i++){const extra=await prepare();await invoke('schedule',fields(extra));}
 const first=await(await invoke('schedules')).json();assert.equal(first.items.length,20);assert.equal(first.nextCursor,'20');
 const second=await(await invoke('schedules',{after:first.nextCursor})).json();assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
 }finally{await mf.dispose();}
});
