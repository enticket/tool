// Embedded inside the weekly editor closure by the public build.
const WD=window.EnticketWeeklyDesign;
let paperAssetsPromise, paperTexture=null, selectedLayer='title', layerDrag=null;
const isPaper=()=>draft?.template==='paper-editorial';
async function ensurePaperAssets(){
  if(!paperAssetsPromise)paperAssetsPromise=(async()=>{
    const fonts=await document.fonts.load('800 48px "Enticket Myeongjo"','공연이 있는 일주일');
    if(!fonts.length)throw Error('명조 글꼴을 불러오지 못했습니다. 다시 시도해 주세요.');
    const img=new Image();img.src='/assets/weekly/paper-grain.png';await img.decode();paperTexture=img;
  })().catch(error=>{paperAssetsPromise=null;throw error;});
  return paperAssetsPromise;
}
function currentScene(){pull();return WD.coverScene(draft);}
function currentLayer(){return currentScene().find(l=>l.id===selectedLayer);}
function paintLayerPreview(){
  if(!isPaper()||draft.jobId||selectedCard!==0)return;
  const canvas=$('wkLayerCanvas'),ctx=canvas.getContext('2d'),scene=currentScene();
  WD.paintScene(ctx,scene,paperTexture);
  const l=scene.find(n=>n.id===selectedLayer),b=WD.layerBounds(ctx,l),selection=$('wkLayerSelection');
  selection.hidden=!l.visible;
  Object.assign(selection.style,{left:b.x/1080*100+'%',top:b.y/1350*100+'%',width:b.width/1080*100+'%',height:b.height/1350*100+'%'});
}
function syncLayerEditor(){
  const active=isPaper()&&!draft.jobId&&selectedCard===0;
  $('wkLayerPanel').hidden=!active;$('wkLayerStage').hidden=!active;$('wkPreviews').hidden=active;
  if(active){$('wkCoverFields').hidden=true;fillLayerProperties();paintLayerPreview();}
}
function fillLayerProperties(){
  if(!isPaper())return;
  const l=currentLayer();$('wkLayerName').textContent=l.name;
  for(const button of $('wkLayerList').children){button.setAttribute('aria-pressed',String(button.dataset.layer===selectedLayer));button.dataset.hidden=String(currentScene().find(n=>n.id===button.dataset.layer).visible===false);}
  $('wkLayerVisible').checked=l.visible;
  $('wkLayerTextField').hidden=l.type!=='text'||l.id==='count';
  $('wkLayerText').value=l.text||'';$('wkLayerText').maxLength=['title','subtitle'].includes(l.id)?220:100;
  $('wkLayerSizeField').hidden=l.type!=='text';$('wkLayerSize').value=l.fontSize||'';
  $('wkLayerColorField').hidden=!l.color;$('wkLayerColor').value=l.color||'#000000';
  $('wkLayerPosition').hidden=l.x===undefined;$('wkLayerX').value=l.x??0;$('wkLayerY').value=l.y??0;
  $('wkLayerOpacityField').hidden=l.type!=='texture';$('wkLayerOpacity').value=l.opacity??90;$('wkLayerOpacityValue').value=(l.opacity??90)+'%';
  $('wkLayerAutoNote').hidden=l.id!=='count';
}
function editLayer(values){
  if(busy||draft?.jobId||!isPaper())return;
  const design=WD.normalizeDesign(draft.design);
  design.layers[selectedLayer]={...design.layers[selectedLayer],...values};
  try{draft.design=WD.normalizeDesign(design);}catch{return;}
  changed();paintLayerPreview();
  for(const button of $('wkLayerList').children)if(button.dataset.layer===selectedLayer)button.dataset.hidden=String(currentLayer().visible===false);
  $('wkStageState').textContent='수정됨 · 저장해 주세요';
}
function paintPaperTemplate(ctx,d,index,posters,text,poster){
  const scene=WD.coverScene(d);
  if(index===0){WD.validateScene(ctx,scene);WD.paintScene(ctx,scene,paperTexture);return;}
  WD.paintScene(ctx,scene.filter(l=>['paper','texture','topRule'].includes(l.id)),paperTexture);
  const ink=scene.find(l=>l.id==='subtitle').color,red=scene.find(l=>l.id==='title').color;
  const serif='"Enticket Myeongjo", serif',last=index===d.cards.length+1;
  text('@en__ticket',780,42,240,44,29,ink,700);
  if(last){
    text('이번 주의 공연',66,160,950,100,72,red,800,serif,60,1.2);
    const count=d.cards.length;
    for(let i=0;i<count;i++){
      const card=d.cards[i],y=300+i*104;
      ctx.fillStyle=ink;ctx.fillRect(66,y-10,950,1);
      text(String(i+1).padStart(2,'0'),66,y+7,60,42,22,red,700);
      text(card.title,150,y,680,92,34,ink,800,serif,28,1.2);
      const dates=[...new Set((card.schedule.match(/\d{2}\.\d{2}/g)||[]))].join(' / ');
      text(dates,850,y+5,166,86,23,ink,500,'system-ui, sans-serif',20,1.3);
    }
    text(d.closing,66,1160,950,115,27,ink,500,'system-ui, sans-serif',24,1.3);
  }else{
    const card=d.cards[index-1];
    text(String(index).padStart(2,'0')+' / '+String(d.cards.length).padStart(2,'0'),66,150,250,46,25,red,700);
    text(card.title,66,215,950,160,58,red,800,serif,38,1.2);
    poster(posters[index-1],66,410,600,760,'#ffffff00');
    text('공연 일시',708,432,310,42,25,red,700);
    text(card.schedule,708,490,310,280,30,ink,500,'system-ui, sans-serif',24,1.35);
    text('장소',708,800,310,42,25,red,700);
    text(card.venue,708,852,310,140,30,ink,700,'system-ui, sans-serif',24,1.3);
    text(card.price,708,1040,310,130,27,ink,500,'system-ui, sans-serif',24,1.3);
  }
  ctx.fillStyle=red;ctx.fillRect(66,1268,950,2);
  text(d.week.slice(5).replace('-','.')+'—'+d.weekEnd.slice(5).replace('-','.'),66,1290,700,40,25,ink,700);
}
async function downloadLayerSource(){
  const exportEpoch=generation;pull();await ensurePaperAssets();
  const scene=currentScene(),ctx=$('wkLayerCanvas').getContext('2d');WD.validateScene(ctx,scene);
  const dataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});
  const get=async path=>{const r=await fetch(path);if(!r.ok)throw Error('원본 파일을 불러오지 못했습니다.');return r.blob();};
  const [font,texture,license]=await Promise.all([get('/assets/weekly/NanumMyeongjo-ExtraBold.woff2'),get('/assets/weekly/paper-grain.png'),get('/assets/weekly/OFL.txt')]);
  const [fontData,textureData]=await Promise.all([dataUrl(font),dataUrl(texture)]);
  const manifest={format:'enticket-weekly-design',version:1,width:1080,height:1350,template:'paper-editorial',
    title:draft.title,subtitle:draft.subtitle,week:draft.week,weekEnd:draft.weekEnd,design:WD.normalizeDesign(draft.design),layers:scene};
  const files={
    'design.json':new TextEncoder().encode(JSON.stringify(manifest,null,2)),
    'cover.svg':new TextEncoder().encode(WD.coverSvg(ctx,scene,{fontData,textureData})),
    'NanumMyeongjo-ExtraBold.woff2':new Uint8Array(await font.arrayBuffer()),
    'OFL.txt':new Uint8Array(await license.arrayBuffer()),
    'paper-grain.png':new Uint8Array(await texture.arrayBuffer()),
    'README.txt':new TextEncoder().encode('엔티켓 표지 편집 원본\n\ncover.svg: 이름이 있는 레이어 그룹과 편집 가능한 텍스트. 폰트와 종이 질감 포함.\ndesign.json: 도구사이트에서 사용하는 위치·색상·글자 크기(pt)·질감 강도.\n글꼴은 나눔명조 ExtraBold, SIL Open Font License 1.1입니다.\n외부 SVG 편집기는 내장 폰트 지원에 따라 글자 모양이 다를 수 있습니다. 게시용 이미지는 도구사이트의 ZIP 다운로드를 사용하세요.\n도구사이트의 저장 버튼으로 초안을 저장하면 같은 설정으로 다시 편집할 수 있습니다.\n')
  };
  if(exportEpoch!==generation)throw Error('로그인 상태가 변경되었습니다.');
  const url=URL.createObjectURL(new Blob([fflate.zipSync(files,{level:6})],{type:'application/zip'})),a=el('a');a.href=url;a.download=draft.week+'-enticket-editable.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function initLayerEditor(){
  for(const l of [...WD.LAYERS].reverse()){
    const b=el('button',l.name);b.type='button';b.dataset.layer=l.id;b.setAttribute('aria-pressed',String(l.id===selectedLayer));
    b.addEventListener('click',()=>{selectedLayer=l.id;fillLayerProperties();paintLayerPreview();});$('wkLayerList').append(b);
  }
  $('wkLayerVisible').addEventListener('change',()=>editLayer({visible:$('wkLayerVisible').checked}));
  for(const [id,key]of [['wkLayerSize','fontSize'],['wkLayerX','x'],['wkLayerY','y'],['wkLayerOpacity','opacity']])$(id).addEventListener('input',()=>{if($(id).value===''||!$(id).checkValidity())return;editLayer({[key]:Number($(id).value)});if(key==='opacity')$('wkLayerOpacityValue').value=$(id).value+'%';});
  $('wkLayerColor').addEventListener('input',()=>editLayer({color:$('wkLayerColor').value}));
  $('wkLayerText').addEventListener('input',()=>{
    if(busy||draft?.jobId)return;
    if(['title','subtitle'].includes(selectedLayer)){$(selectedLayer==='title'?'wkTitle':'wkSubtitle').value=$('wkLayerText').value;pull();changed();paintLayerPreview();}
    else editLayer({text:$('wkLayerText').value});
  });
  $('wkLayerReset').addEventListener('click',()=>{if(busy||draft?.jobId)return;const design=WD.normalizeDesign(draft.design);delete design.layers[selectedLayer];draft.design=design;changed();fillLayerProperties();paintLayerPreview();});
  $('wkLayerDownload').addEventListener('click',()=>run(downloadLayerSource));
  const canvas=$('wkLayerCanvas');
  const point=e=>{const b=canvas.getBoundingClientRect();return {x:(e.clientX-b.x)*1080/b.width,y:(e.clientY-b.y)*1350/b.height};};
  canvas.addEventListener('pointerdown',e=>{
    if(busy||draft?.jobId||!isPaper()||e.button!==0)return;
    const p=point(e),scene=currentScene(),ctx=canvas.getContext('2d');
    const hit=[...scene].reverse().find(l=>{if(!l.visible||!['text','line'].includes(l.type))return false;const b=WD.layerBounds(ctx,l);return p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height;});
    if(!hit)return;
    selectedLayer=hit.id;fillLayerProperties();paintLayerPreview();canvas.focus();
    layerDrag={pointer:e.pointerId,p,x:hit.x,y:hit.y};canvas.setPointerCapture(e.pointerId);canvas.style.touchAction='none';
  });
  canvas.addEventListener('pointermove',e=>{
    if(!layerDrag||layerDrag.pointer!==e.pointerId)return;
    const p=point(e);editLayer({x:Math.round(Math.max(-1080,Math.min(1080,layerDrag.x+p.x-layerDrag.p.x))),y:Math.round(Math.max(-1350,Math.min(1350,layerDrag.y+p.y-layerDrag.p.y)))});
    $('wkLayerX').value=currentLayer().x;$('wkLayerY').value=currentLayer().y;
  });
  const stop=()=>{layerDrag=null;canvas.style.touchAction='';};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,stop);
  canvas.addEventListener('keydown',e=>{
    if(!isPaper()||draft.jobId||busy||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    const l=currentLayer();if(l.x===undefined)return;e.preventDefault();const delta=e.shiftKey?10:1;
    editLayer({x:l.x+(e.key==='ArrowLeft'?-delta:e.key==='ArrowRight'?delta:0),y:l.y+(e.key==='ArrowUp'?-delta:e.key==='ArrowDown'?delta:0)});fillLayerProperties();
  });
  document.addEventListener('enticket-auth',()=>{stop();$('wkLayerCanvas').getContext('2d').clearRect(0,0,1080,1350);$('wkLayerStage').hidden=true;$('wkLayerPanel').hidden=true;selectedLayer='title';});
}
