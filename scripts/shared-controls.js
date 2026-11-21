// Shared app controls. Native form values/events remain the source of truth.
(() => {
  const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const emit=input=>{input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
  const usable=input=>input?.isConnected&&!input.matches(':disabled')&&!input.closest('[hidden]');
  const icon=kind=>kind==='time'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 10h16"/></svg>';
  const button=(text,cls='btn ghost sm')=>{const n=node('button',text,cls);n.type='button';return n;};

  // Explicit, cancellable in-app messages; no confirmation is accepted automatically.
  const message=node('dialog',undefined,'ui-dialog ui-message');message.setAttribute('aria-labelledby','uiMessageTitle');message.setAttribute('aria-describedby','uiMessageText');
  message.innerHTML='<form method="dialog"><div class="ui-dialog-head"><h3 id="uiMessageTitle"></h3><button type="button" class="ui-dialog-close" data-close aria-label="닫기">×</button></div><p id="uiMessageText" class="ui-dialog-message"></p><input type="password" id="uiMessageInput" aria-label="파일 암호" autocomplete="off" hidden><div class="ui-dialog-actions"><button type="button" class="btn ghost" data-cancel>취소</button><button type="submit" class="btn" data-accept>확인</button></div></form>';
  document.body.append(message);
  let queue=[],activeMessage=null;
  function nextMessage(){
    if(activeMessage||!queue.length)return;activeMessage=queue.shift();
    const {kind,text}=activeMessage;
    message.querySelector('h3').textContent=kind==='prompt'?'파일 암호 입력':kind==='confirm'?'확인해 주세요':'안내';
    message.querySelector('p').textContent=String(text);
    const input=message.querySelector('input');input.hidden=kind!=='prompt';input.value='';
    message.querySelector('[data-cancel]').hidden=kind==='alert';message.returnValue='';message.showModal();
    (kind==='prompt'?input:message.querySelector(kind==='confirm'?'[data-cancel]':'[data-accept]')).focus();
  }
  for(const sel of ['[data-cancel]','[data-close]'])message.querySelector(sel).onclick=()=>message.close('cancel');
  message.querySelector('form').addEventListener('submit',e=>{e.preventDefault();message.close('accept');});
  message.addEventListener('close',()=>{
    if(!activeMessage)return;const item=activeMessage;activeMessage=null;
    const accepted=message.returnValue==='accept',value=message.querySelector('input').value;message.querySelector('input').value='';
    item.resolve(item.kind==='prompt'?(accepted?value:null):accepted);queueMicrotask(nextMessage);
  });
  const ask=(kind,text)=>new Promise(resolve=>{queue.push({kind,text,resolve});nextMessage();});
  window.EnticketUI={alert:text=>ask('alert',text),confirm:text=>ask('confirm',text),prompt:text=>ask('prompt',text)};

  // CSS base-select covers Chromium. Other engines receive the same app listbox.
  if(!CSS.supports('appearance','base-select')){
    const popup=node('div',undefined,'ui-select-popup');popup.id='uiSelectOptions';popup.setAttribute('role','listbox');popup.setAttribute('popover','manual');popup.hidden=true;
    let target=null,active=-1,search='',searchTime=0;const optionAria=new Map();
    const enabled=option=>!!option&&!option.disabled&&!option.closest('optgroup[disabled]')&&!option.hidden;
    function close(){
      if(!target)return;target.setAttribute('aria-expanded','false');target.removeAttribute('aria-activedescendant');target=null;
      for(const [option,value]of optionAria){if(value===null)option.removeAttribute('aria-hidden');else option.setAttribute('aria-hidden',value);}optionAria.clear();
      if(popup.hidePopover&&popup.matches(':popover-open'))popup.hidePopover();popup.hidden=true;
    }
    function place(){
      if(!target)return;if(!usable(target)||!target.getClientRects().length){close();return;}
      const r=target.getBoundingClientRect(),v=window.visualViewport,w=v?.width||innerWidth,h=v?.height||innerHeight;
      popup.style.width=Math.min(Math.max(r.width,180),w-24)+'px';popup.style.left=Math.max(12,Math.min(r.left,w-popup.offsetWidth-12))+'px';
      const below=h-r.bottom-12,above=r.top-12,up=below<180&&above>below;
      popup.style.maxHeight=Math.max(50,Math.min(340,up?above-6:below-6))+'px';popup.style.top=(up?r.top-popup.offsetHeight-6:r.bottom+6)+'px';
    }
    function highlight(index){
      active=index;for(const option of popup.querySelectorAll('[role=option]'))option.dataset.active=String(Number(option.dataset.index)===index);
      const option=popup.querySelector('[data-index="'+index+'"]');if(option){target.setAttribute('aria-activedescendant',option.id);option.scrollIntoView({block:'nearest'});}
    }
    function draw(){
      popup.replaceChildren();let group=null;
      [...target.options].forEach((option,i)=>{
        if(!optionAria.has(option)){optionAria.set(option,option.getAttribute('aria-hidden'));option.setAttribute('aria-hidden','true');}
        if(option.hidden)return;
        const parent=option.closest('optgroup');if(parent&&parent!==group){popup.append(node('div',parent.label,'ui-select-group'));group=parent;}
        const row=node('div',option.label,'ui-select-option');row.id='uiOption'+i;row.dataset.index=i;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(!enabled(option)));popup.append(row);
      });
      highlight(active);place();
    }
    function open(select){
      if(!usable(select)||select.multiple||select.size>1)return;close();target=select;active=select.selectedIndex;
      (select.closest('dialog')||document.body).append(popup);popup.hidden=false;popup.setAttribute('aria-label',select.getAttribute('aria-label')||select.labels?.[0]?.childNodes[0]?.textContent.trim()||'항목 선택');
      select.setAttribute('aria-controls',popup.id);select.setAttribute('aria-expanded','true');select.focus();draw();if(popup.showPopover)popup.showPopover();place();highlight(active);
    }
    function choose(index){
      if(!target||!enabled(target.options[index]))return;const select=target;close();select.focus();if(select.selectedIndex!==index){select.selectedIndex=index;emit(select);}
    }
    popup.addEventListener('pointerdown',e=>e.preventDefault());
    popup.addEventListener('click',e=>{const row=e.target.closest('[data-index]');if(row)choose(Number(row.dataset.index));});
    popup.addEventListener('pointermove',e=>{const row=e.target.closest('[data-index]');if(row&&row.getAttribute('aria-disabled')!=='true')highlight(Number(row.dataset.index));});
    document.addEventListener('pointerdown',e=>{const select=e.target.closest('select');if(select&&!select.multiple&&select.size<=1){e.preventDefault();target===select?close():open(select);}else if(!popup.contains(e.target))close();},true);
    document.addEventListener('click',e=>{if(e.target.closest('select:not([multiple])'))e.preventDefault();},true);
    document.addEventListener('keydown',e=>{
      const select=e.target.closest('select');if(!select||select.multiple||select.size>1||!usable(select))return;
      if(e.key==='Tab'){close();return;}if(e.key==='Escape'){if(target){e.preventDefault();e.stopPropagation();close();}return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' ','PageDown','PageUp'].includes(e.key)){
        e.preventDefault();if(!target){open(select);if(['Enter',' '].includes(e.key))return;}
        if(['Enter',' '].includes(e.key)){choose(active);return;}
        const items=[...select.options].map((o,i)=>enabled(o)?i:-1).filter(i=>i>=0);if(!items.length)return;
        let i=items.indexOf(active);i=e.key==='Home'?0:e.key==='End'?items.length-1:i+(e.key==='ArrowUp'?-1:e.key==='PageUp'?-5:e.key==='PageDown'?5:1);highlight(items[Math.max(0,Math.min(items.length-1,i))]);
      }else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.isComposing){
        e.preventDefault();if(!target)open(select);search=Date.now()-searchTime>700?e.key:search+e.key;searchTime=Date.now();const i=[...select.options].findIndex(o=>enabled(o)&&o.label.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()));if(i>=0)highlight(i);
      }
    },true);
    document.addEventListener('focusin',e=>{if(target&&e.target!==target&&!popup.contains(e.target))close();});
    document.addEventListener('scroll',e=>{if(target&&!popup.contains(e.target))place();},true);window.addEventListener('resize',place);
    new MutationObserver(records=>{if(!target)return;if(!usable(target))close();else if(records.some(r=>r.target===target||target.contains(r.target)))draw();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','selected','label']});
    document.addEventListener('enticket-auth',close);
  }

  // A complete RGB picker (plus brand swatches) without an operating-system window.
  const colour=node('dialog',undefined,'ui-dialog ui-colour');colour.setAttribute('aria-labelledby','uiColourTitle');
  colour.innerHTML='<div class="ui-dialog-head"><h3 id="uiColourTitle">색상 선택</h3><button type="button" class="ui-dialog-close" data-close aria-label="닫기">×</button></div><div class="ui-colour-preview"></div><label class="ui-colour-hex">HEX<input type="text" aria-label="색상 HEX 코드" maxlength="7" spellcheck="false"></label><div class="ui-colour-swatches"></div><div class="ui-colour-channels"></div><div class="ui-dialog-actions"><button type="button" class="btn ghost" data-cancel>취소</button><button type="button" class="btn" data-apply>적용</button></div>';
  document.body.append(colour);let colourTarget=null,colourValue='#000000';
  const hex=colour.querySelector('input'),channels=[];
  function colourSync(value){
    colourValue=value.toLowerCase();hex.value=colourValue.toUpperCase();hex.setAttribute('aria-invalid','false');colour.querySelector('[data-apply]').disabled=false;colour.querySelector('.ui-colour-preview').style.background=colourValue;
    channels.forEach((input,i)=>{input.value=parseInt(value.slice(1+i*2,3+i*2),16);input.nextElementSibling.value=input.value;});
    for(const b of colour.querySelectorAll('[data-colour]'))b.setAttribute('aria-pressed',String(b.dataset.colour===colourValue));
  }
  for(const name of ['R','G','B']){
    const row=node('label',name,'ui-colour-channel'),slider=node('input');slider.type='range';slider.min=0;slider.max=255;slider.setAttribute('aria-label',name);const value=node('output');row.append(slider,value);channels.push(slider);colour.querySelector('.ui-colour-channels').append(row);
    slider.addEventListener('input',()=>colourSync('#'+channels.map(s=>Number(s.value).toString(16).padStart(2,'0')).join('')));
  }
  for(const value of ['#ffffff','#fff1e1','#111111','#606060','#602b89','#b80808','#d6ac72','#264c3b','#f2eafa','#d5c1e9','#f4d3d3','#f7e4b5','#d8e8db','#dce7f4','#233b60','#000000']){
    const swatch=button('','');swatch.dataset.colour=value;swatch.style.background=value;swatch.setAttribute('aria-label',value);swatch.onclick=()=>colourSync(value);colour.querySelector('.ui-colour-swatches').append(swatch);
  }
  hex.addEventListener('input',()=>{const value=hex.value.startsWith('#')?hex.value:'#'+hex.value;if(/^#[\da-f]{6}$/i.test(value))colourSync(value);else{hex.setAttribute('aria-invalid','true');colour.querySelector('[data-apply]').disabled=true;}});
  for(const selector of ['[data-close]','[data-cancel]'])colour.querySelector(selector).onclick=()=>colour.close();
  colour.querySelector('[data-apply]').onclick=()=>{if(usable(colourTarget)&&colourTarget.value!==colourValue){colourTarget.value=colourValue;emit(colourTarget);}colour.close();};
  function openColour(input){if(!usable(input))return;colourTarget=input;colourSync(input.value);colour.showModal();hex.focus();}
  document.addEventListener('click',e=>{if(e.target.matches('input[type=color]')){e.preventDefault();openColour(e.target);}},true);

  document.addEventListener('enticket-auth',()=>{
    if(colour.open)colour.close();colourTarget=null;
    for(const item of queue)item.resolve(item.kind==='prompt'?null:false);queue=[];
    if(message.open)message.close('cancel');
  });
  /* SHARED_CALENDAR_JS */
})();
