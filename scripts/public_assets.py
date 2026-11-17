"""Explicit public assets and inline shared renderer; never expose repository paths."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ASSETS = {
    'assets/weekly/NanumMyeongjo-ExtraBold.woff2': 'font/woff2',
    'assets/weekly/paper-grain.png': 'image/png',
    'assets/weekly/OFL.txt': 'text/plain; charset=utf-8',
}


def public_html():
    html = (ROOT / 'index.html').read_text().replace('/* WEEKLY_STUDIO_CSS */', (ROOT / 'scripts/weekly-studio.css').read_text())
    module = (ROOT / 'cloudflare/src/weekly-design.mjs').read_text()
    names = re.findall(r'^export (?:const|function) (\w+)', module, re.M)
    code = re.sub(r'^export ', '', module, flags=re.M)
    html = html.replace('/* WEEKLY_LAYER_EDITOR */', (ROOT / 'scripts/weekly-layer-editor.js').read_text())
    return html.replace('/* WEEKLY_DESIGN_MODULE */',
                        'window.EnticketWeeklyDesign = (() => {\n' + code +
                        '\nreturn {' + ','.join(names) + '};\n})();')
