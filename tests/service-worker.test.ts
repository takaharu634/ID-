import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

type WorkerTestEvent = {
  request?: Request;
  waitUntil(work: Promise<unknown>): void;
  respondWith(work: Promise<Response>): void;
};

async function harness() {
  const listeners = new Map<string, (event: WorkerTestEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const fetched: string[] = [];
  let offline = false;
  let quotaExceeded = false;
  let claimed = false;
  const key = (request: string | Request) => new URL(typeof request === 'string' ? request : request.url, 'https://test.invalid').href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (quotaExceeded) throw new Error("storage disabled");
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (request: string | Request, response: Response) => { store.set(key(request), response.clone()); },
        keys: async () => [...store.keys()].map(url => new Request(url)),
        delete: async (request: string | Request) => store.delete(key(request)),
      };
    },
    match: async (request: string | Request) => {
      if (quotaExceeded) throw new Error("storage disabled");
      for (const store of stores.values()) if (store.has(key(request))) return store.get(key(request))!.clone();
    },
  };
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://test.invalid' }, addEventListener: (name: string, fn: (event: WorkerTestEvent) => void) => listeners.set(name, fn), skipWaiting: async () => {}, clients: { claim: async () => { claimed = true; } } },
    caches, URL, Response, setTimeout, clearTimeout,
    fetch: async (request: string | Request) => {
      const url = key(request);
      fetched.push(url);
      if (offline) throw new Error('offline');
      return new URL(url).pathname === '/' ? new Response('<script src="/assets/app.js"></script><a href="/admin">管理</a>') : Response.json({ pitches: [1] });
    },
  });
  async function dispatch(type: string, extra: object = {}) {
    const pending: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners.get(type)!({ ...extra, waitUntil: (work: Promise<unknown>) => pending.push(work), respondWith: (work: Promise<Response>) => { response = work; } });
    const result = await response;
    await Promise.all(pending);
    return { result, backgroundTasks: pending.length };
  }
  return { dispatch, caches, stores, fetched, exhaustStorage: () => { quotaExceeded = true; }, setOffline: () => { offline = true; }, claimed: () => claimed };
}

test('offline install caches shell without downloading unused seasons, and removes obsolete caches', async () => {
  const h = await harness();
  await h.caches.open('tohto-savant-offline-v4-data');
  const retained = await h.caches.open('tohto-savant-offline-v5-data');
  await retained.put('/data/compact/season-2026-fall.json', Response.json({ pitches: [42] }));
  await h.dispatch('install');
  assert.ok(h.fetched.some(url => url.endsWith('/assets/app.js')));
  assert.ok(h.fetched.every(url => !url.includes('/data/') && !url.includes('/admin')));
  await h.dispatch('activate');
  assert.equal(h.claimed(), true);
  assert.ok(!h.stores.has('tohto-savant-offline-v4-data'));
  assert.ok(h.stores.has('tohto-savant-offline-v8-app'));
  assert.deepEqual(await (await h.caches.match('/data/compact/season-2026-fall.json'))!.json(), { pitches: [42] });
});

test('offline worker excludes authenticated routes, API, CSV and other origins', async () => {
  const h = await harness();
  for (const path of ['/admin', '/api/dataset', '/signin-with-chatgpt', '/signout-with-chatgpt', '/callback', '/data/initial-data.csv', '/sw.js', 'https://other.invalid/file.js']) {
    const { result, backgroundTasks } = await h.dispatch('fetch', { request: new Request(new URL(path, 'https://test.invalid')) });
    assert.equal(result, undefined, path);
    assert.equal(backgroundTasks, 0);
  }
  assert.equal(h.fetched.length, 0);
});

test('used data refresh stays alive and a later network failure returns its cached JSON', async () => {
  const h = await harness();
  const request = new Request('https://test.invalid/data/compact/season-2026-spring.json');
  const first = await h.dispatch('fetch', { request });
  assert.equal(first.backgroundTasks, 1);
  assert.deepEqual(await first.result!.json(), { pitches: [1] });
  h.setOffline();
  const second = await h.dispatch('fetch', { request });
  assert.deepEqual(await second.result!.json(), { pitches: [1] });
  const absent = await h.dispatch('fetch', { request: new Request('https://test.invalid/data/compact/season-2025-fall.json') });
  assert.equal(absent.result!.status, 503);
});


test('storage denied still returns successful page, asset and data responses', async () => {
  const h = await harness();
  h.exhaustStorage();
  for (const path of ['/', '/assets/new.js', '/data/compact/season-2035-spring.json']) {
    const request = new Request(`https://test.invalid${path}`);
    if (path === '/') Object.defineProperty(request, 'mode', { value: 'navigate' });
    const { result } = await h.dispatch('fetch', { request });
    assert.equal(result?.status, 200, path);
  }
});

test('data cache stays bounded and retains the file refreshed at its limit', async () => {
  const h = await harness();
  for (let year = 2020; year < 2033; year++) {
    await h.dispatch('fetch', { request: new Request(`https://test.invalid/data/compact/season-${year}-spring.json`) });
  }
  const cache = await h.caches.open('tohto-savant-offline-v5-data');
  assert.equal((await cache.keys()).length, 12);
  assert.equal(await h.caches.match('/data/compact/season-2020-spring.json'), undefined);
  await h.dispatch('fetch', { request: new Request('https://test.invalid/data/compact/season-2021-spring.json') });
  assert.ok(await h.caches.match('/data/compact/season-2021-spring.json'));
});
