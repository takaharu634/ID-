import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

test('a changed catalog invalidates current data, unchanged catalogs retain identity, and failed loads retry', async () => {
  const original = globalThis.fetch;
  let revision = 'first', calls = 0, fail = false;
  globalThis.fetch = async url => {
    if (url === '/api/seasons') return Response.json({ seasons: [{ key: '2035-spring' }], latest: '2035-spring', revision });
    calls++;
    if (fail) throw new Error('network');
    return Response.json({ schemaVersion: 7, metadata: { revision }, pitches: [], players: [] });
  };
  try {
    const output = await build({ stdin: { contents: `export { refreshSeasonCatalog } from './lib/season-catalog'; export { loadStaticDataset } from './lib/dataset-loader';`, resolveDir: resolve(import.meta.dirname, '..'), loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external' });
    const module = { exports: {} };
    new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    const { refreshSeasonCatalog, loadStaticDataset } = module.exports;
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
  } finally { globalThis.fetch = original; }
});
