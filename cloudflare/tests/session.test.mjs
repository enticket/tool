import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
test('secure session survives token expiry, renews, expires and is revoked on logout',async()=>{
 let googleCalls=0;
 const source=readFileSync(new URL('../src/worker.mjs',import.meta.url),'utf8').replace('export class LoginSession','class BaseSession')+`
 export class LoginSession extends BaseSession {
 async fetch(r){if(new URL(r.url).pathname==='/expire') {let s=await this.ctx.storage.get('session');s.expiresAt=Date.now()-1;await this.ctx.storage.put('session',s);return Response.json({ok:true});}return super.fetch(r);}}
 `;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:['worker.mjs','instagram.mjs','instagram-job.mjs','instagram-caption.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+name,import.meta.url)),...(name==='worker.mjs'?{contents:source}:{})})),compatibilityDate:'2026-10-13',bindings:{GOOGLE_CLIENT_ID:'client',ALLOWED_EMAILS:'staff@test.example'},durableObjects:{LOGIN_SESSIONS:{className:'LoginSession',useSQLite:true}},outboundService:async()=>{googleCalls++;return Response.json({aud:'client',email:'staff@test.example',email_verified:true,expires_in:300});}}));
 let cookie='';
 async function call(path,token,origin='https://tools.enticket.kr'){
 const form=new FormData();if(token)form.set('access_token',token);
 const r=new Request('https://tools.enticket.kr/api/'+path,{method:'POST',headers:{Origin:origin,Cookie:cookie},body:form});
 return mf.dispatchFetch(r.url,{method:'POST',headers:Object.fromEntries(r.headers),body:await r.arrayBuffer()});
 }
 try{
 assert.equal((await call('session')).status,401);
 let r=await call('session/login','synthetic');assert.equal(r.status,200);
 const header=r.headers.get('set-cookie');assert.match(header,/HttpOnly; Secure; SameSite=Strict; Max-Age=86400/);cookie=header.split(';')[0];
 assert.equal((await call('session')).status,200);assert.equal(googleCalls,1);
 assert.equal((await call('session',null,'https://enticket.github.io')).status,403);
 assert.equal((await call('session/logout',null,'https://evil.example')).status,403);
 assert.equal((await call('session')).status,200);
 assert.equal((await call('session/logout')).status,200);
 assert.equal((await call('session')).status,401);
 r=await call('session/login','synthetic');cookie=r.headers.get('set-cookie').split(';')[0];
 const ns=await mf.getDurableObjectNamespace('LOGIN_SESSIONS');const stub=ns.get(ns.idFromName(cookie.split('=')[1]));
 await stub.fetch('https://session/expire');assert.equal((await call('session')).status,401);
 } finally {await mf.dispose();}
});
