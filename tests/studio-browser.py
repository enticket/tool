from browser_support import accept_app_messages
"""Weekly editor against synthetic providers; no production account calls."""
import os,json,io,base64,zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from email import policy
from email.parser import BytesParser
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright,expect
from browser_support import install_library_routes

artifact_dir=Path(os.environ.get('ARTIFACT_DIR','/tmp/enticket-studio-preview'));artifact_dir.mkdir(parents=True,exist_ok=True)
out=io.BytesIO();poster=Image.new('RGB',(900,1200),'#fbcc87');ImageDraw.Draw(poster).text((100,100),'ENTICKET / LIVE / 2026',fill='black')
ImageDraw.Draw(poster).rectangle((810,420,899,780),fill='#143cd5')
poster.save(out,'JPEG');poster_bytes=out.getvalue()
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
 fixture['description']='🎭 11월의 작은 음악회\n\n세 연주자가 들려주는 실내악 이야기.\n\n📅 일시 | 11.16'
 db['performances']=[fixture];assets[fixture['id']]=poster_bytes
 page.goto(base,wait_until='networkidle');page.locator('#gLoginBtn').click();expect(page.locator('#gUser')).to_have_text('staff@test.example');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 expect(page.locator('#wkPreviews img')).to_have_count(2,timeout=30000);expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 expect(page.locator('#wkTitle')).to_have_value('공연이\n있는\n일주일.')
 default_closing=page.locator('#wkClosing').input_value();assert '팔로우' in default_closing and 'enticket.com' in default_closing
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
 # Featured templates should render distinct covers and expose the editable performance layers.
 layer('title')
 page.locator('#wkLayerX').fill('80')
 pane('performances')
 page.locator('#wkCandidates input').check()
 expect(page.locator('#wkPreviews img')).to_have_count(3,timeout=30000)
 covers=set()
 thumbnails=set()
 for template in ['blue-score','stage-marquee','matinee-program']:
  pane('templates')
  choice=page.locator(f'#wkFeaturedTemplate [data-template="{template}"]')
  expect(choice.locator('img[src]')).to_have_count(1,timeout=30000)
  thumbnail=choice.locator('img').get_attribute('src')
  assert thumbnail not in thumbnails,template
  thumbnails.add(thumbnail)
  choice.click()
  expect(choice).to_have_attribute('aria-pressed','true')
  expect(choice).to_be_enabled(timeout=30000)
  expect(page.locator('#wkPreviews img')).to_have_count(3)
  cover=page.locator('#wkPreviews img').first.evaluate("""async img=>{
   await img.decode();
   const canvas=document.createElement('canvas');canvas.width=32;canvas.height=40;
   canvas.getContext('2d').drawImage(img,0,0,32,40);
   return canvas.toDataURL();
  }""")
  assert cover not in covers,template
  covers.add(cover)
  if template=='stage-marquee':
   page.locator('#wkFilmstrip button').first.click()
   layer('title')
   expect(page.locator('#wkLayerX')).to_have_value('80')
   expect(page.locator('#wkLayerAlign')).to_have_value('left')
  page.locator('#wkFilmstrip button').nth(1).click()
  layer('poster')
  expect(page.locator('#wkLayerX')).to_be_editable()
  expect(page.locator('#wkLayerDownload')).to_be_visible()
 page.locator('#wkLayerX').fill('72')
 page.locator('#wkFilmstrip button').first.click()
 layer('motif')
 page.locator('#wkLayerOpacity').fill('83')
 page.locator('#wkSave').click()
 expect(page.locator('#wkStatus')).to_contain_text('저장했습니다',timeout=30000)
 sample=db['drafts'][0]
 assert sample['template']=='matinee-program'
 assert sample['design']['layers']['motif']['opacity']==83
 assert sample['design']['pages']['performance:studio-performance']['layers']['poster']['x']==72
 page.reload(wait_until='networkidle')
 page.locator('[data-tab="instagram"]').click()
 page.locator('[data-ig-view="weekly"]').click()
 page.locator('#wkDraftList').select_option(sample['id'])
 expect(page.locator('#wkPreviews img')).to_have_count(3,timeout=30000)
 expect(page.locator('#wkTemplates [data-template="matinee-program"]')).to_have_attribute('aria-pressed','true')
 page.locator('#wkFilmstrip button').first.click()
 layer('title')
 expect(page.locator('#wkLayerX')).to_have_value('80')
 expect(page.locator('#wkLayerAlign')).to_have_value('left')
 page.locator('#wkFilmstrip button').nth(1).click()
 layer('poster')
 expect(page.locator('#wkLayerX')).to_have_value('72')
 with page.expect_download() as template_download:
  page.locator('#wkLayerDownload').click()
 with zipfile.ZipFile(template_download.value.path()) as archive:
  manifest=json.loads(archive.read('design.json'))
  assert manifest['template']==sample['template'] and manifest['design']==sample['design']
  assert base64.b64encode(poster_bytes) not in archive.read('cover.svg')
  assert base64.b64encode(poster_bytes) in archive.read('02.svg')
  assert b'enticket.com' in archive.read('03.svg')
  for file_name in ['cover.svg','03.svg']:
   svg=ET.fromstring(archive.read(file_name))
   motif=svg.find(".//{*}g[@id='motif']")
   assert motif is not None and any(p.get('d','').strip() for p in motif.findall('.//{*}path')),file_name
   if file_name=='cover.svg':assert motif.get('opacity')=='0.83'
 page.locator('#wkNewDraft').click()
 expect(page.locator('#wkPreviews img')).to_have_count(2,timeout=30000)
 expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
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
 expect(page.locator('#wkLayerList [data-layer="description"]')).to_have_count(0)
 expect(page.locator('#wkCards input').nth(1)).to_have_value('11월 16일 (월) 오후 07시 30분')
 layer('poster')
 width=float(page.locator('#wkLayerWidth').input_value());height=float(page.locator('#wkLayerHeight').input_value())
 assert width>600 and height>736 and abs(width/height-3/4)<.001
 expect(page.locator('#wkLayerList [data-layer^="nextPoster"]')).to_have_count(0)
 page.locator('#wkLayerWidth').fill('560');page.locator('#wkLayerX').fill('80')
 pane('elements');page.locator('[data-add-object="text"]').click();page.locator('#wkInlineText').fill('현장에서 만나요');page.locator('#wkInlineText').press('Control+Enter');page.locator('#wkLayerSize').fill('24');page.locator('#wkLayerX').fill('80');page.locator('#wkLayerY').fill('1200')
 # Page order preserves each performance's scene; deleting a page removes its overrides.
 second={**fixture,'id':'studio-second','assetId':'studio-second','title':'두 번째 공연'}
 green=io.BytesIO();Image.new('RGB',(640,350),'#27b285').save(green,'JPEG')
 db['performances'].append(second);assets[second['id']]=green.getvalue()
 page.locator('#wkRefresh').click();expect(page.locator('#wkCandidates input')).to_have_count(2)
 pane('performances');page.locator('#wkCandidates input').nth(1).check();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 layer('poster');page.locator('#wkLayerWidth').fill('500')
 page.locator('#wkFilmstrip [data-page="2"]').drag_to(page.locator('#wkFilmstrip [data-page="1"]'));expect(page.locator('#wkSave')).to_be_enabled(timeout=30000);expect(page.locator('#wkStageTitle')).to_have_text('두 번째 공연')
 page.locator('#wkFilmstrip [data-page="1"]').drag_to(page.locator('#wkFilmstrip [data-page="2"]'));expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 page.locator('#wkFilmstrip button').nth(1).click();layer('poster');expect(page.locator('#wkLayerWidth')).to_have_value('560')
 layer('nextPoster1')
 expect(page.locator('#wkLayerOpacity')).to_have_value('100')
 def exposed_pixel():
  return page.locator('#wkLayerCanvas').evaluate("(canvas)=>Array.from(canvas.getContext('2d').getImageData(675,480,1,1).data)")
 # Compare the same paper pixels while hiding the cropped poster behind the main poster.
 right=float(page.locator('#wkLayerX').input_value())+float(page.locator('#wkLayerWidth').input_value())
 top=float(page.locator('#wkLayerY').input_value());height=float(page.locator('#wkLayerHeight').input_value())
 def shadow_samples():
  points=[[right-12,top-4],[right+4,top+height/2],[right-12,top+height+4]]
  return page.locator('#wkLayerCanvas').evaluate("(c,p)=>p.map(([x,y])=>c.getContext('2d').getImageData(x,y,1,1).data[0])",points)
 pixel=exposed_pixel();shaded=shadow_samples()
 assert max(abs(x-y) for x,y in zip(pixel,[39,178,133,255]))<4,pixel
 page.locator('#wkLayerVisible').uncheck()
 paper=shadow_samples()
 assert paper[0]-shaded[0]>20 and paper[1]-shaded[1]>20 and abs(paper[2]-shaded[2])<5,(paper,shaded)
 assert exposed_pixel()!=pixel
 page.locator('#wkLayerVisible').check()
 assert exposed_pixel()==pixel
 expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 jpg_pixel=page.locator('#wkPreviews img').nth(1).evaluate("""async img=>{
  await img.decode();
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
  const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
  return Array.from(ctx.getImageData(675,480,1,1).data);
 }""")
 assert max(abs(x-y) for x,y in zip(jpg_pixel,pixel))<5,jpg_pixel
 with page.expect_download() as stack_download:page.locator('#wkLayerDownload').click()
 from xml.etree import ElementTree
 with zipfile.ZipFile(stack_download.value.path()) as stack_source:
  svg=ElementTree.fromstring(stack_source.read('02.svg'))
  shadow=svg.find('.//{*}filter[@id="poster-shadow"]/{*}feDropShadow')
  assert float(shadow.get('dx'))==-float(shadow.get('dy'))>0
  groups=svg.findall('{*}g')
  ids=[g.get('id') for g in groups]
  back=groups[ids.index('nextPoster1')]
  assert ids.index('nextPoster1')<ids.index('poster') and float(back.get('opacity'))==1
  assert back.get('filter')==groups[ids.index('poster')].get('filter')=='url(#poster-shadow)'
  assert back.find('{*}image').get('preserveAspectRatio')=='xMinYMin meet'
  assert base64.b64encode(green.getvalue()).decode() in back.find('{*}image').get('href')
  assert b'nextPoster1' in stack_source.read('03.svg')
 page.locator('#wkFilmstrip button').last.click();pane('performances');page.locator('#wkCandidates input').nth(1).uncheck();expect(page.locator('#wkPreviews img')).to_have_count(3,timeout=30000);expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 page.locator('#wkFilmstrip button').last.click();layer('closingTitle');page.locator('#wkLayerText').fill('이번 주, 놓치지 마세요');page.locator('#wkLayerSize').fill('40')
 page.locator('#wkSave').click();expect(page.locator('#wkStatus')).to_contain_text('저장했습니다',timeout=30000)
 saved=db['drafts'][0];assert saved['design']['pages']['performance:studio-performance']['layers']['poster']['width']==560;assert saved['design']['pages']['closing']['layers']['closingTitle']['text']=='이번 주, 놓치지 마세요'
 assert 'performance:studio-second' not in saved['design']['pages'];assert saved['cards'][0]['performanceId']=='studio-performance'
 expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 # Compare both renders with the publishing JPEG encoder, including chroma subsampling.
 live=Image.open(io.BytesIO(base64.b64decode(page.locator('#wkLayerCanvas').evaluate("(c)=>c.toDataURL('image/jpeg',.92)").split(',')[1]))).convert('RGB')
 encoded=page.locator('#wkPreviews img').last.evaluate("""async img=>{
   const blob=await(await fetch(img.src)).blob(), reader=new FileReader();
   return new Promise(resolve=>{reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});
 }""")
 exported=Image.open(io.BytesIO(base64.b64decode(encoded.split(',')[1]))).convert('RGB')
 from PIL import ImageChops,ImageStat
 mean_error=ImageStat.Stat(ImageChops.difference(live,exported)).mean
 assert max(mean_error)<2,mean_error
 with page.expect_download() as dl:page.locator('#wkLayerDownload').click()
 archive=zipfile.ZipFile(dl.value.path());source=json.loads(archive.read('design.json'));assert source['design']==saved['design'];assert '<rect ' in archive.read('cover.svg').decode();assert 'rotate(' in archive.read('cover.svg').decode();assert 'data:image/jpeg;base64,' in archive.read('02.svg').decode();assert '이번 주, 놓치지 마세요' in archive.read('03.svg').decode()
 closing_svg=archive.read('03.svg').decode()
 assert 'id="ticketStock"' in closing_svg and 'fill-rule="evenodd"' in closing_svg
 profile=archive.read('enticket-instagram-profile.jpg')
 performance_svg=archive.read('02.svg').decode()
 assert 'nextPoster' not in performance_svg and 'posterReflection' not in performance_svg
 assert '세 연주자가 들려주는 실내악 이야기.' not in performance_svg
 assert '11월 16일 (월) 오후 07시 30분' in performance_svg
 assert 'id="date"' not in performance_svg and '@en__ticket' not in performance_svg
 assert 'description' not in saved['cards'][0]
 assert 'enticket.com' in closing_svg and 'clip-profilePhoto' in closing_svg
 assert base64.b64encode(profile).decode() in closing_svg and 'profilePhoto' not in archive.read('cover.svg').decode()
 saved['closing']='enticket.kr · @en__ticket'
 saved['cards'][0]['schedule']='11.16 19:30'
 saved_id=saved['id'];page.reload(wait_until='networkidle');page.locator('[data-tab="instagram"]').click();page.locator('[data-ig-view="weekly"]').click();expect(page.locator('#wkDraftList')).to_be_enabled(timeout=30000);page.locator('#wkDraftList').select_option(saved_id);expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
 expect(page.locator('#wkClosing')).to_have_value(default_closing)
 expect(page.locator('#wkCards input').nth(1)).to_have_value('11월 16일 (월) 오후 07시 30분')
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
 page.locator('#wkPrepare').click();expect(page.locator('#wkReview')).to_be_visible(timeout=30000);expect(page.locator('#wkLayerStage')).to_be_hidden();expect(page.locator('#wkUndo')).to_be_disabled();expect(page.locator('[data-add-object="text"]')).to_be_disabled();assert state['publishes']==0
 assert not errors,errors
 print('PASS: editable template switching and motif exports, studio selection, inline text, add/resize/rotate/move, undo/redo, duplicate/delete, lock/order/zoom, all-page persistence, SVG and JPG parity, mobile and review lock')
 browser.close()
