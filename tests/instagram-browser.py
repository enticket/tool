"""Browser image/review flow with synthetic providers; never calls Meta or publishes."""
import base64
import os
import urllib.request
from email import policy
from email.parser import BytesParser
from playwright.sync_api import sync_playwright, expect

def cdn(route):
    req = urllib.request.Request(route.request.url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        route.fulfill(status=response.status, content_type='application/javascript', body=response.read())

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
    page = browser.new_page()
    errors, calls = [], []
    state = {'allowed': True, 'instagram_error': False, 'network_error': False, 'job': None, 'publish_count': 0, 'published_image': b''}
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    page.route('https://cdn.jsdelivr.net/**', cdn)
    page.route('https://accounts.google.com/gsi/client', lambda route: route.fulfill(content_type='application/javascript', body='''
      window.google={accounts:{oauth2:{initTokenClient(opts){return {requestAccessToken(){opts.callback({access_token:'synthetic-google-token',expires_in:3600});}}},revoke(){}}}};
    '''))
    page.route('https://www.googleapis.com/oauth2/v3/userinfo', lambda route: route.fulfill(json={'email': 'staff@example.test'}))
    def api(route):
        path = route.request.url.split('/api/')[1]
        calls.append(path)
        assert route.request.method == 'POST'
        message = BytesParser(policy=policy.default).parsebytes(('Content-Type: '+route.request.headers['content-type']+'\r\n\r\n').encode()+route.request.post_data_buffer)
        fields = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True) for part in message.iter_parts()}
        assert fields.pop('access_token') == b'synthetic-google-token'
        if not state['allowed']:
            route.fulfill(status=403, json={'error': 'not_allowed'}); return
        if path == 'verify':
            route.fulfill(json={'ok': True, 'allowed': True}); return
        assert path.startswith('instagram/')
        if path == 'instagram/connection':
            if state['instagram_error']:
                route.fulfill(status=503, json={'error': 'instagram_token_invalid'}); return
            route.fulfill(json={'ok': True, 'connected': True, 'account': {'id': '123', 'username': 'en__ticket', 'checkedAt': '2026-11-05T04:00:00Z'}}); return
        if path == 'instagram/prepare':
            assert fields['file'].startswith(b'\xff\xd8')
            state['published_image'] = fields['file']
            assert fields['caption'] == (b'' if fields['channel'] == b'story' else '확인한 문구 #엔티켓'.encode())
            state['job'] = {'ok': True, 'draftId': fields['draft_id'].decode(), 'fingerprint': 'reviewed-image-digest', 'status': 'prepared', 'account': {'id': '123', 'username': 'en__ticket'}, 'channel': fields['channel'].decode()}
            route.fulfill(json=state['job']); return
        if path == 'instagram/publish':
            assert fields['fingerprint'] == b'reviewed-image-digest'
            assert fields['confirm'] == b'publish'
            assert 'file' not in fields
            state['publish_count'] += 1
            state['job'].update(status='published', mediaId='777')
            if state['network_error']:
                route.abort(); return
        route.fulfill(json=state['job'])
    page.route('**/api/**', api)
    page.goto(os.environ.get('TOOL_URL', 'http://127.0.0.1:8787'), wait_until='networkidle')
    page.locator('[data-tab="instagram"]').click()
    expect(page.locator('#igWork')).to_be_hidden()
    assert not calls
    page.locator('#gLoginBtn').click()
    expect(page.locator('#igWork')).to_be_visible()
    state['instagram_error'] = True
    page.locator('#igCheck').click()
    expect(page.locator('#igConnection')).to_contain_text('만료되었거나 취소')
    state['instagram_error'] = False
    page.locator('#igCheck').click()
    expect(page.locator('#igConnection')).to_contain_text('@en__ticket')
    fixture = page.evaluate('''() => {const c=document.createElement('canvas'); c.width=600;c.height=900;const ctx=c.getContext('2d');ctx.fillStyle='#602b89';ctx.fillRect(0,0,600,900);return c.toDataURL('image/png').split(',')[1];}''')
    page.locator('#igFile').set_input_files({'name': 'poster.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(fixture)})
    expect(page.locator('#igPrepare')).to_be_enabled()
    page.locator('#igCaption').fill('확인한 문구 #엔티켓')
    page.locator('#igText').fill('엔티켓 테스트')
    expect(page.locator('#igPrepare')).to_be_enabled()
    expect(page.locator('#igCaptionPreview')).to_contain_text('확인한 문구')
    assert page.locator('#igPreview').evaluate('(img)=>[img.naturalWidth,img.naturalHeight]') == [1080, 1350]
    page.locator('#igPrepare').click()
    expect(page.locator('#igPublish')).to_be_disabled()
    expect(page.locator('#igReviewAccount')).to_contain_text('@en__ticket')
    expect(page.locator('#igCaption')).to_be_disabled()
    preview = page.locator('#igPreview').evaluate('async img=>Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer()))')
    assert bytes(preview) == state['published_image']
    assert state['publish_count'] == 0
    page.locator('#igConfirm').check()
    expect(page.locator('#igPublish')).to_be_enabled()
    page.locator('#igPublish').click()
    expect(page.locator('#igStatus')).to_contain_text('게시 완료')
    expect(page.locator('#igPublish')).to_be_disabled()
    assert state['publish_count'] == 1
    page.locator('#igNew').click()
    page.locator('#igChannel').select_option('story')
    expect(page.locator('#igPrepare')).to_be_enabled()
    expect(page.locator('#igCaptionLabel')).to_be_hidden()
    expect(page.locator('#igStoryNote')).to_be_visible()
    page.wait_for_function("document.getElementById('igPreview').naturalHeight===1920")
    page.locator('#igPrepare').click()
    expect(page.locator('#igReviewAccount')).to_contain_text('스토리')
    expect(page.locator('#igPublish')).to_be_disabled()
    assert state['publish_count'] == 1
    state['network_error'] = True
    page.locator('#igConfirm').check()
    page.locator('#igPublish').click()
    expect(page.locator('#igStatus')).to_contain_text('결과를 확정하지 못했습니다')
    expect(page.locator('#igPublish')).to_be_disabled()
    page.locator('#igRecover').click()
    expect(page.locator('#igStatus')).to_contain_text('게시 완료')
    assert state['publish_count'] == 2
    page.locator('#gLogoutBtn').click()
    expect(page.locator('#igWork')).to_be_hidden()
    assert not page.locator('#igPreview').get_attribute('src')
    assert page.locator('#igCaption').input_value() == ''
    state['allowed'] = False
    page.locator('#gLoginBtn').click()
    expect(page.locator('#igGate')).to_contain_text('허용목록에 없습니다')
    expect(page.locator('#igWork')).to_be_hidden()
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    print('PASS: Google gate, Instagram errors/account, exact JPEG preview, locked review, explicit confirmation, lost-response recovery, feed/story, logout and mobile (mocked providers)')
    browser.close()
