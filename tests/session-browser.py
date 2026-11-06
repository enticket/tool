"""Session restoration and custom calendar UI; all identity responses are synthetic."""
import os
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium')
    context=browser.new_context()
    page=context.new_page()
    page.route('https://cdn.jsdelivr.net/**',lambda r:r.abort())
    page.route('https://accounts.google.com/gsi/client',lambda r:r.fulfill(content_type='application/javascript',body="window.google={accounts:{oauth2:{initTokenClient(o){return {requestAccessToken(){o.callback({access_token:'test',expires_in:300})}}}}}};"))
    page.route('https://www.googleapis.com/**',lambda r:r.fulfill(json={'email':'staff@example.test'}))
    pending=[]
    state={'valid':False,'logins':0,'hold':False}
    def api(route):
        path=route.request.url.split('/api/')[1]
        if path=='session' and state['hold']:
            pending.append(route);return
        if path=='session/login':
            state['valid']=True;state['logins']+=1
            route.fulfill(headers={'Set-Cookie':'__Host-enticket_session=test; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400'},json={'ok':True,'allowed':True,'email':'staff@example.test'});return
        if path=='session/logout': state['valid']=False
        if path=='session' and not state['valid']:
            route.fulfill(status=401,json={'error':'invalid_token'});return
        assert b'access_token' not in (route.request.post_data_buffer or b'')
        route.fulfill(json={'ok':True,'allowed':True,'email':'staff@example.test'})
    page.route('**/api/**',api)
    page.goto('http://127.0.0.1:8787',wait_until='networkidle')
    page.locator('#gLoginBtn').click()
    expect(page.locator('#gUser')).to_have_text('staff@example.test')
    assert context.cookies()[0]['httpOnly']
    assert page.evaluate('document.cookie')==''
    state['hold']=True
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#gAuthLoading')).to_be_visible()
    expect(page.locator('#gLoginBtn')).to_be_hidden()
    expect(page.locator('#gLogoutBtn')).to_be_hidden()
    page.wait_for_timeout(100)
    assert pending
    state['hold']=False
    pending.pop().fulfill(json={'ok':True,'allowed':True,'email':'staff@example.test'})
    expect(page.locator('#gUser')).to_have_text('staff@example.test')
    expect(page.locator('#gAuthLoading')).to_be_hidden()
    cdp=context.new_cdp_session(page)
    cdp.send('Network.setCacheDisabled',{'cacheDisabled':True})
    cdp.send('Page.reload',{'ignoreCache':True})
    expect(page.locator('#gUser')).to_have_text('staff@example.test')
    assert state['logins']==1
    page.locator('#gLogoutBtn').click()
    expect(page.locator('#gUser')).to_be_hidden()
    page.reload(wait_until='networkidle')
    expect(page.locator('#gLoginBtn')).to_be_visible()
    browser.close()
print('PASS: cookie session restored on reload and hard reload; logout remains logged out')
