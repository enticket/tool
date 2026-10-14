"""Cloud UI contract tests with synthetic Google/API responses; no real auth/writes."""
import base64
import os
import ssl
import urllib.request
from playwright.sync_api import sync_playwright, expect

def cdn(route):
    with urllib.request.urlopen(route.request.url, context=ssl.create_default_context(), timeout=30) as r:
        route.fulfill(status=r.status, content_type='application/javascript', body=r.read())

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
    page = browser.new_page()
    errors, calls = [], []
    state = {'allowed': True, 'expired': False, 'stamp': ''}
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())
    page.route('https://cdn.jsdelivr.net/**', cdn)
    page.route('https://accounts.google.com/gsi/client', lambda route: route.fulfill(content_type='application/javascript', body='''
      window.google={accounts:{oauth2:{
        initTokenClient(opts){ return { requestAccessToken(){opts.callback({access_token:'synthetic-token',expires_in:3600});} }; },
        revoke(){}
      }}};
    '''))
    page.route('https://www.googleapis.com/oauth2/v3/userinfo', lambda r: r.fulfill(json={'email':'staff@example.test'}))
    def api(route):
        path = route.request.url.split('/api/')[1]
        calls.append(path)
        assert route.request.method == 'POST'
        assert b'synthetic-token' in route.request.post_data_buffer
        if state['expired']:
            route.fulfill(status=401, json={'error':'invalid_token'})
        elif not state['allowed']:
            route.fulfill(status=403, json={'error':'not_allowed'})
        elif path == 'verify':
            route.fulfill(json={'ok':True, 'allowed':True})
        elif path == 'stamp':
            route.fulfill(json={'ok':True, 'b64':state['stamp']})
        elif path == 'upload':
            assert b'name="file"' in route.request.post_data_buffer
            assert b'name="folder"' in route.request.post_data_buffer
            route.fulfill(json={'ok':True,'fileId':'synthetic','name':'test.xlsx'})
        else:
            raise AssertionError(path)
    page.route('**/api/**', api)
    page.goto(os.environ.get('TOOL_URL', 'http://127.0.0.1:8787'), wait_until='networkidle')
    expect(page.locator('#localNotice')).to_be_hidden()
    expect(page.locator('#localStampControls')).to_be_hidden()
    expect(page.locator('#gLoginBtn')).to_be_enabled()
    page.locator('[data-tab="oseal"]').click()
    expect(page.locator('#osealWork')).to_be_hidden()
    page.locator('#gLoginBtn').click()
    expect(page.locator('#gUser')).to_have_text('staff@example.test')
    expect(page.locator('#osealWork')).to_be_visible()
    fixture = page.evaluate('''() => {
      const c=document.createElement('canvas'); c.width=100; c.height=100;
      c.getContext('2d').fillRect(20,20,60,60);
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['공연명','공연일','공연시간','권종','판매가격','수량','관람자명','연락처','예매번호'],
        ['통합검증','2026-10-14','19:00','일반',10000,3,'테스트','01000000001','T001']
      ]), '정산서');
      return {stamp:c.toDataURL('image/jpeg').split(',')[1], xlsx:XLSX.write(wb,{type:'base64',bookType:'xlsx'})};
    }''')
    state['stamp'] = fixture['stamp']
    file = {'name':'synthetic.xlsx', 'mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'buffer':base64.b64decode(fixture['xlsx'])}
    page.locator('#osealFileInput').set_input_files(file)
    expect(page.locator('#osealStatus')).to_contain_text('변환 완료')
    for tab, input_selector, button in [
        ('excel','#xlFileInput','#xlDriveSave'),
        ('sms','#smsFileInput','#smsDriveSave'),
        ('settlement','#sessions input[type=file]','#saveSettlementDrive'),
    ]:
        page.locator(f'[data-tab="{tab}"]').click()
        page.locator(input_selector).first.set_input_files(file)
        expect(page.locator(button)).to_be_enabled()
        page.locator(button).click()
        expect(page.locator(button)).to_have_text('드라이브 저장')
    assert calls.count('upload') == 3, calls
    state['expired'] = True
    page.locator('#saveSettlementDrive').click()
    expect(page.locator('#gLoginBtn')).to_be_visible()
    assert not page.evaluate('gdrive.isLoggedIn()')
    state.update(expired=False, allowed=False)
    page.locator('#gLoginBtn').click()
    expect(page.locator('#gUser')).to_be_visible()
    page.locator('[data-tab="oseal"]').click()
    expect(page.locator('#osealWork')).to_be_hidden()
    expect(page.locator('#osealGate')).to_contain_text('허용되지 않은 계정')
    assert not errors, errors
    print('PASS: cloud UI login, stamp, three Drive uploads, expired-token reset, denied-account gate (mocked providers)')
    browser.close()
