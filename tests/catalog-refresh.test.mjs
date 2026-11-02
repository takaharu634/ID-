import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { publicSummary } from './fixtures/public-data.mjs';

test('a changed catalog invalidates current data, unchanged catalogs retain identity, and failed loads retry', async () => {
  const original = globalThis.fetch;
  let revision = 'first', calls = 0, fail = false;
  globalThis.fetch = async url => {
    if (url === '/api/seasons') return Response.json({ seasons: [{ key: '2035-spring' }], latest: '2035-spring', revision });
    calls++;
    if (fail) throw new Error('network');
    const data = publicSummary(); data.metadata.revision = revision;
    return Response.json(data);
  };
  try {
    const output = await build({ stdin: { contents: `export { refreshSeasonCatalog } from './lib/season-catalog'; export { loadStaticDataset, resetDatasetCache, getDatasetRevision, subscribeDatasetRefresh } from './lib/dataset-loader';`, resolveDir: resolve(import.meta.dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const { refreshSeasonCatalog, loadStaticDataset, resetDatasetCache, getDatasetRevision, subscribeDatasetRefresh } = module.exports;
    const path = '/data/season-2035-spring.json';
    const first = await refreshSeasonCatalog();
    assert.equal((await loadStaticDataset(path)).metadata.revision, 'first');
    assert.equal(await refreshSeasonCatalog(), first);
    await loadStaticDataset(path);
    assert.equal(calls, 1);
    revision = 'added-game';
    assert.notEqual(await refreshSeasonCatalog(), first);
    fail = true;
    await assert.rejects(loadStaticDataset(path), /network/);
    fail = false;
    await refreshSeasonCatalog();
    assert.equal((await loadStaticDataset(path)).metadata.revision, 'added-game');
    assert.equal(calls, 3);
    const beforeReset=getDatasetRevision(), visibleLoads=[];
    const unsubscribe=subscribeDatasetRefresh(()=>visibleLoads.push(loadStaticDataset(path)));
    resetDatasetCache();
    assert.equal(getDatasetRevision(),beforeReset+1);
    assert.equal((await Promise.all(visibleLoads))[0].metadata.revision,'added-game');
    assert.equal(calls,4,'same-catalog recovery reloads subscribed views from the new shared loader');
    unsubscribe();
  } finally { globalThis.fetch = original; }
});

test('catalog write quota failure cannot regress the latest known live seasons after network loss', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  const stored = new Map(); let writesFail = false, online = true, latest = '2035-spring';
  globalThis.caches = { open: async () => ({
    put: async (key, response) => { if (writesFail) throw new Error('quota exceeded'); stored.set(key, response.clone()); },
    match: async key => stored.get(key)?.clone(),
  }) };
  globalThis.fetch = async url => {
    assert.equal(url, '/api/seasons'); if (!online) throw new Error('offline');
    return Response.json({ seasons: [{ key: latest }], latest, revision: latest });
  };
  try {
    const output = await build({ stdin: { contents: `export { refreshSeasonCatalog } from './lib/season-catalog';`, resolveDir: resolve(import.meta.dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const { refreshSeasonCatalog } = module.exports;
    assert.equal((await refreshSeasonCatalog()).latest, '2035-spring');
    latest = '2040-fall'; writesFail = true;
    const recent = await refreshSeasonCatalog();
    assert.equal(recent.latest, '2040-fall');
    online = false;
    const fallback = await refreshSeasonCatalog();
    assert.equal(fallback.latest, '2040-fall');
    assert.equal(fallback, recent, 'the current in-memory catalog retains identity during an outage');
  } finally { globalThis.fetch = originalFetch; if (originalCaches === undefined) delete globalThis.caches; else globalThis.caches = originalCaches; }
});
