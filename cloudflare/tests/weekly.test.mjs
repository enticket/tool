import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {dateOnly,weekOf,performanceInput,parsePerformanceCaption,parsePerformancePrice,withCaptionPrice} from '../src/weekly.mjs';

test('Korean Monday weeks, month/year boundaries and real session dates',()=>{
 assert.deepEqual(weekOf('2026-11-22'),{start:'2026-11-16',end:'2026-11-22',title:'2026년 11월 셋째 주 공연'});
 assert.equal(weekOf('2027-01-01').title,'2026년 12월 넷째 주 공연');
 assert.equal(weekOf('2026-11-01').start,'2026-10-26');
 assert.equal(dateOnly('2026-02-30'),false);assert.equal(dateOnly('2028-02-29'),true);
 const p={title:'공연',venue:'극장',priceKind:'unknown',price:'',bookingUrl:'',description:'',status:'verified',sessions:[{date:'2026-11-16',time:''}]};
 assert.equal(performanceInput(p).sessions[0].time,'');
 assert.throws(()=>performanceInput({...p,sessions:[{date:'2026-11-16',time:'24:00'}]}));
 assert.throws(()=>performanceInput({...p,sessions:[p.sessions[0],p.sessions[0]]}));
 assert.throws(()=>performanceInput({...p,bookingUrl:'javascript:alert(1)'}));
});

test('persistent library, conflict control, immutable carousel, concurrent publication and lost responses',async()=>{
 let next=100,publishes=0,lost=false,processing=false,connectionFails=false;const remote=[];
 const mf=new Miniflare(convertV4MiniflareOptions({modules:['worker.mjs','weekly.mjs','weekly-design.mjs','instagram-job.mjs','instagram.mjs','instagram-caption.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+name,import.meta.url))})),compatibilityDate:'2026-10-13',bindings:{GOOGLE_CLIENT_ID:'client',ALLOWED_EMAILS:'staff@test.example',INSTAGRAM_ACCOUNT_ID:'123',INSTAGRAM_ACCESS_TOKEN:'synthetic'},durableObjects:{INSTAGRAM_JOBS:{className:'InstagramJob',useSQLite:true}},outboundService:async r=>{
  const u=new URL(r.url);if(u.hostname==='oauth2.googleapis.com')return Response.json({aud:'client',email:'staff@test.example',email_verified:true,expires_in:300});
  assert.equal(u.hostname,'graph.facebook.com');remote.push({path:u.pathname,body:r.method==='POST'?await r.json():null});
  if(u.pathname.endsWith('/media_publish')){publishes++;return lost?new Response('lost',{status:502}):Response.json({id:'777'});}
  if(u.pathname.endsWith('/media')&&r.method==='GET')return Response.json({data:[{id:'222',caption:'🎭 공연\n일시: 2026.11.16 오후 7시',media_type:'IMAGE',media_url:'https://scontent.cdninstagram.com/test.jpg',timestamp:'2026-11-01T00:00:00Z'}]});
  if(u.pathname.endsWith('/media'))return Response.json({id:String(++next)});
  if(u.searchParams.get('fields')==='status_code')return Response.json({status_code:processing?'IN_PROGRESS':'FINISHED'});
  if(connectionFails)return Response.json({error:{code:190}},{status:400});
  return Response.json({id:'123',username:'test'});
 }}));
 const call=async(action,fields={},token='google')=>{const f=new FormData();if(token)f.set('access_token',token);f.set('action',action);for(const[k,v]of Object.entries(fields)){if(Array.isArray(v))v.forEach(x=>f.append(k,x));else f.set(k,v);}const r=new Request('https://tools.enticket.kr/api/weekly',{method:'POST',body:f});return mf.dispatchFetch(r.url,{method:'POST',headers:Object.fromEntries(r.headers),body:await r.arrayBuffer()});};
 const ok=async(action,fields)=>{const r=await call(action,fields);const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
 const jpeg=new Uint8Array([255,216,255,192,0,17,8,5,70,4,56,3,1,17,0,2,17,0,3,17,0,255,217]);
 const file=()=>new File([jpeg],'test.jpg',{type:'image/jpeg'});
 const p={title:'<img src=x onerror=alert(1)> 공연',venue:'극장',priceKind:'unknown',price:'',bookingUrl:'',description:'원문',status:'verified',sessions:[{date:'2026-11-16',time:''},{date:'2026-11-22',time:'19:00'}],version:0,sourcePostId:'222',sourceAsset:'0'};
 try{
  assert.equal((await call('list',{},null)).status,400);
  const sources=await ok('sources');assert.equal(sources.items[0].suggestion.sessions[0].date,'2026-11-16');assert.equal(sources.items[0].suggestion.sessions[0].time,'19:00');
  const id=crypto.randomUUID();let saved=(await ok('performance',{id,data:JSON.stringify(p),file:file()})).performance;
  assert.equal((await call('performance',{id,data:JSON.stringify(p)})).status,409);
  assert.equal((await call('performance',{id:crypto.randomUUID(),data:JSON.stringify(p),file:file()})).status,409);
  assert.equal((await ok('list')).performances.length,1);
  assert.deepEqual(new Uint8Array(await(await call('asset',{id:saved.assetId})).arrayBuffer()),jpeg);
  const secondId=crypto.randomUUID();const second=(await ok('performance',{id:secondId,data:JSON.stringify({...p,sourcePostId:''}),file:file()})).performance;
  const moves=[{id,version:saved.version,sessions:[{date:'2026-11-17',time:''},{date:'2026-11-22',time:'19:00'}]},{id:secondId,version:second.version,sessions:[{date:'2026-11-18',time:'19:00'}]}];
  assert.equal((await call('calendar-save',{data:JSON.stringify([moves[0],{...moves[1],version:0}])})).status,409);
  assert.deepEqual((await ok('list')).performances.find(x=>x.id===id).sessions,p.sessions);
  assert.equal((await call('calendar-save',{data:JSON.stringify([{...moves[0],sessions:[{date:'2026-02-30',time:''}]}])})).status,400);
  const moved=(await ok('calendar-save',{data:JSON.stringify(moves)})).performances;
  assert.deepEqual(moved[0].sessions,moves[0].sessions);assert.equal(moved[0].assetId,saved.assetId);assert.equal(moved[0].title,p.title);
  assert.equal(moved[1].version,second.version+1);
  assert.equal((await call('calendar-save',{data:JSON.stringify(moves)})).status,409);
  saved=(await ok('calendar-save',{data:JSON.stringify([{id,version:moved[0].version,sessions:p.sessions}])})).performances[0];
  await ok('delete',{id:secondId,data:JSON.stringify({version:moved[1].version})});
  const draftInput={week:'2026-11-16',title:'2026년 11월 셋째 주 공연',subtitle:'',closing:'엔티켓',caption:'검토한 캡션',version:0,cards:[{performanceId:id,title:'카드 제목',schedule:'11.16 / 11.22 19:00',venue:'극장',price:''}]};
  const make=async()=>{const id=crypto.randomUUID();return (await ok('draft',{id,data:JSON.stringify(draftInput)})).draft;};
  let d=await make();
  assert.equal(d.template,'classic');
  draftInput.cards[0].description='카드에 편집한 공연 소개';
  assert.equal((await call('draft',{id:d.id,data:JSON.stringify({...draftInput,version:d.version,template:'invalid'})})).status,400);
  assert.equal((await call('draft',{id:crypto.randomUUID(),data:JSON.stringify({...draftInput,template:'poster-news'})})).status,400);
  assert.equal((await call('draft',{id:d.id,data:JSON.stringify({...draftInput,version:d.version,template:'poster-news'})})).status,400);
  for(const template of ['editorial','midnight','ticket','gallery','paper-editorial']){
    const title=draftInput.title;
    d=(await ok('draft',{id:d.id,data:JSON.stringify({...draftInput,title,version:d.version,template})})).draft;
    assert.equal(d.cards[0].description,'카드에 편집한 공연 소개');
    assert.equal(d.template,template);const listed=(await ok('list')).drafts.find(v=>v.id===d.id);assert.equal(listed.template,template);assert.equal(listed.title,title);
  }

  const design={version:1,layers:{title:{fontSize:165,x:80},texture:{opacity:83},handle:{visible:false}}};
  d=(await ok('draft',{id:d.id,data:JSON.stringify({...draftInput,template:'paper-editorial',design,version:d.version})})).draft;
  assert.deepEqual(d.design,design);
  assert.deepEqual((await ok('list')).drafts.find(v=>v.id===d.id).design,design);
  assert.equal((await call('draft',{id:d.id,data:JSON.stringify({...draftInput,template:'paper-editorial',design:{version:1,layers:{title:{fontSize:999}}},version:d.version})})).status,400);
  const studio={version:2,layers:design.layers,objects:[{id:'object-test',name:'안내',type:'text',x:200,y:500,width:400,height:200,color:'#222222',text:'추가 문구',fontSize:30,angle:15,locked:true}],order:['object-test','title'],pages:{['performance:'+id]:{layers:{poster:{x:80,width:550}},objects:[],order:[]}}};
  d=(await ok('draft',{id:d.id,data:JSON.stringify({...draftInput,template:'paper-editorial',design:studio,version:d.version})})).draft;
  assert.deepEqual(d.design,studio);assert.deepEqual((await ok('list')).drafts.find(v=>v.id===d.id).design,studio);

  connectionFails=true;assert.equal((await call('prepare',{id:d.id,version:d.version,file:[file(),file(),file()]})).status,503);
  d=(await ok('list')).drafts[0];assert.equal(d.status,'draft');assert.equal(d.jobId,undefined);connectionFails=false;
  assert.equal((await call('delete',{id,data:JSON.stringify({version:1})})).status,409);
  assert.equal((await call('draft',{id:d.id,data:JSON.stringify(draftInput)})).status,409);
  assert.equal((await call('prepare',{id:d.id,version:d.version,file:[file(),file()]})).status,400);
  d=(await ok('prepare',{id:d.id,version:d.version,file:[file(),file(),file()]})).draft;
  assert.equal(d.status,'prepared');assert.equal(publishes,0);
  assert.deepEqual(new Uint8Array(await(await call('rendered',{id:d.id,index:2})).arrayBuffer()),jpeg);
  assert.equal((await call('draft',{id:d.id,data:JSON.stringify({...draftInput,version:d.version})})).status,409);
  assert.equal((await call('publish',{id:d.id,fingerprint:d.job.fingerprint})).status,409);
  processing=true;d=(await ok('publish',{id:d.id,fingerprint:d.job.fingerprint,confirm:'publish'})).draft;assert.equal(d.status,'processing');assert.equal(publishes,0);
  processing=false;await Promise.all(Array.from({length:3},()=>ok('publish',{id:d.id,fingerprint:d.job.fingerprint,confirm:'publish'})));
  assert.equal(publishes,1);d=(await ok('status',{id:d.id})).draft;assert.equal(d.status,'published');
  const children=remote.filter(r=>r.body?.is_carousel_item);assert.equal(children.length,3);
  assert.deepEqual(children.map(c=>c.body.image_url.slice(-1)),['0','1','2']);
  assert.equal(remote.filter(r=>r.body?.media_type==='CAROUSEL').length,1);
  // Publish images require their capability; durable poster files are authenticated only.
  assert.equal((await mf.dispatchFetch('https://tools.enticket.kr/instagram-media/'+d.jobId+'/wrong/0')).status,404);
  lost=true;d=await make();d=(await ok('prepare',{id:d.id,version:d.version,file:[file(),file(),file()]})).draft;
  d=(await ok('publish',{id:d.id,fingerprint:d.job.fingerprint,confirm:'publish'})).draft;assert.equal(d.status,'unknown');assert.equal(publishes,2);
  await ok('publish',{id:d.id,fingerprint:d.job.fingerprint,confirm:'publish'});assert.equal(publishes,2);
  assert.equal((await call('unlock',{id:d.id})).status,409);
  assert.equal((await ok('list')).drafts.length,2);
  lost=false;d=await make();d=(await ok('prepare',{id:d.id,version:d.version,file:[file(),file(),file()]})).draft;
  const abandonedId=d.jobId;d=(await ok('unlock',{id:d.id})).draft;assert.equal(d.status,'draft');assert.equal(d.jobId,undefined);
  const ns=await mf.getDurableObjectNamespace('INSTAGRAM_JOBS');const abandoned=await(await ns.get(ns.idFromName(abandonedId)).fetch('https://job/snapshot',{method:'POST'})).json();assert.equal(abandoned.status,'cancelled');
  d=(await ok('draft',{id:d.id,data:JSON.stringify({...draftInput,version:d.version,caption:'다시 검토'})})).draft;
  d=(await ok('prepare',{id:d.id,version:d.version,file:[file(),file(),file()]})).draft;assert.notEqual(d.jobId,abandonedId);assert.equal(d.job.caption,'다시 검토');
 }finally{await mf.dispose();}
});


test('Instagram caption dates are performance sessions, never ticket deadlines or publication dates',()=>{
 const parse=parsePerformanceCaption;
 let result=parse('🎭 작은 음악회\n📅 일시 | 2026.11.16.(월) 오후 7시 30분\n📍 장소 | 아트홀\n예매 오픈 2026.11.01. 10:00');
 assert.equal(result.title,'작은 음악회');assert.equal(result.venue,'아트홀');assert.deepEqual(result.sessions,[{date:'2026-11-16',time:'19:30'}]);
 assert.deepEqual(parse('공연명: 두 회차\n일시: 2026년 11월 16일 14:00, 19:00\n11월 22일 오후 3시').sessions,[{date:'2026-11-16',time:'14:00'},{date:'2026-11-16',time:'19:00'},{date:'2026-11-22',time:'15:00'}]);
 assert.deepEqual(parse('콘서트\n일시: 2026-11-16').sessions,[{date:'2026-11-16',time:''}]);
 for(const caption of ['공연\n예매 오픈: 2026.11.16','공연\n일시: 11월 16일','공연\n일시: 2026.02.30','공연\n일시: 2026.11.16.(화)','공연\n일시: 2026.11.16 ~ 2026.11.22']) assert.equal(parse(caption).sessions.length,0,caption);
 assert.equal(parse('일시: 2026.11.16 7시').sessions[0].time,'');
 assert.equal(parse('일시: 2026.11.16 오후 12시').sessions[0].time,'12:00');
 assert.equal(parse('일시: 2026.11.16 오전 12시').sessions[0].time,'00:00');
 assert.equal(parse('엔티켓 새 소식!').eligible,false);
});


test('caption ticket prices populate new and existing unknown performances without overwriting edits',()=>{
 const parse=parsePerformancePrice;
 assert.equal(parse('관람료: 전석 20,000원 (회원 20% 할인)').priceKind,'paid');
 assert.deepEqual(parse('관람료: 전석 20,000원'),{priceKind:'paid',price:'전석 20,000원'});
 assert.deepEqual(parse('가격 | R석 5만원, S석 30,000원'),{priceKind:'paid',price:'R석 5만원, S석 30,000원'});
 assert.deepEqual(parse('티켓 가격\nR석 50,000원\nS석 30,000원'),{priceKind:'paid',price:'R석 50,000원 · S석 30,000원'});
 for(const text of ['관람료: 무료','전석 무료','무료 관람','입장료: 0원'])assert.equal(parse(text).priceKind,'free',text);
 for(const text of ['무료 주차','할인 5,000원','배송료 3,000원','예매 오픈 2026.11.16'])assert.equal(parse(text).priceKind,'unknown',text);
 assert.equal(parsePerformanceCaption('공연\n일시: 11월 16일\n가격: 전석 10,000원').priceKind,'paid');
 const original={priceKind:'unknown',price:'',description:'관람료: 20,000원'};
 assert.equal(withCaptionPrice(original).price,'20,000원');assert.equal(original.priceKind,'unknown');
 assert.equal(withCaptionPrice({...original,priceKind:'free'}).priceKind,'free');
 assert.equal(withCaptionPrice({...original,priceKind:'paid',price:'10,000원'}).price,'10,000원');
});
