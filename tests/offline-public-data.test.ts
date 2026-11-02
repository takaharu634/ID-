import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { portableSha256 } from '../lib/sha256-portable.mjs';
import { createPublicOfflineStore, PUBLIC_DATA_CACHE, validatePublicCatalog, validatePublicPair } from '../lib/public-offline.mjs';
import { createDatasetLoader } from '../lib/dataset-loader.ts';
import { hasSavedPublicDataNotice } from '../lib/public-data-notice.ts';
import { bundledDatasetVersion } from '../lib/public-data-version.mjs';
import { packDataset } from '../lib/dataset-transport.js';
import { publicSummary, publicSpin } from './fixtures/public-data.mjs';

function memoryStorage() {
  const entries = new Map<string, Response>();
  let denied = false;
  const key = (value: string | Request) => typeof value === 'string' ? value : value.url;
  const cache = {
    keys: async () => [...entries.keys()].map(url => new Request(url)),
    match: async (request: string | Request) => entries.get(key(request))?.clone(),
    put: async (request: string | Request, response: Response) => { if (denied) throw new Error('quota'); entries.set(key(request), response.clone()); },
    delete: async (request: string | Request) => entries.delete(key(request)),
  };
  const storage = { open: async (name: string) => { assert.equal(name, PUBLIC_DATA_CACHE); return cache; } } as unknown as CacheStorage;
  return { entries, cache, storage, deny: () => { denied = true; } };
}
const responseFor = (season: string, version: string, format: string, summary = publicSummary(season)) => Response.json(format === 'spin' ? publicSpin(season) : summary, { headers: { 'x-dataset-version': version, 'x-dataset-season': season } });

test('portable SHA-256 matches standard vectors, padding boundaries and native bytes', () => {
  assert.equal(portableSha256(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 1000000]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 137 + 193) % 256);
    assert.equal(portableSha256(bytes), createHash('sha256').update(bytes).digest('hex'));
  }
});

test('HTTP previews without SubtleCrypto or CacheStorage still load verified bundled data', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const season = '2052-spring', summary = publicSummary(season), spin = publicSpin(season);
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const version = `bundled:${hash(summary)}:${hash(spin)}`;
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const load = createDatasetLoader(async url => {
      if (String(url).startsWith('/api/')) return new Response(null, { status: 204, headers: { 'x-dataset-version': version, 'x-dataset-season': season } });
      return Response.json(packDataset(String(url).includes('/spin-') ? spin : summary));
    }, true, createPublicOfflineStore(null));
    assert.deepEqual(await load(`/data/season-${season}.json`), summary);
    assert.deepEqual(await load(`/data/spin-${season}.json`), spin);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor); }
});

test('future season summary and spin survive offline as one verified public record', async () => {
  const mem = memoryStorage(), store = createPublicOfflineStore(mem.storage), season = '2042-fall';
  const urls: string[] = [];
  const online = createDatasetLoader(async url => { urls.push(String(url)); return responseFor(season, 'v1', new URL(String(url), 'https://test.invalid').searchParams.get('format')!); }, true, store);
  const summary = await online(`/data/season-${season}.json`), spin = await online(`/data/spin-${season}.json`);
  assert.equal(mem.entries.size, 1);
  assert.equal(urls.length, 2);
  assert.ok(urls.every(url => /^\/api\/dataset\?season=2042-fall&format=(json|spin)$/.test(url)));
  const offline = createDatasetLoader(async () => { throw new Error('offline'); }, true, store);
  assert.deepEqual(await offline(`/data/season-${season}.json`), summary);
  assert.deepEqual(await offline(`/data/spin-${season}.json`), spin);
  assert.equal(hasSavedPublicDataNotice(season), true);
  const recovered = createDatasetLoader(async url => responseFor(season, 'v1', new URL(String(url), 'https://test.invalid').searchParams.get('format')!), true, store);
  await recovered(`/data/season-${season}.json`);
  assert.equal(hasSavedPublicDataNotice(season), false, 'same-version recovery clears saved-data notice');
});

test('a concurrent publication change retries the whole pair and never caches a mixed pair', async () => {
  const mem = memoryStorage(), store = createPublicOfflineStore(mem.storage), season = '2043-spring';
  let calls = 0;
  const load = createDatasetLoader(async url => responseFor(season, ++calls === 1 ? 'v1' : 'v2', new URL(String(url), 'https://test.invalid').searchParams.get('format')!), true, store);
  await load(`/data/season-${season}.json`);
  assert.equal(calls, 4);
  assert.equal((await store.readPair(season))?.version, 'v2');
  const mixed = createDatasetLoader(async url => responseFor(season, String(url).endsWith('spin') ? 'v3' : 'v2', new URL(String(url), 'https://test.invalid').searchParams.get('format')!), true, createPublicOfflineStore(null));
  await assert.rejects(mixed(`/data/season-${season}.json`), /更新中/);
});

test('checksum changes, truncated pairs and malformed summaries cannot be restored', async () => {
  const mem = memoryStorage(), store = createPublicOfflineStore(mem.storage), season = '2044-spring';
  await store.savePair(season, 'v1', publicSummary(season), publicSpin(season));
  const [key, value] = [...mem.entries][0], record = await value.json();
  record.spin = '[]';
  const text = JSON.stringify(record);
  mem.entries.set(key, new Response(text, { headers: { 'content-length': String(Buffer.byteLength(text)) } }));
  assert.equal(await store.readPair(season), null);
  assert.equal(mem.entries.size, 0);
  const partial = publicSummary(season); delete (partial as unknown as Record<string, unknown>).games;
  assert.equal(await store.savePair(season, 'v1', partial, []), false);
  const mismatch = publicSummary(season); mismatch.metadata.pitches = 1;
  assert.throws(() => validatePublicPair(season, mismatch, []));
  assert.throws(() => validatePublicPair(season, publicSummary('2044-fall'), []));
});

test('quota failure preserves the prior complete pair and never hides a network response', async () => {
  const mem = memoryStorage(), store = createPublicOfflineStore(mem.storage), season = '2045-spring';
  assert.equal(await store.savePair(season, 'v1', publicSummary(season), []), true);
  mem.deny();
  const online = createDatasetLoader(async url => responseFor(season, 'v2', new URL(String(url), 'https://test.invalid').searchParams.get('format')!), true, store);
  assert.deepEqual(await online(`/data/season-${season}.json`), publicSummary(season));
  assert.equal((await store.readPair(season))?.version, 'v1');
  const small = createPublicOfflineStore(memoryStorage().storage, { seasons: 6, bytes: 100, snapshotBytes: 100 });
  assert.equal(await small.savePair(season, 'v1', publicSummary(season), []), false);
});

test('cache capacity is bounded by both season count and bytes, including concurrent writers', async () => {
  const mem = memoryStorage(), limits = { seasons: 2, bytes: 4000, snapshotBytes: 2000 };
  const first = createPublicOfflineStore(mem.storage, limits), second = createPublicOfflineStore(mem.storage, limits);
  await Promise.all(['2046-spring', '2046-fall', '2047-spring'].map((season, index) => (index % 2 ? first : second).savePair(season, 'v1', publicSummary(season), [])));
  assert.equal(mem.entries.size, 2);
  assert.equal(await first.readPair('2046-spring'), null);
  assert.ok(await first.readPair('2047-spring'));
  assert.ok([...mem.entries.values()].reduce((sum, response) => sum + Number(response.headers.get('content-length')), 0) <= limits.bytes);
});

test('validated future catalogs survive offline; duplicates, private fields and corruption are rejected or removed', async () => {
  const mem = memoryStorage(), store = createPublicOfflineStore(mem.storage);
  const input = { seasons: [{ key: '2050-fall', version: 'v1', password: 'must-not-persist', rawCsv: 'private' }], latest: '2050-fall', revision: 'future' };
  assert.equal(await store.saveCatalog(input), true);
  assert.equal((await store.readCatalog())?.latest, '2050-fall');
  const bytes = await [...mem.entries.values()][0].clone().text();
  assert.doesNotMatch(bytes, /password|rawCsv|must-not-persist/);
  assert.throws(() => validatePublicCatalog({ ...input, seasons: [...input.seasons, ...input.seasons] }));
  const key = [...mem.entries.keys()][0]; mem.entries.set(key, Response.json({ value: input, hash: 'bad' }));
  assert.equal(await store.readCatalog(), null);
});

test('unversioned old publications cannot return another season or an unverified spin pair', async () => {
  const wrong = createDatasetLoader(async () => Response.json(publicSummary('2026-spring')), true, createPublicOfflineStore(null));
  await assert.rejects(wrong('/data/season-2051-fall.json'), /シーズン/);
  const legacy = createDatasetLoader(async () => Response.json(publicSummary('2051-fall')), true, createPublicOfflineStore(null));
  assert.deepEqual(await legacy('/data/season-2051-fall.json'), publicSummary('2051-fall'));
  await assert.rejects(legacy('/data/spin-2051-fall.json'), /一致を確認/);
  const staticWrong = createDatasetLoader(async () => Response.json(publicSummary('2026-spring')));
  await assert.rejects(staticWrong('/data/season-2051-fall.json'), /シーズン/);
});

test('all real bundled seasons load through checksummed compact/original files and restore offline', async () => {
  for (const season of ['2025-fall', '2026-spring', '2026-fall']) {
    const mem = memoryStorage(), store = createPublicOfflineStore(mem.storage), version = bundledDatasetVersion(season)!;
    const loader = createDatasetLoader(async url => {
      const path = String(url);
      if (path.startsWith('/api/dataset?')) return new Response(null, { status: 204, headers: { 'x-dataset-season': season, 'x-dataset-version': version } });
      const source = await readFile(new URL(`../public${path.replace('/compact/', '/')}`, import.meta.url), 'utf8');
      return path.includes('/compact/') ? Response.json(packDataset(JSON.parse(source))) : new Response(source);
    }, true, store);
    const summary = await loader<{ metadata: { pitches: number }; pitches: unknown[] }>(`/data/season-${season}.json`);
    assert.equal(summary.metadata.pitches, summary.pitches.length);
    assert.ok(await store.readPair(season), `${season}: paired snapshot saved`);
    const offline = createDatasetLoader(async () => { throw new Error('offline'); }, true, store);
    assert.equal((await offline<{ metadata: { pitches: number } }>(`/data/season-${season}.json`)).metadata.pitches, summary.metadata.pitches);
  }
});

test('invalidated slow loaders cannot overwrite a newer offline snapshot or clear its notice', async () => {
  const mem = memoryStorage(), store = createPublicOfflineStore(mem.storage), season = '2055-fall';
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const older = createDatasetLoader(async url => {
    if (String(url).endsWith('json')) await delayed;
    return responseFor(season, 'old', new URL(String(url), 'https://test.invalid').searchParams.get('format')!);
  }, true, store);
  const oldRequest = older(`/data/season-${season}.json`);
  older.invalidate();
  const newer = createDatasetLoader(async url => responseFor(season, 'new', new URL(String(url), 'https://test.invalid').searchParams.get('format')!), true, store);
  await newer(`/data/season-${season}.json`);
  const fallback = createDatasetLoader(async () => { throw new Error('offline'); }, true, store);
  await fallback(`/data/season-${season}.json`);
  assert.equal(hasSavedPublicDataNotice(season), true);
  release(); await oldRequest;
  assert.equal((await store.readPair(season))?.version, 'new');
  assert.equal(hasSavedPublicDataNotice(season), true, 'an obsolete response cannot clear the current warning');
});

test('offline writes recheck validity after waiting for storage', async () => {
  const mem = memoryStorage(), season = '2056-spring';
  await createPublicOfflineStore(mem.storage).savePair(season, 'new', publicSummary(season), []);
  let release!: () => void, opened!: () => void, active = true;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { opened = resolve; });
  const storage = { open: async () => { opened(); await delayed; return mem.cache; } } as unknown as CacheStorage;
  const save = createPublicOfflineStore(storage).savePair(season, 'old', publicSummary(season), [], () => active);
  await started; active = false; release();
  assert.equal(await save, false);
  assert.equal((await createPublicOfflineStore(mem.storage).readPair(season))?.version, 'new');
});
