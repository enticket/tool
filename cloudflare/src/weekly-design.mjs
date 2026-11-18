// Shared, versioned scene model. The public build embeds this module verbatim
// (without export keywords); the Worker validates the same allowlisted fields.
export const DESIGN_VERSION = 2;
export const SERIF = 'Enticket Myeongjo';
export const PT = 96 / 72;
export const PROFILE_PHOTO='/assets/weekly/enticket-instagram-profile.jpg';
export const DEFAULT_CLOSING_COPY='팔로우하고 매주 인천 공연 소식을 받아보세요.\nenticket.com';
const oldClosingFooters=['enticket.kr · @en__ticket','공연의 자세한 안내는 엔티켓에서\nenticket.kr · @en__ticket','@en__ticket을 팔로우하고\n매주 인천 공연 소식을 받아보세요.\nenticket.com'];

export function refreshClosingCopy(draft){
  if(draft.jobId)return false;
  let changed=false;
  function update(owner,key,footer=false){
    const copy=owner?.[key];
    if(typeof copy!=='string')return;
    const updated=footer&&oldClosingFooters.includes(copy)?DEFAULT_CLOSING_COPY:
      copy.replace(/(?<![\w.@-])(?:www\.)?enticket\.kr(?![\w-]|\.[\w-])/gi,'enticket.com');
    if(updated!==copy){owner[key]=updated;changed=true;}
  }
  update(draft,'closing',true);
  const page=draft.design?.pages?.closing;
  for(const [id,layer] of Object.entries(page?.layers||{}))update(layer,'text',id==='closingCopy');
  for(const object of page?.objects||[])update(object,'text');
  return changed;
}

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
const extraSpec=id=> /^(ticketStock|poster|profilePhoto|number|description|priceLabel|scheduleLabel|schedule|venueLabel|venue|price|closingTitle|closingCopy|closingBand|entry(?:Title|Date|Number|Line|Venue)[0-7])$/.test(id)
  ? {type:id==='ticketStock'?'ticket':['poster','profilePhoto'].includes(id)?'image':id==='closingBand'?'rect':id.startsWith('entryLine')?'line':'text',x:0,y:0,color:'#111111',width:950,height:800} : null;
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
    if(page.layout!==undefined){
      if(key!=='closing'||!['program','ticket'].includes(page.layout))invalid();
    }
    if(key==='closing'){
      clean[key].layout='ticket';
      // Older closing text was positioned from its left edge. Keep authored anchors.
      if(page.layout!=='ticket'){
        for(const [id,x,width,fontSize] of [['closingTitle',64,950,126],['handle',280,725,47],['closingCopy',283,730,28]]){
          const layer=clean[key].layers[id];
          if(layer&&(layer.x!==undefined||layer.align!==undefined)){
            clean[key].layers[id]={x,width,fontSize,align:'left',...layer};
          }
        }
      }
    }
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
// One die line for the paper outline and perforations in both export formats.
const ticketPath = 'M18 0 H942 L960 18 V868 A32 32 0 0 0 960 932 V1182 L942 1200 H18 L0 1182 V932 A32 32 0 0 0 0 868 V18 Z '+
  Array.from({length:36},(_,i)=>`M${54+i*24} 899h12v2h-12Z`).join(' ');

function closingScene(draft,theme,page,ctx){
  const stock=theme.find(l=>l.id==='paper'),texture=theme.find(l=>l.id==='texture');
  const coverColor=id=>theme.find(l=>l.id===id).color;
  const footer={id:'closingCopy',name:'팔로우 안내 · 주소',type:'text',text:draft.closing,
    x:540,y:1052,width:826,fontSize:32,leading:1.55,align:'center',family:'sans',weight:550,color:coverColor('subtitle')};
  if(ctx){
    while(footer.fontSize>12&&layerBounds(ctx,footer).height>190)footer.fontSize--;
  }
  const base=[
    {...stock,name:'바탕',color:coverColor('corner')},
    {id:'ticketStock',name:'절취선이 있는 티켓',type:'ticket',x:60,y:75,width:960,height:1200,color:stock.color,locked:true},
    texture,
    {id:'profilePhoto',name:'인스타 프로필 사진',type:'image',assetId:PROFILE_PHOTO,round:true,x:453,y:142,width:174,height:174},
    {id:'handle',name:'인스타 계정',type:'text',text:'@en__ticket',x:540,y:338,width:760,
      fontSize:40,leading:1.15,align:'center',family:'sans',weight:750,color:coverColor('handle')},
    {id:'closingTitle',name:'뒷표지 제목',type:'text',text:'이번 주의\n커튼콜.',
      x:540,y:465,width:830,fontSize:137,leading:1.06,align:'center',family:'serif',color:coverColor('title')},
    footer
  ];
  // Insert the new stock underneath artwork in previously saved full layer orders.
  if(page?.order?.includes('paper')&&!page.order.includes('ticketStock')){
    const order=[...page.order];
    order.splice(order.indexOf('paper')+1,0,'ticketStock');
    for(const layer of base)if(!order.includes(layer.id))order.push(layer.id);
    page={...page,order};
  }
  return applyPage(base,page);
}

// The Instagram feed caption starts with the title and an optional introduction,
// followed by labelled details. Keep only the opening prose in the weekly card.
export function performanceIntro(performance){
  const lines=String(performance.description||'').trim().split(/\r?\n/).map(line=>line.trim());
  if(lines[0]===performance.title||/^(🎭|공연명\s*[:|｜])/.test(lines[0]))lines.shift();
  while(lines.length&&!lines[0])lines.shift();
  const prose=[];
  for(const line of lines){
    if(!line||/^(?:[#📅🗓📍👥⏱🎟📞]|https?:\/\/|예매는 프로필|(?:공연\s*)?(?:일시|일정|날짜|장소|가격|시간|티켓|문의|관람\s*연령)\s*[:|｜])/u.test(line))break;
    prose.push(line);
  }
  const intro=prose.join(' ');
  return intro.length>220?intro.slice(0,219).trimEnd()+'…':intro;
}

function performanceScene(d,index,theme,page,ctx,images){
  const card=d.cards[index-1],image=images?.[card.assetId];
  const left=66,right=1014,ruleY=1260;
  const coverColor=id=>theme.find(layer=>layer.id===id).color;
  const ink=coverColor('subtitle'),red=coverColor('title');
  const overrides=page?.layers||{};
  const base=theme.filter(layer=>layer.id==='paper'||layer.id==='texture');
  function add(spec){
    const layer={...spec,...overrides[spec.id]};
    base.push(layer);
    return layer;
  }
  function height(layer){
    if(layer.visible===false||layer.type==='text'&&!layer.text)return 0;
    if(layer.type==='line')return layer.height;
    return ctx?layerBounds(ctx,layer).height:layer.fontSize*PT*layer.leading*String(layer.text).split('\n').length;
  }
  function text(id,name,value,x,fontSize,color=ink,family='sans',extra={}){
    return add({id,name,type:'text',text:value||'',x,y:0,width:Math.max(8,right-(overrides[id]?.x??x)),fontSize,color,family,leading:1.2,...extra});
  }
  function fit(layer,budget){
    if(ctx&&overrides[layer.id]?.fontSize===undefined){
      while(layer.fontSize>16&&height(layer)>budget)layer.fontSize--;
    }
    return layer;
  }

  const poster=add({id:'poster',name:'공연 포스터',type:'image',assetId:card.assetId,topLeft:true,
    x:left,y:60,width:image?.width>image?.height?780:600,height:736});
  text('number','공연 번호',String(index).padStart(2,'0')+' / '+String(d.cards.length).padStart(2,'0'),
    right,23,red,'sans',{width:200,align:'right',y:62});
  const title=fit(text('title','공연명',card.title,left,46,red,'serif'),150);
  const intro=fit(text('description','공연 소개',card.description,left,27,ink,'sans',{weight:500,leading:1.4}),165);
  const divider=add({id:'topRule',name:'공연 정보 구분선',type:'line',x:left,y:0,width:right-left,height:2,color:ink});
  const rows=[
    {layers:[title],gap:0},
    {layers:[intro],gap:15},
    {layers:[divider],gap:26}
  ];
  for(const [id,label,budget] of [['schedule','공연 일시',156],['venue','장소',105],['price','가격',105]]){
    const value=fit(text(id,label,card[id],234,25,ink,'sans',{weight:550}),budget);
    const heading=text(id+'Label',label+' 제목',value.text&&value.visible!==false?label:'',left,23,red,'sans',{width:154,weight:650});
    rows.push({layers:[heading,value],gap:14});
  }
  const bodyHeight=rows.reduce((total,row)=>{
    row.height=Math.max(...row.layers.map(height));
    return total+(row.height?row.height+row.gap:0);
  },0);
  const ratio=image?.width&&image.height?image.width/image.height:.8;
  if(overrides.poster?.height===undefined){
    poster.height=Math.min(poster.height,poster.width/ratio,Math.max(160,ruleY-24-bodyHeight-32-poster.y));
  }
  const imageHeight=poster.visible===false?0:Math.min(poster.height,poster.width/ratio);
  let y=Math.max(102,poster.y+imageHeight)+32;
  for(const row of rows){
    if(row.height)y+=row.gap;
    const start=y;
    for(const layer of row.layers){
      if(overrides[layer.id]?.y===undefined)layer.y=start;
      const h=height(layer);
      if(h)y=Math.max(y,layer.y+h);
    }
  }
  add({id:'bottomRule',name:'하단 구분선',type:'line',x:left,y:ruleY,width:right-left,height:2,color:red});
  text('date','기간',d.week.slice(5).replace('-','.')+'—'+d.weekEnd.slice(5).replace('-','.'),left,18.75,ink,'sans',{y:1283});
  text('handle','인스타 계정','@en__ticket',right,18.75,ink,'sans',{align:'right',width:400,y:1283});
  if(page?.order?.includes('paper')){
    const missing=['description','priceLabel'].filter(id=>!page.order.includes(id));
    if(missing.length)page={...page,order:page.order.concat(missing)};
  }
  return applyPage(base,page);
}

export function pageScene(d,index=0,ctx,images){
  const theme=coverScene(d);
  if(index===0)return theme;
  const page=normalizeDesign(d.design).pages?.[pageKey(d,index)];
  if(index===d.cards.length+1)return closingScene(d,theme,page,ctx);
  return performanceScene(d,index,theme,page,ctx,images);
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
  if(['image','rect','ellipse','ticket'].includes(layer.type))return {x:layer.x,y:layer.y,width:layer.width,height:layer.height};
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
    else if(layer.type==='ticket'){
      ctx.translate(layer.x,layer.y);ctx.scale(layer.width/960,layer.height/1200);
      ctx.fill(new Path2D(ticketPath),'evenodd');
    } else if(layer.type==='corner') {
      ctx.translate(layer.x,layer.y);ctx.beginPath();ctx.moveTo(535,1350);ctx.bezierCurveTo(740,1280,950,1135,1080,1010);ctx.lineTo(1080,1350);ctx.closePath();ctx.fill();
    } else if(layer.type==='texture'&&texture) {
      ctx.globalAlpha=layer.opacity/100;ctx.globalCompositeOperation='multiply';ctx.drawImage(texture,0,0,1080,1350);
    } else if(['line','rect'].includes(layer.type))ctx.fillRect(layer.x,layer.y,layer.width,layer.height||3);
    else if(layer.type==='ellipse'){ctx.beginPath();ctx.ellipse(layer.x+layer.width/2,layer.y+layer.height/2,layer.width/2,layer.height/2,0,0,2*Math.PI);ctx.fill();}
    else if(layer.type==='image'&&images[layer.assetId]){
      const img=images[layer.assetId],scale=Math.min(layer.width/img.width,layer.height/img.height);
      if(layer.round){
        ctx.beginPath();ctx.arc(layer.x+layer.width/2,layer.y+layer.height/2,Math.min(layer.width,layer.height)/2,0,2*Math.PI);ctx.clip();
      }
      const x=layer.topLeft?layer.x:layer.x+(layer.width-img.width*scale)/2;
      const y=layer.topLeft?layer.y:layer.y+(layer.height-img.height*scale)/2;
      ctx.drawImage(img,x,y,img.width*scale,img.height*scale);
    }
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
    else if(l.type==='ticket')out.push(`<path d="${ticketPath}" transform="translate(${l.x} ${l.y}) scale(${l.width/960} ${l.height/1200})" fill="${l.color}" fill-rule="evenodd"/>`);
    else if(l.type==='corner')out.push(`<path transform="translate(${l.x} ${l.y})" d="M535 1350 C740 1280 950 1135 1080 1010 L1080 1350 Z" fill="${l.color}"/>`);
    else if(l.type==='texture')out.push(`<image width="1080" height="1350" href="${textureData}" opacity="${l.opacity/100}" style="mix-blend-mode:multiply" preserveAspectRatio="none"/>`);
    else if(['line','rect'].includes(l.type))out.push(`<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height||3}" fill="${l.color}"/>`);
    else if(l.type==='ellipse')out.push(`<ellipse cx="${l.x+l.width/2}" cy="${l.y+l.height/2}" rx="${l.width/2}" ry="${l.height/2}" fill="${l.color}"/>`);
    else if(l.type==='image'&&imageData[l.assetId]){
      if(l.round)out.push(`<defs><clipPath id="clip-${l.id}"><circle cx="${l.x+l.width/2}" cy="${l.y+l.height/2}" r="${Math.min(l.width,l.height)/2}"/></clipPath></defs>`);
      out.push(`<image x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" href="${imageData[l.assetId]}" preserveAspectRatio="${l.topLeft?'xMinYMin':'xMidYMid'} meet"${l.round?` clip-path="url(#clip-${l.id})"`:''}/>`);
    }
    else if(l.type==='text') {
      // Canvas top baseline is the font em box, represented explicitly in SVG.
      out.push(`<text fill="${l.color}" font-family="${l.family==='sans'?'sans-serif':SERIF}" font-size="${l.fontSize*PT}" font-weight="${l.weight||800}" font-style="${l.italic?'italic':'normal'}" text-anchor="${l.align==='right'?'end':l.align==='center'?'middle':'start'}" dominant-baseline="text-before-edge">`);
      textRows(ctx,l).forEach((row,i)=>out.push(`<tspan x="${l.x}" y="${l.y+i*l.fontSize*PT*(l.leading||1.2)}">${xml(row)}</tspan>`));out.push('</text>');
    }
    out.push('</g>');
  }
  out.push('</svg>');return out.join('');
}
