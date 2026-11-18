// Embedded inside the weekly editor closure by the public build.
const WD=window.EnticketWeeklyDesign;
let paperAssetsPromise,paperTexture=null,paperImages={},selectedLayer=null,layerDrag=null,inlineEdit=null;
let historyKey='',past=[],future=[],historyGroup='',historyTime=0,zoom='fit';
const isPaper=()=>draft?.template==='paper-editorial';
const canEdit=()=>isPaper()&&!busy&&!draft.jobId;
const canvasContext=()=>$('wkLayerCanvas').getContext('2d');
async function ensurePaperAssets(){
  if(!paperAssetsPromise)paperAssetsPromise=(async()=>{
    const fonts=await document.fonts.load('800 48px "Enticket Myeongjo"','공연이 있는 일주일');
    if(!fonts.length)throw Error('명조 글꼴을 불러오지 못했습니다. 다시 시도해 주세요.');
    const img=new Image(),profile=new Image();
    img.src='/assets/weekly/paper-grain.png';profile.src=WD.PROFILE_PHOTO;
    await Promise.all([img.decode(),profile.decode()]);
    paperTexture=img;paperImages[WD.PROFILE_PHOTO]=profile;
  })().catch(error=>{paperAssetsPromise=null;throw error;});
  return paperAssetsPromise;
}
async function paperPosters(cards){
  const epoch=generation;
  const posters=await Promise.all(cards.map(async card=>paperImages[card.assetId]||image(await asset(card.assetId))));
  if(epoch!==generation)throw Error('로그인 상태가 변경되었습니다.');
  cards.forEach((card,i)=>{
    paperImages[card.assetId]=posters[i];
  });
  return posters;
}
function currentScene(){return draft?WD.pageScene(draft,Math.min(selectedCard,draft.cards.length+1),canvasContext(),paperImages):[];}
function currentLayer(){return currentScene().find(l=>l.id===selectedLayer);}
function pageModel(){
  const key=WD.pageKey(draft,selectedCard);
  if(key==='cover')return draft.design;
  if(!draft.design.pages[key]){
    draft.design.pages[key]={layers:{},objects:[],order:[]};
    if(key==='closing')draft.design.pages[key].layout='ticket';
  }
  return draft.design.pages[key];
}
function snapshot(){pull();return JSON.stringify({design:draft.design,title:draft.title,subtitle:draft.subtitle,closing:draft.closing,cards:draft.cards});}
function restoreSnapshot(value){
  Object.assign(draft,JSON.parse(value));
  for(const [key,id]of Object.entries({title:'wkTitle',subtitle:'wkSubtitle',closing:'wkClosing'}))$(id).value=draft[key];
  renderCards();changed();refreshStudio();
}
function mutate(fn,group=''){
  if(!canEdit())return false;
  const before=snapshot();draft.design=WD.upgradeDesign(draft.design);
  try{fn(pageModel());draft.design=WD.normalizeDesign(draft.design);}catch(e){restoreSnapshot(before);status('요소의 크기와 설정을 확인해 주세요.',true);return false;}
  if(snapshot()===before)return false;
  if(!group||group!==historyGroup||Date.now()-historyTime>800){past.push(before);if(past.length>60)past.shift();}
  historyGroup=group;historyTime=Date.now();future=[];changed();
  $('wkStageState').textContent='저장하지 않은 변경';paintLayerPreview();renderLayerList();studioControls();return true;
}
function editLayer(values,group=''){
  const l=currentLayer();if(!l||l.locked&&!Object.keys(values).every(k=>k==='locked'||k==='visible'))return;
  mutate(page=>{const object=page.objects.find(o=>o.id===selectedLayer);if(object)Object.assign(object,values);else page.layers[selectedLayer]={...page.layers[selectedLayer],...values};},group);
}
function editText(value){
  const l=currentLayer();if(!l||l.locked)return;
  const field=selectedCard===0?({title:'title',subtitle:'subtitle'}[l.id]):selectedCard===draft.cards.length+1?(l.id==='closingCopy'?'closing':null):null;
  if(field)mutate(page=>{draft[field]=value;$(field==='title'?'wkTitle':field==='subtitle'?'wkSubtitle':'wkClosing').value=value;if(page.layers[l.id])delete page.layers[l.id].text;},'text-'+l.id);
  else if(selectedCard>0&&selectedCard<=draft.cards.length&&['title','schedule','venue','price'].includes(l.id))mutate(page=>{draft.cards[selectedCard-1][l.id]=value;if(page.layers[l.id])delete page.layers[l.id].text;renderCards();},'text-'+l.id);
  else editLayer({text:value},'text-'+l.id);
}
function undoStudio(redo=false){
  if(!canEdit())return;commitInline();const from=redo?future:past,to=redo?past:future;if(!from.length)return;
  to.push(snapshot());restoreSnapshot(from.pop());historyGroup='';
}
function syncLayerEditor(){
  if(inlineEdit)commitInline();
  const active=isPaper()&&!draft.jobId;
  $('wkLayerPanel').hidden=!active;$('wkLayerStage').hidden=!active;$('wkPreviews').hidden=active;
  $('wkCards').hidden=active;$('wkStudioTools').hidden=!active;$('wkLayerEmpty').hidden=!active;
  $('wkStudio').classList.toggle('is-editable',active);
  if(active){
    $('wkCoverFields').hidden=true;$('wkClosingFields').hidden=true;
    const key=draft.id+'|'+draft.cards.map(c=>c.performanceId).join(',')+'|'+(draft.jobId||'');
    if(key!==historyKey){historyKey=key;past=[];future=[];historyGroup='';}
    if(!currentLayer())selectedLayer=null;
    refreshStudio();
  }
  studioControls();requestAnimationFrame(fitCanvas);
}
function renderLayerList(){
  if(!isPaper())return;
  $('wkLayerList').replaceChildren();
  for(const l of currentScene().slice().reverse()){
    const b=el('button');b.type='button';b.dataset.layer=l.id;b.setAttribute('aria-pressed',String(l.id===selectedLayer));
    const state=[l.locked?'잠김':'',!l.visible?'숨김':''].filter(Boolean).join(' · ');
    b.dataset.hidden=String(!l.visible);
    b.title=[l.name,state].filter(Boolean).join(' · ');
    const symbol=el('span',l.type==='text'?'T':'','wk-object-symbol');
    symbol.dataset.type=l.type;
    symbol.setAttribute('aria-hidden','true');
    if(l.color)symbol.style.setProperty('--layer-color',l.color);
    b.append(symbol,el('span',l.name));
    if(state)b.append(el('small',state));
    b.addEventListener('click',event=>{
      commitInline();selectedLayer=l.id;setStudioPane('properties');refreshStudio();
      if(event.detail===0)$('wkLayerName').focus({preventScroll:true});
    });
    $('wkLayerList').append(b);
  }
}
function fillLayerProperties(){
  const l=currentLayer();$('wkLayerEmpty').hidden=!!l;$('wkLayerProperties').hidden=!l;
  if(!l){studioControls();return;}
  $('wkLayerName').textContent=l.name;$('wkLayerVisible').checked=l.visible;
  const text=l.type==='text';$('wkLayerTextField').hidden=!text||l.id==='count';
  $('wkLayerText').value=l.text||'';$('wkLayerText').maxLength=selectedCard===0&&['title','subtitle'].includes(l.id)?220:l.id==='closingCopy'?300:l.id==='schedule'?WD.MAX_SCHEDULE_LENGTH:220;
  $('wkLayerSizeField').hidden=!text;$('wkLayerSize').value=l.fontSize||'';
  $('wkLayerFontField').hidden=!text;$('wkLayerFont').value=l.family||'serif';
  $('wkLayerAlignField').hidden=!text;$('wkLayerAlign').value=l.align||'left';
  $('wkLayerColorField').hidden=!l.color;$('wkLayerColor').value=l.color||'#000000';
  const hundredths=value=>Math.round(value*100)/100;
  $('wkLayerGeometry').hidden=l.x===undefined;$('wkLayerX').value=hundredths(l.x??0);$('wkLayerY').value=hundredths(l.y??0);
  $('wkLayerDimensions').hidden=!['rect','ellipse','image','line','text','ticket'].includes(l.type);$('wkLayerWidth').value=hundredths(l.width||950);$('wkLayerHeight').value=hundredths(l.height||3);$('wkLayerHeight').min=l.type==='line'?'1':'8';$('wkLayerHeightField').hidden=text;
  $('wkLayerRotationField').hidden=l.x===undefined;$('wkLayerRotation').value=l.angle||0;
  $('wkLayerOpacity').value=l.opacity??100;$('wkLayerOpacityValue').value=(l.opacity??100)+'%';
  $('wkLayerOpacityLabel').textContent=l.type==='texture'?'질감 강도':'불투명도';
  $('wkLayerAutoNote').hidden=l.id!=='count';
  $('wkLayerReset').hidden=l.id.startsWith('object-');
  for(const n of $('wkLayerProperties').querySelectorAll('input,textarea,select,button'))n.disabled=!!draft?.jobId||!!l.locked;
  $('wkLayerVisible').disabled=!!draft?.jobId;
  studioControls();
}
function refreshStudio(){renderLayerList();fillLayerProperties();paintLayerPreview();}
function studioControls(){
  const enabled=canEdit(),l=isPaper()?currentLayer():null,mutable=enabled&&l&&!l.locked;
  for(const b of document.querySelectorAll('[data-add-object]'))b.disabled=!enabled;
  $('wkUndo').disabled=!enabled||!past.length;$('wkRedo').disabled=!enabled||!future.length;
  for(const id of ['wkDelete','wkForward','wkBackward','wkAlignCenter'])$(id).disabled=!mutable;
  $('wkDuplicate').disabled=!mutable||!['text','rect','ellipse','line'].includes(l?.type);
  $('wkLock').disabled=!enabled||!l;$('wkLock').textContent=l?.locked?'잠금 해제':'잠금';$('wkLock').setAttribute('aria-pressed',String(!!l?.locked));
  $('wkShowPrevious').disabled=busy||!draft||selectedCard===0;
  $('wkShowNext').disabled=busy||!draft||selectedCard>=draft.cards.length+1;
}
function reorderStudioPage(from,to){
  if(busy||draft?.jobId||from===to||from<1||to<1||from>draft.cards.length||to>draft.cards.length)return;
  commitInline();pull();draft.cards.splice(to-1,0,draft.cards.splice(from-1,1)[0]);selectedCard=to;
  changed();renderCards();renderCandidates();run(render);
}
function fitCanvas(){
  if($('wkLayerStage').hidden)return;
  const view=$('wkCanvasViewport'),width=zoom==='fit'?Math.max(150,Math.min(view.clientWidth-48,(view.clientHeight-48)*.8)):1080*Number(zoom)/100;
  $('wkLayerStage').style.width=width+'px';$('wkZoomLabel').textContent=Math.round(width/1080*100)+'%';
  paintLayerPreview();
}
function paintLayerPreview(){
  if(!isPaper()||draft.jobId)return;
  const ctx=canvasContext(),scene=currentScene();
  WD.paintScene(ctx,inlineEdit?scene.map(l=>l.id===inlineEdit.id?{...l,visible:false}:l):scene,paperTexture,paperImages);
  const l=scene.find(n=>n.id===selectedLayer),selection=$('wkLayerSelection');
  selection.hidden=!l||!l.visible;if(!l)return;
  const b=WD.layerBounds(ctx,l);
  Object.assign(selection.style,{left:b.x/1080*100+'%',top:b.y/1350*100+'%',width:b.width/1080*100+'%',height:Math.max(b.height,3)/1350*100+'%',transform:`rotate(${l.angle||0}deg)`});
  selection.classList.toggle('is-locked',!!l.locked);
  const transformable=!l.locked&&['text','rect','ellipse','line','image','ticket'].includes(l.type);
  for(const n of selection.querySelectorAll('button'))n.hidden=!transformable;
  if(inlineEdit){const scale=$('wkLayerStage').clientWidth/1080;Object.assign($('wkInlineText').style,{left:b.x/1080*100+'%',top:b.y/1350*100+'%',width:Math.max(b.width+20,120)/1080*100+'%',height:(b.height+40)/1350*100+'%',font:WD.fontFor({...l,fontSize:l.fontSize*scale}),lineHeight:String(l.leading||1.2),color:l.color,transform:`rotate(${l.angle||0}deg)`,textAlign:l.align||'left'});}
  const thumb=$('wkFilmstrip').children[selectedCard]?.querySelector('img');
  if(thumb&&!inlineEdit)thumb.src=$('wkLayerCanvas').toDataURL('image/jpeg',.65);
}
function paintPaperTemplate(ctx,d,index){
  const scene=WD.pageScene(d,index,ctx,paperImages);WD.validateScene(ctx,scene);WD.paintScene(ctx,scene,paperTexture,paperImages);
}
function addObject(type){
  commitInline();const id='object-'+crypto.randomUUID();
  const spec={id,type,name:type==='text'?'새 텍스트':type==='rect'?'사각형':type==='ellipse'?'원':'선',x:320,y:520,width:440,height:type==='line'?5:240,color:type==='text'?'#222222':'#b80808',visible:true,locked:false,angle:0,opacity:100};
  if(type==='text')Object.assign(spec,{text:'텍스트를 입력하세요',fontSize:34,family:'sans',leading:1.2});
  if(mutate(page=>{if(page.objects.length>=40)throw Error('limit');page.objects.push(spec);page.order.push(id);})){selectedLayer=id;setStudioPane('properties');refreshStudio();if(type==='text')startInline();}
}
function deleteObject(){
  const l=currentLayer();if(!l||l.locked)return;
  if(mutate(page=>{if(page.objects.some(o=>o.id===l.id)){page.objects=page.objects.filter(o=>o.id!==l.id);page.order=page.order.filter(id=>id!==l.id);}else page.layers[l.id]={...page.layers[l.id],visible:false};})){selectedLayer=null;refreshStudio();}
}
function duplicateObject(){
  const l=currentLayer();if(!l||!['text','rect','ellipse','line'].includes(l.type))return;
  const copy={id:'object-'+crypto.randomUUID(),type:l.type,name:l.name+' 복사'};
  for(const key of ['text','x','y','width','height','fontSize','color','family','leading','weight','italic','align','angle','opacity'])if(l[key]!==undefined)copy[key]=l[key];
  copy.x=Math.min(1000,copy.x+24);copy.y=Math.min(1250,copy.y+24);
  if(mutate(page=>{if(page.objects.length>=40)throw Error('limit');page.objects.push(copy);page.order=currentScene().map(n=>n.id).filter(id=>id!==copy.id).concat(copy.id);})){selectedLayer=copy.id;setStudioPane('properties');refreshStudio();}
}
function moveOrder(delta){
  if(!currentLayer()||currentLayer().locked)return;
  const ids=currentScene().map(l=>l.id),from=ids.indexOf(selectedLayer),to=Math.max(0,Math.min(ids.length-1,from+delta));
  if(from!==to)mutate(page=>{ids.splice(from,1);ids.splice(to,0,selectedLayer);page.order=ids;});
}
function startInline(){
  const l=currentLayer();if(!canEdit()||!l||l.type!=='text'||l.locked||l.id==='count')return;
  inlineEdit={id:l.id,value:l.text||'',page:selectedCard};const input=$('wkInlineText');input.hidden=false;input.value=inlineEdit.value;
  input.maxLength=Number($('wkLayerText').maxLength)||220;paintLayerPreview();input.focus();input.select();
}
function commitInline(cancel=false){
  if(!inlineEdit)return;const edit=inlineEdit,value=$('wkInlineText').value;inlineEdit=null;$('wkInlineText').hidden=true;
  if(!cancel&&edit.page===selectedCard&&value!==edit.value){selectedLayer=edit.id;editText(value);}
  fillLayerProperties();paintLayerPreview();
}
async function downloadLayerSource(){
  commitInline();const exportEpoch=generation;pull();await Promise.all([ensurePaperAssets(),paperPosters(draft.cards)]);
  const dataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
  const get=async path=>{const r=await fetch(path);if(!r.ok)throw Error('원본 파일을 불러오지 못했습니다.');return r.blob();};
  const [font,texture,license,profile]=await Promise.all([get('/assets/weekly/NanumMyeongjo-ExtraBold.woff2'),get('/assets/weekly/paper-grain.png'),get('/assets/weekly/OFL.txt'),get(WD.PROFILE_PHOTO)]);
  const [fontData,textureData,profileData]=await Promise.all([dataUrl(font),dataUrl(texture),dataUrl(profile)]),imageData={[WD.PROFILE_PHOTO]:profileData};
  for(const c of draft.cards)imageData[c.assetId]=await dataUrl(await asset(c.assetId));
  const manifest={format:'enticket-weekly-design',version:2,width:1080,height:1350,template:'paper-editorial',title:draft.title,subtitle:draft.subtitle,closing:draft.closing,cards:draft.cards,week:draft.week,weekEnd:draft.weekEnd,design:WD.normalizeDesign(draft.design)};
  const files={'design.json':new TextEncoder().encode(JSON.stringify(manifest,null,2)),'NanumMyeongjo-ExtraBold.woff2':new Uint8Array(await font.arrayBuffer()),'OFL.txt':new Uint8Array(await license.arrayBuffer()),'paper-grain.png':new Uint8Array(await texture.arrayBuffer()),'README.txt':new TextEncoder().encode('엔티켓 디자인 원본\n각 SVG는 편집 가능한 텍스트·도형·이미지 레이어입니다. 폰트와 이미지가 포함되어 있습니다.\ndesign.json에는 각 페이지의 요소와 배치가 저장됩니다.\n글꼴: 나눔명조 ExtraBold (SIL OFL 1.1). 외부 편집기의 웹폰트 지원에 따라 표시가 달라질 수 있습니다. 게시에는 사이트의 JPG 출력을 사용하세요.\n사이트에서는 저장한 디자인을 선택해 이어서 편집합니다. 원본 ZIP 가져오기는 지원하지 않습니다.\n')};
  files['enticket-instagram-profile.jpg']=new Uint8Array(await profile.arrayBuffer());
  for(let i=0;i<draft.cards.length+2;i++){
    const scene=WD.pageScene(draft,i,canvasContext(),paperImages);
    WD.validateScene(canvasContext(),scene);
    const mirror=scene.find(layer=>layer.mirrorOf);
    if(mirror)imageData[mirror.assetId]=WD.createPosterReflection(paperImages[mirror.mirrorOf],mirror.width,mirror.height,mirror.sourceAngle).toDataURL('image/png');
    files[i===0?'cover.svg':String(i+1).padStart(2,'0')+'.svg']=new TextEncoder().encode(WD.coverSvg(canvasContext(),scene,{fontData,textureData,imageData}));
  }
  if(exportEpoch!==generation)throw Error('로그인 상태가 변경되었습니다.');
  const url=URL.createObjectURL(new Blob([fflate.zipSync(files,{level:6})],{type:'application/zip'})),a=el('a');a.href=url;a.download=draft.week+'-enticket-editable.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function setStudioPane(name){
  for(const button of document.querySelectorAll('[data-studio-pane]')){
    const selected=button.dataset.studioPane===name;
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex=selected?0:-1;
  }
  for(const panel of document.querySelectorAll('[data-studio-content]'))panel.hidden=panel.dataset.studioContent!==name;
}
function initLayerEditor(){
  const tabs=[...document.querySelectorAll('[data-studio-pane]')];
  for(const [index,button] of tabs.entries()){
    button.addEventListener('click',()=>setStudioPane(button.dataset.studioPane));
    button.addEventListener('keydown',event=>{
      const next={ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length,Home:0,End:tabs.length-1}[event.key];
      if(next===undefined)return;
      event.preventDefault();tabs[next].click();tabs[next].focus();
    });
  }
  $('wkToTools').addEventListener('click',()=>tabs.find(t=>t.tabIndex===0).focus());
  $('wkToCanvas').addEventListener('click',()=>$('wkToTools').focus());
  for(const b of document.querySelectorAll('[data-add-object]'))b.addEventListener('click',()=>addObject(b.dataset.addObject));
  $('wkUndo').addEventListener('click',()=>undoStudio());$('wkRedo').addEventListener('click',()=>undoStudio(true));
  $('wkDelete').addEventListener('click',deleteObject);$('wkDuplicate').addEventListener('click',duplicateObject);
  $('wkForward').addEventListener('click',()=>moveOrder(1));$('wkBackward').addEventListener('click',()=>moveOrder(-1));
  $('wkLock').addEventListener('click',()=>{const l=currentLayer();if(l){editLayer({locked:!l.locked});fillLayerProperties();}});
  $('wkAlignCenter').addEventListener('click',()=>{const l=currentLayer();if(l){const b=WD.layerBounds(canvasContext(),l);editLayer({x:l.x+540-b.x-b.width/2});fillLayerProperties();}});
  $('wkZoom').addEventListener('change',()=>{zoom=$('wkZoom').value;fitCanvas();});
  $('wkShowPrevious').addEventListener('click',()=>selectCard(selectedCard-1));
  $('wkShowNext').addEventListener('click',()=>selectCard(selectedCard+1));
  $('wkFilmstrip').addEventListener('dragstart',e=>{
    const tab=e.target.closest('[data-page]');if(!tab||busy||draft?.jobId){e.preventDefault();return;}
    e.dataTransfer.setData('application/x-enticket-page',tab.dataset.page);e.dataTransfer.effectAllowed='move';
  });
  $('wkFilmstrip').addEventListener('dragover',e=>{if(e.target.closest('[data-page]')&&e.dataTransfer.types.includes('application/x-enticket-page'))e.preventDefault();});
  $('wkFilmstrip').addEventListener('drop',e=>{const tab=e.target.closest('[data-page]'),from=Number(e.dataTransfer.getData('application/x-enticket-page'));if(tab&&Number.isInteger(from)){e.preventDefault();reorderStudioPage(from,Number(tab.dataset.page));}});
  $('wkFocus').addEventListener('click',()=>{$('wkDesignView').classList.toggle('wk-focus');$('wkFocus').textContent=$('wkDesignView').classList.contains('wk-focus')?'넓게 보기 종료':'넓게 보기';fitCanvas();});
  new ResizeObserver(()=>requestAnimationFrame(fitCanvas)).observe($('wkCanvasViewport'));
  $('wkLayerVisible').addEventListener('change',()=>editLayer({visible:$('wkLayerVisible').checked}));
  for(const [id,key]of [['wkLayerSize','fontSize'],['wkLayerX','x'],['wkLayerY','y'],['wkLayerWidth','width'],['wkLayerHeight','height'],['wkLayerRotation','angle'],['wkLayerOpacity','opacity']])$(id).addEventListener('input',()=>{if($(id).value===''||!$(id).checkValidity())return;editLayer({[key]:Number($(id).value)},'input-'+id);if(key==='opacity')$('wkLayerOpacityValue').value=$(id).value+'%';});
  for(const [id,key]of [['wkLayerColor','color'],['wkLayerFont','family'],['wkLayerAlign','align']])$(id).addEventListener('input',()=>editLayer({[key]:$(id).value},'input-'+id));
  $('wkLayerText').addEventListener('input',()=>editText($('wkLayerText').value));
  $('wkLayerReset').addEventListener('click',()=>{if(!currentLayer()||currentLayer().locked)return;mutate(page=>{delete page.layers[selectedLayer];});refreshStudio();});
  $('wkLayerDownload').addEventListener('click',()=>run(downloadLayerSource));
  $('wkInlineText').addEventListener('blur',()=>commitInline());
  $('wkInlineText').addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();commitInline(true);}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();commitInline();}});
  const canvas=$('wkLayerCanvas'),stage=$('wkLayerStage');
  const point=e=>{const b=canvas.getBoundingClientRect();return {x:(e.clientX-b.x)*1080/b.width,y:(e.clientY-b.y)*1350/b.height};};
  const start=(e,mode='move')=>{
    if(!canEdit()||e.button!==0)return;commitInline();const p=point(e);
    if(mode==='move'){
      const hit=currentScene().slice().reverse().find(l=>l.visible&&!l.locked&&!['background','texture'].includes(l.type)&&WD.hitLayer(canvasContext(),l,p.x,p.y));
      selectedLayer=hit?.id||null;if(hit)setStudioPane('properties');refreshStudio();if(!hit)return;
    }
    const l=currentLayer();if(!l||l.locked)return;e.preventDefault();canvas.focus();
    layerDrag={pointer:e.pointerId,mode,p,layer:{...l},bounds:WD.layerBounds(canvasContext(),l),group:'pointer-'+Date.now(),moved:false};stage.setPointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerdown',e=>start(e));
  for(const handle of $('wkLayerSelection').querySelectorAll('[data-handle]'))handle.addEventListener('pointerdown',e=>{e.stopPropagation();start(e,handle.dataset.handle);});
  stage.addEventListener('dblclick',e=>{if(!e.target.closest('button,textarea'))startInline();});
  stage.addEventListener('pointermove',e=>{
    if(!layerDrag||layerDrag.pointer!==e.pointerId)return;
    const d=layerDrag,p=point(e),l=d.layer,b=d.bounds,dx=p.x-d.p.x,dy=p.y-d.p.y;if(Math.hypot(dx,dy)<2&&!d.moved)return;d.moved=true;
    let values={};
    if(d.mode==='move'){
      values={x:l.x+dx,y:l.y+dy};const cx=b.x+dx+b.width/2,cy=b.y+dy+b.height/2;
      const snapX=Math.abs(cx-540)<8,snapY=Math.abs(cy-675)<8;
      if(!e.altKey){if(snapX)values.x+=540-cx;if(snapY)values.y+=675-cy;}
      $('wkGuideX').hidden=e.altKey||!snapX;$('wkGuideY').hidden=e.altKey||!snapY;
    }else if(d.mode==='rotate'){
      let angle=Math.atan2(p.y-b.y-b.height/2,p.x-b.x-b.width/2)*180/Math.PI+90;
      if(e.shiftKey)angle=Math.round(angle/15)*15;values.angle=((angle+540)%360)-180;
    }else{
      const a=(l.angle||0)*Math.PI/180,rx=dx*Math.cos(a)+dy*Math.sin(a),ry=-dx*Math.sin(a)+dy*Math.cos(a),west=d.mode.includes('w'),north=d.mode.includes('n');
      let w=Math.max(12,b.width+(west?-rx:rx)),h=Math.max(12,b.height+(north?-ry:ry));
      if(l.type==='text'||l.type==='image'||e.shiftKey){let factor=Math.abs(rx/b.width)>Math.abs(ry/b.height)?w/b.width:h/b.height;if(l.type==='text')factor=Math.max(12/l.fontSize,Math.min(220/l.fontSize,factor));w=b.width*factor;h=b.height*factor;}
      const left=west?b.x+b.width-w:b.x,top=north?b.y+b.height-h:b.y,ocx=b.x+b.width/2,ocy=b.y+b.height/2;
      const localX=left+w/2-ocx,localY=top+h/2-ocy,nx=ocx+localX*Math.cos(a)-localY*Math.sin(a)-w/2,ny=ocy+localX*Math.sin(a)+localY*Math.cos(a)-h/2;
      values={x:nx+(l.type==='text'?(l.align==='right'?w:l.align==='center'?w/2:0):0),y:ny,width:Math.min(2160,l.type==='text'?l.width*w/b.width:w)};
      if(l.type==='text')values.fontSize=l.fontSize*w/b.width;else values.height=Math.min(2160,h);
    }
    if(values.x!==undefined)values.x=Math.max(-1080,Math.min(1080,values.x));if(values.y!==undefined)values.y=Math.max(-1350,Math.min(1350,values.y));
    editLayer(values,d.group);fillLayerProperties();
  });
  const stop=()=>{layerDrag=null;historyGroup='';$('wkGuideX').hidden=true;$('wkGuideY').hidden=true;};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,stop);
  $('wkDesignView').addEventListener('keydown',e=>{
    if(e.defaultPrevented||e.isComposing||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
    if(e.key==='Escape'){stop();selectedLayer=null;refreshStudio();return;}
    if(!canEdit())return;
    const mod=e.ctrlKey||e.metaKey;
    if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();undoStudio(e.shiftKey);return;}
    if(mod&&e.key.toLowerCase()==='y'){e.preventDefault();undoStudio(true);return;}
    if(mod&&e.key.toLowerCase()==='d'){e.preventDefault();duplicateObject();return;}
    if(['Delete','Backspace'].includes(e.key)){e.preventDefault();deleteObject();return;}
    if(e.key==='Enter' && e.target===canvas){e.preventDefault();startInline();return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      const l=currentLayer();if(!l||l.locked||l.x===undefined)return;e.preventDefault();const delta=e.shiftKey?10:1;
      editLayer({x:l.x+(e.key==='ArrowLeft'?-delta:e.key==='ArrowRight'?delta:0),y:l.y+(e.key==='ArrowUp'?-delta:e.key==='ArrowDown'?delta:0)},'arrow-'+l.id);fillLayerProperties();
    }
  });
  document.addEventListener('enticket-auth',()=>{inlineEdit=null;$('wkInlineText').hidden=true;stop();past=[];future=[];historyKey='';paperImages={};paperAssetsPromise=null;canvasContext().clearRect(0,0,1080,1350);$('wkLayerStage').hidden=true;$('wkLayerPanel').hidden=true;$('wkDesignView').classList.remove('wk-focus');selectedLayer=null;});
  setStudioPane('performances');
}
