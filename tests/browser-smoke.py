"""Local-only onboarding smoke checks; no authenticated service writes."""
import base64
import json
import ssl
import os
import tempfile
import zipfile
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

TEMP = tempfile.TemporaryDirectory(prefix='enticket-browser-')
ROOT = Path(TEMP.name)
CDN = 'https://cdn.jsdelivr.net/'

def verified_cdn(route):
    # Chromium does not trust this machine's proxy CA. Use the existing
    # system CA bundle with hostname/certificate verification still enabled.
    with urllib.request.urlopen(route.request.url, context=ssl.create_default_context(), timeout=30) as response:
        route.fulfill(status=response.status, content_type='application/javascript', body=response.read())

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
    page = browser.new_page(accept_downloads=True)
    errors = []
    failed = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed.append(request.url.split('?')[0]))
    page.route(CDN + '**', verified_cdn)
    backend_requests = []
    def block_backend(route):
        backend_requests.append(route.request.url)
        route.abort()
    page.route('**/*.workers.dev/**', block_backend)
    page.route('https://accounts.google.com/**', block_backend)
    page.route('**/api/**', block_backend)
    page.on('dialog', lambda dialog: dialog.accept())
    response = page.goto(os.environ.get('TOOL_URL', 'http://127.0.0.1:8000'), wait_until='networkidle')
    expect(page.locator('#localNotice')).to_be_visible()
    expect(page.locator('#gLoginBtn')).to_be_hidden()
    assert page.locator('[data-cloud-only]:visible').count() == 0
    assert page.evaluate('gdrive.isLoggedIn() === false && gdrive.isAllowed() === false')
    assert response.status == 200
    assert page.evaluate('typeof XLSX !== "undefined" && typeof fflate !== "undefined"')
    for tab in ['excel', 'sms', 'poster', 'settlement', 'oseal']:
        page.locator(f'[data-tab="{tab}"]').click()
        expect(page.locator(f'#panel-{tab}')).to_be_visible()
    print('PASS: HTTP, CDN dependencies, all five tabs')

    fixture = page.evaluate('''() => {
      const wb = XLSX.utils.book_new();
      const rows = [
        ['공연명','공연일','공연시간','좌석수','관람자명','연락처','예매번호'],
        ['환경검증','2026-10-13','19:00',1,'테스트가','01000000001','TEST001'],
        ['환경검증','2026-10-13','19:00',1,'테스트나','01000000002','TEST002'],
        ['환경검증','2026-10-13','19:00',1,'테스트가','01000000001','TEST003']
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'fixture');
      return XLSX.write(wb, {type:'base64',bookType:'xlsx'});
    }''')
    file = {'name':'synthetic.xlsx', 'mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'buffer':base64.b64decode(fixture)}
    page.locator('[data-tab="excel"]').click()
    page.locator('#xlFileInput').set_input_files(file)
    expect(page.locator('#xlOutput table tr')).to_have_count(4)
    with page.expect_download() as event:
        page.locator('#xlDownload').click()
    event.value.save_as(ROOT / 'cleaned.xlsx')
    output = base64.b64encode((ROOT / 'cleaned.xlsx').read_bytes()).decode()
    rows = page.evaluate('''data => {
      const wb=XLSX.read(data,{type:'base64'});
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1});
    }''', output)
    assert len(rows) == 4 and rows[0] == ['공연명','공연일','공연시간','좌석수','관람자명','연락처','예매번호'], rows
    assert all(row[0] == '환경검증' for row in rows[1:]), rows
    print('PASS: booking XLSX upload, three-row conversion, XLSX download/readback')

    page.locator('[data-tab="sms"]').click()
    page.locator('#smsFileInput').set_input_files(file)
    expect(page.locator('#smsCount')).to_contain_text('2명')
    with page.expect_download() as event:
        page.locator('#smsDlTxt').click()
    event.value.save_as(ROOT / 'sms.txt')
    lines = (ROOT / 'sms.txt').read_text().splitlines()
    assert len(lines) == 2 and all('테스트' in line for line in lines), lines
    assert any('010-0000-0001' in line for line in lines), lines
    print('PASS: SMS duplicate removal and TXT download')

    # Generate a synthetic canvas fixture, without editing user images.
    png = page.evaluate('''() => {
      const c=document.createElement('canvas'); c.width=100; c.height=200;
      c.getContext('2d').fillRect(0,0,100,200); return c.toDataURL().split(',')[1];
    }''')
    page.locator('[data-tab="poster"]').click()
    page.locator('.imgdrop[data-box="poster"] input').set_input_files({'name':'synthetic.png','mimeType':'image/png','buffer':base64.b64decode(png)})
    cards = page.locator('.imgbox-results[data-box="poster"] .card')
    expect(cards).to_have_count(2)
    expect(cards.nth(0)).to_contain_text('238×476px')
    expect(cards.nth(1)).to_contain_text('650×1300px')
    with page.expect_download() as event:
        cards.nth(0).locator('.dl').click()
    event.value.save_as(ROOT / 'poster.jpg')
    assert (ROOT / 'poster.jpg').read_bytes()[:2] == b'\xff\xd8'
    print('PASS: two poster sizes, aspect ratio, JPEG download')
    # Exercise actual settlement generation, then use its output for sealing.
    page.locator('[data-tab="settlement"]').click()
    settlement_fixture = page.evaluate("""() => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['공연명','공연일','공연시간','권종','판매가격','수량'],
        ['이관검증','2026-10-14','19:00','일반',10000,3]
      ]), '판매');
      return XLSX.write(wb, {type:'base64', bookType:'xlsx'});
    }""")
    page.locator('#sessions input[type=file]').first.set_input_files({
        'name':'sales.xlsx', 'mimeType':file['mimeType'], 'buffer':base64.b64decode(settlement_fixture)})
    expect(page.locator('#genSettlement')).to_be_enabled()
    expect(page.locator('#livePayout')).to_have_text('₩28,020')
    expect(page.locator('#saveSettlementDrive')).to_be_hidden()
    with page.expect_download() as event:
        page.locator('#genSettlement').click()
    settlement_path = ROOT / 'settlement.xlsx'
    event.value.save_as(settlement_path)
    assert zipfile.is_zipfile(settlement_path)
    print('PASS: settlement 30,000 gross / 28,020 payout, XLSX generation')

    page.locator('[data-tab="oseal"]').click()
    expect(page.locator('#osealWork')).to_be_hidden()
    page.locator('#localStampInput').set_input_files({
        'name':'invalid.png', 'mimeType':'image/png', 'buffer':b'not an image'})
    expect(page.locator('#localStampStatus')).to_contain_text('실패')
    expect(page.locator('#osealWork')).to_be_hidden()
    stamp_file = {'name':'synthetic-stamp.png','mimeType':'image/png','buffer':base64.b64decode(png)}
    page.locator('#localStampInput').set_input_files(stamp_file)
    expect(page.locator('#osealWork')).to_be_visible()
    page.locator('#osealFileInput').set_input_files(settlement_path)
    expect(page.locator('#osealStatus')).to_contain_text('변환 완료')
    with page.expect_download() as event:
        page.locator('#osealDlXlsx').click()
    sealed_path = ROOT / 'sealed.xlsx'
    event.value.save_as(sealed_path)
    with zipfile.ZipFile(sealed_path) as archive:
        assert any(name.startswith('xl/media/') for name in archive.namelist())
        assert any('원 본 대 조 필' in archive.read(name).decode('utf-8')
                   for name in archive.namelist() if name.endswith('.xml'))
    with page.expect_download() as event:
        page.locator('#osealDlPdf').click()
        page.wait_for_function("/PDF (저장 완료|생성 실패)/.test(document.getElementById('osealStatus').textContent)")
        assert 'PDF 저장 완료' in page.locator('#osealStatus').inner_text(), page.locator('#osealStatus').inner_text()
    event.value.save_as(ROOT / 'sealed.pdf')
    assert (ROOT / 'sealed.pdf').read_bytes().startswith(b'%PDF-')
    print('PASS: local stamp + generated settlement -> sealed XLSX and PDF')

    page.locator('#localStampClear').click()
    expect(page.locator('#osealWork')).to_be_hidden()
    expect(page.locator('#osealBtnRow')).to_be_hidden()
    assert not page.evaluate('gdrive.hasLocalStamp()')
    page.locator('#localStampInput').set_input_files(stamp_file)
    expect(page.locator('#osealWork')).to_be_visible()
    page.reload(wait_until='networkidle')
    assert not page.evaluate('gdrive.hasLocalStamp()')
    assert page.evaluate('localStorage.length === 0 && sessionStorage.length === 0')
    assert not backend_requests, backend_requests
    assert not failed, failed
    print('PASS: clearing/reloading forgets stamp; no login, Worker or API calls')
    page.set_viewport_size({'width':390,'height':844})
    page.locator('[data-tab="oseal"]').click()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    print('PASS: no JavaScript runtime errors')
    print('Unverified optional external requests:', json.dumps(failed))
    browser.close()
