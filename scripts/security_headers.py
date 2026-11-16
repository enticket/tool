"""Build CSP from the exact HTML bytes we publish, with no inline-script bypass."""
import base64
import hashlib
import re
from html.parser import HTMLParser


def security_headers(html):
    hashes = []
    sources = []

    def pinned_source(src, integrity):
        if not src.startswith(('https://cdn.jsdelivr.net/npm/', 'https://cdn.sheetjs.com/xlsx-')):
            raise ValueError('Unexpected third-party script source')
        if not re.fullmatch(r'sha384-[A-Za-z0-9+/]{64}', integrity or ''):
            raise ValueError('Third-party scripts require SHA-384 integrity')
        sources.append(src)

    class Scripts(HTMLParser):
        active = False
        content = ''

        def handle_starttag(self, tag, attrs):
            if tag != 'script':
                return
            attrs = dict(attrs)
            self.active = not attrs.get('src') and attrs.get('type') != 'application/json'
            self.content = ''
            if attrs.get('src'):
                if attrs.get('crossorigin') != 'anonymous':
                    raise ValueError('Cross-origin scripts require anonymous CORS')
                pinned_source(attrs['src'], attrs.get('integrity'))

        def handle_data(self, data):
            if self.active:
                self.content += data

        def handle_endtag(self, tag):
            if tag == 'script' and self.active:
                digest = base64.b64encode(hashlib.sha256(self.content.encode()).digest()).decode()
                hashes.append("'sha256-" + digest + "'")
                self.active = False

    Scripts().feed(html)
    for src, integrity in re.findall(r'await load\("([^"]+)","([^"]+)"\)', html):
        pinned_source(src, integrity)
    # GIS changes upstream and cannot be pinned with SRI. Restrict it to Google's
    # documented client path. Cloudflare injects its own integrity-pinned beacon.
    scripts = hashes + sources + ['https://accounts.google.com/gsi/client', 'https://static.cloudflareinsights.com/']
    policy = '; '.join([
        "default-src 'none'",
        'script-src ' + ' '.join(scripts),
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
        "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://cloudflareinsights.com",
        "img-src 'self' data: blob: https://cdninstagram.com https://*.cdninstagram.com https://fbcdn.net https://*.fbcdn.net https://instagram.com https://*.instagram.com https://*.googleusercontent.com https://accounts.google.com",
        "media-src 'self' blob: https://cdninstagram.com https://*.cdninstagram.com https://fbcdn.net https://*.fbcdn.net https://instagram.com https://*.instagram.com",
        "font-src 'self' data:",
        "frame-src 'self' blob: https://accounts.google.com",
        "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
        "form-action 'self' https://accounts.google.com",
    ])
    headers = {
        'Content-Security-Policy': policy,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Strict-Transport-Security': 'max-age=31536000',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    }
    # Cloudflare Assets limits each _headers line to 2,000 characters.
    if any(len(f'  {name}: {value}') > 2000 for name, value in headers.items()):
        raise ValueError('Security header exceeds Cloudflare Assets line limit')
    return headers
