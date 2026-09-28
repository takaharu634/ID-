import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { packDataset, unpackDataset } from '../lib/dataset-transport.js';
import { createDatasetLoader, createLatestRequest, loadUploadedDataset } from '../lib/dataset-loader.ts';
import { publicSummary, publicSpin } from './fixtures/public-data.mjs';

test('compact transport preserves all real pitches, metadata, classifications and nulls', async () => {
  for (const season of ['2026-fall', '2026-spring', '2025-fall']) for (const kind of ['season', 'spin']) {
    const original = JSON.parse(await readFile(new URL(`../public/data/${kind}-${season}.json`, import.meta.url), 'utf8'));
    const serialized = JSON.stringify(packDataset(original));
    assert.deepEqual(unpackDataset(JSON.parse(serialized)), original);
    if (JSON.stringify(original).length > 100) assert.ok(serialized.length < JSON.stringify(original).length * .65);
  }
  const heterogeneous = [{ a: null, b: 0 }, { b: false, c: '' }, { a: 1.23456789012345 }];
  assert.deepEqual(unpackDataset(JSON.parse(JSON.stringify(packDataset(heterogeneous)))), heterogeneous);
  const unusual = JSON.parse('[{"__proto__":{"value":1},"constructor":2},{"constructor":null}]');
  assert.deepEqual(unpackDataset(JSON.parse(JSON.stringify(packDataset(unusual)))), unusual);
});

test('uploaded data failures remain distinct from an explicitly absent dataset', async () => {
  assert.equal(await loadUploadedDataset(async () => new Response(null, { status: 204 })), null);
  const data = { schemaVersion: 7, pitches: [{ result: '空振り' }], players: [] };
  assert.deepEqual(await loadUploadedDataset(async () => Response.json(data)), data);
  for (const response of [new Response('failed', { status: 503 }), new Response('{broken'), Response.json({ schemaVersion: 6 })]) {
    await assert.rejects(loadUploadedDataset(async () => response), /最新データを確認できませんでした/);
  }
  await assert.rejects(loadUploadedDataset(async () => { throw new DOMException('slow', 'TimeoutError'); }), /最新データを確認できませんでした/);
});

test('different views share one in-flight fetch and one decoded object', async () => {
  let calls = 0;
  const load = createDatasetLoader(async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json(packDataset(publicSpin('2026-spring')));
  });
  const [a, b] = await Promise.all([load('/data/spin-2026-spring.json'), load('/data/spin-2026-spring.json')]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(await load('/data/spin-2026-spring.json'), a);
  assert.equal(calls, 1);
});

test('an old publication falls back to JSON, and a failed request can retry', async () => {
  const urls: string[] = [];
  let fail = true;
  const load = createDatasetLoader(async url => {
    urls.push(String(url));
    if (String(url).includes('/compact/') || fail) return new Response('missing', { status: 404 });
    return Response.json(publicSummary('2026-spring'));
  });
  await assert.rejects(load('/data/season-2026-spring.json'));
  fail = false;
  assert.deepEqual(await load('/data/season-2026-spring.json'), publicSummary('2026-spring'));
  assert.equal(urls.length, 4);
});

test('late season success and failure cannot overwrite the most recent selection', async () => {
  const latest = createLatestRequest();
  const spring = latest.start();
  const fall = latest.start();
  let displayed = '';
  await Promise.all([
    new Promise<void>(resolve => setTimeout(() => { if (spring()) displayed = 'spring'; resolve(); }, 10)),
    Promise.resolve().then(() => { if (fall()) displayed = 'fall'; }),
  ]);
  assert.equal(displayed, 'fall');
  assert.equal(spring(), false);
  latest.cancel();
  assert.equal(fall(), false);
});

test('every current season and spin request checks its own active snapshot; errors never hide behind static fallback',async()=>{
 const urls:string[]=[];const load=createDatasetLoader(async url=>{
  urls.push(String(url));const query=new URL(String(url),'https://test.invalid').searchParams, season=query.get('season')!;
  return Response.json(query.get('format')==='spin'?[]:publicSummary(season),{headers:{'x-dataset-version':'current','x-dataset-season':season}});
 },true);
 for(const kind of ['season','spin'])for(const season of ['2025-fall','2026-spring','2026-fall'])await load(`/data/${kind}-${season}.json`);
 assert.equal(urls.length,6);assert.ok(urls.every(u=>u.startsWith('/api/dataset?season=')));assert.equal(urls.filter(u=>u.endsWith('format=spin')).length,3);
 const fail=createDatasetLoader(async()=>new Response('failed',{status:503}),true);await assert.rejects(fail('/data/season-2026-fall.json'),/最新データ/);
});
