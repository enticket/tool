import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDesign,coverScene,coverSvg,PT,weekLabel} from '../src/weekly-design.mjs';

test('layer settings preserve exact point sizes and reject executable or unbounded fields',()=>{
  const design={version:1,layers:{title:{fontSize:165,x:90,color:'#ac1010'},texture:{opacity:81},handle:{visible:false}}};
  assert.deepEqual(normalizeDesign(design),design);
  assert.ok(Math.abs((170-165)*PT-20/3)<1e-12);
  for(const layers of [{title:{fontSize:NaN}},{title:{fontSize:221}},{texture:{opacity:-1}},{title:{x:1081}},
    {title:{color:'url(javascript:alert(1))'}},{handle:{text:'x'.repeat(101)}},{title:{html:'<script>'}},
    {unknown:{visible:true}},{paper:{visible:'false'}}])assert.throws(()=>normalizeDesign({version:1,layers}));
  assert.throws(()=>normalizeDesign({version:99,layers:{}}));
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
