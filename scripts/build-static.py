"""Stage only the public HTML, never the repository or server-app secrets."""
from pathlib import Path
import argparse
import json
import re

parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['local', 'cloud'], default='local')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()
config = json.loads(re.search(r'<script id="tool-config" type="application/json">(.*?)</script>', html).group(1))
config.update(mode=args.mode, apiBase='/api')
html = re.sub(r'(<script id="tool-config" type="application/json">).*?(</script>)',
              lambda m: m[1] + json.dumps(config) + m[2], html, count=1)
output = root / 'dist'
output.mkdir(exist_ok=True)
# Refuse unexpected leftovers rather than publishing them or deleting user data.
allowed = {'index.html', '_headers'}
if any(p.name not in allowed or not p.is_file() or p.is_symlink() for p in output.iterdir()):
    raise SystemExit('Unexpected files in dist: move them out before building public assets.')
(output / 'index.html').write_text(html)
(output / '_headers').write_text('/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n')
print(f'Built dist/index.html and dist/_headers ({args.mode} mode).')
