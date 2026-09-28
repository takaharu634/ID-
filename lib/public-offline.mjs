import { isSeasonKey, seasonFromLabel, seasonInfo, sortSeasons } from './seasons.mjs';

export const PUBLIC_DATA_CACHE = 'tohto-public-snapshots-v1';
const SNAPSHOT_PATH = '/__tohto_public_cache__/snapshot/';
const CATALOG_PATH = '/__tohto_public_cache__/catalog';
export const OFFLINE_LIMITS = Object.freeze({ seasons: 6, bytes: 128 * 1024 * 1024, snapshotBytes: 64 * 1024 * 1024 });
const encoder = new TextEncoder();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validVersion = value => typeof value === 'string' && /^[A-Za-z0-9:._-]{1,200}$/.test(value);
export async function publicDataHash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validatePublicPair(season, summary, spin) {
  if (!isSeasonKey(season) || !object(summary) || !(summary.schemaVersion >= 7) || !object(summary.metadata) || seasonFromLabel(summary.metadata.season) !== season || !Array.isArray(summary.players) || !Array.isArray(summary.pitches) || !Array.isArray(spin)) throw new Error('公開データの形式またはシーズンが不正です。');
  if (summary.pitches.some(row => !object(row)) || summary.players.some(row => !object(row)) || spin.some(row => !object(row) || typeof row.pitcherId !== 'string' || typeof row.pitchType !== 'string' || (/^[1-9]\d{3}-(?:spring|fall):/.test(row.pitcherId) && !row.pitcherId.startsWith(`${season}:`)))) throw new Error('公開データの行が不正です。');
  return { summary, spin };
}

export function validatePublicCatalog(value) {
  if (!object(value) || !Array.isArray(value.seasons) || !value.seasons.length || value.seasons.length > 20000 || typeof value.revision !== 'string' || !value.revision.length || value.revision.length > 200 || !isSeasonKey(value.latest)) throw new Error('シーズン一覧が不正です。');
  const rows = new Map();
  for (const row of value.seasons) {
    if (!object(row) || !isSeasonKey(row.key) || rows.has(row.key) || (row.version !== undefined && !validVersion(row.version)) || ['pitches', 'games'].some(key => row[key] !== undefined && (!Number.isSafeInteger(row[key]) || row[key] < 0))) throw new Error('シーズン一覧が不正です。');
    rows.set(row.key, { ...seasonInfo(row.key), ...(row.version === undefined ? {} : { version: row.version }), ...(row.pitches === undefined ? {} : { pitches: row.pitches }), ...(row.games === undefined ? {} : { games: row.games }) });
  }
  if (!rows.has(value.latest)) throw new Error('最新シーズンがありません。');
  return { schemaVersion: 1, seasons: sortSeasons(rows.keys()).map(key => rows.get(key)), latest: value.latest, revision: value.revision };
}

function defaultStorage() { try { return typeof caches === 'undefined' ? null : caches; } catch { return null; } }
function urlFor(path) { return new URL(path, typeof location === 'undefined' ? 'https://offline.invalid' : location.origin).href; }

/** Only allowlisted public values enter this cache. CSV, admin responses and credentials never do. */
export function createPublicOfflineStore(storage = defaultStorage(), limits = OFFLINE_LIMITS) {
  let writing = Promise.resolve();
  async function cache() { return storage ? storage.open(PUBLIC_DATA_CACHE) : null; }
  async function readRecord(season) {
    const c = await cache(), response = c && await c.match(urlFor(`${SNAPSHOT_PATH}${season}`));
    if (!response) return null;
    const declaredBytes = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > limits.snapshotBytes) throw new Error('Invalid offline size');
    const text = await response.text();
    if (encoder.encode(text).length !== declaredBytes) throw new Error('Truncated offline snapshot');
    const record = JSON.parse(text);
    if (record.format !== 'tohto-public-pair-v1' || record.season !== season || !validVersion(record.version) || !Number.isFinite(record.savedAt) || record.savedAt <= 0 || typeof record.summary !== 'string' || typeof record.spin !== 'string') throw new Error('Invalid offline record');
    if (await publicDataHash(record.summary) !== record.summaryHash || await publicDataHash(record.spin) !== record.spinHash) throw new Error('Offline checksum mismatch');
    return { ...validatePublicPair(season, JSON.parse(record.summary), JSON.parse(record.spin)), version: record.version, savedAt: record.savedAt, season };
  }
  async function prune(c, incomingBytes, retain) {
    const rows = [];
    for (const request of await c.keys()) {
      if (!new URL(request.url).pathname.startsWith(SNAPSHOT_PATH) || request.url === retain) continue;
      const response = await c.match(request), bytes = Number(response?.headers.get('content-length')), time = Number(response?.headers.get('x-saved-at'));
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > limits.snapshotBytes || !Number.isFinite(time) || time <= 0) { await c.delete(request); continue; }
      rows.push({ request, bytes, time });
    }
    rows.sort((a, b) => a.time - b.time);
    let total = rows.reduce((sum, row) => sum + row.bytes, incomingBytes);
    while (rows.length && (rows.length + 1 > limits.seasons || total > limits.bytes)) { const row = rows.shift(); await c.delete(row.request); total -= row.bytes; }
  }
  return {
    async readPair(season) {
      if (!isSeasonKey(season)) return null;
      try { return await readRecord(season); }
      catch { try { await (await cache())?.delete(urlFor(`${SNAPSHOT_PATH}${season}`)); } catch { /* Storage is optional. */ } return null; }
    },
    async savePair(season, version, summary, spin) {
      const operation = writing.then(async () => {
        try {
          validatePublicPair(season, summary, spin);
          if (!validVersion(version)) return false;
          const c = await cache(); if (!c) return false;
          const summaryText = JSON.stringify(summary), spinText = JSON.stringify(spin), savedAt = Date.now();
          const text = JSON.stringify({ format: 'tohto-public-pair-v1', season, version, savedAt, summary: summaryText, spin: spinText, summaryHash: await publicDataHash(summaryText), spinHash: await publicDataHash(spinText) });
          const bytes = encoder.encode(text).length;
          if (bytes > limits.snapshotBytes || bytes > limits.bytes) return false;
          const key = urlFor(`${SNAPSHOT_PATH}${season}`);
          await prune(c, bytes, key);
          // Cache.put atomically replaces the pair. A failed write retains the prior whole pair.
          await c.put(key, new Response(text, { headers: { 'content-type': 'application/json', 'content-length': String(bytes), 'x-saved-at': String(savedAt) } }));
          await prune(c, bytes, key);
          return true;
        } catch { return false; }
      });
      writing = operation.then(() => undefined);
      return operation;
    },
    async saveCatalog(input) {
      try {
        const value = validatePublicCatalog(input), text = JSON.stringify(value);
        const c = await cache(); if (!c) return false;
        await c.put(urlFor(CATALOG_PATH), Response.json({ format: 'tohto-public-catalog-v1', value, hash: await publicDataHash(text) }));
        return true;
      } catch { return false; }
    },
    async readCatalog() {
      try {
        const c = await cache(), response = c && await c.match(urlFor(CATALOG_PATH)); if (!response) return null;
        const text = await response.text(); if (text.length > 8 * 1024 * 1024) return null;
        const record = JSON.parse(text);
        if (record.format !== 'tohto-public-catalog-v1' || await publicDataHash(JSON.stringify(record.value)) !== record.hash) return null;
        return validatePublicCatalog(record.value);
      } catch { return null; }
    },
  };
}

export const publicOfflineStore = createPublicOfflineStore();
