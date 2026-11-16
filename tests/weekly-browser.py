"""Weekly editor against synthetic providers; no production account calls."""
import os,json,io
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
   route.fulfill(json={'ok':True,'items':[{'id':'999','caption':'🎭 가져온 공연\n일시: 2026.12.05 19:30','assets':[{'type':'image'}],'suggestion':{'title':'가져온 공연','venue':'아트홀','sessions':[{'date':'2026-12-05','time':'19:30'}]}},{'id':'998','caption':'🎭 날짜 미정 공연','assets':[{'type':'image'}],'suggestion':{'title':'날짜 미정 공연','venue':'','sessions':[]}}], 'nextCursor':None});return
  if action=='source':route.fulfill(content_type='image/jpeg',body=poster_bytes);return
  if action=='list':route.fulfill(json={'ok':True,**db});return
  if action=='performance':
   value=json.loads(fields['data']);value.update(id=id,version=value['version']+1,assetId=id);assets[id]=files[0] if files else assets[id];db['performances']=[v for v in db['performances'] if v['id']!=id]+[value];route.fulfill(json={'ok':True,'performance':value});return
  if action=='asset':route.fulfill(content_type='image/jpeg',body=assets[id]);return
  if action=='draft':
   value=json.loads(fields['data']);value.update(status='draft',weekEnd='2026-11-22',version=value['version']+1)
   for card in value['cards']:card['assetId']=card['performanceId']
   db['drafts']=[value];route.fulfill(json={'ok':True,'draft':value});return
  if action=='rendered':route.fulfill(content_type='image/jpeg',body=images[int(fields['index'])]);return
  d=db['drafts'][0]
  if action=='prepare':
   images[:]=files;assert len(images)==3
   d.update(jobId='prepared-id',status='prepared',job={'fingerprint':'digest','account':{'username':'en__ticket'}})
  elif action=='publish':
   assert fields['confirm']=='publish' and fields['fingerprint']=='digest';state['publishes']+=1;d['status']='published'
  else:assert action=='status',action
  route.fulfill(json={'ok':True,'draft':d})
 page.route('**/api/**',api)
 base=os.environ.get('TOOL_URL','http://127.0.0.1:8788')
 page.goto(base,wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('#gLoginBtn').click();page.locator('[data-ig-view="calendar"]').click()
 expect(page.locator('#wkCalendarView')).to_be_visible();expect(page.locator('#wkDesignView')).to_be_hidden()
 expect(page.locator('#igWeeklyView')).to_be_visible();expect(page.locator('#igPostView')).to_be_hidden()

 page.locator('#wkNewPerformance').click();page.locator('#wkPTitle').fill('11월의 작은 음악회');page.locator('#wkPSessions').fill('2026-11-16 19:30\n2026-11-22');page.locator('#wkPVenue').fill('엔티켓 아트홀');page.locator('#wkPFile').set_input_files({'name':'poster.jpg','mimeType':'image/jpeg','buffer':poster_bytes});expect(page.locator('#wkPPreview')).to_be_visible();page.locator('#wkPStatus').select_option('verified');page.locator('#wkPerformanceForm button[type="submit"]').click();expect(page.locator('#wkPerformanceDialog')).not_to_be_visible()
 page.locator('#wkImport').click();expect(page.locator('#wkStatus')).to_contain_text('날짜 배치 1개');expect(page.locator('#wkUnscheduled')).to_contain_text('날짜 미정 공연')
 page.locator('#wkMonth').fill('2026-12');page.locator('#wkMonth').dispatch_event('change');expect(page.locator('[data-date="2026-12-05"]')).to_contain_text('가져온 공연');assert len(db['performances'])==3
 page.locator('#wkImport').click();expect(page.locator('#wkStatus')).to_contain_text('기존/동영상 제외 2개');assert len(db['performances'])==3
 page.locator('#wkMonth').fill('2026-11');page.locator('#wkMonth').dispatch_event('change')
 page.screenshot(path=str(artifact_dir/'calendar.png'),full_page=True)
 page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkCalendarView')).to_be_hidden();expect(page.locator('#wkDesignView')).to_be_visible()
 page.locator('#wkWeek').fill('2026-11-16');page.locator('#wkWeek').dispatch_event('change');expect(page.locator('#wkTitle')).to_have_value('2026년 11월 셋째 주 공연')
 page.locator('#wkCandidates input').check();page.locator('#wkCaptionSection summary').click();page.locator('#wkCaptionGenerate').click();page.locator('#wkSave').click();expect(page.locator('#wkStatus')).to_contain_text('저장했습니다')
 saved_id=db['drafts'][0]['id'];page.reload(wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();page.locator('#wkDraftList').select_option(saved_id);expect(page.locator('#wkCards input').first).to_have_value('11월의 작은 음악회')
 page.locator('#wkRender').click();expect(page.locator('#wkPreviews img')).to_have_count(3);page.locator('#wkFilmstrip button').nth(1).click();expect(page.locator('#wkCards input').first).to_be_visible()
 assert page.locator('#wkPreviews img').evaluate_all('(xs)=>xs.every(i=>i.naturalWidth===1080&&i.naturalHeight===1350)')
 assert state['publishes']==0
 # The two workspaces are distinct, and navigating between them preserves the editor.
 page.locator('[data-ig-view="calendar"]').click();expect(page.locator('#wkCalendar')).to_be_visible();expect(page.locator('#wkTitle')).to_be_hidden()
 page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkCalendar')).to_be_hidden();expect(page.locator('#wkCards input').first).to_have_value('11월의 작은 음악회')
 page.screenshot(path=str(artifact_dir/'desktop.png'),full_page=True)
 page.locator('#wkPreviews').screenshot(path=str(artifact_dir/'cards.png'))
 with page.expect_download() as download:page.locator('#wkDownload').click()
 assert download.value.suggested_filename.endswith('.zip')
 page.locator('#wkPrepare').click();expect(page.locator('#wkReview')).to_be_visible();expect(page.locator('#wkPublish')).to_be_disabled();assert state['publishes']==0
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
