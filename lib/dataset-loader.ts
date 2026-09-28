import { applyPitchQuality } from './pitch-quality.mjs';
import { unpackDataset } from './dataset-transport.js';
import type { Dataset } from './dataset-types';

/** Only an explicit empty response means there is no uploaded dataset. */
export async function loadUploadedDataset(fetcher: typeof fetch = fetch): Promise<Dataset | null> {
  try {
    const response = await fetcher('/api/dataset', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error('Dataset request failed');
    const data = await response.json();
    if ((data.schemaVersion ?? 0) < 7 || !Array.isArray(data.pitches) || !Array.isArray(data.players)) throw new Error('Invalid dataset');
    return applyPitchQuality(data);
  } catch {
    throw new Error('最新データを確認できませんでした。通信状態を確認して再読み込みしてください。');
  }
}

/** One shared request and parsed object per static dataset, across all views. */
export function createDatasetLoader(fetcher: typeof fetch = fetch, current = false) {
  const cache = new Map<string, Promise<unknown>>();
  async function request(url: string) {
    const response = await fetcher(url, { cache: 'no-cache', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('データを読み込めませんでした。再読み込みしてください。');
    return applyPitchQuality(await response.json());
  }
  return function load<T>(url: string): Promise<T> {
    const existing = cache.get(url);
    if (existing) return existing as Promise<T>;
    const pending = (async () => {
      const match = /^\/data\/(season|spin)-([1-9]\d{3}-(?:spring|fall))\.json$/.exec(url);
      if (current && match) {
        const response = await fetcher(`/api/dataset?season=${match[2]}&format=${match[1] === 'spin' ? 'spin' : 'json'}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (response.status !== 204) {
          if (!response.ok) throw new Error('最新データを確認できませんでした。再読み込みしてください。');
          return applyPitchQuality(await response.json());
        }
      }
      if (/^\/data\/(season-|spin-).+\.json$/.test(url)) {
        try { return applyPitchQuality(unpackDataset(await request(url.replace('/data/', '/data/compact/')))); }
        catch { /* Old publications and offline caches still have the original JSON. */ }
      }
      return request(url);
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
