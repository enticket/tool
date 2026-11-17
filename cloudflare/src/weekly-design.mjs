// Shared, versioned scene model. The public build embeds this module verbatim
// (without export keywords); the Worker validates the same allowlisted fields.
export const DESIGN_VERSION = 2;
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
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const extraSpec=id=> /^(poster|number|scheduleLabel|schedule|venueLabel|venue|price|closingTitle|closingCopy|entry(?:Title|Date|Number|Line)[0-7])$/.test(id)
  ? {type:id==='poster'?'image':id.startsWith('entryLine')?'line':'text',x:0,y:0,color:'#111111',width:950,height:800} : null;
function settings(values,spec,legacy=false,id='') {
  if(!record(values))invalid();const clean={};
  for(const [key,value]of Object.entries(values)) {
    if(['visible','locked','italic'].includes(key)){if(typeof value!=='boolean'||legacy&&key!=='visible')invalid();clean[key]=value;}
    else if(key==='color'&&spec.color){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))invalid();clean[key]=value;}
    else if(key==='text'&&spec.type==='text'&&(!legacy||!['title','subtitle','count'].includes(id))){if(typeof value!=='string'||value.length>(legacy?100:500))invalid();clean[key]=value;}
    else if(!legacy&&key==='family'&&spec.type==='text'){if(!['serif','sans'].includes(value))invalid();clean[key]=value;}
    else if(!legacy&&key==='align'&&spec.type==='text'){if(!['left','center','right'].includes(value))invalid();clean[key]=value;}
    else {
      const range=key==='x'&&spec.x!==undefined?[-1080,1080]:key==='y'&&spec.y!==undefined?[-1350,1350]:
        key==='fontSize'&&spec.type==='text'?[12,220]:key==='opacity'&&(!legacy||spec.type==='texture')?[0,100]:
        !legacy&&key==='angle'?[-180,180]:!legacy&&['width','height'].includes(key)&&!['background','texture','corner'].includes(spec.type)?[key==='height'&&spec.type==='line'?1:8,2160]:
        !legacy&&key==='leading'&&spec.type==='text'?[.8,2.5]:!legacy&&key==='weight'&&spec.type==='text'?[400,800]:null;
      if(!range||typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])invalid();
      clean[key]=Math.round(value*100)/100;
    }
  }
  return clean;
}
function pageInput(input,cover=false,legacy=false){
  if(!record(input)||!record(input.layers))invalid();
  const layers={};
  for(const [id, values] of Object.entries(input.layers)) {
    const spec=LAYERS.find(l=>l.id===id)||(!cover&&extraSpec(id));if(!spec)invalid();
    layers[id]=settings(values,spec,legacy,id);
  }
  if(legacy)return {layers};
  const objects=input.objects??[],order=input.order??[];
  if(!Array.isArray(objects)||objects.length>40||!Array.isArray(order)||order.length>100)invalid();
  const seen=new Set();
  const cleanObjects=objects.map(object=>{
    if(!record(object)||!/^object-[a-zA-Z0-9-]{1,45}$/.test(object.id)||seen.has(object.id)||!['text','rect','ellipse','line'].includes(object.type))invalid();seen.add(object.id);
    const {id,type,name,...values}=object;
    if(typeof name!=='string'||name.length>80)invalid();
    return {id,type,name,x:80,y:80,width:400,height:type==='line'?3:200,color:'#222222',...(type==='text'?{text:'',fontSize:30}:{}),...settings(values,{type,x:0,y:0,color:'#111111',width:400,height:200})};
  });
  const known=id=>LAYERS.some(l=>l.id===id)||(!cover&&extraSpec(id))||seen.has(id);
  if(new Set(order).size!==order.length||order.some(id=>typeof id!=='string'||!known(id)))invalid();
  return {layers,objects:cleanObjects,order:[...order]};
}
export function normalizeDesign(input) {
  if(input===undefined||input===null)return {version:2,layers:{},objects:[],order:[],pages:{}};
  if(!record(input)||![1,2].includes(input.version))invalid();
  if(input.version===1)return {version:1,...pageInput(input,true,true)};
  const pages=input.pages??{};if(!record(pages)||Object.keys(pages).length>10)invalid();
  const clean={};for(const [key,page]of Object.entries(pages)){
    if(key!=='closing'&&!/^performance:[a-zA-Z0-9_-]{1,40}$/.test(key))invalid();clean[key]=pageInput(page);
  }
  return {version:2,...pageInput(input,true),pages:clean};
}
export function upgradeDesign(input){const d=normalizeDesign(input);return normalizeDesign({...d,version:2});}
export function pageKey(d,index){return index===0?'cover':index===d.cards.length+1?'closing':'performance:'+d.cards[index-1].performanceId;}
export function applyPage(base,page){
  const nodes=base.map(l=>({visible:true,locked:false,angle:0,opacity:100,...l,...page?.layers?.[l.id]}));
  nodes.push(...(page?.objects||[]).map(l=>({visible:true,locked:false,angle:0,opacity:100,...l})));
  const order=page?.order||[];return [...nodes.filter(n=>!order.includes(n.id)),...order.map(id=>nodes.find(n=>n.id===id)).filter(Boolean)];
}
export function weekLabel(date) {
  const d=new Date(date+'T00:00:00Z');
  return `${d.getUTCMonth()+1}월 ${['첫째','둘째','셋째','넷째','다섯째'][Math.floor((d.getUTCDate()-1)/7)]} 주 · 인천`;
}
export function coverScene(draft) {
  const design=normalizeDesign(draft.design);
  const content={title:draft.title,subtitle:draft.subtitle,count:`이번 주 공연 ${draft.cards.length}편`,
    date:draft.week.slice(5).replace('-','.')+'—'+draft.weekEnd.slice(5).replace('-','.')};
  return applyPage(LAYERS.map(base=>({...base,...(content[base.id]!==undefined?{text:content[base.id]}:{})})),design);
}
export function pageScene(d,index=0){
  if(index===0)return coverScene(d);
  const design=normalizeDesign(d.design),key=pageKey(d,index),last=index===d.cards.length+1;
  const theme=coverScene(d),color=id=>theme.find(l=>l.id===id).color,ink=color('subtitle'),red=color('title');
  const base=theme.filter(l=>['paper','texture','topRule'].includes(l.id)).map(l=>({...l}));
  const text=(id,name,value,x,y,width,fontSize,color=ink,family='sans')=>base.push({id,name,type:'text',text:value,x,y,width,fontSize,color,family,leading:1.2});
  text('handle','인스타 계정','@en__ticket',1016,42,400,22,ink);base.at(-1).align='right';
  if(last){
    text('closingTitle','목록 제목','이번 주의 공연',66,160,950,54,red,'serif');
    d.cards.forEach((card,i)=>{
      const y=300+i*104;base.push({id:'entryLine'+i,name:(i+1)+'번 구분선',type:'line',x:66,y:y-10,width:950,height:1,color:ink});
      text('entryNumber'+i,(i+1)+'번 번호',String(i+1).padStart(2,'0'),66,y+7,60,16.5,red);
      text('entryTitle'+i,(i+1)+'번 공연명',card.title,150,y,680,25.5,ink,'serif');
      text('entryDate'+i,(i+1)+'번 날짜',[...new Set(card.schedule.match(/\d{2}\.\d{2}/g)||[])].join(' / '),850,y+5,166,17.25);
    });
    text('closingCopy','마지막 안내',d.closing,66,1160,950,20.25);
  }else{
    const card=d.cards[index-1];text('number','공연 번호',String(index).padStart(2,'0')+' / '+String(d.cards.length).padStart(2,'0'),66,150,250,18.75,red);
    text('title','공연명',card.title,66,215,950,40,red,'serif');
    base.push({id:'poster',name:'공연 포스터',type:'image',x:66,y:410,width:600,height:760,assetId:card.assetId});
    text('scheduleLabel','일시 제목','공연 일시',708,432,310,18.75,red);text('schedule','공연 일시',card.schedule,708,490,310,22.5);
    text('venueLabel','장소 제목','장소',708,800,310,18.75,red);text('venue','공연장',card.venue,708,852,310,22.5);
    text('price','가격 안내',card.price,708,1040,310,20.25);
  }
  base.push({id:'bottomRule',name:'하단 구분선',type:'line',x:66,y:1268,width:950,height:2,color:red});
  text('date','기간',d.week.slice(5).replace('-','.')+'—'+d.weekEnd.slice(5).replace('-','.'),66,1290,700,18.75);
  return applyPage(base,design.pages?.[key]);
}
export function fontFor(layer) {return `${layer.italic?'italic ':''}${layer.weight||800} ${layer.fontSize*PT}px ${layer.family==='sans'?'system-ui, sans-serif':`"${SERIF}", serif`}`;}
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
    return {x:layer.x-(layer.align==='right'?width:layer.align==='center'?width/2:0),y:layer.y,width,height:rows.length*layer.fontSize*PT*(layer.leading||1.2)};
  }
  if(layer.type==='line')return {x:layer.x,y:layer.y,width:layer.width,height:layer.height||3};
  if(['image','rect','ellipse'].includes(layer.type))return {x:layer.x,y:layer.y,width:layer.width,height:layer.height};
  return {x:0,y:0,width:1080,height:1350};
}
export function hitLayer(ctx,layer,x,y){
  const b=layerBounds(ctx,layer),cx=b.x+b.width/2,cy=b.y+b.height/2,a=-(layer.angle||0)*Math.PI/180;
  const px=cx+(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a),py=cy+(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a);
  if(layer.type==='corner')return px>=layer.x+535&&py>=layer.y+1010&&(px-layer.x-535)/545+(py-layer.y-1010)/340>1;
  const pad=layer.type==='line'?10:0;return px>=b.x-pad&&px<=b.x+b.width+pad&&py>=b.y-pad&&py<=b.y+b.height+pad;
}
export function paintScene(ctx,scene,texture,images={}) {
  ctx.clearRect(0,0,1080,1350);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1080,1350);
  for(const layer of scene) {
    if(!layer.visible)continue;
    ctx.save();ctx.fillStyle=layer.color||'#000';
    ctx.globalAlpha=(layer.opacity??100)/100;
    if(layer.angle){const b=layerBounds(ctx,layer);ctx.translate(b.x+b.width/2,b.y+b.height/2);ctx.rotate(layer.angle*Math.PI/180);ctx.translate(-b.x-b.width/2,-b.y-b.height/2);}
    if(layer.type==='background')ctx.fillRect(0,0,1080,1350);
    else if(layer.type==='corner') {
      ctx.translate(layer.x,layer.y);ctx.beginPath();ctx.moveTo(535,1350);ctx.bezierCurveTo(740,1280,950,1135,1080,1010);ctx.lineTo(1080,1350);ctx.closePath();ctx.fill();
    } else if(layer.type==='texture'&&texture) {
      ctx.globalAlpha=layer.opacity/100;ctx.globalCompositeOperation='multiply';ctx.drawImage(texture,0,0,1080,1350);
    } else if(['line','rect'].includes(layer.type))ctx.fillRect(layer.x,layer.y,layer.width,layer.height||3);
    else if(layer.type==='ellipse'){ctx.beginPath();ctx.ellipse(layer.x+layer.width/2,layer.y+layer.height/2,layer.width/2,layer.height/2,0,0,2*Math.PI);ctx.fill();}
    else if(layer.type==='image'&&images[layer.assetId]){const img=images[layer.assetId],scale=Math.min(layer.width/img.width,layer.height/img.height);ctx.drawImage(img,layer.x+(layer.width-img.width*scale)/2,layer.y+(layer.height-img.height*scale)/2,img.width*scale,img.height*scale);}
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
export function coverSvg(ctx,scene,{textureData,fontData,imageData={}}) {
  // Every object is a named group. Text remains text; the paper texture alone is raster.
  const out=[`<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><style>@font-face{font-family:'${SERIF}';font-weight:800;src:url('${fontData}') format('woff2')}</style></defs><rect width="1080" height="1350" fill="#ffffff"/>`];
  for(const l of scene) {
    const b=layerBounds(ctx,l);
    out.push(`<g id="${l.id}" inkscape:groupmode="layer" inkscape:label="${xml(l.name)}"${l.visible?'':' display="none"'}${l.type==='texture'?'':` opacity="${(l.opacity??100)/100}"`}${l.angle?` transform="rotate(${l.angle} ${b.x+b.width/2} ${b.y+b.height/2})"`:''}>`);
    if(l.type==='background')out.push(`<rect width="1080" height="1350" fill="${l.color}"/>`);
    else if(l.type==='corner')out.push(`<path transform="translate(${l.x} ${l.y})" d="M535 1350 C740 1280 950 1135 1080 1010 L1080 1350 Z" fill="${l.color}"/>`);
    else if(l.type==='texture')out.push(`<image width="1080" height="1350" href="${textureData}" opacity="${l.opacity/100}" style="mix-blend-mode:multiply" preserveAspectRatio="none"/>`);
    else if(['line','rect'].includes(l.type))out.push(`<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height||3}" fill="${l.color}"/>`);
    else if(l.type==='ellipse')out.push(`<ellipse cx="${l.x+l.width/2}" cy="${l.y+l.height/2}" rx="${l.width/2}" ry="${l.height/2}" fill="${l.color}"/>`);
    else if(l.type==='image'&&imageData[l.assetId])out.push(`<image x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" href="${imageData[l.assetId]}" preserveAspectRatio="xMidYMid meet"/>`);
    else if(l.type==='text') {
      // Canvas top baseline is the font em box, represented explicitly in SVG.
      out.push(`<text fill="${l.color}" font-family="${l.family==='sans'?'sans-serif':SERIF}" font-size="${l.fontSize*PT}" font-weight="${l.weight||800}" font-style="${l.italic?'italic':'normal'}" text-anchor="${l.align==='right'?'end':l.align==='center'?'middle':'start'}" dominant-baseline="text-before-edge">`);
      textRows(ctx,l).forEach((row,i)=>out.push(`<tspan x="${l.x}" y="${l.y+i*l.fontSize*PT*(l.leading||1.2)}">${xml(row)}</tspan>`));out.push('</text>');
    }
    out.push('</g>');
  }
  out.push('</svg>');return out.join('');
}
