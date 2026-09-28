import { applyPitchQuality } from './pitch-quality.mjs';
import { unpackDataset } from './dataset-transport.js';
import type { Dataset } from './dataset-types';
import { publicOfflineStore, publicDataHash, validatePublicPair } from './public-offline.mjs';
import { setSavedPublicDataNotice } from './public-data-notice.ts';
import { repairLegacyAggregates } from './repair-legacy-aggregates.ts';

const normalize = <T>(data: T): T => applyPitchQuality(repairLegacyAggregates(data));

/** Only an explicit empty response means there is no uploaded dataset. */
export async function loadUploadedDataset(fetcher: typeof fetch = fetch): Promise<Dataset | null> {
  try {
    const response = await fetcher('/api/dataset', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error('Dataset request failed');
    const data = await response.json();
    if ((data.schemaVersion ?? 0) < 7 || !Array.isArray(data.pitches) || !Array.isArray(data.players)) throw new Error('Invalid dataset');
    return normalize(data);
  } catch {
    throw new Error('最新データを確認できませんでした。通信状態を確認して再読み込みしてください。');
  }
}

/** One shared request and parsed object per static dataset, across all views. */
export function createDatasetLoader(fetcher: typeof fetch = fetch, current = false, offline = publicOfflineStore) {
  const cache = new Map<string, Promise<unknown>>();
  type Pair = { summary: unknown; spin?: unknown; legacy?: boolean };
  const pairs = new Map<string, Promise<Pair | null>>();
  async function request(url: string) {
    const response = await fetcher(url, { cache: 'no-cache', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('データを読み込めませんでした。再読み込みしてください。');
    return await response.json();
  }
  async function bundledFile(season: string, kind: 'season' | 'spin', expectedHash: string) {
    const path = `/data/${kind}-${season}.json`;
    try {
      const data = unpackDataset(await request(path.replace('/data/', '/data/compact/')));
      if (await publicDataHash(JSON.stringify(data)) === expectedHash) return data;
    } catch { /* An older publication may only include original JSON. */ }
    const response = await fetcher(path, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('同梱データを読み込めませんでした。');
    const text = await response.text();
    if (await publicDataHash(text) !== expectedHash) throw new Error('公開版の切り替え中です。再読み込みしてください。');
    return JSON.parse(text);
  }
  async function pairFromNetwork(season: string): Promise<Pair | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const summaryResponse = await fetcher(`/api/dataset?season=${season}&format=json`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!summaryResponse.ok) throw new Error('最新データを確認できませんでした。再読み込みしてください。');
      const version = summaryResponse.headers.get('x-dataset-version');
      // Keep old publications usable, but do not save responses without a proven public identity.
      if (!version) return summaryResponse.status === 204 ? null : { summary: normalize(await summaryResponse.json()), legacy: true };
      if (summaryResponse.headers.get('x-dataset-season') !== season) throw new Error('取得したデータのシーズンが一致しません。');
      if (version.startsWith('legacy:')) return { summary: normalize(await summaryResponse.json()), legacy: true };
      const spinResponse = await fetcher(`/api/dataset?season=${season}&format=spin`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!spinResponse.ok) throw new Error('最新の回転データを確認できませんでした。');
      if (spinResponse.headers.get('x-dataset-version') !== version || spinResponse.headers.get('x-dataset-season') !== season || spinResponse.status !== summaryResponse.status) continue;
      let summary, spin;
      if (summaryResponse.status === 204) {
        const bundled = /^bundled:([a-f0-9]{64}):([a-f0-9]{64})$/.exec(version);
        if (!bundled) throw new Error('公開データの識別子が不正です。');
        [summary, spin] = await Promise.all([bundledFile(season, 'season', bundled[1]), bundledFile(season, 'spin', bundled[2])]);
      } else {
        [summary, spin] = await Promise.all([summaryResponse.json(), spinResponse.json()]);
      }
      validatePublicPair(season, summary, spin);
      summary = normalize(summary);
      await offline.savePair(season, version, summary, spin);
      setSavedPublicDataNotice(season, null);
      return { summary, spin };
    }
    throw new Error('データの更新中です。再読み込みしてください。');
  }
  function currentPair(season: string): Promise<Pair | null> {
    const existing = pairs.get(season); if (existing) return existing;
    const pending = pairFromNetwork(season).catch(async error => {
      const saved = await offline.readPair(season);
      if (saved) { setSavedPublicDataNotice(season, saved.savedAt); return { summary: normalize(saved.summary), spin: saved.spin }; }
      pairs.delete(season);
      throw error;
    });
    pairs.set(season, pending);
    while (pairs.size > 6) pairs.delete(pairs.keys().next().value!);
    return pending;
  }
  return function load<T>(url: string): Promise<T> {
    const existing = cache.get(url);
    if (existing) return existing as Promise<T>;
    const pending = (async () => {
      const match = /^\/data\/(season|spin)-([1-9]\d{3}-(?:spring|fall))\.json$/.exec(url);
      if (current && match) {
        const pair = await currentPair(match[2]);
        if (pair) {
          if (match[1] === 'season') return pair.summary;
          if (!pair.legacy) return pair.spin;
          const response = await fetcher(`/api/dataset?season=${match[2]}&format=spin`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
          if (!response.ok || response.status === 204) throw new Error('最新の回転データを確認できませんでした。');
          return await response.json();
        }
      }
      if (/^\/data\/(season-|spin-).+\.json$/.test(url)) {
        try { return normalize(unpackDataset(await request(url.replace('/data/', '/data/compact/')))); }
        catch { /* Old publications and offline caches still have the original JSON. */ }
      }
      return normalize(await request(url));
    })().catch(error => { cache.delete(url); throw error; });
    cache.set(url, pending);
    // Retain only the active comparison window; old years remain in durable storage.
    while (cache.size > 6) cache.delete(cache.keys().next().value!);
    return pending as Promise<T>;
  };
}

// All views, including historical comparisons and spin, share the same current snapshot.
let currentLoader = createDatasetLoader(fetch, true);
export const loadBundledDataset = createDatasetLoader();
export function resetDatasetCache() { currentLoader = createDatasetLoader(fetch, true); }
export function loadStaticDataset<T>(url: string): Promise<T> { return currentLoader<T>(url); }

/** Ignore older successes and failures without aborting another view's shared request. */
export function createLatestRequest() {
  let generation = 0;
  return { start() { const current = ++generation; return () => current === generation; }, cancel() { generation++; } };
}

export function readPreference(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function savePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Preferences must not block analysis. */ }
}
