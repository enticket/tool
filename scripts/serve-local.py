"""Serve only the legacy single HTML file, never the new server app or secrets."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

class LegacyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(True)

    def do_HEAD(self):
        self.respond(False)

    def respond(self, body):
        if urlsplit(self.path).path not in ('/', '/index.html'):
            self.send_error(404)
            return
        content = (Path(__file__).resolve().parents[1] / 'index.html').read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if body:
            self.wfile.write(content)

if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8000), LegacyHandler).serve_forever()
