from browser_support import accept_app_messages
"""Weekly editor against synthetic providers; no production account calls."""
import os,json,io,base64,zipfile
from pathlib import Path
from email import policy
from email.parser import BytesParser
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright,expect
from browser_support import install_library_routes

artifact_dir=Path(os.environ.get('ARTIFACT_DIR','/tmp/enticket-studio-preview'));artifact_dir.mkdir(parents=True,exist_ok=True)
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
   images[:]=files;assert len(images)==len(d['cards'])+2
   d.update(jobId='prepared-id',status='prepared',job={'fingerprint':'digest','account':{'username':'en__ticket'}})
  elif action=='unlock':
   d.pop('jobId',None);d.pop('job',None);d['status']='draft'
  elif action=='publish':
   assert fields['confirm']=='publish' and fields['fingerprint']=='digest';state['publishes']+=1;d['status']='published'
  else:assert action=='status',action
  route.fulfill(json={'ok':True,'draft':d})
 page.route('**/api/**',api)
 base=os.environ.get('TOOL_URL','http://127.0.0.1:8788')
 fixture={'id':'studio-performance','assetId':'studio-performance','title':'11월의 작은 음악회','venue':'엔티켓 아트홀','priceKind':'paid','price':'전석 20,000원','status':'verified','sessions':[{'date':'2026-11-16','time':'19:30'}],'version':1}
 db['performances']=[fixture];assets[fixture['id']]=poster_bytes
 page.goto(base,wait_until='networkidle');page.locator('#gLoginBtn').click();expect(page.locator('#gUser')).to_have_text('staff@test.example');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 expect(page.locator('#wkPreviews img')).to_have_count(2,timeout=30000);expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 expect(page.locator('#wkTitle')).to_have_value('공연이\n있는\n일주일.')
 expect(page.locator('#wkLayerSelection')).to_be_hidden()
 page.locator('#wkStudio').screenshot(path=str(artifact_dir/'studio-clean.png'))
 def pane(name):page.locator(f'[data-studio-pane="{name}"]').click()
 def layer(name):
  pane('layers');page.locator(f'[data-layer="{name}"]').click()
  expect(page.locator('[data-studio-pane="properties"]')).to_have_attribute('aria-selected','true')
 active_tool=page.locator('[data-studio-pane="performances"]')
 active_tool.focus();page.keyboard.press('ArrowRight')
 expect(page.locator('[data-studio-pane="templates"]')).to_be_focused()
 expect(page.locator('#wkTemplatesPane')).to_be_visible()
 page.keyboard.press('Home');expect(active_tool).to_be_focused()
 def drag(start,end):
  page.mouse.move(*start);page.mouse.down();page.mouse.move(*end,steps=12);page.mouse.up()
 def center(selector):
  b=page.locator(selector).bounding_box();return (b['x']+b['width']/2,b['y']+b['height']/2)
 layer('title');expect(page.locator('#wkLayerSize')).to_have_value('170');page.locator('#wkLayerSize').fill('165')
 layer('texture');page.locator('#wkLayerOpacity').fill('80');expect(page.locator('#wkLayerOpacityValue')).to_have_text('80%')
 layer('title');b=page.locator('#wkLayerCanvas').bounding_box();page.locator('#wkLayerCanvas').dblclick(position={'x':200*b['width']/1080,'y':230*b['height']/1350})
 expect(page.locator('#wkInlineText')).to_be_visible();page.locator('#wkInlineText').fill('공연이\n있는\n일주일.');page.locator('#wkInlineText').press('Control+Enter');expect(page.locator('#wkInlineText')).to_be_hidden()
 # New text is actual editable content, with one undo entry per pointer gesture.
 pane('elements');page.locator('[data-add-object="text"]').click();expect(page.locator('#wkInlineText')).to_be_visible();page.locator('#wkInlineText').fill('이번 주 추천');page.locator('#wkInlineText').press('Control+Enter')
 original_x=float(page.locator('#wkLayerX').input_value());start=center('#wkLayerSelection');drag(start,(start[0]+35,start[1]+10));moved_x=float(page.locator('#wkLayerX').input_value());assert moved_x>original_x+20
 page.keyboard.press('Control+z');assert float(page.locator('#wkLayerX').input_value())==original_x
 page.keyboard.press('Control+Shift+z');assert float(page.locator('#wkLayerX').input_value())==moved_x
 size=float(page.locator('#wkLayerSize').input_value());start=center('[data-handle="se"]');drag(start,(start[0]+20,start[1]+15));assert float(page.locator('#wkLayerSize').input_value())>size
 page.keyboard.press('Control+z');assert float(page.locator('#wkLayerSize').input_value())==size
 start=center('[data-handle="rotate"]');c=center('#wkLayerSelection');drag(start,(c[0]+70,c[1]));assert abs(float(page.locator('#wkLayerRotation').input_value()))>20
 page.keyboard.press('Control+d');pane('layers');expect(page.locator('#wkLayerList [data-layer^="object-"]')).to_have_count(2)
 page.locator('#wkLayerCanvas').focus();page.keyboard.press('Delete');expect(page.locator('#wkLayerList [data-layer^="object-"]')).to_have_count(1)
 page.keyboard.press('Control+z');expect(page.locator('#wkLayerList [data-layer^="object-"]')).to_have_count(2)
 page.locator('#wkLayerList [data-layer^="object-"]').first.click();page.locator('#wkLock').click();expect(page.locator('#wkLayerSize')).to_be_disabled();expect(page.locator('[data-handle="se"]')).to_be_hidden();page.locator('#wkLock').click();expect(page.locator('#wkLayerSize')).to_be_enabled()
 page.locator('#wkBackward').click();page.locator('#wkZoom').select_option('100');assert page.locator('#wkLayerCanvas').bounding_box()['width']==1080;assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.locator('#wkZoom').select_option('fit')
 pane('elements');page.locator('[data-add-object="rect"]').click();page.locator('#wkLayerWidth').fill('300');page.locator('#wkLayerHeight').fill('100');page.locator('#wkLayerOpacity').fill('35');page.locator('#wkLayerX').fill('700');page.locator('#wkLayerY').fill('800')
 page.locator('#wkSave').click();expect(page.locator('#wkStatus')).to_contain_text('저장했습니다',timeout=30000)
 design=db['drafts'][0]['design'];assert design['version']==2 and len(design['objects'])==3;assert design['layers']['title']['fontSize']==165;assert len(design['order'])>0
 assert design['objects'][-1]['width']==300 and design['objects'][-1]['opacity']==35
 page.locator('#wkStudio').screenshot(path=str(artifact_dir/'studio-desktop.png'))
 # Every slide uses the same canvas editor, including the poster and closing page.
 pane('performances');page.locator('#wkCandidates input').check();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000);expect(page.locator('#wkLayerStage')).to_be_visible()
 layer('poster');expect(page.locator('#wkLayerWidth')).to_have_value('600');page.locator('#wkLayerWidth').fill('560');page.locator('#wkLayerX').fill('80')
 pane('elements');page.locator('[data-add-object="text"]').click();page.locator('#wkInlineText').fill('현장에서 만나요');page.locator('#wkInlineText').press('Control+Enter');page.locator('#wkLayerSize').fill('24');page.locator('#wkLayerX').fill('80');page.locator('#wkLayerY').fill('1200')
 # Page order preserves each performance's scene; deleting a page removes its overrides.
 second={**fixture,'id':'studio-second','assetId':'studio-second','title':'두 번째 공연'};db['performances'].append(second);assets[second['id']]=poster_bytes
 page.locator('#wkRefresh').click();expect(page.locator('#wkCandidates input')).to_have_count(2)
 pane('performances');page.locator('#wkCandidates input').nth(1).check();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 layer('poster');page.locator('#wkLayerWidth').fill('500')
 page.locator('#wkFilmstrip [data-page="2"]').drag_to(page.locator('#wkFilmstrip [data-page="1"]'));expect(page.locator('#wkSave')).to_be_enabled(timeout=30000);expect(page.locator('#wkStageTitle')).to_have_text('두 번째 공연')
 page.locator('#wkFilmstrip [data-page="1"]').drag_to(page.locator('#wkFilmstrip [data-page="2"]'));expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 page.locator('#wkFilmstrip button').nth(1).click();layer('poster');expect(page.locator('#wkLayerWidth')).to_have_value('560')
 page.locator('#wkFilmstrip button').last.click();pane('performances');page.locator('#wkCandidates input').nth(1).uncheck();expect(page.locator('#wkPreviews img')).to_have_count(3,timeout=30000);expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 page.locator('#wkFilmstrip button').last.click();layer('closingTitle');page.locator('#wkLayerText').fill('이번 주, 놓치지 마세요');page.locator('#wkLayerSize').fill('40')
 page.locator('#wkSave').click();expect(page.locator('#wkStatus')).to_contain_text('저장했습니다',timeout=30000)
 saved=db['drafts'][0];assert saved['design']['pages']['performance:studio-performance']['layers']['poster']['width']==560;assert saved['design']['pages']['closing']['layers']['closingTitle']['text']=='이번 주, 놓치지 마세요'
 assert 'performance:studio-second' not in saved['design']['pages'];assert saved['cards'][0]['performanceId']=='studio-performance'
 live=Image.open(io.BytesIO(base64.b64decode(page.locator('#wkLayerCanvas').evaluate('(c)=>c.toDataURL()').split(',')[1]))).convert('RGB')
 encoded=page.locator('#wkPreviews img').last.evaluate('(img)=>{const c=document.createElement("canvas");c.width=1080;c.height=1350;c.getContext("2d").drawImage(img,0,0);return c.toDataURL();}')
 exported=Image.open(io.BytesIO(base64.b64decode(encoded.split(',')[1]))).convert('RGB')
 from PIL import ImageChops,ImageStat
 assert max(ImageStat.Stat(ImageChops.difference(live,exported)).mean)<2
 with page.expect_download() as dl:page.locator('#wkLayerDownload').click()
 archive=zipfile.ZipFile(dl.value.path());source=json.loads(archive.read('design.json'));assert source['design']==saved['design'];assert '<rect ' in archive.read('cover.svg').decode();assert 'rotate(' in archive.read('cover.svg').decode();assert 'data:image/jpeg;base64,' in archive.read('02.svg').decode();assert '이번 주, 놓치지 마세요' in archive.read('03.svg').decode()
 saved_id=saved['id'];page.reload(wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkDraftList')).to_be_enabled(timeout=30000);page.locator('#wkDraftList').select_option(saved_id);expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 layer('title');expect(page.locator('#wkLayerSize')).to_have_value('165');expect(page.locator('#wkLayerList [data-layer^="object-"]')).to_have_count(3)
 next_page=page.locator('#wkShowNext');previous_page=page.locator('#wkShowPrevious')
 expect(previous_page).to_be_disabled()
 page_labels=page.locator('#wkFilmstrip button').all_text_contents()
 next_page.click();expect(page.locator('#wkStageTitle')).to_have_text(fixture['title'])
 next_page.click();expect(next_page).to_be_disabled()
 previous_page.click();expect(page.locator('#wkStageTitle')).to_have_text(fixture['title'])
 assert page.locator('#wkFilmstrip button').all_text_contents()==page_labels
 layer('poster');expect(page.locator('#wkLayerWidth')).to_have_value('560');expect(page.locator('#wkLayerX')).to_have_value('80')
 for width in [960,823,390,320]:
  page.set_viewport_size({'width':width,'height':900})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if width in (960,823):
   canvas=page.locator('#wkLayerCanvas').bounding_box()
   assert canvas['width']>=240, (width,canvas)
  expect(page.locator('[data-studio-pane="properties"]')).to_be_visible()
 page.screenshot(path=str(artifact_dir/'studio-mobile.png'),full_page=True);page.set_viewport_size({'width':1440,'height':1000})
 page.locator('#wkPrepare').click();expect(page.locator('#wkReview')).to_be_visible();expect(page.locator('#wkLayerStage')).to_be_hidden();expect(page.locator('#wkUndo')).to_be_disabled();expect(page.locator('[data-add-object="text"]')).to_be_disabled();assert state['publishes']==0
 assert not errors,errors
 print('PASS: studio selection, inline text, add/resize/rotate/move, undo/redo, duplicate/delete, lock/order/zoom, all-page persistence, SVG and JPG parity, mobile and review lock')
 browser.close()
