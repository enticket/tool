import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import {formatCaption} from '../src/instagram-caption.mjs';
const data={title:'테스트 공연',description:'',venue:'공연장',age:'',duration:'',price:'',inquiry:'02-123-4567',schedules:[{date:'2026-11-20',time:'19:30',text:'원문'}],tags:['공연','공연','엔티켓','지역','극장','장르','초과']};
const env={GOOGLE_CLIENT_ID:'client',ALLOWED_EMAILS:'staff@example.test',GEMINI_API_KEY:'secret-key'};
function request(file=new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'})){
 const form=new FormData();form.set('access_token','google-token');form.set('file',file,'poster.jpg');
 return new Request('https://tools.enticket.kr/api/instagram/caption',{method:'POST',body:form});
}
test('formats date, inquiry, missing fields and five unique tags',()=>{
 const r=formatCaption(data);assert.match(r.caption,/2026\.11\.20\.\(금\) 오후 7시 30분/);assert.match(r.caption,/문의 \| 02-123-4567/);assert.match(r.caption,/\[좌석 등급·가격\]/);assert.equal(r.caption.match(/#/g).length,5);assert.ok(r.missing.includes('price'));
 assert.match(formatCaption({...data,schedules:[{date:'2026-02-30',time:'19:00',text:'2월 말'}]}).caption,/일시 \| 2월 말/);
});
function mock(t,{allowed=true,status=200,payload}={}){
 const calls=[];t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(String(url).includes('tokeninfo'))return Response.json({aud:'client',expires_in:300,email:allowed?'staff@example.test':'other@example.test',email_verified:true});
  calls.push({url,opts});assert.equal(opts.redirect,'manual');assert.equal(opts.headers['x-goog-api-key'],'secret-key');assert.ok(!opts.body.includes('google-token'));
  return Response.json(payload||{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(data)}]}}]},{status});
 });return calls;
}
test('authorized request returns Gemini caption',async t=>{const calls=mock(t);const r=await worker.fetch(request(),env);assert.equal(r.status,200);assert.match((await r.json()).caption,/테스트 공연/);assert.equal(calls.length,1);});
test('denied identity cannot call Gemini',async t=>{const calls=mock(t,{allowed:false});assert.equal((await worker.fetch(request(),env)).status,403);assert.equal(calls.length,0);});
test('missing key and invalid image fail before Gemini',async t=>{const calls=mock(t);assert.equal((await worker.fetch(request(),{...env,GEMINI_API_KEY:''})).status,503);assert.equal((await worker.fetch(request(new Blob(['bad'],{type:'image/jpeg'})),env)).status,400);assert.equal(calls.length,0);});
for(const [status,code] of [[429,'caption_rate_limited'],[302,'caption_unavailable'],[403,'caption_unavailable']])test('sanitizes error '+status,async t=>{mock(t,{status,payload:{secret:'MUST_NOT_LEAK'}});assert.deepEqual(await (await worker.fetch(request(),env)).json(),{error:code});});
test('rejects malformed model output',async t=>{mock(t,{payload:{candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}});assert.deepEqual(await (await worker.fetch(request(),env)).json(),{error:'caption_invalid_response'});});
