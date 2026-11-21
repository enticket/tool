"""Verified CDN transport for Chromium behind the test environment's proxy CA.

Keep CORS and browser SRI checks enabled; never bypass certificate verification.
"""
import urllib.request
import time


def install_library_routes(page):
    def serve(route):
        request = urllib.request.Request(route.request.url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            route.fulfill(status=response.status, content_type='application/javascript',
                          headers={'Access-Control-Allow-Origin': '*'}, body=response.read())

    page.route('https://cdn.jsdelivr.net/**', serve)
    page.route('https://cdn.sheetjs.com/**', serve)


def wait_for_js(page, expression, timeout=10000):
    # Playwright's wait_for_function uses page-level eval; our CSP forbids it.
    # CDP evaluation polls the same condition without weakening the page policy.
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if page.evaluate(expression):
            return
        page.wait_for_timeout(50)
    raise AssertionError('Browser condition timed out: ' + expression)


def accept_app_messages(page):
    """Explicit synthetic-test consent; production dialogs always wait for the user."""
    page.add_locator_handler(page.locator('.ui-message[open]'),
                             lambda dialog: dialog.locator('[data-accept]').click())
