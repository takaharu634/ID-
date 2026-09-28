import { Miniflare } from 'miniflare';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hmac } from '../server/trackman-push.mjs';
import { sha256 } from '../server/import-store.mjs';
import { engineVersion } from '../server/generated/drive-push-script.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
test('compiled push API protects setup credentials and streams signed UTF-8 into R2', { timeout: 60000 }, async () => {
  const modules = (await fs.readdir(root + '/dist/server', { recursive: true })).filter(f => f.endsWith('.js')).map(f => ({ type: 'ESModule', path: root + '/dist/server/' + f })).sort((a, b) => Number(b.path.endsWith('/server/index.js')) - Number(a.path.endsWith('/server/index.js')));
  const secret = 'isolated-runtime-key-never-deployed-'.repeat(2);
  const mf = new Miniflare({ modules, compatibilityDate: '2026-05-01', compatibilityFlags: ['nodejs_compat'], r2Buckets: ['BUCKET'], d1Databases: ['DB'], bindings: { ADMIN_EMAILS: 'admin@example.test', TRACKMAN_SYNC_SECRET: secret }, serviceBindings: { ASSETS: async request => { try { return new Response(await fs.readFile(root + '/public' + new URL(request.url).pathname)); } catch { return new Response(null, { status: 404 }); } } }, port: 0 });
  try {
    const db = await mf.getD1Database('DB');
    for(const file of ['0001_broken_revanche.sql','0002_wise_wrecking_crew.sql'])for (const sql of (await fs.readFile(root + '/drizzle/'+file, 'utf8')).split('--> statement-breakpoint')) await db.prepare(sql.trim()).run();
    for (const path of ['/api/trackman/admin', '/api/trackman/admin?download=script']) {
      assert.equal((await mf.dispatchFetch('http://test.local' + path)).status, 401);
      assert.equal((await mf.dispatchFetch('http://test.local' + path, { headers: { 'oai-authenticated-user-email': 'other@example.test' } })).status, 403);
    }
    const headers = { 'oai-authenticated-user-email': 'admin@example.test' };
    const setup = await mf.dispatchFetch('http://test.local/api/trackman/admin?download=script', { headers }); assert.equal(setup.status, 200); assert.equal(setup.headers.get('cache-control'), 'no-store'); assert.ok((await setup.text()).includes(secret));
    const admin = await mf.dispatchFetch('http://test.local/admin', { headers }); assert.equal(admin.status, 200); const html = await admin.text(); assert.ok(html.includes('Driveから自動反映')); assert.ok(!html.includes(secret));
    const body = JSON.stringify({ action: 'connect', engineVersion, scriptUrl: 'https://script.google.com/macros/s/isolated-test/exec' }), time = String(Date.now());
    const connection = await mf.dispatchFetch('http://test.local/api/trackman/bridge', { method: 'POST', body, headers: { 'x-trackman-time': time, 'x-trackman-signature': await hmac(secret, time + '\n' + await sha256(body)) } }); assert.equal(connection.status, 200, await connection.text());
    const data = 'PitchUID,Date,選手\ntest,2026-09-26,日本語\n', hash = await sha256(data), key = `datasets/v2/2026-fall/versions/${crypto.randomUUID()}/raw.csv`;
    const uploadHeaders = { 'x-trackman-time': time, 'x-trackman-signature': await hmac(secret, `${time}\n${key}\n${hash}`), 'x-content-sha256': hash, 'x-content-bytes': String(Buffer.byteLength(data)) };
    const bad = await mf.dispatchFetch('http://test.local/api/trackman/storage?key=' + encodeURIComponent(key), { method: 'PUT', body: data + 'corruption', headers: uploadHeaders }); assert.equal(bad.status, 409);
    const upload = await mf.dispatchFetch('http://test.local/api/trackman/storage?key=' + encodeURIComponent(key), { method: 'PUT', body: data, headers: uploadHeaders }); assert.equal(upload.status, 200, await upload.text());
    const bucket = await mf.getR2Bucket('BUCKET'), saved = await bucket.get(key); assert.deepEqual(Buffer.from(await saved.arrayBuffer()), Buffer.from(data));
    assert.equal((await mf.dispatchFetch('http://test.local/api/dataset?season=2026-fall')).status, 204);
  } finally { await mf.dispose(); }
});
