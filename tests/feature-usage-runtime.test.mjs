import { Miniflare } from 'miniflare';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

test('deployed worker counts only allowed anonymous menu views and protects the report', { timeout: 60000 }, async () => {
  const modules = (await fs.readdir(root + '/dist/server', { recursive: true }))
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ type: 'ESModule', path: root + '/dist/server/' + file }))
    .sort((a, b) => Number(b.path.endsWith('/server/index.js')) - Number(a.path.endsWith('/server/index.js')));
  const mf = new Miniflare({ modules, compatibilityDate: '2026-05-01', compatibilityFlags: ['nodejs_compat'], d1Databases: ['DB'], bindings: { ADMIN_EMAILS: 'admin@example.test' },
    serviceBindings: { ASSETS: async () => new Response(null, { status: 404 }) }, port: 0 });
  try {
    const db = await mf.getD1Database('DB');
    const migration = await fs.readFile(root + '/drizzle/0003_elite_spirit.sql', 'utf8');
    await db.prepare(migration).run();
    const send = (feature, origin = 'http://test.local') => mf.dispatchFetch('http://test.local/api/usage', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ feature }),
    });
    assert.equal((await send('search')).status, 204);
    assert.equal((await send('search')).status, 204);
    assert.equal((await send('leaders:batting_qab')).status, 204);
    assert.equal((await send('player:123')).status, 400);
    assert.equal((await send('search', 'http://other.local')).status, 403);
    assert.equal((await mf.dispatchFetch('http://test.local/api/usage')).status, 401);
    const admin = await mf.dispatchFetch('http://test.local/api/usage', { headers: { 'oai-authenticated-user-email': 'admin@example.test' } });
    const counts = await admin.json();
    assert.equal(admin.status, 200, JSON.stringify(counts));
    assert.deepEqual(counts.rows.map(({ feature, views }) => [feature, views]).sort(), [['leaders:batting_qab', 1], ['search', 2]]);
  } finally { await mf.dispose(); }
});
