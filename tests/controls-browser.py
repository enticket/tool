"""Shared controls with synthetic account/data; never calls real account APIs."""
import os, base64
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import install_library_routes, wait_for_js

artifacts=Path(os.environ.get('ARTIFACT_DIR','/tmp/enticket-controls'));artifacts.mkdir(parents=True,exist_ok=True)
url=os.environ.get('TOOL_URL','http://127.0.0.1:8791')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium')
 for fallback in [False,True]:
  page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));install_library_routes(page)
  if fallback:page.add_init_script("{const supports=CSS.supports.bind(CSS);CSS.supports=(...args)=>args.join(':')==='appearance:base-select'?false:supports(...args);}")
  page.route('https://accounts.google.com/gsi/client',lambda r:r.fulfill(content_type='application/javascript',body='window.google={accounts:{oauth2:{initTokenClient(){return {requestAccessToken(){}}}}}}'))
  def api(r):
   if r.request.url.endswith('/api/session'):r.fulfill(json={'ok':True,'allowed':True,'email':'controls@example.test'})
   elif r.request.url.endswith('/api/weekly'):r.fulfill(json={'ok':True,'performances':[],'drafts':[]})
   else:r.fulfill(json={'ok':True,'connected':False})
  page.route('**/api/**',api);page.goto(url,wait_until='networkidle');expect(page.locator('#gUser')).to_have_text('controls@example.test')
  page.locator('[data-tab=instagram]').click();page.locator('[data-ig-view=weekly]').click();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000);expect(page.locator('#wkPreviews img')).to_have_count(2,timeout=30000)
  page.locator('#wkDraftList').click()
  if fallback:expect(page.locator('.ui-select-popup')).to_be_visible()
  else:assert page.locator('#wkDraftList').evaluate("el=>getComputedStyle(el).appearance")=='base-select'
  page.screenshot(path=str(artifacts/('fallback-select.png' if fallback else 'weekly-select.png')))
  page.keyboard.press('Escape');expect(page.locator('#wkDraftList')).to_be_focused()
  # Modal selects remain above their dialog and dispatch the existing field handlers.
  page.locator('[data-ig-view=calendar]').click();page.locator('#wkNewPerformance').click();expect(page.locator('#wkPerformanceDialog')).to_be_visible()
  price=page.locator('#wkPPriceKind');price.click();page.get_by_role('option',name='유료',exact=True).click();expect(price).to_have_value('paid');expect(page.locator('#wkPPrice')).to_be_enabled()
  price.click();page.keyboard.press('Home');page.keyboard.press('ArrowDown');page.keyboard.press('Enter');expect(price).to_have_value('free');expect(page.locator('#wkPPrice')).to_be_disabled()
  # Keyboard cancellation leaves the value and the parent edit dialog intact.
  price.click();page.keyboard.press('End');page.keyboard.press('Escape');expect(price).to_have_value('free');expect(page.locator('#wkPerformanceDialog')).to_be_visible()
  page.locator('#wkPStatus').click();page.screenshot(path=str(artifacts/('fallback-modal-select.png' if fallback else 'modal-select.png')));page.keyboard.press('Escape')
  # Native values stay editable; app date/time pickers preserve optional empty times.
  row=page.locator('#wkSessionRows .wk-session-row').first
  row.locator('[type=date]').fill('2026-11-20');row.locator('.ui-picker-open').first.click();expect(page.locator('.ui-calendar')).to_be_visible()
  page.get_by_role('button',name='2026년 11월 21일',exact=True).click();page.get_by_role('button',name='선택 완료',exact=True).click();expect(row.locator('[type=date]')).to_have_value('2026-11-21')
  row.locator('.ui-picker-open').nth(1).click();page.get_by_role('textbox',name='시',exact=True).fill('19');page.get_by_role('textbox',name='분',exact=True).fill('30');page.get_by_role('button',name='선택 완료',exact=True).click();expect(row.locator('[type=time]')).to_have_value('19:30')
  row.locator('.ui-picker-open').nth(1).click();page.get_by_role('button',name='비우기',exact=True).click();expect(row.locator('[type=time]')).to_have_value('')
  page.locator('#wkClosePerformance').click();page.locator('[data-ig-view=weekly]').click();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000)
  # Colour apply produces the existing layer edit; cancellation never applies a preview.
  page.locator('#wkLayerColor').click();expect(page.locator('.ui-colour')).to_be_visible();page.get_by_role('textbox',name='색상 HEX 코드').fill('#123456');page.get_by_role('button',name='취소',exact=True).click();expect(page.locator('#wkLayerColor')).to_have_value('#b80808')
  page.locator('#wkLayerColor').click();page.get_by_role('textbox',name='색상 HEX 코드').fill('#123456');page.get_by_role('button',name='적용',exact=True).click();expect(page.locator('#wkLayerColor')).to_have_value('#123456')
  page.locator('#wkLayerColor').click();page.get_by_role('textbox',name='색상 HEX 코드').fill('invalid');expect(page.get_by_role('button',name='적용',exact=True)).to_be_disabled();page.keyboard.press('Escape')
  # Unsaved work confirmation must remain an explicit choice, defaulting to cancel.
  page.locator('#wkNewDraft').click();expect(page.locator('.ui-message')).to_be_visible();expect(page.locator('.ui-message [data-cancel]')).to_be_focused();page.keyboard.press('Escape');expect(page.locator('#wkLayerColor')).to_have_value('#123456')
  page.locator('#wkNewDraft').click();page.locator('.ui-message [data-accept]').click();expect(page.locator('#wkSave')).to_be_enabled(timeout=30000);expect(page.locator('#wkLayerColor')).to_have_value('#b80808')
  # File-derived column dropdowns in another tool are styled without per-screen wiring.
  fixture=page.evaluate("""()=>{const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['관람자명','연락처','예매번호'],['테스트','01012345678','T001']]),'test');return XLSX.write(w,{type:'base64',bookType:'xlsx'});} """)
  page.locator('[data-tab=sms]').click();page.locator('#smsFileInput').set_input_files({'name':'synthetic.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':base64.b64decode(fixture)})
  selects=page.locator('#panel-sms select');expect(selects).to_have_count(2);selects.first.click();page.screenshot(path=str(artifacts/('fallback-sms-select.png' if fallback else 'sms-select.png')));page.keyboard.press('Escape')
  # Text is never interpreted as markup in options or messages.
  page.evaluate("()=>{const s=document.querySelector('#panel-sms select');s.add(new Option('<img src=x onerror=alert(1)>','probe'));}")
  selects.first.click();expect(page.get_by_role('option',name='<img src=x onerror=alert(1)>',exact=True)).to_be_visible();page.keyboard.press('Escape');assert page.locator('.ui-select-popup img').count()==0
  for scheme in ['light','dark']:
   page.emulate_media(color_scheme=scheme);selects.first.click();page.screenshot(path=str(artifacts/f'{scheme}-select-{fallback}.png'));page.keyboard.press('Escape')
  for width in [390,320]:
   page.set_viewport_size({'width':width,'height':850});selects.first.click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(artifacts/f'mobile-{width}-{fallback}.png'));page.keyboard.press('Escape')
  page.evaluate("()=>{window.__answer='pending';EnticketUI.prompt('파일 암호를 입력하세요').then(v=>window.__answer=v);}")
  expect(page.locator('#uiMessageInput')).to_have_attribute('type','password');page.locator('#uiMessageInput').fill('synthetic-password');page.keyboard.press('Escape');wait_for_js(page,"window.__answer !== 'pending'");assert page.evaluate('window.__answer') is None
  assert not errors,errors;page.close()
 print('PASS: native and fallback selects, dynamic columns, modal stacking, keyboard/cancel, dates/times, colours, explicit confirmation, password cancellation, dark/mobile layouts')
 browser.close()
