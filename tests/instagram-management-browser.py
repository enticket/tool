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
    state = {'allowed': True, 'instagram_error': False, 'network_error': False, 'job': None, 'caption_error':False, 'publish_count': 0, 'published_image': b''}
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
        if path == 'instagram/media':
            if state.get('media_error'):
                route.fulfill(status=503,json={'error':'instagram_permission_denied'}); return
            more=fields.get('after')==b'next_page'
            items=[] if state.get('empty') else [{'id':'2' if more else '1','caption':'<img src=x onerror=alert(1)> 포스터','type':'사진','thumbnail':None,'assets':[{'type':'image','url':'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'},{'type':'image','url':'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}],'timestamp':'2026-11-06T00:00:00Z','permalink':'https://www.instagram.com/p/test/'}]
            route.fulfill(json={'ok':True,'account':{'username':'en__ticket'},'items':items,'nextCursor':None if more or state.get('empty') else 'next_page'}); return
        if path == 'instagram/caption':
            assert fields['file'].startswith(b'\xff\xd8')
            if state['caption_error']:
                route.fulfill(status=429,json={'error':'caption_rate_limited'}); return
            route.fulfill(json={'ok':True,'caption':'🎭 자동 공연\n📞 문의 | [문의 연락처]','missing':['inquiry'],'fields':{'title':'자동 공연','tags':'#엔티켓'}}); return
        if path == 'instagram/prepare':
            assert fields['file'].startswith(b'\xff\xd8')
            state['published_image'] = fields['file']
            assert fields['caption'] == b'' if fields['channel'] == b'story' else '확인한 문구 #엔티켓' in fields['caption'].decode()
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
    page.locator('#igField_title').fill('작성 중인 공연')
    page.locator('[data-ig-view="manage"]').click()
    expect(page.locator('#igManageAccount')).to_have_text('@en__ticket · 게시물 관리')
    expect(page.locator('#igMediaList article')).to_have_count(1)
    expect(page.locator('#igMediaList')).to_contain_text('<img src=x onerror=alert(1)>')
    assert page.locator('#igMediaList img').count()==0
    page.locator('#igMediaList button').first.click()
    expect(page.locator('#igDetail')).to_be_visible()
    expect(page.locator('#igDetailCaption')).to_have_text('<img src=x onerror=alert(1)> 포스터')
    expect(page.locator('#igDetailCaption img')).to_have_count(0)
    expect(page.locator('#igDetailPage')).to_have_text('1 / 2')
    page.locator('#igDetailNext').click()
    expect(page.locator('#igDetailPage')).to_have_text('2 / 2')
    expect(page.locator('#igDetailNext')).to_be_disabled()
    page.keyboard.press('Escape')
    expect(page.locator('#igDetail')).not_to_be_visible()
    expect(page.locator('#igMediaList button').first).to_be_focused()
    page.locator('#igLoadMore').click()
    expect(page.locator('#igMediaList article')).to_have_count(2)
    expect(page.locator('#igLoadMore')).to_be_hidden()
    state['media_error']=True
    page.locator('#igRefresh').click()
    expect(page.locator('#igManageStatus')).to_have_attribute('data-error','true')
    expect(page.locator('#igMediaList article')).to_have_count(2)
    state['media_error']=False
    state['empty']=True
    page.locator('#igRefresh').click()
    expect(page.locator('#igMediaList article')).to_have_count(0)
    expect(page.locator('#igManageStatus')).to_contain_text('아직 조회할 게시물이 없습니다')
    page.locator('[data-ig-view="post"]').click()
    expect(page.locator('#igField_title')).to_have_value('작성 중인 공연')
    page.locator('[data-ig-view="manage"]').click()
    for width in [1440,390,320]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        expect(page.locator('[data-ig-view="manage"]')).to_be_visible()
    page.locator('#gLogoutBtn').click()
    expect(page.locator('#igWork')).to_be_hidden()
    expect(page.locator('#igMediaList article')).to_have_count(0)
    assert not errors,errors
    print('PASS: management list, pagination, error/retry, empty state, safe text, preserved editor, logout and responsive submenu')
    browser.close()
