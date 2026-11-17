// Shared, versioned scene model. The public build embeds this module verbatim
// (without export keywords); the Worker validates the same allowlisted fields.
export const DESIGN_VERSION = 1;
export const SERIF = 'Enticket Myeongjo';
export const PT = 96 / 72;
export const LAYERS = [
  {id:'paper', name:'배경', type:'background', color:'#fff1e1'},
  {id:'corner', name:'붉은 곡선', type:'corner', color:'#bc0808', x:0, y:0},
  {id:'texture', name:'종이 질감', type:'texture', opacity:90},
  {id:'topRule', name:'상단 구분선', type:'line', color:'#111111', x:65, y:110, width:950},
  {id:'bottomRule', name:'하단 구분선', type:'line', color:'#b80808', x:73, y:1118, width:560},
  {id:'handle', name:'인스타 계정', type:'text', color:'#111111', x:1016, y:40, fontSize:29, text:'@en__ticket', align:'right', family:'sans', width:600},
  {id:'title', name:'제목', type:'text', color:'#b80808', x:72, y:158, fontSize:170, width:950, leading:1.07},
  {id:'subtitle', name:'주간 · 지역', type:'text', color:'#111111', x:72, y:927, fontSize:43, width:950},
  {id:'count', name:'공연 수', type:'text', color:'#111111', x:72, y:1014, fontSize:43, width:950},
  {id:'date', name:'기간', type:'text', color:'#b80808', x:72, y:1175, fontSize:76, width:950},
];
const invalid = () => { throw new Error('weekly_invalid_design'); };
export function normalizeDesign(input) {
  if(input === undefined || input === null) return {version:DESIGN_VERSION,layers:{}};
  if(typeof input !== 'object' || Array.isArray(input) || input.version !== DESIGN_VERSION ||
    !input.layers || typeof input.layers !== 'object' || Array.isArray(input.layers)) invalid();
  const layers={};
  for(const [id, values] of Object.entries(input.layers)) {
    const spec=LAYERS.find(l=>l.id===id);
    if(!spec || !values || typeof values!=='object' || Array.isArray(values)) invalid();
    const clean={};
    for(const [key,value] of Object.entries(values)) {
      if(key==='visible') {if(typeof value!=='boolean')invalid();clean[key]=value;}
      else if(key==='color' && spec.color) {if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))invalid();clean[key]=value;}
      else if(key==='text' && spec.type==='text' && !['title','subtitle','count'].includes(id)) {
        if(typeof value!=='string'||value.length>100)invalid();clean[key]=value;
      } else {
        const range=key==='x'&&spec.x!==undefined?[-1080,1080]:key==='y'&&spec.y!==undefined?[-1350,1350]:
          key==='fontSize'&&spec.type==='text'?[12,220]:key==='opacity'&&spec.type==='texture'?[0,100]:null;
        if(!range||typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])invalid();
        clean[key]=Math.round(value*100)/100;
      }
    }
    layers[id]=clean;
  }
  return {version:DESIGN_VERSION,layers};
}
export function weekLabel(date) {
  const d=new Date(date+'T00:00:00Z');
  return `${d.getUTCMonth()+1}월 ${['첫째','둘째','셋째','넷째','다섯째'][Math.floor((d.getUTCDate()-1)/7)]} 주 · 인천`;
}
export function coverScene(draft) {
  const design=normalizeDesign(draft.design);
  const content={title:draft.title,subtitle:draft.subtitle,count:`이번 주 공연 ${draft.cards.length}편`,
    date:draft.week.slice(5).replace('-','.')+'—'+draft.weekEnd.slice(5).replace('-','.')};
  return LAYERS.map(base=>({...base,visible:true,...(content[base.id]!==undefined?{text:content[base.id]}:{}),...design.layers[base.id]}));
}
export function fontFor(layer) {return `800 ${layer.fontSize*PT}px ${layer.family==='sans'?'system-ui, sans-serif':`"${SERIF}", serif`}`;}
export function textRows(ctx,layer) {
  ctx.font=fontFor(layer);
  const rows=[];
  for(const paragraph of String(layer.text||'').split('\n')) {
    let row='';
    for(const char of paragraph) {if(row&&ctx.measureText(row+char).width>layer.width){rows.push(row);row='';}row+=char;}
    rows.push(row);
  }
  return rows;
}
export function layerBounds(ctx,layer) {
  if(layer.type==='text') {
    const rows=textRows(ctx,layer),width=Math.max(1,...rows.map(r=>ctx.measureText(r).width));
    return {x:layer.x-(layer.align==='right'?width:0),y:layer.y,width,height:rows.length*layer.fontSize*PT*(layer.leading||1.2)};
  }
  if(layer.type==='line')return {x:layer.x,y:layer.y-10,width:layer.width,height:20};
  return {x:0,y:0,width:1080,height:1350};
}
export function paintScene(ctx,scene,texture) {
  ctx.clearRect(0,0,1080,1350);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1080,1350);
  for(const layer of scene) {
    if(!layer.visible)continue;
    ctx.save();ctx.fillStyle=layer.color||'#000';
    if(layer.type==='background')ctx.fillRect(0,0,1080,1350);
    else if(layer.type==='corner') {
      ctx.translate(layer.x,layer.y);ctx.beginPath();ctx.moveTo(535,1350);ctx.bezierCurveTo(740,1280,950,1135,1080,1010);ctx.lineTo(1080,1350);ctx.closePath();ctx.fill();
    } else if(layer.type==='texture'&&texture) {
      ctx.globalAlpha=layer.opacity/100;ctx.globalCompositeOperation='multiply';ctx.drawImage(texture,0,0,1080,1350);
    } else if(layer.type==='line')ctx.fillRect(layer.x,layer.y,layer.width,3);
    else if(layer.type==='text') {
      const rows=textRows(ctx,layer);ctx.textBaseline='top';ctx.textAlign=layer.align||'left';
      rows.forEach((row,i)=>ctx.fillText(row,layer.x,layer.y+i*layer.fontSize*PT*(layer.leading||1.2)));
    }
    ctx.restore();
  }
}
export function validateScene(ctx,scene) {
  for(const layer of scene.filter(l=>l.visible&&l.type==='text')) {
    const b=layerBounds(ctx,layer);
    if(b.x<0||b.y<0||b.x+b.width>1080||b.y+b.height>1350)throw Error(layer.name+'이 이미지 밖으로 나갑니다. 크기나 위치를 조정해 주세요.');
  }
}
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function coverSvg(ctx,scene,{textureData,fontData}) {
  // Every object is a named group. Text remains text; the paper texture alone is raster.
  const out=[`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><style>@font-face{font-family:'${SERIF}';font-weight:800;src:url('${fontData}') format('woff2')}</style></defs><rect width="1080" height="1350" fill="#ffffff"/>`];
  for(const l of scene) {
    out.push(`<g id="${l.id}" inkscape:groupmode="layer" inkscape:label="${xml(l.name)}"${l.visible?'':' display="none"'}>`);
    if(l.type==='background')out.push(`<rect width="1080" height="1350" fill="${l.color}"/>`);
    else if(l.type==='corner')out.push(`<path transform="translate(${l.x} ${l.y})" d="M535 1350 C740 1280 950 1135 1080 1010 L1080 1350 Z" fill="${l.color}"/>`);
    else if(l.type==='texture')out.push(`<image width="1080" height="1350" href="${textureData}" opacity="${l.opacity/100}" style="mix-blend-mode:multiply" preserveAspectRatio="none"/>`);
    else if(l.type==='line')out.push(`<rect x="${l.x}" y="${l.y}" width="${l.width}" height="3" fill="${l.color}"/>`);
    else if(l.type==='text') {
      // Canvas top baseline is the font em box, represented explicitly in SVG.
      out.push(`<text fill="${l.color}" font-family="${l.family==='sans'?'sans-serif':SERIF}" font-size="${l.fontSize*PT}" font-weight="800" text-anchor="${l.align==='right'?'end':'start'}" dominant-baseline="text-before-edge">`);
      textRows(ctx,l).forEach((row,i)=>out.push(`<tspan x="${l.x}" y="${l.y+i*l.fontSize*PT*(l.leading||1.2)}">${xml(row)}</tspan>`));out.push('</text>');
    }
    out.push('</g>');
  }
  out.push('</svg>');return out.join('');
}
