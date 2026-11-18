import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDesign,coverScene,coverSvg,PT,weekLabel,upgradeDesign,pageScene,pageKey,hitLayer} from '../src/weekly-design.mjs';

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

test('closing programme adapts to the weekly line-up and preserves saved layer positions',()=>{
  const card={performanceId:'p1',title:'실내악의 밤',schedule:'11.18 14:00 / 11.18 19:30 / 11.19 14:00',venue:'아트홀'};
  const draft={week:'2026-11-16',weekEnd:'2026-11-22',cards:[card],closing:'다음 주에 만나요.'};
  const scene=()=>pageScene(draft,draft.cards.length+1);
  const layer=id=>scene().find(l=>l.id===id);
  assert.equal(layer('date').text,'11.16—11.22');
  assert.equal(layer('entryDate0').text,'11.18\n11.19');
  assert.equal(layer('entryVenue0').text,'아트홀');
  assert.equal(layer('closingCopy').text,draft.closing);
  const sparseBand=layer('closingBand').height;
  draft.cards=Array.from({length:8},(_,i)=>({...card,performanceId:'p'+i}));
  assert.ok(layer('closingBand').height<sparseBand);
  assert.equal(layer('entryVenue0'),undefined);
  assert.ok(layer('entryTitle7').y<layer('bottomRule').y);
  const cover=pageScene(draft,0),detail=pageScene(draft,1);
  const design=normalizeDesign(),closing={layers:{closingTitle:{x:108}}};
  design.pages.closing=closing;
  draft.design=normalizeDesign(design);
  assert.equal(layer('closingBand'),undefined);
  assert.equal(layer('closingTitle').x,108);
  closing.layout='program';
  closing.layers.closingBand={height:320};
  draft.design=normalizeDesign(design);
  assert.equal(layer('closingBand').height,320);
  assert.equal(layer('closingTitle').x,108);
  assert.deepEqual(pageScene(draft,0),cover);
  assert.deepEqual(pageScene(draft,1),detail);
  assert.throws(()=>normalizeDesign({...design,pages:{'performance:p0':closing}}));
  assert.equal(normalizeDesign({...design,pages:{closing:{layers:{}}}}).pages.closing.layout,'program');
});
