"""Stage only the public HTML, never the repository or server-app secrets."""
from pathlib import Path
import argparse
import json
import re
from security_headers import security_headers
from public_assets import PUBLIC_ASSETS, public_html
from shutil import copy2

parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['local', 'cloud'], default='local')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
html = public_html()
config = json.loads(re.search(r'<script id="tool-config" type="application/json">(.*?)</script>', html).group(1))
config.update(mode=args.mode, apiBase='/api')
html = re.sub(r'(<script id="tool-config" type="application/json">).*?(</script>)',
              lambda m: m[1] + json.dumps(config) + m[2], html, count=1)
if args.mode == 'cloud':
    # The cloud navigation/account controls must be visible in the initial HTML,
    # even before the browser has initialized JavaScript and the Google library.
    html = html.replace(' data-cloud-only hidden', ' data-cloud-only')
output = root / 'dist'
output.mkdir(exist_ok=True)
# Refuse unexpected leftovers rather than publishing them or deleting user data.
allowed = {'index.html', '_headers', *PUBLIC_ASSETS}
allowed_dirs = {str(parent) for name in PUBLIC_ASSETS for parent in Path(name).parents if str(parent) != '.'}
if any(p.is_symlink() or not (p.is_file() or p.is_dir()) or (str(p.relative_to(output)) not in (allowed_dirs if p.is_dir() else allowed)) for p in output.rglob('*')):
    raise SystemExit('Unexpected files in dist: move them out before building public assets.')
for name in PUBLIC_ASSETS:
    source = root / name
    if source.is_symlink() or not source.is_file():
        raise SystemExit('Invalid public asset: ' + name)
    target = output / name
    target.parent.mkdir(parents=True, exist_ok=True)
    copy2(source, target)
(output / 'index.html').write_text(html)
(output / '_headers').write_text('/*\n' + ''.join(
    f'  {name}: {value}\n' for name, value in security_headers(html).items()))
print(f'Built dist/index.html and dist/_headers ({args.mode} mode).')
