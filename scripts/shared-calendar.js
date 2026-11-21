// Embedded in shared-controls.js; typed native values and form validity are retained.
const calendar=node('dialog',undefined,'ig-calendar ui-calendar');calendar.setAttribute('aria-label','날짜와 시간 선택');
calendar.innerHTML='<div class="ig-calendar-head"><button type="button" class="ig-calendar-icon" data-prev aria-label="이전 달">‹</button><strong></strong><button type="button" class="ig-calendar-icon" data-next aria-label="다음 달">›</button><button type="button" class="ig-calendar-icon" data-close aria-label="닫기">×</button></div><div class="ig-calendar-grid"></div><div class="ig-calendar-time"><label>시간</label><div class="ig-time-stepper"><button type="button" tabindex="-1" data-step="1" aria-label="시 증가"></button><input aria-label="시" inputmode="numeric" type="text" maxlength="2" value="00" data-max="23"><button type="button" tabindex="-1" data-step="-1" aria-label="시 감소"></button></div><span>:</span><div class="ig-time-stepper"><button type="button" tabindex="-1" data-step="1" aria-label="분 증가"></button><input aria-label="분" inputmode="numeric" type="text" maxlength="2" value="00" data-max="59"><button type="button" tabindex="-1" data-step="-1" aria-label="분 감소"></button></div></div><p class="ui-dialog-error" role="status" hidden></p><div class="ui-dialog-actions"><button type="button" class="btn ghost sm" data-clear>비우기</button><button type="button" class="btn sm ig-calendar-apply">선택 완료</button></div>';
document.body.append(calendar);
const grid=calendar.querySelector('.ig-calendar-grid'),[hour,minute]=calendar.querySelectorAll('.ig-time-stepper input'),pad=n=>String(n).padStart(2,'0');
let dateTarget=null,dateTrigger=null,selected='',month=null,dateType='date';
const korea=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
function normalizeTime(input){input.value=pad(Math.min(Number(input.dataset.max),Math.max(0,Number(input.value)||0)));}
for(const input of [hour,minute]){
  const step=delta=>{normalizeTime(input);input.value=pad((Number(input.value)+delta+Number(input.dataset.max)+1)%(Number(input.dataset.max)+1));};
  input.parentElement.querySelectorAll('button').forEach(b=>b.onclick=()=>step(Number(b.dataset.step)));
  input.addEventListener('input',()=>{input.value=input.value.replace(/[^0-9]/g,'').slice(0,2);});input.addEventListener('blur',()=>normalizeTime(input));input.addEventListener('focus',()=>input.select());
  input.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();step(e.key==='ArrowUp'?1:-1);}});
}
function limits(){
  const reservation=dateType==='datetime-local'&&dateTarget.closest('#panel-instagram');
  return {min:dateTarget.min?.slice(0,dateType==='month'?7:10)||(reservation?korea():''),max:dateTarget.max?.slice(0,dateType==='month'?7:10)||(reservation?new Date(Date.now()+30*86400000+9*3600000).toISOString().slice(0,10):'')};
}
function renderCalendarPicker(){
  const {min,max}=limits(),visible=month.toISOString().slice(0,7),y=month.getUTCFullYear(),m=month.getUTCMonth(),isMonth=dateType==='month',isTime=dateType==='time';
  calendar.querySelector('[data-prev]').hidden=isTime;calendar.querySelector('[data-next]').hidden=isTime;grid.hidden=isTime;
  calendar.querySelector('[data-prev]').disabled=!!min&&(isMonth?String(y)<=min.slice(0,4):visible<=min.slice(0,7));
  calendar.querySelector('[data-next]').disabled=!!max&&(isMonth?String(y)>=max.slice(0,4):visible>=max.slice(0,7));
  calendar.querySelector('[data-prev]').setAttribute('aria-label',isMonth?'이전 해':'이전 달');calendar.querySelector('[data-next]').setAttribute('aria-label',isMonth?'다음 해':'다음 달');
  calendar.querySelector('strong').textContent=isTime?'시간 선택':isMonth?`${y}년`:`${y}년 ${m+1}월`;
  calendar.querySelector('.ig-calendar-time').hidden=!['time','datetime-local'].includes(dateType);
  calendar.querySelector('.ig-calendar-time label').textContent=dateType==='datetime-local'?'한국 시간':'시간';
  grid.classList.toggle('is-months',isMonth);grid.replaceChildren();
  const add=(value,text,label)=>{
    const b=button(text,'ig-calendar-day');b.dataset.date=value;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(value===selected));b.disabled=!!(min&&value<min||max&&value>max);
    b.onclick=()=>{selected=value;renderCalendarPicker();grid.querySelector('[data-date="'+value+'"]')?.focus();};grid.append(b);
  };
  if(isMonth){for(let n=1;n<=12;n++)add(`${y}-${pad(n)}`,n+'월',`${y}년 ${n}월`);}
  else if(!isTime){
    for(const day of ['일','월','화','수','목','금','토'])grid.append(node('span',day));
    for(let n=0;n<new Date(Date.UTC(y,m,1)).getUTCDay();n++)grid.append(node('i'));
    for(let n=1;n<=new Date(Date.UTC(y,m+1,0)).getUTCDate();n++)add(`${y}-${pad(m+1)}-${pad(n)}`,n,`${y}년 ${m+1}월 ${n}일`);
  }
}
function openCalendar(input,trigger){
  if(!usable(input)&&!input.matches('input[type=datetime-local][data-calendar]'))return;if(input.matches(':disabled'))return;
  dateTarget=input;dateTrigger=trigger;dateType=input.type;calendar.setAttribute('aria-label',dateType==='datetime-local'?'예약 날짜와 시간 선택':dateType==='time'?'시간 선택':dateType==='month'?'월 선택':'날짜 선택');
  const now=new Date(Date.now()+10*3600000).toISOString().slice(0,16),value=input.value||now;
  selected=dateType==='month'?value.slice(0,7):dateType==='time'?korea():value.slice(0,10);
  const {min,max}=limits();if(min&&selected<min)selected=min;if(max&&selected>max)selected=max;
  month=new Date(selected.slice(0,7)+'-01T00:00:00Z');const time=dateType==='time'?(input.value||'19:00'):value.slice(11,16);[hour.value,minute.value]=time.split(':');
  calendar.querySelector('.ui-dialog-error').hidden=true;calendar.querySelector('[data-clear]').hidden=input.required||dateType==='datetime-local';renderCalendarPicker();calendar.showModal();
  (dateType==='time'?hour:grid.querySelector('[aria-pressed=true]:not(:disabled)')||calendar.querySelector('[data-close]')).focus();
}
for(const [selector,delta]of [['[data-prev]',-1],['[data-next]',1]])calendar.querySelector(selector).onclick=()=>{if(dateType==='month')month.setUTCFullYear(month.getUTCFullYear()+delta);else month.setUTCMonth(month.getUTCMonth()+delta);renderCalendarPicker();};
calendar.querySelector('[data-close]').onclick=()=>calendar.close();
function applyDate(value){
  if(!dateTarget?.isConnected||dateTarget.matches(':disabled')){calendar.close();return;}
  const probe=dateTarget.cloneNode();probe.value=value;
  if(!probe.checkValidity()){
    const error=calendar.querySelector('.ui-dialog-error');error.textContent='입력 가능한 날짜와 시간 범위를 확인해 주세요.';error.hidden=false;return;
  }
  const input=dateTarget;calendar.close();if(input.value!==value){input.value=value;emit(input);}
}
calendar.querySelector('.ig-calendar-apply').onclick=()=>{normalizeTime(hour);normalizeTime(minute);applyDate(dateType==='time'?hour.value+':'+minute.value:dateType==='datetime-local'?selected+'T'+hour.value+':'+minute.value:selected);};
calendar.querySelector('[data-clear]').onclick=()=>applyDate('');
calendar.addEventListener('close',()=>{if(dateTrigger?.isConnected)dateTrigger.focus({preventScroll:true});dateTarget=null;dateTrigger=null;});
grid.addEventListener('keydown',e=>{
  const b=e.target.closest('[data-date]');if(!b)return;
  const keys={ArrowLeft:-1,ArrowRight:1,ArrowUp:dateType==='month'?-3:-7,ArrowDown:dateType==='month'?3:7};
  if(!(e.key in keys))return;e.preventDefault();const all=[...grid.querySelectorAll('button')],next=all[all.indexOf(b)+keys[e.key]];if(next&&!next.disabled)next.focus();
});
const attachedDates=new WeakMap();
function attachDate(input){
  if(attachedDates.has(input)||input.closest('.ui-calendar'))return;
  const type=input.type,full=type==='datetime-local',trigger=button('',full?'ig-date-trigger':'ui-picker-open');
  trigger.setAttribute('aria-label',full?'예약 날짜와 시간 선택':type==='date'?'날짜 선택':type==='month'?'월 선택':'시간 선택');trigger.setAttribute('aria-haspopup','dialog');
  if(full){input.dataset.calendar='true';input.hidden=true;input.tabIndex=-1;input.after(trigger);}
  else{const wrap=node('span',undefined,'ui-field-picker');input.before(wrap);wrap.append(input,trigger);trigger.innerHTML=icon(type);}
  let displayed=null;
  function sync(){const disabled=input.matches(':disabled');if(trigger.disabled!==disabled)trigger.disabled=disabled;if(full&&displayed!==input.value){displayed=input.value;trigger.replaceChildren(node('span',input.value?input.value.replace('T','  ').replaceAll('-','.'):'날짜와 시간 선택'));const symbol=node('span');symbol.innerHTML=icon(type);symbol.className='ui-date-icon';trigger.append(symbol);}}
  trigger.onclick=()=>openCalendar(input,trigger);input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&e.altKey){e.preventDefault();openCalendar(input,trigger);}});
  for(const event of ['input','change'])input.addEventListener(event,sync);
  // Programmatic value assignments are common when loading saved drafts/reservations.
  if(full){const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');Object.defineProperty(input,'value',{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});}
  attachedDates.set(input,sync);sync();
}
function scanDates(){
  for(const input of document.querySelectorAll('input:is([type=date],[type=time],[type=month],[type=datetime-local])')){attachDate(input);attachedDates.get(input)?.();}
  if(dateTarget&&(!dateTarget.isConnected||dateTarget.matches(':disabled')))calendar.close();
}
function startDates(){scanDates();new MutationObserver(scanDates).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startDates,{once:true});else startDates();
document.addEventListener('enticket-auth',()=>{if(calendar.open)calendar.close();});
