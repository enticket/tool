import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker from '../src/worker.mjs';
const origin = 'https://tools.enticket.kr';
const bindings = { GOOGLE_CLIENT_ID: 'test-client', ALLOWED_EMAILS: 'staff@example.test',
  INSTAGRAM_ACCOUNT_ID: '17841465620686597', INSTAGRAM_ACCESS_TOKEN: 'private-instagram-token' };
function request(path, fields = {}, from = origin) {
  const form = new FormData(); form.set('access_token', 'staff-token');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(origin + '/api/instagram/' + path, { method: 'POST', headers: { Origin: from }, body: form });
}
const google = email => Response.json({ aud: 'test-client', email, email_verified: true, expires_in: 300 });
test('Instagram authorization fails before any Meta call', async t => {
  const calls = []; let identity = { email: 'other@example.test' };
  t.mock.method(globalThis, 'fetch', async url => { calls.push(String(url)); return Response.json({ aud: 'test-client', expires_in: 300, email_verified: true, ...identity }); });
  for (const path of ['connection', 'prepare', 'publish', 'status']) {
    assert.equal((await worker.fetch(request(path), bindings)).status, 403);
    assert.equal((await worker.fetch(request(path, {}, 'https://other.test'), bindings)).status, 403);
  }
  identity = { aud: 'other-client', email: 'staff@example.test' };
  assert.equal((await worker.fetch(request('connection'), bindings)).status, 401);
  identity = { email: 'staff@example.test', expires_in: 0 };
  assert.equal((await worker.fetch(request('connection'), bindings)).status, 401);
  assert.ok(calls.every(url => url.startsWith('https://oauth2.googleapis.com/')));
});
for (const [scenario, response, status, error] of [
  ['valid', () => Response.json({ id: bindings.INSTAGRAM_ACCOUNT_ID, username: 'en__ticket', access_token: 'MUST_NOT_LEAK' }), 200],
  ['wrong account', () => Response.json({ id: '123', username: 'another' }), 409, 'instagram_account_mismatch'],
  ['expired', () => Response.json({ error: { code: 190, message: 'MUST_NOT_LEAK' } }, { status: 400 }), 503, 'instagram_token_invalid'],
  ['permissions', () => Response.json({ error: { code: 200 } }, { status: 403 }), 503, 'instagram_permission_denied'],
  ['rate limit', () => Response.json({ error: { code: 4 } }, { status: 400 }), 429, 'instagram_rate_limited'],
  ['redirect', () => new Response(null, { status: 302, headers: { Location: 'https://must-not-follow.test' } }), 502, 'instagram_unavailable'],
  ['non JSON', () => new Response('MUST_NOT_LEAK', { status: 502 }), 502, 'instagram_unavailable'],
]) test('connection: ' + scenario, async t => {
  let metaCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('oauth2.googleapis.com')) return google('staff@example.test');
    metaCalls++; assert.equal(String(url), 'https://graph.facebook.com/v27.0/' + bindings.INSTAGRAM_ACCOUNT_ID + '?fields=id%2Cusername');
    assert.equal(opts.headers.Authorization, 'Bearer private-instagram-token');
    assert.equal(opts.redirect, 'manual'); assert.equal(opts.method, 'GET'); return response();
  });
  const result = await worker.fetch(request('connection'), bindings);
  assert.equal(result.status, status); assert.equal(metaCalls, 1);
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  const text = await result.text(); assert.ok(!/MUST_NOT_LEAK|private-instagram-token/.test(text));
  const data = JSON.parse(text);
  if (error) assert.equal(data.error, error); else assert.equal(data.account.username, 'en__ticket');
});
test('Workers + SQLite: immutable review, protected media, one publish and uncertain-response recovery', async () => {
  let publishMode = 'success', identity = 'staff@example.test', containerState = 'FINISHED';
  const calls = [];
  // Synthetic JPEG marker fixture validates the server contract; it is never sent to Meta.
  const jpeg = new Uint8Array([255,216,255,192,0,17,8,5,70,4,56,3,1,17,0,2,17,0,3,17,0,255,217]);
  const storyJpeg = jpeg.slice(); storyJpeg[7] = 7; storyJpeg[8] = 128;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: ['worker.mjs', 'instagram.mjs', 'instagram-job.mjs'].map(name => ({
      type: 'ESModule', path: fileURLToPath(new URL('../src/' + name, import.meta.url)),
    })),
    compatibilityDate: '2026-10-13', bindings,
    durableObjects: { INSTAGRAM_JOBS: { className: 'InstagramJob', useSQLite: true } },
    outboundService: async req => {
      const url = new URL(req.url); calls.push({ path: url.pathname, method: req.method });
      if (url.hostname === 'oauth2.googleapis.com') return google(identity);
      assert.equal(url.hostname, 'graph.facebook.com');
      assert.equal(req.headers.get('Authorization'), 'Bearer private-instagram-token');
      assert.equal(url.searchParams.has('access_token'), false);
      if (url.pathname.endsWith('/media_publish')) {
        assert.deepEqual(await req.json(), { creation_id: '999' });
        return publishMode === 'lost' ? new Response('MUST_NOT_LEAK', { status: 502 }) : Response.json({ id: '777' });
      }
      if (url.pathname.endsWith('/media')) {
        const body = await req.json();
        if (body.media_type === 'STORIES') assert.equal('caption' in body, false);
        else assert.equal(body.caption, '승인한 캡션');
        assert.ok(body.image_url.startsWith(origin + '/instagram-media/'));
        const image = await mf.dispatchFetch(body.image_url);
        assert.equal(image.status, 200); assert.equal(image.headers.get('Content-Type'), 'image/jpeg');
        assert.deepEqual(new Uint8Array(await image.arrayBuffer()), body.media_type === 'STORIES' ? storyJpeg : jpeg);
        return Response.json({ id: '999' });
      }
      if (url.pathname.endsWith('/999')) return Response.json({ status_code: containerState });
      return Response.json({ id: bindings.INSTAGRAM_ACCOUNT_ID, username: 'en__ticket' });
    },
  }));
  const invoke = async (path, fields) => {
    const req = request(path, fields);
    return mf.dispatchFetch(req.url, { method: req.method,
      headers: Object.fromEntries(req.headers), body: await req.arrayBuffer() });
  };
  const id = '10000000-0000-4000-8000-000000000001';
  const draft = { draft_id: id, channel: 'feed', caption: '승인한 캡션', file: new File([jpeg], 'test.jpg', { type: 'image/jpeg' }) };
  try {
    const response = await invoke('prepare', draft);
    assert.equal(response.status, 200, await response.clone().text());
    const prepared = await response.json(); assert.equal(prepared.status, 'prepared');
    assert.equal((await (await invoke('prepare', draft)).json()).fingerprint, prepared.fingerprint);
    assert.equal((await invoke('prepare', { ...draft, caption: '바뀐 캡션' })).status, 409);
    assert.equal((await invoke('prepare', { ...draft, draft_id: 'bad' })).status, 400);
    assert.equal((await invoke('publish', { draft_id: id, fingerprint: prepared.fingerprint })).status, 409);
    assert.equal((await invoke('publish', { draft_id: id, fingerprint: 'tampered', confirm: 'publish' })).status, 409);
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
    assert.equal((await mf.dispatchFetch(origin + '/instagram-media/' + id + '/' + '0'.repeat(72))).status, 404);
    const confirmed = { draft_id: id, fingerprint: prepared.fingerprint, confirm: 'publish' };
    containerState = 'IN_PROGRESS';
    assert.equal((await (await invoke('publish', confirmed)).json()).status, 'processing');
    containerState = 'FINISHED';
    const results = await Promise.all([invoke('publish', confirmed), invoke('publish', confirmed)]);
    assert.ok((await Promise.all(results.map(r => r.json()))).some(s => s.status === 'published'));
    assert.equal((await (await invoke('publish', confirmed)).json()).mediaId, '777');
    assert.equal(calls.filter(c => c.path.endsWith('/media_publish')).length, 1);
    assert.equal(calls.filter(c => c.path.endsWith('/media')).length, 1);
    const nextId = '10000000-0000-4000-8000-000000000002';
    const next = await (await invoke('prepare', { ...draft, draft_id: nextId })).json(); publishMode = 'lost';
    const nextConfirmed = { draft_id: nextId, fingerprint: next.fingerprint, confirm: 'publish' };
    assert.equal((await (await invoke('publish', nextConfirmed)).json()).status, 'unknown');
    assert.equal((await (await invoke('publish', nextConfirmed)).json()).status, 'unknown');
    assert.equal(calls.filter(c => c.path.endsWith('/media_publish')).length, 2);
    containerState = 'PUBLISHED';
    const reconciled = await (await invoke('status', { draft_id: nextId })).json();
    assert.equal(reconciled.status, 'published'); assert.equal(reconciled.mediaId, null);
    assert.ok(!JSON.stringify(reconciled).includes('MUST_NOT_LEAK'));
    // Stories have their own immutable image shape and never inherit feed captions.
    const storyId = '10000000-0000-4000-8000-000000000003';
    const story = { ...draft, draft_id: storyId, channel: 'story', caption: '', file: new File([storyJpeg], 'story.jpg', { type: 'image/jpeg' }) };
    assert.equal((await invoke('prepare', { ...story, caption: 'must not be sent' })).status, 400);
    assert.equal((await invoke('prepare', { ...story, file: draft.file })).status, 400);
    const readyStory = await (await invoke('prepare', story)).json();
    publishMode = 'success'; containerState = 'FINISHED';
    assert.equal((await (await invoke('publish', { draft_id: storyId, fingerprint: readyStory.fingerprint, confirm: 'publish' })).json()).status, 'published');
    identity = 'other@example.test'; assert.equal((await invoke('status', { draft_id: id })).status, 403);
  } finally { await mf.dispose(); }
});
