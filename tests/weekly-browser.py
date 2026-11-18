from browser_support import accept_app_messages
"""Weekly editor against synthetic providers; no production account calls."""
import os,json,io,base64,zipfile
from pathlib import Path
from email import policy
from email.parser import BytesParser
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright,expect
from browser_support import install_library_routes

artifact_dir=Path(os.environ.get('ARTIFACT_DIR','/tmp/enticket-weekly-preview'));artifact_dir.mkdir(parents=True,exist_ok=True)
out=io.BytesIO();poster=Image.new('RGB',(900,1200),'#fbcc87');ImageDraw.Draw(poster).text((100,100),'ENTICKET / LIVE / 2026',fill='black');poster.save(out,'JPEG');poster_bytes=out.getvalue()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'))
 page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 accept_app_messages(page)
 install_library_routes(page)
 db={'performances':[],'drafts':[]};assets={};images=[];state={'logged':False,'publishes':0}
 page.route('https://accounts.google.com/gsi/client',lambda r:r.fulfill(content_type='application/javascript',body="window.google={accounts:{oauth2:{initTokenClient(o){return{requestAccessToken(){o.callback({access_token:'synthetic',expires_in:3600})}}},revoke(){}}}}"))
 page.route('https://www.googleapis.com/oauth2/v3/userinfo',lambda r:r.fulfill(json={'email':'staff@test.example'}))
 def api(route):
  path=route.request.url.split('/api/')[1]
  if path=='session':route.fulfill(status=200 if state['logged'] else 401,json={'ok':True,'allowed':True,'email':'staff@test.example'} if state['logged'] else {'error':'invalid_token'});return
  if path=='session/login':state['logged']=True;route.fulfill(json={'ok':True,'allowed':True,'email':'staff@test.example'});return
  if path=='session/logout':state['logged']=False;route.fulfill(json={'ok':True});return
  assert path=='weekly',path
  msg=BytesParser(policy=policy.default).parsebytes(('Content-Type: '+route.request.headers['content-type']+'\r\n\r\n').encode()+route.request.post_data_buffer)
  fields={};files=[]
  for part in msg.iter_parts():
   key=part.get_param('name',header='content-disposition');value=part.get_payload(decode=True)
   if key=='file':files.append(value)
   else:fields[key]=value.decode()
  action=fields['action'];id=fields.get('id')
  if action=='sources':
   route.fulfill(json={'ok':True,'items':[{'id':'999','caption':'🎭 가져온 공연\n일시: 2026.12.05 19:30','assets':[{'type':'image'}],'suggestion':{'title':'가져온 공연','venue':'아트홀','sessions':[{'date':'2026-12-05','time':'19:30'}]}},{'id':'998','caption':'🎭 날짜 미정 공연','assets':[{'type':'image'}],'suggestion':{'title':'날짜 미정 공연','venue':'','sessions':[],'priceKind':'paid','price':'전석 20,000원'}}], 'nextCursor':None});return
  if action=='source':route.fulfill(content_type='image/jpeg',body=poster_bytes);return
  if action=='list':route.fulfill(json={'ok':True,**db});return
  if action=='performance':
   value=json.loads(fields['data']);value.update(id=id,version=value['version']+1,assetId=id);assets[id]=files[0] if files else assets[id];db['performances']=[v for v in db['performances'] if v['id']!=id]+[value];route.fulfill(json={'ok':True,'performance':value});return
  if action=='calendar-save':
   updates=json.loads(fields['data']);state['calendar_saves']=state.get('calendar_saves',0)+1
   if state.get('calendar_fail'):route.fulfill(status=409,json={'ok':False,'error':'weekly_conflict'});return
   changed=[]
   for update in updates:
    value=next(v for v in db['performances'] if v['id']==update['id']);assert value['version']==update['version'];value.update(sessions=update['sessions'],version=value['version']+1);changed.append(value)
   route.fulfill(json={'ok':True,'performances':changed});return
  if action=='asset':
   if state.get('hold_assets'):state.setdefault('held_assets',[]).append(route);return
   route.fulfill(content_type='image/jpeg',body=assets[id]);return
  if action=='draft':
   value=json.loads(fields['data']);value.update(status='draft',weekEnd='2026-11-22',version=value['version']+1)
   for card in value['cards']:card['assetId']=card['performanceId']
   db['drafts']=[value];route.fulfill(json={'ok':True,'draft':value});return
  if action=='rendered':route.fulfill(content_type='image/jpeg',body=images[int(fields['index'])]);return
  d=db['drafts'][0]
  if action=='prepare':
   images[:]=files;assert len(images)==3
   d.update(jobId='prepared-id',status='prepared',job={'fingerprint':'digest','account':{'username':'en__ticket'}})
  elif action=='unlock':
   d.pop('jobId',None);d.pop('job',None);d['status']='draft'
  elif action=='publish':
   assert fields['confirm']=='publish' and fields['fingerprint']=='digest';state['publishes']+=1;d['status']='published'
  else:assert action=='status',action
  route.fulfill(json={'ok':True,'draft':d})
 page.route('**/api/**',api)
 base=os.environ.get('TOOL_URL','http://127.0.0.1:8788')
 page.goto(base,wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('#gLoginBtn').click();page.locator('[data-ig-view="calendar"]').click()
 expect(page.locator('#wkCalendarView')).to_be_visible();expect(page.locator('#wkDesignView')).to_be_hidden()
 expect(page.locator('#igWeeklyView')).to_be_visible();expect(page.locator('#igPostView')).to_be_hidden()

 page.locator('#wkCalendar .wk-day-date').first.click();box=page.locator('#wkPPosterEmpty').bounding_box();assert abs(box['width']/box['height']-.75)<.01;empty_frame=page.locator('.wk-poster-upload').bounding_box();desktop_poster_height=page.locator('.wk-poster-control').bounding_box()['height'];expect(page.locator('#wkPRestore')).to_be_disabled();page.set_viewport_size({'width':390,'height':1000});mobile_poster_height=page.locator('.wk-poster-control').bounding_box()['height'];page.set_viewport_size({'width':1440,'height':1000});landscape=io.BytesIO();Image.new('RGB',(1200,600),'#ccc').save(landscape,'JPEG');page.locator('#wkPFile').set_input_files({'name':'wide.jpg','mimeType':'image/jpeg','buffer':landscape.getvalue()});expect(page.locator('#wkPPreview')).to_be_visible();page.wait_for_function("document.getElementById('wkPPreview').naturalWidth > 0");loaded_frame=page.locator('.wk-poster-upload').bounding_box();assert abs(loaded_frame['height']-empty_frame['height'])<1;assert abs(loaded_frame['width']/loaded_frame['height']-.75)<.01;page.locator('#wkPTitle').fill('11월의 작은 음악회');page.locator('#wkSessionRows input[type=date]').first.fill('2026-11-16');page.locator('#wkSessionRows input[type=time]').first.fill('19:30');page.locator('#wkAddSession').click();page.locator('#wkSessionRows input[type=date]').nth(1).fill('2026-11-22');page.locator('#wkPVenue').fill('엔티켓 아트홀');page.locator('#wkPFile').set_input_files({'name':'poster.jpg','mimeType':'image/jpeg','buffer':poster_bytes});expect(page.locator('#wkPPreview')).to_be_visible();page.locator('#wkPStatus').select_option('verified');page.locator('#wkPerformanceDialog').screenshot(path=str(artifact_dir/'performance-modal.png'));state['hold_assets']=True;page.locator('#wkPerformanceForm button[type="submit"]').click();expect(page.locator('#wkPerformanceDialog')).not_to_be_visible()
 # Opening a modal must not lock navigation while its poster request is pending.
 page.locator('#wkCalendar .wk-event').first.click();expect(page.locator('#wkPerformanceDialog')).to_be_visible()
 page.locator('#wkClosePerformance').click();expect(page.locator('#wkPerformanceDialog')).not_to_be_visible()
 page.locator('#wkCalendar .wk-event').first.click();expect(page.locator('#wkPerformanceDialog')).to_be_visible(timeout=1500)
 page.keyboard.press('Escape');expect(page.locator('#wkPerformanceDialog')).not_to_be_visible()
 page.locator('#wkCalendar .wk-day-date').first.click();expect(page.locator('#wkPTitle')).to_have_value('')
 state['hold_assets']=False
 for route in state.get('held_assets',[]):route.fulfill(content_type='image/jpeg',body=poster_bytes)
 # The late old poster must not populate a newly opened blank performance.
 page.wait_for_timeout(100);expect(page.locator('#wkPPreview')).to_be_hidden()
 page.locator('#wkClosePerformance').click()
 page.locator('#wkCalendar .wk-event').first.click();expect(page.locator('#wkPPreview')).to_be_visible()
 page.locator('#wkPSave').click();expect(page.locator('#wkPerformanceDialog')).not_to_be_visible()
 page.locator('#wkCalendar .wk-event').first.click();expect(page.locator('#wkPerformanceDialog')).to_be_visible()
 page.locator('#wkClosePerformance').click()
 # Different dates of the same performance highlight together, including keyboard focus.
 linked=page.locator('#wkCalendar .wk-event')
 page.locator('#wkNextMonth').focus();linked.first.hover();expect(page.locator('#wkCalendar .wk-linked-highlight')).to_have_count(2)
 tip=page.get_by_role('tooltip');expect(tip).to_be_visible();expect(tip).to_contain_text(linked.first.locator('.wk-event-title').inner_text());assert linked.first.get_attribute('title') is None
 page.keyboard.press('Escape');expect(tip).to_be_hidden()
 page.locator('#wkMonthTitle').hover();expect(page.locator('#wkCalendar .wk-linked-highlight')).to_have_count(0)
 linked.first.focus();expect(page.locator('#wkCalendar .wk-linked-highlight')).to_have_count(2)
 page.locator('#wkNextMonth').focus();expect(page.locator('#wkCalendar .wk-linked-highlight')).to_have_count(0)
 # Pointer dragging stages only the selected date's sessions until explicit save.
 def drag_day(source,target):
  button=page.locator(f'#wkCalendar [data-date="2026-11-{source}"] .wk-event').first
  dest=page.locator(f'#wkCalendar [data-date="2026-11-{target}"]')
  button.evaluate("e=>e.scrollIntoView({block:'center'})");a=button.bounding_box();b=dest.bounding_box()
  page.mouse.move(a['x']+a['width']/2,a['y']+a['height']/2);page.mouse.down();page.mouse.move(b['x']+b['width']/2,b['y']+b['height']/2,steps=12);page.mouse.up()
 drag_day('16','17');expect(page.locator('#wkCalendar [data-date="2026-11-17"] .wk-event')).to_have_count(1)
 expect(page.locator('#wkPerformanceDialog')).not_to_be_visible();expect(page.locator('#wkCalendarSave')).to_be_enabled()
 assert db['performances'][0]['sessions'][0]['date']=='2026-11-16';assert not state.get('calendar_saves')
 page.locator('#wkCalendarCancel').click();expect(page.locator('#wkCalendar [data-date="2026-11-16"] .wk-event')).to_have_count(1)
 drag_day('16','17');state['calendar_fail']=True;page.locator('#wkCalendarSave').click();expect(page.locator('#wkStatus')).to_contain_text('다른 창에서 수정');expect(page.locator('#wkCalendarSave')).to_be_enabled();assert db['performances'][0]['sessions'][0]['date']=='2026-11-16'
 state['calendar_fail']=False;page.locator('#wkCalendarSave').click();expect(page.locator('#wkCalendarSave')).to_be_disabled();expect(page.locator('#wkStatus')).to_contain_text('변경한 일정을 저장')
 assert db['performances'][0]['sessions']==[{'date':'2026-11-17','time':'19:30'},{'date':'2026-11-22','time':''}]
 drag_day('17','16');page.locator('#wkCalendarSave').click();expect(page.locator('#wkStatus')).to_contain_text('변경한 일정을 저장')
 page.locator('#wkImport').click();expect(page.locator('#wkStatus')).to_contain_text('날짜 배치 1개',timeout=20000);expect(page.locator('#wkUnscheduled')).to_contain_text('날짜 미정 공연')
 page.locator('#wkUnscheduled button').first.click();expect(page.locator('#wkPPriceKind')).to_have_value('paid');expect(page.locator('#wkPPrice')).to_have_value('전석 20,000원');expect(page.locator('#wkPRestore')).to_be_enabled();assert abs(page.locator('.wk-poster-control').bounding_box()['height']-desktop_poster_height)<1;page.set_viewport_size({'width':390,'height':1000});assert abs(page.locator('.wk-poster-control').bounding_box()['height']-mobile_poster_height)<1;page.set_viewport_size({'width':1440,'height':1000});page.locator('#wkPRestore').click();expect(page.locator('#wkPMessage')).to_contain_text('이미지를 불러왔습니다',timeout=20000);expect(page.locator('#wkPPreview')).to_be_visible();box=page.locator('#wkPPreview').bounding_box();assert abs(box['width']/box['height']-.75)<.01;page.locator('#wkClosePerformance').click()
 page.locator('#wkMonth').fill('2026-12');page.locator('#wkMonth').dispatch_event('change');expect(page.locator('[data-date="2026-12-05"]')).to_contain_text('가져온 공연');assert len(db['performances'])==3
 page.locator('#wkImport').click();expect(page.locator('#wkStatus')).to_contain_text('기존/동영상 제외 2개');assert len(db['performances'])==3
 page.locator('#wkMonth').fill('2026-11');page.locator('#wkMonth').dispatch_event('change')
 assert page.locator('#wkCalendar .wk-event').evaluate_all('(nodes)=>nodes.every(n=>n.getBoundingClientRect().height<=28)')
 page.screenshot(path=str(artifact_dir/'calendar.png'),full_page=True)
 # Existing sessions restore as actual date/time controls; footer stays in the dialog on mobile.
 page.locator('#wkCalendar .wk-event').first.click();expect(page.locator('#wkSessionRows input[type=date]')).to_have_count(2)
 expect(page.locator('#wkSessionRows input[type=time]').first).to_have_value('19:30')
 for width in [390,320]:
  page.set_viewport_size({'width':width,'height':740});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  footer=page.locator('.wk-modal-footer').bounding_box();assert footer['y']+footer['height']<=740
 page.locator('#wkPerformanceDialog').screenshot(path=str(artifact_dir/'performance-modal-mobile.png'))
 page.locator('#wkSessionRows .wk-session-remove').nth(1).click();expect(page.locator('#wkSessionRows input[type=date]')).to_have_count(1)
 page.locator('#wkClosePerformance').click();page.set_viewport_size({'width':1440,'height':1000})
 page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkCalendarView')).to_be_hidden();expect(page.locator('#wkDesignView')).to_be_visible()
 def pane(name):page.locator(f'[data-studio-pane="{name}"]').click()
 expect(page.locator('[data-studio-pane="performances"]')).to_have_attribute('aria-selected','true')
 page.locator('#wkWeek').fill('2026-11-16');page.locator('#wkWeek').dispatch_event('change');expect(page.locator('#wkTitle')).to_have_value('공연이\n있는\n일주일.')
 expect(page.locator('#wkLayerStage')).to_be_visible();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
 assert page.evaluate("document.fonts.check('800 48px \"Enticket Myeongjo\"', '공연')")
 # A five-point change is stored as a numeric size, not a regenerated bitmap.
 page.locator('[data-studio-pane="layers"]').click()
 page.locator('[data-layer="title"]').click();expect(page.locator('#wkLayerSize')).to_have_value('170')
 before=page.locator('#wkLayerCanvas').evaluate('(c)=>c.toDataURL()')
 page.locator('#wkLayerSize').fill('165');expect(page.locator('#wkDownload')).to_be_disabled()
 page.locator('#wkLayerText').fill('공연이\n있는\n일주일.')
 after=page.locator('#wkLayerCanvas').evaluate('(c)=>c.toDataURL()');assert before!=after
 page.locator('[data-studio-pane="layers"]').click()
 page.locator('[data-layer="texture"]').click();page.locator('#wkLayerOpacity').fill('80');expect(page.locator('#wkLayerOpacityValue')).to_have_text('80%')
 page.locator('[data-studio-pane="layers"]').click()
 page.locator('[data-layer="handle"]').click();page.locator('#wkLayerVisible').uncheck()
 page.locator('[data-studio-pane="layers"]').click()
 page.locator('[data-layer="title"]').click();page.locator('#wkLayerCanvas').focus();page.keyboard.press('ArrowRight');expect(page.locator('#wkLayerX')).to_have_value('73')
 page.locator('#wkSave').click();expect(page.locator('#wkStatus')).to_contain_text('저장했습니다',timeout=20000)
 saved=db['drafts'][0];assert saved['template']=='paper-editorial';assert saved['design']['layers']['title']=={'fontSize':165,'x':73,'y':158}
 assert saved['design']['layers']['texture']['opacity']==80;assert not saved['design']['layers']['handle']['visible']
 # Same renderer drives interactive preview and the exported JPEG (allow JPEG quantization).
 live=Image.open(io.BytesIO(base64.b64decode(page.locator('#wkLayerCanvas').evaluate('(c)=>c.toDataURL()').split(',')[1]))).convert('RGB')
 jpg=page.locator('#wkPreviews img').first.evaluate('(img)=>{const c=document.createElement("canvas");c.width=1080;c.height=1350;c.getContext("2d").drawImage(img,0,0);return c.toDataURL();}')
 exported=Image.open(io.BytesIO(base64.b64decode(jpg.split(",")[1]))).convert('RGB')
 from PIL import ImageChops,ImageStat
 assert max(ImageStat.Stat(ImageChops.difference(live,exported)).mean)<2
 page.locator('#wkLayerStage').screenshot(path=str(artifact_dir/'editable-cover.png'))
 page.locator('#wkLayerPanel').screenshot(path=str(artifact_dir/'layer-controls.png'))
 with page.expect_download() as edit_download:page.locator('#wkLayerDownload').click()
 archive=zipfile.ZipFile(edit_download.value.path());manifest=json.loads(archive.read('design.json'));svg=archive.read('cover.svg').decode()
 assert manifest['design']['layers']['title']['fontSize']==165
 assert '<g id="title"' in svg and '<text ' in svg and 'ENTICKET' not in svg and 'data:font/woff2;base64,' in svg
 assert state['publishes']==0
 layer_saved_id=saved['id'];page.reload(wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkDraftList')).to_be_enabled(timeout=20000);page.locator('#wkDraftList').select_option(layer_saved_id);pane('layers');page.locator('[data-layer="title"]').click()
 expect(page.locator('#wkLayerSize')).to_have_value('165');expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
 page.locator('[data-studio-pane="layers"]').click()
 page.locator('[data-layer="texture"]').click();expect(page.locator('#wkLayerOpacity')).to_have_value('80')
 for width in [390,320]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(artifact_dir/'layer-mobile.png'),full_page=True);page.set_viewport_size({'width':1440,'height':1000})
 # Layered carousel details and frozen publication review use the same saved bytes.
 page.locator('[data-studio-pane="performances"]').click()
 page.locator('#wkCandidates input').check();page.locator('#wkRender').click();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000);assert page.locator('#wkStatus').get_attribute('data-error')!='true',page.locator('#wkStatus').inner_text();expect(page.locator('#wkPreviews img')).to_have_count(3)
 page.locator('#wkFilmstrip button').nth(1).click();page.locator('#wkLayerStage').screenshot(path=str(artifact_dir/'paper-detail.png'))
 page.locator('#wkPrepare').click();expect(page.locator('#wkReview')).to_be_visible();expect(page.locator('#wkLayerStage')).to_be_hidden();expect(page.locator('#wkLayerPanel')).to_be_hidden();expect(page.locator('#wkLayerDownload')).to_be_disabled();assert state['publishes']==0
 archived=bytes(images[0]);page.locator('#wkRender').click();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000);assert bytes(images[0])==archived
 page.locator('#wkUnlock').click();pane('properties');expect(page.locator('#wkLayerPanel')).to_be_visible();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
 # Eight performances produce ten images with the same closing artwork.
 paper_base=next(p for p in db['performances'] if p['title']=='11월의 작은 음악회')
 for n in range(2,9):
  sample={**paper_base,'id':f'paper-capacity-{n}','assetId':f'paper-capacity-{n}','title':f'인천시립교향악단 기획연주회 가을밤의 클래식 {n}'}
  db['performances'].append(sample);assets[sample['id']]=poster_bytes
 page.locator('#wkRefresh').click();expect(page.locator('#wkCandidates input')).to_have_count(8)
 for n in range(1,8):
  page.locator('[data-studio-pane="performances"]').click()
  page.locator('#wkCandidates input').nth(n).check();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
 expect(page.locator('#wkPreviews img')).to_have_count(10);page.locator('#wkFilmstrip button').last.click();page.locator('#wkLayerStage').screenshot(path=str(artifact_dir/'paper-eight-closing.png'))
 expect(page.locator('#wkLayerList [data-layer="closingTitle"]')).to_have_count(1)
 expect(page.locator('#wkLayerList [data-layer^="entry"]')).to_have_count(0)
 assert page.locator('#wkStatus').get_attribute('data-error')!='true'
 for n in range(7,0,-1):
  page.locator('[data-studio-pane="performances"]').click()
  page.locator('#wkCandidates input').nth(n).uncheck();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
 db['performances']=[p for p in db['performances'] if not p['id'].startswith('paper-capacity-')]
 page.locator('#wkRefresh').click();expect(page.locator('#wkCandidates input')).to_have_count(1)
 page.locator('[data-studio-pane="performances"]').click()
 page.locator('#wkCandidates input').uncheck()
 # Retain the original templates and posting flow checks below.
 page.locator('[data-studio-pane="templates"]').click()
 expect(page.locator('#wkTemplates [data-template="poster-news"]')).to_have_count(0)
 legacy={**db['drafts'][0],'id':'prior-curation','template':'poster-news','cards':[]}
 db['drafts'].append(legacy)
 page.locator('#wkRefresh').click();page.locator('#wkDraftList').select_option('prior-curation')
 expect(page.locator('#wkTemplateName')).to_have_text('이전 큐레이션 초안')
 expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
 pane('properties')
 page.locator('#wkTitle').fill('이번 주\n인천에서 볼 공연');page.locator('#wkSubtitle').fill('이번 주, 공연장에서 만나요')
 expect(page.locator('#wkPreviousTemplates')).not_to_have_attribute('open','')
 page.locator('#wkRender').click();expect(page.locator('#wkPreviews img')).to_have_count(2)
 page.locator('[data-studio-pane="performances"]').click()
 page.locator('#wkCandidates input').check()
 page.locator('[data-studio-pane="templates"]').click()
 page.locator('#wkPreviousTemplates summary').click()
 template_bytes=[]
 for template in ['editorial','midnight','ticket','gallery']:
  page.locator('[data-studio-pane="templates"]').click()
  choice=page.locator(f'#wkTemplates [data-template="{template}"]');expect(choice).to_be_enabled(timeout=20000);choice.click();expect(choice).to_have_attribute('aria-pressed','true');expect(choice).to_be_enabled(timeout=20000)
  expect(page.locator('#wkPreviews img')).to_have_count(3)
  for j,label in enumerate(['cover','performance','closing']):
   page.locator('#wkFilmstrip button').nth(j).click()
   page.wait_for_function('(i)=>document.querySelectorAll("#wkPreviews img")[i].naturalWidth===1080',arg=j)
   encoded=page.locator('#wkPreviews img').nth(j).evaluate('(img)=>{const c=document.createElement("canvas");c.width=1080;c.height=1350;c.getContext("2d").drawImage(img,0,0);return c.toDataURL("image/jpeg");}')
   (artifact_dir/f'{template}-{label}.jpg').write_bytes(base64.b64decode(encoded.split(',')[1]))
  data=page.locator('#wkPreviews img').first.evaluate('(img)=>{const c=document.createElement("canvas");c.width=1080;c.height=1350;c.getContext("2d").drawImage(img,0,0);return c.toDataURL("image/jpeg");}')
  template_bytes.append(data)
 page.locator('[data-studio-pane="templates"]').click()
 page.locator('#wkTemplates').screenshot(path=str(artifact_dir/'templates.png'))
 assert len(set(template_bytes))==4
 # The cover adapts to two and three posters, while extra performances remain in the carousel.
 base_performance=next(p for p in db['performances'] if p['title']=='11월의 작은 음악회')
 for n in [2,3,4]:
  sample={**base_performance,'id':f'cover-fixture-{n}','assetId':f'cover-fixture-{n}','title':f'표지 배치 확인 {n}'}
  db['performances'].append(sample);assets[sample['id']]=poster_bytes
 page.locator('#wkRefresh').click();expect(page.locator('#wkCandidates input')).to_have_count(4)
 for n in [2,3,4]:
  page.locator('[data-studio-pane="performances"]').click()
  page.locator('#wkCandidates input').nth(n-1).check();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
  expect(page.locator('#wkPreviews img')).to_have_count(n+2)
  page.locator('#wkFilmstrip button').first.click()
  page.wait_for_function('document.querySelector("#wkPreviews img").naturalWidth===1080')
  encoded=page.locator('#wkPreviews img').first.evaluate('(img)=>{const c=document.createElement("canvas");c.width=1080;c.height=1350;c.getContext("2d").drawImage(img,0,0);return c.toDataURL("image/jpeg");}')
  (artifact_dir/f'gallery-cover-{n}.jpg').write_bytes(base64.b64decode(encoded.split(',')[1]))
 for n in [4,3,2]:
  page.locator('[data-studio-pane="performances"]').click()
  page.locator('#wkCandidates input').nth(n-1).uncheck();expect(page.locator('#wkRender')).to_be_enabled(timeout=20000)
 db['performances']=[p for p in db['performances'] if not p['id'].startswith('cover-fixture-')]
 page.locator('#wkRefresh').click();expect(page.locator('#wkCandidates input')).to_have_count(1)
 # Realistic long copy must fit all styles; excessive copy must not leave a partial export enabled.
 page.locator('#wkFilmstrip button').nth(1).click()
 pane('properties')
 fields=page.locator('#wkCards input');original=[fields.nth(i).input_value() for i in range(4)]
 stress=['2026 인천시립교향악단 기획연주회 — 가을밤에 만나는 영화 속 클래식','11월 16일 (월) 오후 02시 / 11월 17일 (화) 오후 07시 30분 / 11월 18일 (수) 오후 07시 30분 / 11월 19일 (목) 오후 07시 30분 / 11월 22일 (일) 오후 03시','인천문화예술회관 대공연장 · 인천광역시 남동구','R석 50,000원 · S석 30,000원']
 for i,value in enumerate(stress):fields.nth(i).fill(value)
 for template in ['editorial','midnight','ticket','gallery']:
  page.locator('[data-studio-pane="templates"]').click()
  choice=page.locator(f'#wkTemplates [data-template="{template}"]');choice.click();expect(choice).to_be_enabled(timeout=20000);expect(page.locator('#wkPreviews img')).to_have_count(3);expect(page.locator('#wkDownload')).to_be_enabled()
 page.locator('[data-studio-pane="templates"]').click()
 page.locator('#wkTemplates [data-template="ticket"]').click();expect(page.locator('#wkTemplates [data-template="ticket"]')).to_be_enabled(timeout=20000)
 pane('properties')
 fields.nth(2).fill('장소가 너무 긴 문구입니다 '*15);page.locator('#wkRender').click();expect(page.locator('#wkStatus')).to_contain_text('너무 깁니다');expect(page.locator('#wkDownload')).to_be_disabled();expect(page.locator('#wkPreviews img')).to_have_count(0)
 for i,value in enumerate(original):fields.nth(i).fill(value)
 page.locator('[data-studio-pane="templates"]').click()
 page.locator('#wkTemplates [data-template="ticket"]').click();expect(page.locator('#wkTemplates [data-template="ticket"]')).to_be_enabled(timeout=20000)
 page.locator('#wkFilmstrip button').first.click()
 pane('properties')
 page.locator('#wkCaptionSection summary').click();page.locator('#wkCaptionGenerate').click();page.locator('#wkSave').click();expect(page.locator('#wkStatus')).to_contain_text('저장했습니다')
 assert db['drafts'][0]['template']=='ticket'
 assert db['drafts'][0]['title']=='이번 주\n인천에서 볼 공연'
 saved_id=db['drafts'][0]['id'];page.reload(wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();page.locator('#wkDraftList').select_option(saved_id);expect(page.locator('#wkCards input').first).to_have_value('11월의 작은 음악회')
 page.locator('#wkRender').click();expect(page.locator('#wkPreviews img')).to_have_count(3);page.locator('#wkFilmstrip button').nth(1).click();pane('properties');expect(page.locator('#wkCards input').first).to_be_visible()
 assert page.locator('#wkPreviews img').evaluate_all('(xs)=>xs.every(i=>i.naturalWidth===1080&&i.naturalHeight===1350)')
 assert state['publishes']==0
 # The two workspaces are distinct, and navigating between them preserves the editor.
 page.locator('[data-ig-view="calendar"]').click();expect(page.locator('#wkCalendar')).to_be_visible();expect(page.locator('#wkTitle')).to_be_hidden()
 page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkCalendar')).to_be_hidden();expect(page.locator('#wkCards input').first).to_have_value('11월의 작은 음악회')
 page.screenshot(path=str(artifact_dir/'desktop.png'),full_page=True)
 page.locator('#wkPreviews').screenshot(path=str(artifact_dir/'cards.png'))
 with page.expect_download() as download:page.locator('#wkDownload').click()
 assert download.value.suggested_filename.endswith('.zip')
 page.locator('#wkPrepare').click();expect(page.locator('#wkReview')).to_be_visible();expect(page.locator('#wkTemplates button').first).to_be_disabled();expect(page.locator('#wkPublish')).to_be_disabled();assert state['publishes']==0
 for blob in images:
  im=Image.open(io.BytesIO(blob));assert im.size==(1080,1350)
 # Review exactly the archived bytes again after reload.
 page.reload(wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();page.locator('#wkDraftList').select_option(saved_id);page.locator('#wkRender').click();expect(page.locator('#wkPreviews img')).to_have_count(3)
 for width in [390,320]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(artifact_dir/'mobile.png'),full_page=True)
 page.locator('#wkConfirm').check();page.locator('#wkPublish').click();expect(page.locator('#wkStatus')).to_have_text('게시 완료');assert state['publishes']==1
 page.locator('#gLogoutBtn').click();expect(page.locator('#igWork')).to_be_hidden();expect(page.locator('#wkPreviews img')).to_have_count(0);expect(page.locator('#wkTitle')).to_have_value('')
 assert not errors,errors
 print('PASS: persistent weekly editor, sessions, JPEG preview, ZIP, immutable review, explicit publication, mobile and logout')
 browser.close()
