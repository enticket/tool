import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Run through workerd: Node fetch mocks do not enforce Workers' redirect options.
test('Workers runtime verifies accounts and rejects invalid tokens/redirects', async () => {
  let mode = 'allowed';
  const calls = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: fileURLToPath(new URL('../src/worker.mjs', import.meta.url)),
    compatibilityDate: '2026-10-13',
    bindings: { GOOGLE_CLIENT_ID: 'synthetic-client', ALLOWED_EMAILS: 'staff@example.test' },
    outboundService: async request => {
      calls.push(new URL(request.url).hostname);
      if (mode === 'invalid') return Response.json({ error: 'invalid_token' }, { status: 400 });
      if (mode === 'redirect') return new Response(null, {
        status: 302, headers: { Location: 'https://must-not-follow.example/' },
      });
      return Response.json({ aud: 'synthetic-client', expires_in: 300,
        email: mode === 'denied' ? 'other@example.test' : 'staff@example.test', email_verified: true });
    },
  }));
  try {
    for (const [scenario, status, error] of [
      ['allowed', 200, undefined], ['denied', 403, 'not_allowed'],
      ['invalid', 401, 'invalid_token'], ['redirect', 502, 'google_unavailable'],
    ]) {
      mode = scenario;
      const response = await mf.dispatchFetch('https://tools.enticket.kr/api/verify', {
        method: 'POST',
        headers: { Origin: 'https://tools.enticket.kr', 'Content-Type': 'multipart/form-data; boundary=test' },
        body: '--test\r\nContent-Disposition: form-data; name="access_token"\r\n\r\nsynthetic-token\r\n--test--\r\n',
      });
      assert.equal(response.status, status, scenario);
      const data = await response.json();
      if (error) assert.equal(data.error, error);
      else assert.equal(data.allowed, true);
    }
    assert.deepEqual(calls, Array(4).fill('oauth2.googleapis.com'));
  } finally { await mf.dispose(); }
});
