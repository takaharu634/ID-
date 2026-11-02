const CACHE_VERSION = 'tohto-savant-offline-v10';
const APP_CACHE = `${CACHE_VERSION}-app`;
// The application validates and atomically saves summary + spin as one record.
const DATA_CACHE = 'tohto-public-snapshots-v1';
const CORE_FILES = ['/', '/manifest.webmanifest', '/favicon.svg'];
const ASSET = /\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?)$/i;
const PRIVATE_PATH = /^\/(?:admin|api|signin-with-chatgpt|signout-with-chatgpt|callback)(?:\/|$)/;

async function cachedResponse(request) {
  try { return await caches.match(request); }
  catch { return undefined; }
}
async function saveAppResponse(request, response) {
  try {
    const cache = await caches.open(APP_CACHE);
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    const removable = keys.filter(key => !CORE_FILES.includes(new URL(key.url).pathname));
    for (const key of removable.slice(0, Math.max(0, keys.length - 128))) await cache.delete(key);
  } catch { /* Browser storage restrictions must not hide a successful response. */ }
}

async function cacheAppShell() {
  const cache = await caches.open(APP_CACHE);
  const response = await fetch('/', { cache: 'reload' });
  if (!response.ok) throw new Error('App shell unavailable');
  await cache.put('/', response.clone());
  const html = await response.text();
  const urls = new Set(CORE_FILES.slice(1));
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && !PRIVATE_PATH.test(url.pathname) && ASSET.test(url.pathname)) urls.add(`${url.pathname}${url.search}`);
    } catch { /* Ignore non-URL attributes. */ }
  }
  await Promise.allSettled([...urls].map(async url => {
    const asset = await fetch(url, { cache: 'reload' });
    if (asset.ok) await cache.put(url, asset);
  }));
}

self.addEventListener('install', event => {
  // Save only the shell. Season and spin data are cached when actually opened.
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('tohto-savant-offline-') && ![APP_CACHE, DATA_CACHE].includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE_READY') return;
  event.waitUntil((async () => {
    const cache = await caches.open(DATA_CACHE);
    const keys = await cache.keys();
    const seasons = [...new Set(keys.map(key=>/^\/__tohto_public_cache__\/snapshot\/([1-9]\d{3}-(?:spring|fall))$/.exec(new URL(key.url).pathname)?.[1]).filter(Boolean))];
    event.source?.postMessage({ type: 'OFFLINE_STATUS', version: CACHE_VERSION, seasons });
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || PRIVATE_PATH.test(url.pathname) || url.pathname.endsWith('.csv') || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    if (url.pathname !== '/') return;
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.status >= 500) return (await cachedResponse('/')) || response;
        if (response.ok) await saveAppResponse('/', response);
        return response;
      } catch { return (await cachedResponse('/')) || Response.error(); }
    })());
    return;
  }

  // Never return individually cached JSON: it can mix two active publications.
  // A network failure is handled by the application's verified paired snapshot.
  if (url.pathname.startsWith('/data/')) return;

  if (ASSET.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await cachedResponse(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await saveAppResponse(request, response);
        return response;
      } catch { return new Response('Offline asset unavailable', { status: 503 }); }
    })());
  }
});
