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
    return data;
  } catch {
    throw new Error('最新データを確認できませんでした。通信状態を確認して再読み込みしてください。');
  }
}

/** One shared request and parsed object per static dataset, across all views. */
export function createDatasetLoader(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, Promise<unknown>>();
  async function request(url: string) {
    const response = await fetcher(url, { cache: 'no-cache', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('データを読み込めませんでした。再読み込みしてください。');
    return response.json();
  }
  return function load<T>(url: string): Promise<T> {
    const existing = cache.get(url);
    if (existing) return existing as Promise<T>;
    const pending = (async () => {
      if (/^\/data\/(season-|spin-).+\.json$/.test(url)) {
        try { return unpackDataset(await request(url.replace('/data/', '/data/compact/'))); }
        catch { /* Old publications and offline caches still have the original JSON. */ }
      }
      return request(url);
    })().catch(error => { cache.delete(url); throw error; });
    cache.set(url, pending);
    return pending as Promise<T>;
  };
}

export const loadStaticDataset = createDatasetLoader();

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
