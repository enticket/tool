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
        if path == 'session':
            route.fulfill(status=401,json={'error':'invalid_token'}); return
        if path == 'session/logout':
            route.fulfill(json={'ok':True}); return
        calls.append(path)
        assert route.request.method == 'POST'
        message = BytesParser(policy=policy.default).parsebytes(('Content-Type: '+route.request.headers['content-type']+'\r\n\r\n').encode()+route.request.post_data_buffer)
        fields = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True) for part in message.iter_parts()}
        assert fields.pop('access_token',None) == (b'synthetic-google-token' if path == 'session/login' else None)
        if not state['allowed']:
            route.fulfill(status=403, json={'error': 'not_allowed'}); return
        if path == 'session/login':
            route.fulfill(json={'ok': True, 'allowed': True,'email':'staff@example.test'}); return
        assert path.startswith('instagram/')
        if path == 'instagram/connection':
            if state['instagram_error']:
                route.fulfill(status=503, json={'error': 'instagram_token_invalid'}); return
            route.fulfill(json={'ok': True, 'connected': True, 'account': {'id': '123', 'username': 'en__ticket', 'checkedAt': '2026-11-05T04:00:00Z'}}); return
        if path == 'instagram/media':
            route.fulfill(json={'ok':True,'account':{'username':'en__ticket'},'items':[],'nextCursor':None});return
        if path == 'instagram/schedules':
            route.fulfill(json={'ok':True,'items':[state['job']] if state['job'] else []});return
        if path == 'instagram/schedule':
            assert fields['confirm']==b'schedule'
            assert fields['fingerprint']==b'reviewed-image-digest'
            assert fields['scheduled_at'].decode()==state['expected_time']
            state['job'].update(status='scheduled',scheduledAt=fields['scheduled_at'].decode())
            route.fulfill(json=state['job']);return
        if path == 'instagram/cancel':
            assert fields['confirm']==b'cancel'
            state['job']['status']='cancelled';route.fulfill(json=state['job']);return
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
    fixture=page.evaluate("""()=>{const c=document.createElement('canvas');c.width=600;c.height=900;c.getContext('2d').fillRect(0,0,600,900);return c.toDataURL('image/png').split(',')[1]}""")
    page.locator('#igFile').set_input_files({'name':'test.png','mimeType':'image/png','buffer':base64.b64decode(fixture)})
    page.locator('#igField_title').fill('확인한 문구 #엔티켓')
    page.locator('#igPrepare').click()
    expect(page.locator('#igReview')).to_be_visible()
    for width in [1280,390]:
        page.set_viewport_size({'width':width,'height':900})
        page.locator('[data-publish-mode="now"]').check()
        expect(page.locator('#igScheduleField .ig-date-trigger')).to_be_disabled()
        before=page.locator('#igReview').bounding_box()
        page.locator('[data-publish-mode="schedule"]').check()
        after=page.locator('#igReview').bounding_box()
        assert abs(before['height']-after['height'])<1
        assert abs(before['width']-after['width'])<1
        assert abs(before['y']-after['y'])<1
        expect(page.locator('#igScheduleField .ig-date-trigger')).to_be_enabled()
    page.set_viewport_size({'width':1280,'height':720})
    page.locator('[data-publish-mode="schedule"]').click()
    expect(page.locator('#igScheduleField')).to_be_visible()
    page.locator('#igScheduleField .ig-date-trigger').click()
    box=page.locator('.ig-calendar').bounding_box()
    viewport=page.viewport_size
    assert abs(box['x']+box['width']/2-viewport['width']/2)<2
    assert abs(box['y']+box['height']/2-viewport['height']/2)<2
    expect(page.locator('.ig-calendar [data-prev]')).to_be_disabled()
    page.locator('.ig-calendar [data-next]').click()
    expect(page.locator('.ig-calendar [data-next]')).to_be_disabled()
    expect(page.get_by_role('button',name='2026년 12월 7일',exact=True)).to_be_disabled()
    page.locator('.ig-calendar [data-prev]').click()

    page.get_by_role('button',name='2026년 11월 20일',exact=True).click()
    page.get_by_role('textbox',name='시',exact=True).fill('19')
    page.get_by_role('textbox',name='분',exact=True).fill('00')
    page.get_by_role('button',name='분 증가',exact=True).click()
    page.get_by_role('button',name='분 감소',exact=True).click()
    page.get_by_role('button',name='선택 완료').click()
    state['expected_time']='2026-11-20T10:00:00.000Z'
    expect(page.locator('#igPublish')).to_be_disabled()
    page.locator('#igConfirm').check()
    page.locator('#igPublish').click()
    expect(page.locator('#igStatus')).to_contain_text('예약이 완료')
    expect(page.locator('#igReview')).to_be_hidden()
    assert state['publish_count']==0
    page.locator('[data-ig-view="manage"]').click()
    page.locator('#igShowScheduled').click()
    expect(page.locator('#igScheduleList')).to_contain_text('예약 대기')
    page.locator('#igScheduleList .ig-date-trigger').click()
    page.get_by_role('button',name='2026년 11월 21일',exact=True).click()
    page.get_by_role('textbox',name='시',exact=True).fill('20')
    page.get_by_role('textbox',name='분',exact=True).fill('30')
    page.get_by_role('button',name='선택 완료').click()
    state['expected_time']='2026-11-21T11:30:00.000Z'
    page.get_by_role('button',name='시간 변경',exact=True).click()
    expect(page.locator('#igScheduleList input')).to_have_value('2026-11-21T20:30')
    page.get_by_role('button',name='예약 취소',exact=True).click()
    expect(page.locator('#igScheduleList')).to_contain_text('취소됨')
    assert state['publish_count']==0
    for width in [1440,390,320]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.locator('#gLogoutBtn').click()
    expect(page.locator('#igScheduleList')).to_be_empty()
    assert not errors,errors
    print('PASS: explicit schedule confirmation, Korea time conversion, automatic editor reset, management list, reschedule/cancel, logout; no publication')
    browser.close()
