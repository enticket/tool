"""Regression tests for spreadsheet XSS, CSP and SRI, using synthetic data only."""
import base64
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import install_library_routes

URL = os.environ.get('TOOL_URL', 'http://127.0.0.1:8787')
HTML = (Path(__file__).resolve().parents[1] / 'dist/index.html').read_text()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
    page = browser.new_page()
    install_library_routes(page)
    page.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(
        content_type='application/javascript', body='window.google={accounts:{oauth2:{initTokenClient(){return {requestAccessToken(){}}}}}};'))
    page.route('**/api/**', lambda r: r.fulfill(json={'ok': True, 'allowed': True, 'email': 'synthetic@example.test'}))

    # Prove the injection is fixed even without CSP acting as a second defence.
    page.route(URL + '/', lambda r: r.fulfill(content_type='text/html', body=HTML))
    page.goto(URL + '/', wait_until='networkidle')
    expect(page.locator('#gUser')).to_have_text('synthetic@example.test')
    assert page.evaluate('XLSX.version') == '0.20.3'
    page.locator('[data-tab=settlement]').click()
    payload = 'Probe" onmouseover="window.__xss=true" x="'
    names = [payload, 'Normal', '__proto__', 'constructor', 'toString']
    fixture = page.evaluate('''names => {
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
        ['공연명','공연일','공연시간','권종','판매가격','수량'],
        ...names.map(n=>['Synthetic','2026-11-16','19:00',n,10000,1])]),'Sheet1');
      return XLSX.write(wb,{type:'base64',bookType:'xlsx'});
    }''', names)
    page.locator('#sessions input[type=file]').first.set_input_files({
        'name': 'synthetic-security.xlsx', 'mimeType': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'buffer': base64.b64decode(fixture)})
    page.locator('.merge-toggle').click()
    checks = page.locator('.mg-chk')
    expect(checks).to_have_count(len(names))
    assert sorted(checks.evaluate_all('(els)=>els.map(el=>el.value)')) == sorted(names)
    expect(page.locator('.merge [onmouseover]')).to_have_count(0)
    for checkbox in checks.all():
        checkbox.hover()
    assert page.evaluate('window.__xss !== true')
    checks.nth(0).check()
    checks.nth(1).check()
    canonical = 'Merged" onmouseover="window.__xss=true" x="'
    page.locator('#mgCanon').fill(canonical)
    page.locator('#mgApply').click()
    expect(page.locator('.rule b')).to_have_text(canonical)
    expect(page.locator('.rule [onmouseover]')).to_have_count(0)
    page.locator('.undo').hover()
    assert page.evaluate('window.__xss !== true')
    page.locator('.undo').click()
    expect(checks).to_have_count(len(names))
    print('PASS: malicious XLSX remains literal text; merge and undo work without CSP')

    page.unroute(URL + '/')
    violations = []
    page.expose_function('recordViolation', lambda directive: violations.append(directive))
    page.add_init_script("addEventListener('securitypolicyviolation',e=>window.recordViolation(e.effectiveDirective))")
    response = page.goto(URL + '/', wait_until='networkidle')
    assert "script-src-attr 'none'" in response.headers['content-security-policy']
    expect(page.locator('#gUser')).to_have_text('synthetic@example.test')
    assert not violations, violations
    page.evaluate('''()=>{
      const script=document.createElement('script');script.textContent='window.__inlineRan=true';document.head.append(script);
      const button=document.createElement('button');button.setAttribute('onclick','window.__handlerRan=true');document.body.append(button);button.click();
    }''')
    page.wait_for_timeout(100)
    assert page.evaluate('window.__inlineRan !== true && window.__handlerRan !== true')
    assert 'script-src-elem' in violations and 'script-src-attr' in violations, violations
    print('PASS: CSP allows application and Google client; injected scripts and handlers are blocked')

    # An allowed CDN URL alone must not be enough to run modified library code.
    page.route('https://cdn.jsdelivr.net/npm/fflate@0.8.3/umd/index.js', lambda r: r.fulfill(
        content_type='application/javascript', headers={'Access-Control-Allow-Origin': '*'},
        body='window.__tamperedLibrary=true;'))
    page.reload(wait_until='networkidle')
    assert page.evaluate('typeof fflate === "undefined" && window.__tamperedLibrary !== true')
    print('PASS: browser SRI rejects a modified response from an allowed CDN URL')
    browser.close()
