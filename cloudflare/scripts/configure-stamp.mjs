// Run from an authenticated Cloudflare terminal. Never print the stamp value.
import { readFileSync } from 'node:fs';
import { stampSecrets } from './stamp-secrets.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let stamp;
try { stamp = readFileSync(new URL('../.private/stamp-base64.txt', import.meta.url), 'utf8').trim(); }
catch { throw new Error('Private stamp file is missing. Extract it from the original Worker into cloudflare/.private/stamp-base64.txt; never commit it.'); }
const values = stampSecrets(stamp);
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'secret', 'bulk'], { cwd: root, input: JSON.stringify(values), stdio: ['pipe', 'inherit', 'inherit'] });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
