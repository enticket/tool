import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
const origin = 'https://tools.enticket.kr';
const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_REFRESH_TOKEN: 'test-refresh', ALLOWED_EMAILS: 'staff@example.test',
  STAMP_JPEG_B64_1: 'synthetic-', STAMP_JPEG_B64_2: 'stamp-', STAMP_JPEG_B64_3: 'end', ASSETS: { fetch: () => new Response('static page') } };
function request(path, { origin: from = origin, file = false, fields = {} } = {}) {
  const form = new FormData(); form.set('access_token', 'test-user-token');
  if (file) {
    form.set('file', new Blob(['synthetic workbook']), '명단.xlsx');
    form.set('filename', '명단.xlsx'); form.set('mime', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    form.set('folder', 'enticket/예매자명단/공연');
  }
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(origin + path, { method: 'POST', headers: { Origin: from }, body: form });
}
function googleMock(t, { identity = {}, fail = '', userinfo = false } = {}) {
  const calls = []; let folders = 0;
  t.mock.method(globalThis, 'fetch', async (input, opts = {}) => {
    const url = String(input); calls.push({ url, opts });
    if (url.includes('/tokeninfo?')) return Response.json({ aud: 'test-client', expires_in: 300,
      email: userinfo ? undefined : 'staff@example.test', email_verified: !userinfo, ...identity });
    if (url.includes('/userinfo')) return Response.json({ email: 'staff@example.test', email_verified: true });
    if (url.endsWith('/token')) {
      assert.equal(opts.body.get('refresh_token'), 'test-refresh');
      return fail === 'token' ? Response.json({ error_description: 'MUST_NOT_LEAK' }, { status: 400 }) : Response.json({ access_token: 'company-access' });
    }
    assert.equal(opts.headers.Authorization, 'Bearer company-access');
    if (url.includes('/upload/')) {
      const body = await opts.body.text();
      assert.ok(body.includes('synthetic workbook'));
      assert.ok(body.includes('명단.xlsx'));
      assert.ok(body.includes('"parents":["folder-3"]'));
      return fail === 'upload' ? new Response('MUST_NOT_LEAK', { status: 500 }) : Response.json({ id: 'saved', name: '명단.xlsx', webViewLink: 'https://drive.google.com/file/d/saved/view' });
    }
    if (!opts.method) return fail === 'lookup' ? new Response('MUST_NOT_LEAK', { status: 403 }) : Response.json({ files: [] });
    return fail === 'create' ? new Response('MUST_NOT_LEAK', { status: 403 }) : Response.json({ id: 'folder-' + ++folders });
  });
  return calls;
}
test('static page and health preserve response; unknown API is 404', async () => {
  assert.equal(await (await worker.fetch(new Request(origin + '/'), env)).text(), 'static page');
  assert.equal((await worker.fetch(new Request(origin + '/healthz'), env)).status, 200);
  assert.equal((await worker.fetch(new Request(origin + '/api/nope'), env)).status, 404);
});
test('same-origin and legacy preflight accepted; foreign origin rejected before Google', async t => {
  const calls = googleMock(t);
  for (const from of [origin, 'https://enticket.github.io']) {
    const res = await worker.fetch(new Request(origin + '/api/verify', { method: 'OPTIONS', headers: { Origin: from } }), env);
    assert.equal(res.status, 204); assert.equal(res.headers.get('Access-Control-Allow-Origin'), from);
  }
  const res = await worker.fetch(request('/api/stamp', { origin: 'https://other.example' }), env);
  assert.equal(res.status, 403); assert.equal(calls.length, 0); assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});
for (const path of ['/verify', '/api/verify']) test('authorized identity on ' + path, async t => {
  googleMock(t); const res = await worker.fetch(request(path), env);
  assert.equal(res.status, 200); assert.equal((await res.json()).allowed, true);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
for (const [label, identity, status] of [
  ['wrong client', { aud: 'another-client' }, 401],
  ['expired', { expires_in: 0 }, 401],
  ['bad expiry', { exp: 'NaN' }, 401],
  ['unverified', { email_verified: false }, 403],
  ['not allowed', { email: 'other@example.test' }, 403],
]) test(label + ' cannot read stamp or upload', async t => {
  const calls = googleMock(t, { identity });
  for (const path of ['/stamp', '/api/upload']) {
    const res = await worker.fetch(request(path, { file: true }), env);
    assert.equal(res.status, status); assert.ok(!(await res.text()).includes('synthetic-stamp-end'));
  }
  assert.equal(calls.length, 2);
});
test('userinfo fallback and authorized stamp only', async t => {
  googleMock(t, { userinfo: true });
  const res = await worker.fetch(request('/api/stamp'), env);
  assert.equal(res.status, 200); assert.equal((await res.json()).b64, 'synthetic-stamp-end');
});
test('missing token/config/stamp fail closed', async t => {
  const calls = googleMock(t);
  assert.equal((await worker.fetch(request('/verify', { fields: { access_token: '' } }), env)).status, 400);
  assert.equal((await worker.fetch(request('/verify'), { ...env, GOOGLE_CLIENT_ID: '' })).status, 503);
  assert.equal(calls.length, 0);
  assert.equal((await worker.fetch(request('/stamp'), { ...env, STAMP_JPEG_B64_2: '' })).status, 503);
});
test('company upload preserves folder hierarchy and result contract', async t => {
  const calls = googleMock(t); const res = await worker.fetch(request('/api/upload', { file: true }), env);
  assert.equal(res.status, 200); assert.equal((await res.json()).fileId, 'saved');
  assert.equal(calls.length, 9);
});
for (const fail of ['token', 'lookup', 'create', 'upload']) test(fail + ' failure stops without leaking provider details', async t => {
  const calls = googleMock(t, { fail });
  const res = await worker.fetch(request('/upload', { file: true }), env);
  assert.equal(res.status, 502); assert.ok(!(await res.text()).includes('MUST_NOT_LEAK'));
  if (fail !== 'upload') assert.ok(!calls.some(c => c.url.includes('/upload/')));
  if (fail === 'lookup') assert.equal(calls.length, 3);
});
test('invalid files/metadata and too many folders rejected before company access', async t => {
  const calls = googleMock(t);
  for (const fields of [{ file: 'not a file' }, { mime: 'text/plain\r\nInjected: yes' }, { folder: '' }, { folder: 'a/'.repeat(9) }]) {
    assert.equal((await worker.fetch(request('/upload', { file: true, fields }), env)).status, 400);
  }
  assert.equal(calls.length, 4);
  assert.equal((await worker.fetch(request('/upload', { file: true, fields: { file: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) } }), env)).status, 413);
});
test('oversized streaming body rejected before any upstream request', async t => {
  const calls = googleMock(t);
  const res = await worker.fetch(new Request(origin + '/upload', { method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=bad' },
    body: new Blob([new Uint8Array(11 * 1024 * 1024 + 1)]) }), env);
  assert.equal(res.status, 413); assert.equal(calls.length, 0);
});
test('non-POST and malformed multipart rejected', async () => {
  assert.equal((await worker.fetch(new Request(origin + '/stamp'), env)).status, 405);
  assert.equal((await worker.fetch(new Request(origin + '/stamp', { method: 'POST', body: 'bad' }), env)).status, 415);
  assert.equal((await worker.fetch(new Request(origin + '/stamp', { method: 'POST', body: 'bad', headers: { 'Content-Type': 'multipart/form-data; boundary=x' } }), env)).status, 400);
});

// The real stamp is never imported into tests or public source.
test('private stamp splitting respects Cloudflare limits and preserves every byte', async () => {
  const { stampSecrets } = await import('../scripts/stamp-secrets.mjs');
  const source = '/9j/' + 'A'.repeat(10868);
  const chunks = stampSecrets(source);
  assert.deepEqual(Object.keys(chunks), ['STAMP_JPEG_B64_1', 'STAMP_JPEG_B64_2', 'STAMP_JPEG_B64_3']);
  assert.equal(Object.values(chunks).join(''), source);
  assert.ok(Object.values(chunks).every(s => s.length <= 4096));
  assert.throws(() => stampSecrets('/9j/' + 'A'.repeat(13000)));
});
