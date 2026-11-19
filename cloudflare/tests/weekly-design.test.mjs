import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDesign,coverScene,coverSvg,PT,weekLabel,weeklyScheduleText,refreshWeeklySchedules,textRows,
  upgradeDesign,pageScene,pageKey,hitLayer,layerBounds,PROFILE_PHOTO,DEFAULT_CLOSING_COPY,refreshClosingCopy} from '../src/weekly-design.mjs';

test('layer settings preserve exact point sizes and reject executable or unbounded fields',()=>{
  const design={version:1,layers:{title:{fontSize:165,x:90,color:'#ac1010'},texture:{opacity:81},handle:{visible:false}}};
  assert.deepEqual(normalizeDesign(design),design);
  assert.ok(Math.abs((170-165)*PT-20/3)<1e-12);
  for(const layers of [{title:{fontSize:NaN}},{title:{fontSize:221}},{texture:{opacity:-1}},{title:{x:1081}},
    {title:{color:'url(javascript:alert(1))'}},{handle:{text:'x'.repeat(101)}},{title:{html:'<script>'}},
    {unknown:{visible:true}},{paper:{visible:'false'}}])assert.throws(()=>normalizeDesign({version:1,layers}));
  assert.throws(()=>normalizeDesign({version:99,layers:{}}));
});

test('studio pages preserve legacy covers, custom geometry, stacking and stable performance keys',()=>{
  const old={version:1,layers:{title:{fontSize:165},texture:{opacity:80}}};
  const design=upgradeDesign(old);assert.equal(design.version,2);assert.deepEqual(design.layers,old.layers);
  design.objects=[{id:'object-example',type:'ellipse',name:'원',x:200,y:300,width:160,height:80,color:'#112233',angle:45,opacity:50,locked:true}];
  design.order=['object-example','title'];
  design.pages={'performance:first':{layers:{poster:{width:550,x:90}},objects:[],order:[]}};
  const saved=normalizeDesign(design),draft={title:'공연',subtitle:'인천',week:'2026-11-16',weekEnd:'2026-11-22',closing:'감사합니다',design:saved,cards:[{performanceId:'first',assetId:'asset-one',title:'첫 공연',schedule:'11.16',venue:'극장',price:''},{performanceId:'second',assetId:'asset-two',title:'두 번째',schedule:'11.17',venue:'극장',price:''}]};
  assert.equal(coverScene(draft).at(-1).id,'title');
  assert.equal(pageKey(draft,1),'performance:first');assert.equal(pageScene(draft,1).find(l=>l.id==='poster').width,550);
  draft.cards.reverse();assert.equal(pageScene(draft,2).find(l=>l.id==='poster').width,550);
  const ctx={measureText:text=>({width:text.length*20})};
  assert.equal(hitLayer(ctx,{type:'rect',x:100,y:100,width:200,height:100,angle:90},200,60),true);
  const svg=coverSvg(ctx,coverScene(draft),{fontData:'data:font/woff2;base64,AA==',textureData:'data:image/png;base64,AA=='});
  assert.match(svg,/<ellipse/);assert.match(svg,/rotate\(45 /);assert.match(svg,/opacity="0.5"/);
});

test('studio model limits reject unknown layer types, URLs, malformed objects and unsupported pages',()=>{
  const base={version:2,layers:{},objects:[],order:[],pages:{}};
  for(const bad of [
    {...base,objects:[{id:'object-a',name:'bad',type:'script',x:0,y:0}]},
    {...base,objects:[{id:'object-a',name:'bad',type:'rect',url:'https://evil.test'}]},
    {...base,layers:{motif:{motif:'alternate-shape'}}},
    {...base,layers:{title:{angle:181}}},
    {...base,layers:{title:{family:'url(evil)'}}},
    {...base,order:['title','title']},
    {...base,pages:{unknown:{layers:{}}}},
    {...base,objects:Array.from({length:41},(_,i)=>({id:'object-'+i,type:'text',name:'text'}))}
  ])assert.throws(()=>normalizeDesign(bad));
  const thin=normalizeDesign({...base,objects:[{id:'object-line',name:'선',type:'line',height:2}]});assert.equal(thin.objects[0].height,2);
});

test('cover scenes bind live content, keep posters out, and export escaped editable SVG groups',()=>{
  const draft={title:'공연이\n있는\n일주일.',subtitle:'11월 셋째 주 · 인천',week:'2026-11-16',weekEnd:'2026-11-22',cards:[{},{}],
    design:{version:1,layers:{title:{fontSize:165},handle:{text:'<img onerror="alert(1)"> & test'},texture:{opacity:75}}}};
  const scene=coverScene(draft);
  assert.equal(scene.find(l=>l.id==='title').text,draft.title);
  assert.equal(scene.find(l=>l.id==='count').text,'이번 주 공연 2편');
  assert.equal(scene.find(l=>l.id==='date').text,'11.16—11.22');
  assert.equal(scene.some(l=>l.type==='poster'),false);
  assert.equal(weekLabel('2026-11-16'),'11월 셋째 주 · 인천');
  const ctx={measureText:text=>({width:text.length*10})};
  const svg=coverSvg(ctx,scene,{fontData:'data:font/woff2;base64,AA==',textureData:'data:image/png;base64,AA=='});
  assert.match(svg,/<g id="title"/);assert.match(svg,/<text[^>]+font-size="220"/);
  assert.match(svg,/&lt;img onerror=&quot;alert\(1\)&quot;&gt; &amp; test/);
  assert.equal(svg.includes('<img onerror='),false);
});

test('closing artwork is independent of the line-up and respects existing closing edits',()=>{
  const draft={week:'2026-11-16',weekEnd:'2026-11-22',cards:[],closing:'엔티켓에서 만나요.'};
  const scene=()=>pageScene(draft,draft.cards.length+1);
  const empty=scene();
  assert.deepEqual(empty.filter(l=>l.type==='text').map(l=>l.text),['@en__ticket','인천\n공연 소식',draft.closing]);
  const avatar=empty.find(l=>l.id==='profilePhoto');
  assert.equal(avatar.assetId,PROFILE_PHOTO);assert.equal(avatar.round,true);
  const card={performanceId:'p1',title:'실내악의 밤',schedule:'11.18 14:00',venue:'아트홀'};
  for(const count of [1,3,8]){
    draft.cards=Array.from({length:count},(_,i)=>({...card,performanceId:'p'+i}));
    assert.deepEqual(scene(),empty);
    assert.equal(pageScene(draft,count).find(l=>l.id==='title').text,card.title);
  }

  const closing={layers:{closingTitle:{text:'또 만나요.'},closingCopy:{x:108},entryTitle0:{fontSize:20}},
    order:['entryTitle0','closingTitle'],objects:[{id:'object-rule',type:'line',name:'선',x:90,y:130}]};
  const cover=pageScene(draft,0),detail=pageScene(draft,1);
  for(const page of [closing,{...closing,layout:'program'}]){
    draft.design=normalizeDesign({...normalizeDesign(),pages:{closing:page}});
    const saved=scene();
    assert.equal(saved.find(l=>l.id==='closingTitle').text,'또 만나요.');
    assert.equal(saved.find(l=>l.id==='closingCopy').x,108);
    assert.equal(saved.find(l=>l.id==='closingCopy').align,'left');
    assert.ok(saved.some(l=>l.id==='object-rule'));
    assert.ok(saved.every(l=>!l.id.startsWith('entry')));
    assert.deepEqual(pageScene(draft,0),cover);
    assert.deepEqual(pageScene(draft,1),detail);
  }
  assert.throws(()=>normalizeDesign({...draft.design,pages:{'performance:p0':{...closing,layout:'program'}}}));
  draft.design=normalizeDesign({...draft.design,pages:{closing:{layers:{},order:['paper','texture','closingTitle','closingCopy']}}});
  const stacked=scene().map(l=>l.id);
  assert.equal(stacked.indexOf('ticketStock'),stacked.indexOf('paper')+1);
  assert.ok(stacked.indexOf('closingTitle')>stacked.indexOf('ticketStock'));
  assert.ok(stacked.indexOf('profilePhoto')>stacked.indexOf('paper'));
  assert.ok(stacked.indexOf('handle')>stacked.indexOf('paper'));
  draft.design=normalizeDesign({...draft.design,pages:{closing:{layout:'ticket',layers:{closingTitle:{x:556},ticketStock:{locked:false,width:930}}}}});
  assert.equal(scene().find(l=>l.id==='closingTitle').align,'center');
  assert.equal(scene().find(l=>l.id==='ticketStock').width,930);
});

test('closing ticket inherits the cover palette and preserves the profile photo',()=>{
  const palette={paper:'#ffe4ce',corner:'#a52d1d',title:'#962512',handle:'#252321',subtitle:'#342822'};
  const design=normalizeDesign();
  const draft={week:'2026-11-16',weekEnd:'2026-11-22',cards:[],design};
  const profile=pageScene(draft,1).find(layer=>layer.id==='profilePhoto');
  for(const [id,color] of Object.entries(palette))design.layers[id]={color};
  const closing=Object.fromEntries(pageScene(draft,1).map(layer=>[layer.id,layer]));
  assert.deepEqual([closing.ticketStock.color,closing.paper.color,closing.closingTitle.color,closing.handle.color,closing.closingCopy.color],
    [palette.paper,palette.corner,palette.title,palette.handle,palette.subtitle]);
  assert.deepEqual(closing.profilePhoto,profile);
});

test('editable closing copy adopts the follow invitation and the public ticketing domain',()=>{
  for(const closing of ['팔로우하고 매주 인천 공연 소식을 받아보세요.\nenticket.com','enticket.kr · @en__ticket','공연의 자세한 안내는 엔티켓에서\nenticket.kr · @en__ticket','@en__ticket을 팔로우하고\n매주 인천 공연 소식을 받아보세요.\nenticket.com']){
    const draft={closing};
    assert.equal(refreshClosingCopy(draft),true);
    assert.equal(draft.closing,DEFAULT_CLOSING_COPY);
    assert.match(draft.closing,/팔로우/);
    assert.match(draft.closing,/enticket\.com$/);
    assert.equal(refreshClosingCopy(draft),false);
    const locked={closing,jobId:'review'};
    assert.equal(refreshClosingCopy(locked),false);
    assert.equal(locked.closing,closing);
  }
  const draft={closing:'예매는 https://www.enticket.kr/show 에서. 도구는 tools.enticket.kr',
    design:{pages:{closing:{layers:{closingTitle:{text:'이번 주의\n커튼콜.'},closingCopy:{text:'내 문구 · enticket.kr'}},objects:[{type:'text',text:'자세히 보기 enticket.kr.'}]}}}};
  assert.equal(refreshClosingCopy(draft),true);
  assert.equal(draft.closing,'예매는 https://enticket.com/show 에서. 도구는 tools.enticket.kr');
  assert.equal(draft.design.pages.closing.layers.closingTitle.text,'인천\n공연 소식');
  assert.equal(draft.design.pages.closing.layers.closingCopy.text,'내 문구 · enticket.com');
  assert.equal(draft.design.pages.closing.objects[0].text,'자세히 보기 enticket.com.');
});

test('legacy introductions take up no space between the poster, title and details',()=>{
  const card={performanceId:'p',assetId:'img',title:'작은 음악회',schedule:'11.20 19:30',venue:'아트홀',price:''};
  const draft={week:'2026-11-16',weekEnd:'2026-11-22',cards:[card]};
  const oldPage={layers:{description:{text:'편집한 소개',visible:true},date:{visible:true},handle:{text:'@en__ticket'}},
    order:['paper','description','date','handle']};
  const legacy={...draft,cards:[{...card,description:'저장된 소개'}],design:{...normalizeDesign(),pages:{'performance:p':oldPage}}};
  const ctx={measureText(s){return {width:s.length*parseFloat(this.font.match(/([\d.]+)px/)[1])};}};
  for(const [width,height] of [[450,800],[800,450],[600,600]]){
    const scene=pageScene(draft,1,ctx,{img:{width,height}});
    const layer=id=>scene.find(l=>l.id===id);
    const poster=layer('poster');
    assert.equal(poster.topLeft,true);
    assert.equal(poster.x+poster.width/2,540);
    assert.equal(layer('title').fontSize,36.8);
    assert.equal(layer('schedule').fontSize,20);
    assert.equal(layer('scheduleLabel').fontSize,18.4);
    assert.ok(layerBounds(ctx,layer('number')).y+layerBounds(ctx,layer('number')).height<poster.y);
    const paintedBottom=poster.y+Math.min(poster.height,poster.width*height/width);
    assert.ok(layer('title').y>=paintedBottom+63.99);
    assert.equal(layer('description'),undefined);
    const older=pageScene(legacy,1,ctx,{img:{width,height}});
    assert.ok(older.every(l=>!['description','date','handle'].includes(l.id)));
    for(const id of ['poster','title','topRule','schedule','venue']){
      assert.deepEqual(older.find(l=>l.id===id),layer(id));
    }
    assert.ok(layer('schedule').y>layer('title').y);
    assert.equal(layer('priceLabel').text,'');
    assert.match(coverSvg(ctx,scene,{imageData:{img:'data:image/jpeg;base64,AA=='}}),/xMinYMin meet/);
  }
});

test('poster fills the space left by performance details up to the footer or side margin',()=>{
  const ctx={measureText(s){return {width:s.length*20};}};
  const card={assetId:'img',performanceId:'show',title:'음악회',schedule:'11.20 19:30',venue:'아트홀'};
  const draft={week:'2026-11-16',weekEnd:'2026-11-22',cards:[card]};
  function layout(card,width,height){
    const scene=pageScene({...draft,cards:[card]},1,ctx,{img:{width,height}});
    return Object.fromEntries(scene.map(layer=>[layer.id,layerBounds(ctx,layer)]));
  }
  const portrait=layout(card,3,4);
  assert.ok(portrait.poster.height>900);
  assert.equal(portrait.poster.width,portrait.poster.height*3/4);
  assert.equal(Math.round(portrait.bottomRule.y-portrait.venue.y-portrait.venue.height),24);
  const busy=layout({...card,schedule:Array(10).fill('11.20 19:30').join(' / '),price:'전석 20,000원'},3,4);
  assert.ok(busy.poster.height<portrait.poster.height);
  assert.equal(Math.round(busy.bottomRule.y-busy.price.y-busy.price.height),24);
  const wide=layout(card,16,9);
  assert.ok(wide.poster.width<=wide.topRule.width);
  assert.equal(wide.poster.height,wide.poster.width*9/16);
  assert.equal(wide.poster.y,portrait.poster.y);
  const cards=[card,{...card,performanceId:'other',assetId:'wide',title:'아주 긴 공연 제목 '.repeat(8),schedule:'11월 20일 (금) 오후 07시 / 11월 21일 (토) 오후 08시',price:'일반석'}];
  const scenes=cards.map((_,i)=>pageScene({...draft,cards},i+1,ctx,{img:{width:3,height:4},wide:{width:16,height:9}}));
  for(const id of ['poster','title','schedule','venue','price']){
    const [a,b]=scenes.map(scene=>scene.find(l=>l.id===id));
    assert.equal(a.y,b.y,id);
    if(id==='poster')assert.equal(a.x+a.width/2,b.x+b.width/2);
    else assert.equal(a.x,b.x,id);
  }
  draft.design={...normalizeDesign(),pages:{'performance:show':{layers:{title:{y:850}}}}};
  const edited=layout(card,3,4);
  assert.equal(edited.title.y,850);
  assert.equal(edited.poster.y+edited.poster.height+64,850);
});

test('upcoming posters follow page order at full opacity and fit even an eight-show week',()=>{
  const cards=Array.from({length:8},(_,i)=>({performanceId:'show'+i,assetId:'img'+i,title:'공연 '+i,schedule:'11.20',venue:'아트홀'}));
  const draft={week:'2026-11-16',weekEnd:'2026-11-22',cards,design:normalizeDesign()};
  // Old drafts can have explicit transparency and a full layer order for the retired duplicate.
  const page={layers:{posterReflection:{opacity:24}},order:['paper','texture','posterReflection','poster','number']};
  draft.design.pages['performance:show0']=page;
  const images=Object.fromEntries(cards.map((c,i)=>[c.assetId,i%2?{width:16,height:9}:{width:3,height:4}]));
  const scene=index=>pageScene(draft,index,undefined,images);
  for(let index=1;index<=cards.length;index++){
    const layers=scene(index),front=layers.find(l=>l.id==='poster');
    const backs=layers.filter(l=>l.id.startsWith('nextPoster')).reverse();
    const neighbors=[cards[index],cards[index-2]].filter(Boolean);
    assert.deepEqual(backs.map(l=>l.assetId),neighbors.map(c=>c.assetId));
    for(const layer of backs){
      const leftSide=layer.assetId===cards[index-2]?.assetId;
      assert.equal(front.angle,0);
      assert.equal(layer.angle,leftSide?-5:5);
      const edge=leftSide?layer.x:layer.x+layer.width;
      assert.ok(leftSide?edge<front.x:edge>front.x+front.width);
      assert.ok(layer.x+layer.width>front.x&&layer.x<front.x+front.width);
      assert.ok(edge>=66&&edge<=1014.001);
      assert.equal(layer.opacity,100);
      assert.ok(layer.width<=front.width*.781);
      assert.ok(layer.y+layer.height<=layers.find(l=>l.id==='title').y);
      assert.ok(layers.indexOf(layer)<layers.indexOf(front));
    }
    assert.ok(!layers.some(l=>l.id==='posterReflection'));
  }
  assert.ok(![...scene(0),...scene(9)].some(l=>l.id.startsWith('nextPoster')));
  assert.ok(!pageScene(draft,1).some(l=>l.id.startsWith('nextPoster')));
  page.layers.nextPoster1={locked:true};
  [cards[1],cards[2]]=[cards[2],cards[1]];
  const next=scene(1).find(l=>l.id==='nextPoster1');
  assert.equal(next.assetId,'img2');
  assert.equal(next.locked,true);
  delete images.img2;
  assert.ok(!scene(1).some(l=>l.id.startsWith('nextPoster')));
  images.img2={width:3,height:4};
  page.layers.poster={width:948,height:600};
  images.img0={width:16,height:9};
  const full=scene(1),front=full.find(l=>l.id==='poster');
  const frontsBottom=front.y+front.width*9/16;
  const edges=full.filter(l=>l.id.startsWith('nextPoster')).reverse().map(l=>l.y+l.height);
  const bottomGaps=edges.map((edge,i)=>edge-(edges[i-1]??frontsBottom));
  assert.ok(bottomGaps.every((gap,i)=>gap>0&&gap<(bottomGaps[i-1]??Infinity)));
  assert.ok(edges.at(-1)<full.find(l=>l.id==='title').y);
  page.layers.poster.visible=false;
  assert.ok(!scene(1).some(l=>l.id.startsWith('nextPoster')));
});
test('short lineups only show distinct available neighbors',()=>{
  const cards=Array.from({length:5},(_,i)=>({performanceId:'p'+i,assetId:'img'+i,title:'공연 '+i}));
  for(let n=1;n<=5;n++){
    const draft={week:'2026-11-16',weekEnd:'2026-11-22',cards:cards.slice(0,n)};
    const images=Object.fromEntries(draft.cards.map(c=>[c.assetId,{width:600,height:900}]));
    for(let page=1;page<=n;page++){
      const scene=pageScene(draft,page,undefined,images),front=scene.find(l=>l.id==='poster');
      const backs=scene.filter(l=>l.id.startsWith('nextPoster'));
      const expected=draft.cards.slice(Math.max(0,page-2),page+1).map(c=>c.assetId);
      assert.deepEqual([front,...backs].map(l=>l.assetId).sort(),expected.sort());
      assert.equal(backs.some(l=>l.x<front.x),page>1);
      assert.equal(backs.some(l=>l.x+l.width>front.x+front.width),page<n);
    }
  }
});
test('featured templates have distinct covers and keep the weekly lineup on the performance pages',()=>{
  const cards=Array.from({length:8},(_,i)=>({performanceId:'p'+i,assetId:'img'+i,title:'공연 '+i,schedule:'11.18',venue:'극장',price:'무료'}));
  const images=Object.fromEntries(cards.map(c=>[c.assetId,{width:700,height:1000}]));
  const draft={title:'공연이\n있는\n일주일.',subtitle:'11월 셋째 주 · 인천',closing:'엔티켓을 팔로우해 주세요.\nenticket.com',week:'2026-11-16',weekEnd:'2026-11-22',cards};
  const coverLayouts=new Set();
  for(const template of ['paper-editorial','blue-score','stage-marquee','matinee-program']){
    const scene=index=>pageScene({...draft,template},index,undefined,images);
    const cover=scene(0),closing=scene(cards.length+1);
    coverLayouts.add(JSON.stringify(cover.filter(l=>l.visible).map(l=>[l.id,l.type,l.x,l.y,l.width,l.height,l.fontSize])));
    assert.ok(cover.every(l=>!images[l.assetId]),template);
    assert.equal(closing.find(l=>l.id==='profilePhoto').assetId,PROFILE_PHOTO);
    if(template!=='paper-editorial'){
      const design=normalizeDesign({version:2,layers:{motif:{x:100,opacity:70,color:'#184634'}}});
      const edited=coverScene({...draft,template,design}).find(l=>l.id==='motif');
      assert.deepEqual([edited.x,edited.opacity,edited.color],[100,70,'#184634']);
      assert.equal(edited.motif,template);
      assert.equal(closing.find(l=>l.id==='motif').motif,template);
    }
    for(const index of [1,4,8]){
      const detail=scene(index);
      assert.equal(detail.find(l=>l.id==='poster').assetId,cards[index-1].assetId);
      assert.deepEqual(detail.filter(l=>l.id.startsWith('nextPoster')).reverse().map(l=>l.assetId),({1:[1],4:[4,2],8:[6]})[index].map(i=>cards[i].assetId));
    }
  }
  assert.equal(coverLayouts.size,4);
});
test('weekly dates include the weekday, distinguish noon and midnight, and retain every session',()=>{
  const schedule=weeklyScheduleText([
    {date:'2026-12-31',time:'09:05'},{date:'2026-12-31',time:'12:00'},
    {date:'2027-01-01',time:'00:00'},{date:'2027-01-01',time:'19:30'},
    {date:'2027-01-02',time:''},{date:'2027-01-02',time:'14:00'}
  ]);
  const days=['12월 31일 (목) 오전 09시 5분 · 오후 12시','1월 1일 (금) 오전 12시 · 오후 07시 30분','1월 2일 (토)','1월 2일 (토) 오후 02시'];
  assert.equal(schedule,days.join(' / '));
  assert.deepEqual(textRows({measureText(s){return {width:s.length};}},{id:'schedule',text:schedule,width:780,fontSize:25}),days);
  const layer={text:'01.01 00:00'};
  const draft={week:'2026-12-28',cards:[{performanceId:'p',schedule:'12.31 09:05 / 12.31 12:00 / 01.01 00:00 / 01.01 19:30 / 01.02 / 01.02 14:00'},
    {schedule:'12.31 09:05 / 특별 회차'},{schedule:'02.01'}],design:{pages:{'performance:p':{layers:{schedule:layer}}}}};
  assert.equal(refreshWeeklySchedules({...draft,jobId:'locked'}),false);
  assert.equal(refreshWeeklySchedules(draft),true);
  assert.equal(draft.cards[0].schedule,schedule);
  assert.equal(layer.text,'1월 1일 (금) 오전 12시');
  assert.equal(draft.cards[1].schedule,'12.31 09:05 / 특별 회차');
  assert.equal(draft.cards[2].schedule,'02.01');
  assert.equal(refreshWeeklySchedules(draft),false);
});
