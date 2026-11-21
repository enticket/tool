"""Serve only the legacy single HTML file, never the new server app or secrets."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from security_headers import security_headers
from public_assets import ROOT, PUBLIC_ASSETS, public_html

class LegacyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(True)

    def do_HEAD(self):
        self.respond(False)

    def respond(self, body):
        path = urlsplit(self.path).path
        asset = path.lstrip('/')
        if path not in ('/', '/index.html') and asset not in PUBLIC_ASSETS:
            self.send_error(404)
            return
        content = (ROOT / asset).read_bytes() if asset in PUBLIC_ASSETS else public_html().encode()
        self.send_response(200)
        self.send_header('Content-Type', PUBLIC_ASSETS.get(asset, 'text/html; charset=utf-8'))
        self.send_header('Content-Length', str(len(content)))
        for name, value in security_headers(public_html()).items():
            self.send_header(name, value)
        self.end_headers()
        if body:
            self.wfile.write(content)

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8000), LegacyHandler).serve_forever()
